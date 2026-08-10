import fs from "fs/promises";
import type Database from "better-sqlite3";
import type {
  ServerId,
  ServerConfig,
  IServerManager,
  IServerDiscovery,
  IProcessSupervisor,
  IRconManager,
  IConfigService,
  IBroadcaster,
  ActiveOperation,
  WorkshopFileId,
  IWorkshopApplyService,
  CommandsDatRecord,
} from "@unturned-manager/shared";
import { ServerState, RconConnectionState } from "@unturned-manager/shared";
import { logger } from "../../utils/logger.js";
import { AppError } from "../../utils/AppError.js";
import { resolveInstallDir, resolveServerPath } from "./pathResolver.js";
import {
  detectStartScript,
  ensureStartScriptExecutable,
} from "./startScript.js";
import {
  getRconCredential,
  setRconCredential,
  deleteRconCredentials,
} from "../settings/settingsStorage.js";

// ─── 常量 ────────────────────────────────────────────

const SHUTDOWN_TIMEOUT = 30_000; // 等待进程退出
const CRASH_RESTART_DELAY = 5_000; // T6: 崩溃 5s 硬重启（抄 GSM GameManager.ts:331-335）

// ─── 运行时状态 (in-memory, 目录扫描真源 + settings K-V) ──

interface RuntimeServerState {
  state: ServerState;
  activeOperation: ActiveOperation;
  config: ServerConfig;
}

/**
 * 服务端聚合根（ADR-0003 B2 目录扫描重构）。
 *
 * 数据源变更：
 *   - 实例身份 = <installDir>/Servers/<id>/Server/Commands.dat 存在性（目录扫描，替代 DB servers 表）
 *   - 运行时状态 = in-memory（B2 §9.6：面板启动不吸附真实进程，一律 STOPPED）
 *   - RCON 凭证 = settings K-V（AES-GCM 加密，ADR-17 双协议分离）
 *
 * 状态机：STOPPED → STARTING → RUNNING；RUNNING → STOPPING → STOPPED；RUNNING ↔ DEGRADED。
 */
export class ServerManager implements IServerManager {
  private servers = new Map<ServerId, RuntimeServerState>();

  constructor(
    private db: Database.Database,
    private discovery: IServerDiscovery,
    private processSupervisor: IProcessSupervisor,
    private rconManager: IRconManager,
    private configService: IConfigService,
    private broadcaster: IBroadcaster,
    private workshopApply?: IWorkshopApplyService,
  ) {
    this.loadServersFromDisk();

    // CLAUDE.md §4.7: DEGRADED 状态接线——RCON 断连 → 降级
    this.rconManager.onStateChange((serverId, state) => {
      if (state === RconConnectionState.DEGRADED) {
        this.transition(serverId, ServerState.DEGRADED);
      } else if (state === RconConnectionState.CONNECTED) {
        const current = this.getState(serverId);
        if (current === ServerState.DEGRADED) {
          this.transition(serverId, ServerState.RUNNING);
        }
      }
    });

    // CLAUDE.md §4.7: 崩溃检测——进程退出 → STOPPED；T6: 非预期退出 5s 硬重启
    this.processSupervisor.onCrash((serverId, exitCode) => {
      logger.warn({ serverId, exitCode }, "U3DS 进程退出");
      this.transition(serverId, ServerState.STOPPED);
      this.scheduleCrashRestart(serverId, exitCode);
    });
  }

  // ── 目录扫描加载 ────────────────────────────────────

  /**
   * 从目录扫描加载实例（B2 §3.1）。真源 = Commands.dat 存在性。
   * 状态一律 STOPPED（B2 §9.6：不吸附真实进程）；RCON 凭证从 settings K-V 恢复。
   */
  private loadServersFromDisk(): void {
    const discovered = this.discovery.scanSync(resolveInstallDir());
    for (const s of discovered) {
      this.servers.set(s.id, {
        state: ServerState.STOPPED,
        activeOperation: { type: "none" },
        config: {
          id: s.id,
          name: s.name,
          gamePort: s.gamePort,
          ownerSteamId: s.ownerSteamId,
          installDir: resolveInstallDir(),
        },
      });
      this.restoreRcon(s.id);
    }
    logger.info({ count: discovered.length }, "已从目录扫描加载服务器");
  }

  // ── 查询 ────────────────────────────────────────────

  getState(serverId: ServerId): ServerState {
    return this.servers.get(serverId)?.state ?? ServerState.STOPPED;
  }

  getActiveOperation(serverId: ServerId): ActiveOperation {
    return this.servers.get(serverId)?.activeOperation ?? { type: "none" };
  }

  async listServers(): Promise<ServerConfig[]> {
    return Array.from(this.servers.values()).map((s) => s.config);
  }

  /** 同步版——直接读 in-memory Map（启动时给 LogStreamer 接线用） */
  listServersSync(): string[] {
    return Array.from(this.servers.keys());
  }

  /** 活跃实例（状态非 STOPPED）——SteamCmdManager 更新 U3DS 前置检查用（替代 DB state 列） */
  listActiveServerIds(): ServerId[] {
    return Array.from(this.servers.entries())
      .filter(([, e]) => e.state !== ServerState.STOPPED)
      .map(([id]) => id);
  }

  // ── 创建 / 配置 / 删除 ──────────────────────────────

  /**
   * 创建实例（B2 §3.1）：目录真源——建 Servers/<id>/Server/Commands.dat 即实例成立。
   * 不再写 DB；RCON 凭证落 settings K-V。
   *
   * @throws {AppError} code=server-exists, status=409 当 Commands.dat 已存在（重复创建）
   */
  async createServer(config: ServerConfig): Promise<void> {
    // 目录真源幂等检查：Commands.dat 已存在 → 已创建过
    const cmdsPath = resolveServerPath(config.id, "Server/Commands.dat");
    try {
      await fs.access(cmdsPath);
      throw new AppError("server-exists", `服务端 ${config.id} 已存在`, 409);
    } catch (err) {
      if (err instanceof AppError) throw err; // 已存在 → 409
      // ENOENT → 正常创建
    }

    await fs.mkdir(resolveServerPath(config.id, "Server"), { recursive: true });
    const record: CommandsDatRecord = {
      known: {
        Name: config.name,
        Port: String(config.gamePort),
        Owner: config.ownerSteamId,
      },
      unknown: {},
      comments: [],
    };
    await this.configService.writeCommandsDat(config.id, record);

    // RCON 凭证 → settings K-V（AES-GCM）
    if (config.openModCredential) {
      setRconCredential(
        this.db,
        config.id,
        "openmod",
        config.openModCredential,
      );
    }
    if (config.rconPassword) {
      setRconCredential(this.db, config.id, "rocketmod", config.rconPassword);
    }

    // installDir 一律取全局（B2 §2.5：忽略客户端传入值，防多路径漂移）
    const normalized: ServerConfig = {
      ...config,
      installDir: resolveInstallDir(),
    };
    this.servers.set(config.id, {
      state: ServerState.STOPPED,
      activeOperation: { type: "none" },
      config: normalized,
    });

    this.restoreRcon(config.id);
    logger.info({ serverId: config.id }, "服务器已创建");
  }

  /**
   * 更新实例配置。凭证变更 → settings K-V + 重新 register（B2 §3.3 缺口 2 修复）；
   * 身份字段变更 → 写回 Commands.dat，保持目录真源同步。
   *
   * @throws {AppError} code=server-not-found, status=404 当实例不存在
   */
  async configureServer(
    serverId: ServerId,
    patch: Partial<ServerConfig>,
  ): Promise<void> {
    const existing = this.ensureServer(serverId);
    const updated = {
      ...existing.config,
      ...patch,
      installDir: resolveInstallDir(),
    };

    // 凭证变更 → 落 K-V，随后 restoreRcon 重新 register
    if (patch.openModCredential !== undefined) {
      setRconCredential(this.db, serverId, "openmod", patch.openModCredential);
    }
    if (patch.rconPassword !== undefined) {
      setRconCredential(this.db, serverId, "rocketmod", patch.rconPassword);
    }

    // 身份字段变更 → 写回 Commands.dat
    if (
      patch.name !== undefined ||
      patch.gamePort !== undefined ||
      patch.ownerSteamId !== undefined
    ) {
      const record = await this.configService.readCommandsDat(serverId);
      if (patch.name !== undefined) record.known.Name = patch.name;
      if (patch.gamePort !== undefined)
        record.known.Port = String(patch.gamePort);
      if (patch.ownerSteamId !== undefined)
        record.known.Owner = patch.ownerSteamId;
      await this.configService.writeCommandsDat(serverId, record);
    }

    existing.config = updated;
    if (patch.gamePort != null) {
      // A2S 通道已删（ADR-0004 Phase 1）——端口变更无需 register
    }
    this.restoreRcon(serverId);
    logger.info({ serverId }, "服务器配置已更新");
  }

  /**
   * 删除实例（B2 §3.6）：RUNNING 先优雅 stop → 删目录（幂等）→ 删 RCON 凭证 K-V → unregister。
   * 目录不存在时幂等返回（不抛错）。
   *
   * @param serverId - 实例 ID
   */
  async removeServer(serverId: ServerId): Promise<void> {
    const entry = this.servers.get(serverId);
    if (entry && entry.state !== ServerState.STOPPED) {
      await this.stopInternal(serverId, "删除实例");
    }

    try {
      await fs.rm(resolveServerPath(serverId, ""), {
        recursive: true,
        force: true,
      });
    } catch {
      /* 目录不存在——幂等返回 */
    }

    deleteRconCredentials(this.db, serverId);
    this.rconManager.unregister(serverId);
    this.servers.delete(serverId);
    logger.info({ serverId }, "服务器已删除");
  }

  // ── 生命周期 ───────────────────────────────────────

  async start(serverId: ServerId): Promise<void> {
    const entry = this.ensureServer(serverId);

    if (entry.activeOperation.type !== "none") {
      throw new AppError(
        "operation-conflict",
        `操作冲突: ${entry.activeOperation.type}`,
        409,
      );
    }

    if (entry.state === ServerState.RUNNING) return;

    entry.activeOperation = {
      type: "manual_start",
      startedAt: new Date().toISOString(),
    };
    this.transition(serverId, ServerState.STARTING);

    try {
      const { id, installDir } = entry.config;
      // T6: 启动脚本探测 + chmod +x 后 spawn（抄 GSM detectStartScript）
      const pid = await this.spawnU3DS(id, installDir);
      logger.info({ serverId, pid, installDir }, "U3DS 进程已启动");

      // ★ ADR-0004 Phase 1 中间态：A2S 通道已删除，RUNNING 立即触发。
      // Phase 2 将改成「PTY 输出 'Server is ready' / 'World saved' 信号触发 RUNNING」
      this.transition(serverId, ServerState.RUNNING);

      // 连接 RCON
      try {
        await this.rconManager.connect(serverId);
      } catch (err) {
        logger.warn({ serverId, err }, "RCON 连接失败，服务仍在运行");
      }
    } catch (err) {
      logger.error({ serverId, err }, "启动失败");
      // BUG-3/7（第四版）：spawn 失败时，spawn 的 ServerHelper.sh 可能还挂在后台
      // （比如 Mono 慢启动），若不清理，processes map 残留 → 下次启动被「已有进程在运行」拦截。
      // 启动失败即清理，保证可重试。
      try {
        this.processSupervisor.forceKill(serverId);
      } catch {
        /* 进程可能已退出，forceKill 幂等 */
      }
      this.transition(serverId, ServerState.STOPPED);
      // BUG-3/7（第四版）：非 AppError 的启动错误（spawn ENOENT / Mono 缺失）原样上抛
      // 会被全局错误处理兜底成「服务器内部错误」——用户和面板都看不到真实原因。
      // 包装成带 err.message 的 AppError，前端 toast 直接显示具体错因，便于定位。
      if (err instanceof AppError) throw err;
      throw new AppError(
        "u3ds-start-failed",
        `U3DS 启动失败: ${err instanceof Error ? err.message : String(err)}`,
        500,
      );
    } finally {
      entry.activeOperation = { type: "none" };
    }
  }

  async stop(serverId: ServerId, reason: string): Promise<void> {
    const entry = this.ensureServer(serverId);

    if (entry.activeOperation.type !== "none") {
      throw new AppError(
        "operation-conflict",
        `操作冲突: ${entry.activeOperation.type}`,
        409,
      );
    }

    entry.activeOperation = {
      type: "manual_stop",
      startedAt: new Date().toISOString(),
    };
    this.transition(serverId, ServerState.STOPPING);

    try {
      // 尝试 RCON Save + Shutdown
      if (this.rconManager.isReachable(serverId)) {
        try {
          await this.rconManager.execute(serverId, "Save");
        } catch {
          /* RCON 可能已断开 */
        }
        try {
          await this.rconManager.execute(serverId, `Shutdown 30 "${reason}"`);
        } catch {
          /* Shutdown 可能不受支持 */
        }
      }

      await this.processSupervisor.waitForExit(serverId, SHUTDOWN_TIMEOUT);
      this.transition(serverId, ServerState.STOPPED);
      this.rconManager.disconnect(serverId);
    } catch {
      // 进程未在超时内退出
      logger.warn({ serverId }, "停止超时，SIGKILL");
      this.processSupervisor.forceKill(serverId);
      this.transition(serverId, ServerState.STOPPED);
    } finally {
      entry.activeOperation = { type: "none" };
    }
  }

  async restart(serverId: ServerId, reason: string): Promise<void> {
    const entry = this.ensureServer(serverId);

    // CLAUDE.md §4.7: restart 全过程由一个 activeOperation 覆盖，防止竞态
    if (entry.activeOperation.type !== "none") {
      throw new AppError(
        "operation-conflict",
        `操作冲突: ${entry.activeOperation.type}`,
        409,
      );
    }
    entry.activeOperation = {
      type: "manual_restart",
      startedAt: new Date().toISOString(),
    };

    try {
      // 内部 stop（绕过 stop() 的 activeOperation 检查）
      await this.stopInternal(serverId, reason);
      // 内部 start
      await this.startInternal(serverId);
    } finally {
      entry.activeOperation = { type: "none" };
    }
  }

  /** 内部 stop——不检查 activeOperation（由 restart / removeServer 统一管理）。 */
  private async stopInternal(
    serverId: ServerId,
    reason: string,
  ): Promise<void> {
    this.transition(serverId, ServerState.STOPPING);

    if (this.rconManager.isReachable(serverId)) {
      try {
        await this.rconManager.execute(serverId, "Save");
      } catch {
        /* noop */
      }
      try {
        await this.rconManager.execute(serverId, `Shutdown 30 "${reason}"`);
      } catch {
        /* noop */
      }
    }

    try {
      await this.processSupervisor.waitForExit(serverId, SHUTDOWN_TIMEOUT);
    } catch {
      this.processSupervisor.forceKill(serverId);
    }

    this.transition(serverId, ServerState.STOPPED);
    this.rconManager.disconnect(serverId);
  }

  /** 内部 start——不检查 activeOperation（由 restart 统一管理）。 */
  private async startInternal(serverId: ServerId): Promise<void> {
    const entry = this.ensureServer(serverId);
    if (entry.state === ServerState.RUNNING) return;

    this.transition(serverId, ServerState.STARTING);

    const { id, installDir } = entry.config;
    // T6: 启动脚本探测 + chmod +x 后 spawn（抄 GSM detectStartScript）
    const pid = await this.spawnU3DS(id, installDir);

    logger.info({ serverId, pid, installDir }, "U3DS 进程已启动");
    // ★ ADR-0004 Phase 1 中间态：A2S 通道已删除，RUNNING 立即触发（Phase 2 改 PTY ready）
    this.transition(serverId, ServerState.RUNNING);

    try {
      await this.rconManager.connect(serverId);
    } catch {
      /* noop */
    }
  }

  /**
   * 探测 U3DS 启动脚本 + chmod +x + spawn（T6 抄 GSM detectStartScript）。
   * 统一带 +InternetServer/<id> 参数（对齐 GSM3 docs 启动方式：启动脚本负责拉起 U3DS，
   * 后置参数覆盖 ExampleServer.sh 自带的 +InternetServer/Default，保证启动用户创建的实例）。
   *
   * @throws {AppError} code=start-script-not-found, status=500 当 installDir 无 U3DS 启动脚本
   */
  private async spawnU3DS(id: ServerId, installDir: string): Promise<number> {
    const script = await detectStartScript(installDir);
    if (!script) {
      // BUG-3/7：未安装 U3DS 时给可执行的引导，而不是裸 500「未检测到启动脚本」。
      // status 409（前置条件不满足）：U3DS 二进制尚未安装或安装不完整。
      throw new AppError(
        "start-script-not-found",
        `U3DS 未安装或安装不完整（${installDir} 下未找到 ServerHelper.sh/ExampleServer.sh）。请先在「服务器设置」页点击「安装 U3DS」后再启动。`,
        409,
      );
    }
    await ensureStartScriptExecutable(installDir, script);
    // 对齐 GSM3 docs 启动方式：统一带 +InternetServer/<id> + -ThreadedConsole。
    // ServerHelper.sh 透传参数；ExampleServer.sh 自带 +InternetServer/Default 会被后置参数覆盖——
    // 保证启动的是用户创建的 <id> 实例而非 Default（BUG-3/7 潜在错实例修复）。
    const args = [`+InternetServer/${id}`, "-ThreadedConsole"];
    return this.processSupervisor.spawn(
      id,
      `${installDir}/${script}`,
      args,
      installDir,
    );
  }

  /**
   * 崩溃 5s 硬重启（T6 抄 GSM GameManager.ts:331-335）。守卫：
   *   - 主动操作（manual_stop/manual_restart/mod_apply）期间退出 → 不重启
   *   - exitCode === 0（RCON 优雅关闭等正常退出）→ 不重启
   *   - 5s 后实例已被删除 → 跳过
   */
  private scheduleCrashRestart(
    serverId: ServerId,
    exitCode: number | null,
  ): void {
    const entry = this.servers.get(serverId);
    if (!entry || entry.activeOperation.type !== "none") return;
    if (exitCode === 0) return;
    logger.info({ serverId, exitCode }, "5s 后自动重启");
    setTimeout(() => {
      if (!this.servers.has(serverId)) return; // 期间被删除
      void this.startInternal(serverId).catch((err) => {
        logger.error({ serverId, err }, "崩溃自动重启失败");
      });
    }, CRASH_RESTART_DELAY);
  }

  async forceStop(serverId: ServerId): Promise<void> {
    const entry = this.ensureServer(serverId);
    logger.warn({ serverId }, "强制停止");

    this.processSupervisor.forceKill(serverId);
    this.rconManager.disconnect(serverId);
    this.transition(serverId, ServerState.STOPPED);
    entry.activeOperation = { type: "none" };
  }

  // ── Mod / Update (Phase 2: Mod apply 流水线) ─────────

  /**
   * 9 步 Mod 应用流水线（详见 ADR-0002 §6.2）：
   * ① 备份 WorkshopDownloadConfig.json
   * ② writeWorkshopFileIds 写新 ID
   * ③ RCON `Say` 公告即将重启
   * ④ 每 10s 广播一次倒计时（共 5 次：50→10 剩余）
   * ⑤ RCON `Save`
   * ⑥ RCON `Shutdown 10 "<原因>"`
   * ⑦ waitForExit（30s 超时则 forceKill）
   * ⑧ spawn（走 startInternal + RUNNING transition）
   * ⑨ RCON `Say "Mod 变更已应用"` + activeOperation 释放 + final broadcast
   *
   * 全程在 `mod_apply` activeOperation 覆盖下，外部 stop/start 不会 409（仅 cancel 走 9）
   */
  async applyModChanges(
    serverId: ServerId,
    modIds: WorkshopFileId[],
  ): Promise<void> {
    const entry = this.ensureServer(serverId);

    if (entry.activeOperation.type !== "none") {
      throw new AppError(
        "operation-conflict",
        `操作冲突: ${entry.activeOperation.type}`,
        409,
      );
    }
    entry.activeOperation = {
      type: "mod_apply",
      startedAt: new Date().toISOString(),
      modIds: modIds as string[],
    };

    // 当前必须是 RUNNING（DEGRADED 也允许）才能 mod_apply
    if (
      entry.state !== ServerState.RUNNING &&
      entry.state !== ServerState.DEGRADED
    ) {
      entry.activeOperation = { type: "none" };
      throw new AppError(
        "server-not-running",
        `Mod 应用要求服务器运行中，当前状态: ${entry.state}`,
        409,
      );
    }

    // 进度 helper
    const announce = (stage: string, remainingSeconds?: number) => {
      try {
        this.broadcaster.broadcast({
          type: "mod_apply_progress",
          serverId,
          stage,
          remainingSeconds,
        } as never);
      } catch {
        /* 广播失败不阻塞主流程 */
      }
    };

    try {
      // ① 备份
      announce("backing_up");
      try {
        await this.configService.backup(
          serverId,
          "Server/WorkshopDownloadConfig.json",
        );
      } catch (err) {
        // 备份失败：文件可能还不存在（首次启动），降级为 warn，不阻塞
        logger.warn(
          { serverId, err },
          "WorkshopDownloadConfig.json 备份失败（文件可能不存在）",
        );
      }

      // ② 写新 File_IDs
      announce("writing_config");
      await this.configService.writeWorkshopFileIds(serverId, modIds);

      // ③ RCON Say 公告——只有 RCON 通了才发
      if (this.rconManager.isReachable(serverId)) {
        announce("broadcasting", 60);
        try {
          await this.rconManager.execute(
            serverId,
            'Say "服务器将在 60 秒后重启以应用 Mod 变更"',
          );
        } catch {
          /* ignore */
        }
      }

      // ④ 5 次倒计时广播（10s 间隔）——不真正等，只是发事件
      for (const remaining of [50, 40, 30, 20, 10]) {
        announce("countdown", remaining);
      }

      // ⑤ Save
      if (this.rconManager.isReachable(serverId)) {
        announce("saving");
        try {
          await this.rconManager.execute(serverId, "Save");
        } catch {
          /* ignore */
        }
      }

      // ⑥ Shutdown
      announce("shutting_down", 10);
      if (this.rconManager.isReachable(serverId)) {
        try {
          await this.rconManager.execute(
            serverId,
            'Shutdown 10 "Mod 变更重启"',
          );
        } catch {
          /* Shutdown 可能受限 */
        }
      }

      // ⑦ 等进程退出
      announce("waiting_exit");
      try {
        await this.processSupervisor.waitForExit(serverId, SHUTDOWN_TIMEOUT);
      } catch {
        // 30s 未退出 → 强杀
        logger.warn({ serverId }, "Shutdown 超时，SIGKILL");
        this.processSupervisor.forceKill(serverId);
      }
      this.transition(serverId, ServerState.STOPPED);
      this.rconManager.disconnect(serverId);

      // ⑦.5 staging → content 移动（acf 合并 + File_IDs 同步 + 回滚）
      if (this.workshopApply) {
        announce("moving");
        await this.workshopApply.applyStaged(serverId);
      }

      // ⑧ 重新拉起
      await this.startInternal(serverId);

      // ⑨ 收尾
      if (this.rconManager.isReachable(serverId)) {
        try {
          await this.rconManager.execute(serverId, 'Say "Mod 变更已应用"');
        } catch {
          /* ignore */
        }
      }
      announce("completed");
      logger.info({ serverId, modCount: modIds.length }, "Mod 变更流水线完成");
    } catch (err) {
      logger.error({ serverId, err }, "Mod 变更流水线失败");
      announce("failed");
      // try 兜底：把进程拉回 STOPPED
      try {
        this.transition(serverId, ServerState.STOPPED);
      } catch {
        /* noop */
      }
      throw err;
    } finally {
      entry.activeOperation = { type: "none" };
    }
  }

  /** 更新 U3DS 二进制——Phase 3 卡 C 待实现（SteamCmdManager 已承担） */
  async updateServerBinaries(_installDir: string): Promise<void> {
    throw new AppError(
      "not-implemented",
      "updateServerBinaries: Phase 3 待实现",
      501,
    );
  }

  // ── 内部方法 ────────────────────────────────────────

  private ensureServer(serverId: ServerId): RuntimeServerState {
    const entry = this.servers.get(serverId);
    if (!entry)
      throw new AppError("server-not-found", `服务器不存在: ${serverId}`, 404);
    return entry;
  }

  private transition(serverId: ServerId, to: ServerState): void {
    const entry = this.servers.get(serverId);
    if (!entry) return;
    const from = entry.state;
    entry.state = to;

    // 广播
    try {
      this.broadcaster.broadcast({
        type: "state_change",
        serverId,
        from,
        to,
      });
    } catch {
      /* 广播失败不影响主流程 */
    }

    logger.info({ serverId, from, to }, "状态转换");
  }

  /** 从 settings K-V 恢复 RCON 凭证并 register（B2 §3.3 缺口 1 修复——面板重启后凭证不丢） */
  private restoreRcon(serverId: ServerId): void {
    const cfg = this.servers.get(serverId)?.config;
    if (!cfg) return;
    this.rconManager.register(serverId, {
      host: "127.0.0.1",
      gamePort: cfg.gamePort,
      openModCredential:
        getRconCredential(this.db, serverId, "openmod") ?? undefined,
      rocketModPassword:
        getRconCredential(this.db, serverId, "rocketmod") ?? undefined,
      ownerSteamId: cfg.ownerSteamId,
    });
  }
}
