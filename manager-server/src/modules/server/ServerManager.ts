import fs from "fs/promises";
import type Database from "better-sqlite3";
import type {
  ServerId,
  ServerConfig,
  IServerManager,
  IServerDiscovery,
  IPtyManager,
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
  getStartCommand,
  setStartCommand,
  deleteStartCommand,
} from "../settings/settingsStorage.js";

// ─── 常量 ────────────────────────────────────────────

const SHUTDOWN_TIMEOUT = 30_000; // 等待进程退出
const CRASH_RESTART_DELAY = 5_000; // T6: 崩溃 5s 硬重启（抄 GSM GameManager.ts:331-335）
const START_COMMAND_DELAY = 1_000; // ADR-0004 §3.3：spawn bash 后 1s 塞 startCommand

// ─── 运行时状态 (in-memory, 目录扫描真源 + settings K-V) ──

interface RuntimeServerState {
  state: ServerState;
  activeOperation: ActiveOperation;
  config: ServerConfig;
  /** ADR-0004 Phase 2：PTY 终端会话 ID（= serverId，IPtyManager 的 key） */
  terminalSessionId?: string;
  /** PTY 进程 PID（spawn 返回值，start 返回给前端） */
  ptyPid?: number;
  /** 主动停止标记——stop/stopInternal/forceStop 置位，onExit 据此跳过崩溃重启 */
  stopRequested?: boolean;
  /** 会话代际（review-修复 BUG-2）：每次 startPty spawn 自增，1s timer 校验归属，防过期 timer 误写新会话 */
  sessionEpoch?: number;
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
    private ptyManager: IPtyManager,
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

    // ★ ADR-0004 Phase 2：崩溃检测从 processSupervisor.onCrash 挪到 PTY exit——
    // U3DS 走 PTY 后，bash 退出 = PTY 会话结束（bash 永驻，U3DS 崩溃时 bash 回提示符
    // 不触发 exit；崩溃重启语义见 scheduleCrashRestart）。onExit 在 startPty 每次 spawn 时注册。
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
      // ADR-0004 Phase 4：从 settings K-V 恢复 startCommand（持久化跨重启）
      this.restoreStartCommand(s.id);
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

    // ADR-0004 Phase 4：startCommand 明文落库（仅在创建时显式传入时）。
    // 注：buildStartCommand 兜底生成留到 startPty 首次启动时按需执行（U3DS 未装时
    //      start 自然抛 409），不在 createServer 阶段探测——避免创建 → 启动语义混淆。
    if (config.startCommand) {
      setStartCommand(this.db, config.id, config.startCommand);
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
    // ADR-0004 Phase 4：startCommand patch 走明文 K-V（不加密）
    if (patch.startCommand !== undefined) {
      setStartCommand(this.db, serverId, patch.startCommand);
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
    // ADR-0004 Phase 4：同步清掉 startCommand K-V
    deleteStartCommand(this.db, serverId);
    this.rconManager.unregister(serverId);
    this.servers.delete(serverId);
    logger.info({ serverId }, "服务器已删除");
  }

  // ── 生命周期 ───────────────────────────────────────

  /**
   * 启动服务端（ADR-0004 Phase 2）。
   * spawn 永驻 PTY bash（cwd=installDir）后立即返回 terminalSessionId + pid，
   * 1s 后自动向 PTY 写入 startCommand 启动 U3DS（不等待 U3DS 就绪）。
   *
   * @param serverId - 服务端实例 ID
   * @returns 立即返回 { terminalSessionId, pid }；RUNNING/STARTING 幂等返回已有会话
   * @throws {AppError} 操作冲突 409；start-script-not-found 409；u3ds-start-failed 500
   */
  async start(
    serverId: ServerId,
  ): Promise<{ terminalSessionId: string; pid: number }> {
    const entry = this.ensureServer(serverId);

    if (entry.activeOperation.type !== "none") {
      throw new AppError(
        "operation-conflict",
        `操作冲突: ${entry.activeOperation.type}`,
        409,
      );
    }

    // ★ ADR-0004 Phase 2：RUNNING/STARTING 幂等返回。
    // STARTING = PTY 已 spawn、1s 塞命令窗口内——重复点击直接返回已有会话。
    if (
      entry.state === ServerState.RUNNING ||
      entry.state === ServerState.STARTING
    ) {
      return {
        terminalSessionId: entry.terminalSessionId ?? serverId,
        pid: entry.ptyPid ?? 0,
      };
    }

    entry.activeOperation = {
      type: "manual_start",
      startedAt: new Date().toISOString(),
    };
    this.transition(serverId, ServerState.STARTING);

    try {
      const result = await this.startPty(serverId);
      // 连接 RCON（保留，Phase 6 评估去留）
      try {
        await this.rconManager.connect(serverId);
      } catch (err) {
        logger.warn({ serverId, err }, "RCON 连接失败，服务仍在运行");
      }
      return result;
    } catch (err) {
      logger.error({ serverId, err }, "启动失败");
      // review-修复 BUG-1：启动失败清理也视为主动停止——forceKill 触发的 onExit
      // 若 stopRequested 未置位会走崩溃重启分支，把「启动失败」误判成「崩溃要重启」。
      entry.stopRequested = true;
      // BUG-3/7（第四版）：spawn 失败时清理 PTY，保证可重试
      try {
        this.ptyManager.forceKill(serverId);
      } catch {
        /* 进程可能已退出，forceKill 幂等 */
      }
      entry.terminalSessionId = undefined;
      entry.ptyPid = undefined;
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

  /**
   * 停止服务端（ADR-0004 Phase 2）：RCON Save+Shutdown 优雅关 U3DS → PTY ctrl+c →
   * 写 exit 关永驻 bash → waitExit（超时 forceKill 兜底）。
   *
   * @param serverId - 服务端实例 ID
   * @param reason - 停止原因（写入 RCON Shutdown 消息）
   * @returns Promise 在 bash 退出（或 forceKill 兜底）后 resolve
   * @throws {AppError} 操作冲突 409
   */
  async stop(serverId: ServerId, reason: string): Promise<void> {
    const entry = this.ensureServer(serverId);

    if (entry.activeOperation.type !== "none") {
      throw new AppError(
        "operation-conflict",
        `操作冲突: ${entry.activeOperation.type}`,
        409,
      );
    }
    // review-修复 风险-6：已停止实例调 stop 幂等返回，避免 STOPPED→STOPPING→STOPPED 空转闪动
    if (entry.state === ServerState.STOPPED) return;

    entry.activeOperation = {
      type: "manual_stop",
      startedAt: new Date().toISOString(),
    };
    this.transition(serverId, ServerState.STOPPING);

    try {
      await this.stopPty(serverId, reason);
      this.transition(serverId, ServerState.STOPPED);
      this.rconManager.disconnect(serverId);
    } finally {
      entry.activeOperation = { type: "none" };
    }
  }

  /**
   * 重启服务端 = 内部 stop（RCON + ctrl+c + exit）→ 内部 start（spawn 新 bash）。
   * 全程一个 manual_restart activeOperation 覆盖（CLAUDE.md §4.7 防竞态）。
   *
   * @param serverId - 服务端实例 ID
   * @param reason - 重启原因（写入 RCON Shutdown 消息）
   * @returns Promise 在新 bash spawn 后 resolve（不等待 U3DS 就绪）
   * @throws {AppError} 操作冲突 409
   */
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
    await this.stopPty(serverId, reason);
    this.transition(serverId, ServerState.STOPPED);
    this.rconManager.disconnect(serverId);
  }

  /** 内部 start——不检查 activeOperation（由 restart / scheduleCrashRestart 统一管理）。 */
  private async startInternal(serverId: ServerId): Promise<void> {
    const entry = this.ensureServer(serverId);
    if (entry.state === ServerState.RUNNING) return;

    this.transition(serverId, ServerState.STARTING);
    await this.startPty(serverId);

    try {
      await this.rconManager.connect(serverId);
    } catch {
      /* noop */
    }
  }

  /**
   * ADR-0004 Phase 2 核心：spawn 永驻 PTY bash → 立即返回 → 1s 后塞 startCommand。
   *
   * - bash 永驻（GSM3 同款 §6.2/6.3）：U3DS 是 bash 子进程，退出后 bash 回提示符、终端仍可交互
   * - startCommand 由 detectStartScript 生成并缓存到 config（Phase 4 用户可编辑覆盖）
   * - PTY exit（bash 退出）→ STOPPED + 崩溃重启判定（onExit 注册；stopRequested 置位时跳过）
   * - 若 bash 已存在（崩溃残留）→ 只重塞命令，不重 spawn（isRunning 分支）
   *
   * @returns PTY 会话信息——terminalSessionId（= serverId）与 PID
   */
  private async startPty(
    serverId: ServerId,
  ): Promise<{ terminalSessionId: string; pid: number }> {
    const entry = this.ensureServer(serverId);
    const { id, installDir } = entry.config;

    // 生成 / 复用 startCommand（缓存到 config，避免每次探测 + chmod）
    let startCommand = entry.config.startCommand;
    if (!startCommand) {
      startCommand = await this.buildStartCommand(id, installDir);
      entry.config = { ...entry.config, startCommand };
    }

    let pid: number;
    if (this.ptyManager.isRunning(id)) {
      // bash 已残留（U3DS 崩溃后 bash 回提示符仍在）——只重塞命令，不重 spawn。
      // review-修复 风险-5：新 start 意图接管，清掉残留的 stopRequested（否则后续 exit 事件
      // 会误把这次 start 当「主动停止」跳过崩溃判定，导致 start 后闪一下又回 STOPPED）。
      entry.stopRequested = false;
      pid = entry.ptyPid ?? 0;
      logger.info({ serverId, pid }, "PTY bash 已存在，直接塞启动命令");
      this.pipePtyOutput(id); // 保险：onData 幂等（PtyManager exit 后清了 callbacks）
      this.ptyManager.write(id, `${startCommand}\r`);
      this.transition(serverId, ServerState.RUNNING);
    } else {
      // 首次：spawn 永驻 bash（cwd=installDir）
      pid = await this.ptyManager.spawn(id, "/bin/bash", [], {
        cwd: installDir,
      });
      entry.terminalSessionId = id;
      entry.ptyPid = pid;
      logger.info(
        { serverId, pid, installDir, startCommand },
        "PTY bash 已启动",
      );

      // ★ ADR-0004 Phase 3：PTY stdout → console_line 广播（§2.4）。
      // U3DS 的 ANSI 彩色日志经此推给前端 xterm.js（xterm 原生渲染 ANSI）。
      this.pipePtyOutput(id);

      // 崩溃检测接线：bash 退出 → STOPPED + 崩溃重启判定。
      // stopRequested 置位（主动 stop/forceStop）时跳过重启。
      this.ptyManager.onExit(id, ({ exitCode }) => {
        const wasStopped = entry.stopRequested ?? false;
        entry.stopRequested = false;
        entry.terminalSessionId = undefined;
        entry.ptyPid = undefined;
        logger.warn({ serverId, exitCode }, "PTY bash 退出");
        this.transition(id, ServerState.STOPPED);
        if (!wasStopped) {
          this.scheduleCrashRestart(id, exitCode);
        }
      });

      // review-修复 BUG-2：会话代际保护。epoch 捕获本次 spawn，过期 timer（旧会话已 stop、
      // 新会话已 spawn）经 epoch 比对丢弃，杜绝「把命令写进新 bash / 强制 RUNNING」。
      const epoch = (entry.sessionEpoch ?? 0) + 1;
      entry.sessionEpoch = epoch;

      // 1s 后塞 startCommand（对齐 ADR-0004 §3.3：STARTING → 1s → RUNNING）
      setTimeout(() => {
        if (entry.sessionEpoch !== epoch) return; // 过期 timer（本会话已结束）
        if (entry.state !== ServerState.STARTING) return; // 已被 stop/forceStop 中断
        if (!this.ptyManager.isRunning(id)) return;
        this.ptyManager.write(id, `${startCommand}\r`);
        this.transition(id, ServerState.RUNNING);
      }, START_COMMAND_DELAY);
    }

    return { terminalSessionId: id, pid };
  }

  /**
   * 把 serverId 的 PTY stdout 接线到 console_line 广播（ADR-0004 §2.4 Phase 3）。
   * U3DS 的 ANSI 彩色日志经此推给前端 xterm.js；PtyManager.exit 已自动清 callbacks，
   * 每次 spawn 重新注册。幂等调用安全（重复注册仅多一次广播，PtyManager 行为一致）。
   */
  private pipePtyOutput(serverId: ServerId): void {
    this.ptyManager.onData(serverId, (line: string) => {
      this.broadcaster.broadcast({
        type: "console_line",
        serverId,
        line,
        source: "stdout",
      });
    });
  }

  /**
   * 优雅停止 PTY：RCON Save + Shutdown（保留，Phase 6 评估去留）→ PTY 写 ctrl+c →
   * 写 exit 关永驻 bash → 等 bash 退出（30s 超时 forceKill）。
   *
   * 顺序保证数据安全：先 RCON Save 刷盘，再双路关停（RCON Shutdown + ctrl+c）。
   * ctrl+c 是 ADR-0004 §2.2 要求的 PTY 停服通道；exit\r 尽力关闭 bash（见下方实机说明）。
   * 最后 waitExit 确认 bash 退出；超时 forceKill（SIGKILL bash → SIGHUP 前台组 U3DS 兜底）。
   *
   * 实机说明（review 风险-2）：U3DS 在前台运行时，③ 的 exit\r 字节进的是 U3DS 的 stdin
   * 而非 bash（终端输入送达前台进程组），会被 U3DS 当控制台命令忽略——因此优雅关闭的主力
   * 是 ① RCON Shutdown 30 + ② ctrl+c，exit\r 只在 U3DS 已退出、bash 回提示符后才有机会命中。
   * 真实停止耗时 ≈ RCON Shutdown 30 秒，waitExit 超时后 forceKill 收尾是常态路径而非兜底。
   * 数据安全由 ① Save 先行保证；RCON 不可达时（isReachable false）走 ctrl+c 直杀，无 Save，
   * 属「RCON 挂了无法安全关」的固有代价。
   */
  private async stopPty(serverId: ServerId, reason: string): Promise<void> {
    const entry = this.ensureServer(serverId);
    entry.stopRequested = true; // 防 onExit 误判崩溃重启

    // ① RCON 优雅关闭（U3DS 已知可靠路径）
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

    // ② PTY 写 ctrl+c（ADR-0004 §2.2）——U3DS 收到 SIGINT 退出
    this.ptyManager.write(serverId, "\u0003");

    // ③ 写 exit 尽力关 bash（U3DS 已退、bash 回提示符时命中；否则被 U3DS stdin 吞掉，
    //    由 ④ waitExit 超时 forceKill 兜底）
    this.ptyManager.write(serverId, "exit\r");

    // ④ 等 bash 退出（30s 超时 → forceKill）
    const exited = await this.ptyManager.waitExit(serverId, SHUTDOWN_TIMEOUT);
    if (!exited) {
      logger.warn({ serverId }, "停止超时，SIGKILL");
      this.ptyManager.forceKill(serverId);
      // 给 PTY exit 事件一点时间触发（onExit 会清 terminalSessionId + 触发 crash 判定）
      await this.ptyManager.waitExit(serverId, 2_000);
    }
  }

  /**
   * 生成 U3DS 启动命令（ADR-0004 §6.1）：detectStartScript 探测 → chmod +x →
   * `./<script> +InternetServer/<id> -ThreadedConsole`。Phase 4 用户可在控制卡片编辑覆盖。
   *
   * @throws {AppError} code=start-script-not-found, status=409 当 installDir 无 U3DS 启动脚本
   */
  private async buildStartCommand(
    id: ServerId,
    installDir: string,
  ): Promise<string> {
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
    return `./${script} +InternetServer/${id} -ThreadedConsole`;
  }

  /**
   * 崩溃 5s 硬重启（T6 抄 GSM GameManager.ts:331-335）。
   *
   * 崩溃语义（review 风险-1 澄清）：触发点是「bash 退出」——bash 是 U3DS 的父进程，
   * bash 退出 ⇒ U3DS 必死（PTY 会话整体结束）。U3DS 单独崩溃时 bash 回提示符不退出，
   * 不走此路径，由 RCON 心跳失败 → DEGRADED 承接（用户看状态手动处理，不做自动拉起）。
   *
   * 守卫：
   *   - 主动停止类操作（manual_stop/manual_restart/mod_apply）期间退出 → 不重启。
   *     stopRequested 已在 onExit 层拦截主动路径，这里是双保险；stopPty 对 STARTING 中的
   *     bash 写 exit 也会触发 onExit，若此时 activeOperation=manual_stop 会误吞——守卫防之。
   *   - manual_start 期间退出 → **放行重启**（启动期崩溃恰恰最需要自动拉起；start 失败
   *     forceKill 触发的 onExit 已由 start catch 置 stopRequested 拦截，不会误入此分支）。
   *   - exitCode === 0（RCON 优雅关闭等正常退出）→ 不重启
   *   - 5s 后实例已被删除 → 跳过
   */
  private scheduleCrashRestart(
    serverId: ServerId,
    exitCode: number | null,
  ): void {
    const entry = this.servers.get(serverId);
    if (!entry) return;
    if (exitCode === 0) return;
    const op = entry.activeOperation.type;
    if (op === "manual_stop" || op === "manual_restart" || op === "mod_apply") {
      return; // 主动停止类操作期间退出，不重启
    }
    logger.info({ serverId, exitCode }, "5s 后自动重启");
    setTimeout(() => {
      if (!this.servers.has(serverId)) return; // 期间被删除
      void this.startInternal(serverId).catch((err) => {
        logger.error({ serverId, err }, "崩溃自动重启失败");
      });
    }, CRASH_RESTART_DELAY);
  }

  /**
   * 强制停止（kill -9 兜底）：PTY forceKill bash → 内核 SIGHUP 前台进程组 U3DS 终止。
   * 不等待优雅关闭，立即 STOPPED。stopRequested 置位防 onExit 误判崩溃重启。
   *
   * @param serverId - 服务端实例 ID
   */
  async forceStop(serverId: ServerId): Promise<void> {
    const entry = this.ensureServer(serverId);
    logger.warn({ serverId }, "强制停止");

    // ★ Phase 2：PTY forceKill（SIGKILL bash → 内核 SIGHUP 前台进程组 U3DS 兜底终止）。
    // stopRequested 置位防 onExit 误判崩溃重启。
    entry.stopRequested = true;
    this.ptyManager.forceKill(serverId);
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
   * ⑦ PTY waitExit 等 bash 退出（30s 超时则 forceKill 关 bash）
   * ⑧ spawn PTY bash + 1s 塞 startCommand（走 startInternal + RUNNING transition）
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

      // ⑦ 等进程退出（★ Phase 2：bash 永驻不自己退——RCON Shutdown 10 让 U3DS 优雅退出后
      // bash 回提示符仍在。等 bash 退出必然超时 → forceKill 关 bash。stopRequested 置位防
      // onExit 误判崩溃重启）
      announce("waiting_exit");
      const exited = await this.ptyManager.waitExit(serverId, SHUTDOWN_TIMEOUT);
      if (!exited) {
        // 30s 未退出 → 强杀
        logger.warn({ serverId }, "Shutdown 超时，SIGKILL");
        entry.stopRequested = true;
        this.ptyManager.forceKill(serverId);
        // 给 PTY exit 事件一点时间触发（onExit 清 terminalSessionId）
        await this.ptyManager.waitExit(serverId, 2_000);
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

  /**
   * ADR-0004 Phase 4：从 settings K-V 恢复 startCommand 到 in-memory config。
   * loadServersFromDisk 时调用（与 restoreRcon 对齐）——用户编辑过的 startCommand 跨重启保留。
   */
  private restoreStartCommand(serverId: ServerId): void {
    const entry = this.servers.get(serverId);
    if (!entry) return;
    const persisted = getStartCommand(this.db, serverId);
    if (persisted) {
      entry.config = { ...entry.config, startCommand: persisted };
    }
  }
}
