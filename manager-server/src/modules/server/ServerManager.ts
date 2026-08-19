import fs from "fs/promises";
import type Database from "better-sqlite3";
import type {
  ServerId,
  ServerConfig,
  IServerManager,
  IServerDiscovery,
  IPtyManager,
  IConfigService,
  IBroadcaster,
  ActiveOperation,
  WorkshopFileId,
  IWorkshopApplyService,
  ISessionManager,
  IIncidentsService,
  CommandsDatRecord,
} from "@unturned-manager/shared";
import { ServerState } from "@unturned-manager/shared";
import { logger } from "../../utils/logger.js";
import { AppError } from "../../utils/AppError.js";
import {
  formatOperationType,
  formatServerState,
} from "../../utils/serverStateLabels.js";
import { resolveInstallDir, resolveServerPath } from "./pathResolver.js";
import {
  detectStartScript,
  ensureStartScriptExecutable,
  normalizeStartCommand,
} from "./startScript.js";
import {
  getStartCommand,
  setStartCommand,
  deleteStartCommand,
} from "../settings/settingsStorage.js";

// ─── 常量 ────────────────────────────────────────────

const SHUTDOWN_TIMEOUT = 30_000; // 等待进程退出
const CRASH_RESTART_DELAY = 5_000; // 崩溃 5s 硬重启
/**
 * spawn bash 后塞 startCommand + 兜底 transition(RUNNING) 的延迟。
 * 提前于 3s 的 transition 由 stdout 命中 ready 正则触发（pipePtyOutput 内）。
 */
const START_COMMAND_DELAY = 3_000;

/**
 * U3DS 启动成功标志——命中任一正则即提前 transition(RUNNING)，
 * 避免用户等满 3s 兜底。
 */
const U3DS_READY_PATTERNS: RegExp[] = [
  /Server is ready/i,
  /World saved/i,
  /Startup complete/i,
];

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
  /** 本次 STARTING transition 的时间戳（用于计算启动耗时） */
  startTimestamp?: number;
}

/**
 * 服务端聚合根（ADR-0003 B2 目录扫描重构）。
 *
 * 数据源变更：
 *   - 实例身份 = <installDir>/Servers/<id>/Server/Commands.dat 存在性（目录扫描，替代 DB servers 表）
 *   - 运行时状态 = in-memory（B2 §9.6：面板启动不吸附真实进程，一律 STOPPED）
 *   - startCommand = settings K-V 明文（Phase 4）
 *
 * 状态机（ADR-0004 Phase 6：去 DEGRADED）：
 *   STOPPED → STARTING → RUNNING → STOPPING → STOPPED
 *   决定性状态由 PTY 进程存活驱动——bash 活 = RUNNING/STARTING/STOPPING，bash 死 = STOPPED，
 *   中间无 DEGRADED 模糊态（owner-trust 模型）。
 *
 * Phase 6：RCON 通道删除，所有命令通过 PTY 终端 owner-trust 模型执行（§6.4）。
 */
export class ServerManager implements IServerManager {
  private servers = new Map<ServerId, RuntimeServerState>();

  constructor(
    private db: Database.Database,
    private discovery: IServerDiscovery,
    private ptyManager: IPtyManager,
    private configService: IConfigService,
    private broadcaster: IBroadcaster,
    private workshopApply?: IWorkshopApplyService,
    private sessionManager?: ISessionManager,
    private incidentsService?: IIncidentsService,
  ) {
    this.loadServersFromDisk();

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
    // 注入内存运行态 state——前端 Dashboard / 服务器控制卡片实时显示 + 按钮 disabled 判据均依赖此字段
    return Array.from(this.servers.values()).map((s) => ({
      ...s.config,
      state: s.state,
    }));
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

    logger.info({ serverId: config.id }, "服务器已创建");
  }

  /**
   * 更新实例配置。startCommand 变更 → settings K-V（明文）；身份字段变更 → 写回 Commands.dat。
   * ★ ADR-0004 Phase 6：RCON 凭证字段已删（openModCredential / rconPassword 不再支持）。
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
    logger.info({ serverId }, "服务器配置已更新");
  }

  /**
   * 删除实例（B2 §3.6）：RUNNING 先优雅 stop → 删目录（幂等）→ 删 startCommand K-V。
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

    // ADR-0004 Phase 4：同步清掉 startCommand K-V
    deleteStartCommand(this.db, serverId);
    // ★ ADR-0005 Phase 7：删除实例 → 同步清终端会话记录
    if (this.sessionManager) {
      void this.sessionManager.removeSession(serverId);
    }
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
        `操作冲突：当前正在${formatOperationType(entry.activeOperation.type)}`,
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
      // ★ ADR-0005 Phase 7：启动失败 → 移除会话记录（GSM3 TerminalManager.ts:1056 回滚形态）
      if (this.sessionManager) {
        void this.sessionManager.removeSession(serverId);
      }
      // BUG-3/7（第四版）：非 AppError 的启动错误（spawn ENOENT / Mono 缺失）原样上抛
      // 会被全局错误处理兜底成「服务器内部错误」——用户和面板都看不到真实原因。
      // 包装成带 err.message 的 AppError，前端 toast 直接显示具体错因，便于定位。
      if (err instanceof AppError) throw err;
      throw new AppError(
        "u3ds-start-failed",
        `Unturned 服务端启动失败: ${err instanceof Error ? err.message : String(err)}`,
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
        `操作冲突：当前正在${formatOperationType(entry.activeOperation.type)}`,
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
  async restart(
    serverId: ServerId,
    reason: string,
    opts?: { preStartHook?: () => Promise<void> },
  ): Promise<void> {
    const entry = this.ensureServer(serverId);

    // CLAUDE.md §4.7: restart 全过程由一个 activeOperation 覆盖，防止竞态
    if (entry.activeOperation.type !== "none") {
      throw new AppError(
        "operation-conflict",
        `操作冲突：当前正在${formatOperationType(entry.activeOperation.type)}`,
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
      // 内部 start——调用方可传 preStartHook（如把 staging Mod 移入 content）。
      // 默认无钩子，与启动实例（POST /start）行为对齐：单纯重启不搬运 staging。
      await this.startInternal(serverId, opts?.preStartHook);
    } finally {
      entry.activeOperation = { type: "none" };
    }
  }

  /**
   * 重启实例并应用 staging Mod（Phase 2b 设计复用 applyChangesCore 流水线本体）。
   *
   * 与 restart 的区别：
   *   - activeOperation.type 用 'mod_apply'（与 ldm_apply 共用同一流水线标识）
   *   - preStartHook 把 staging 里已下载的 Mod 移入 content/304930/（U3DS 只在启动时读 content）
   *
   * 由 POST /:id/restart 路由调用——保持「用户重启即应用 Mod 列表」既有语义，
   * 同时显式走 applyChangesCore 流水线本体（与 modpack_apply / ldm_apply 共用）。
   *
   * @param serverId - 实例标识
   * @param reason - 重启原因（日志 + Shutdown 命令参数用）
   * @throws AppError('operation-conflict') 已有 activeOperation
   */
  async restartAndApplyMods(serverId: ServerId, reason: string): Promise<void> {
    await this.applyChangesCore(serverId, {
      hook: "mod_apply",
      preStartHook: async () => {
        if (this.workshopApply) {
          // ★ U3DS 必然 STOPPED（preStartHook 在 startInternal 内 transition STARTING 之前执行），
          //   移动零冲突（SOP：写入 content 必须停服）。失败则上抛，阻止 spawn。
          await this.workshopApply.applyStaged(serverId);
        }
      },
    });
  }

  /**
   * 配置变更后的「保存-关-启」流水线本体——Phase 2b 抽出（与 mod_apply / ldm_apply 共用）。
   *
   * 与 restart 的区别：activeOperation.type 用调用方 hook 名（mod_apply/ldm_apply/modpack_apply），
   * 并支持 preStopHook + preStartHook + postStartHook 三个钩子（让各 hook 模块在关/启前后执行业务逻辑）。
   *
   * 复用 stopInternal + startInternal（与 restart 共用底层）。
   * 重入保护：activeOperation 与 restart/stop/start 共用同一锁。
   *
   * @param serverId 实例 ID
   * @param opts.hook 调用方身份（用于 activeOperation.type + 日志）
   * @param opts.preStopHook 停止前同步任务（如移动 staging 内容 / 备份当前配置）—— 抛错则流水线 abort
   * @param opts.preStartHook spawn 前同步任务（U3DS 已 STOPPED；如把 staging Mod 移入 content）—— 抛错则阻止 spawn
   * @param opts.postStartHook 启动后同步任务（如调 /p reload 触发权限重载）—— 抛错仅记录，不阻止（启动已完成）
   * @throws AppError('operation-conflict') 已有 activeOperation
   * @throws AppError('server-not-running') 实例不在 RUNNING 状态
   */
  async applyChangesCore(
    serverId: ServerId,
    opts: {
      hook: "mod_apply" | "ldm_apply" | "modpack_apply";
      preStopHook?: () => Promise<void>;
      preStartHook?: () => Promise<void>;
      postStartHook?: () => Promise<void>;
    },
  ): Promise<void> {
    const entry = this.ensureServer(serverId);

    // 重入保护（与 restart/stop/start 共用锁）
    if (entry.activeOperation.type !== "none") {
      throw new AppError(
        "operation-conflict",
        `操作冲突：当前正在${formatOperationType(entry.activeOperation.type)}`,
        409,
      );
    }
    // 实例必须 RUNNING（保存后需重启）
    if (entry.state !== ServerState.RUNNING) {
      throw new AppError(
        "server-not-running",
        `实例不在 RUNNING 状态（当前：${entry.state}），无法应用配置变更`,
        409,
      );
    }

    entry.activeOperation = {
      type: opts.hook,
      startedAt: new Date().toISOString(),
    };

    try {
      // 1. preStopHook（抛错则流水线 abort，不进入 stop）
      if (opts.preStopHook) {
        await opts.preStopHook();
      }
      // 2. 内部 stop（与 restart 共用底层）
      await this.stopInternal(serverId, "配置变更");
      // 3. 内部 start——preStartHook 在 spawn 前执行（U3DS 已 STOPPED，可写 content/304930/），
      //    再等 RUNNING（stdout ready 提前 / 3s 兜底），最后 postStartHook。
      //    ★ Phase 2 审计 P0-1：postStartHook（如 LDM /p reload）依赖实例 RUNNING
      //    （LdmPluginCommandsService 查 getState()===RUNNING），若在 STARTING 执行会抛
      //    server-not-running 被吞 → 永远不执行。
      await this.startInternal(serverId, opts.preStartHook);
      await this.waitForState(serverId, ServerState.RUNNING, 15_000);
      // 4. postStartHook（启动后任务；抛错仅记录——实例已启动不能让其崩溃）
      if (opts.postStartHook) {
        try {
          await opts.postStartHook();
        } catch (postErr) {
          logger.error(
            { err: postErr, serverId, hook: opts.hook },
            "applyChangesCore postStartHook 失败——实例已启动，仅记录",
          );
        }
      }
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
  }

  /**
   * 轮询等待实例达到目标状态（有超时兜底，超时降级不抛错）。
   * 用于 applyChangesCore 在 startInternal 后等 RUNNING——postStartHook（如 LDM /p reload）
   * 需要实例真正 RUNNING 才能执行。U3DS 正常启动 3s 内 transition(RUNNING)（stdout ready 提前 / 3s 兜底），
   * 15s 超时保护启动失败的极端情况（降级后 postStartHook 内部自己兜底）。
   *
   * @param serverId - 实例标识
   * @param target - 目标状态（如 RUNNING）
   * @param timeoutMs - 超时毫秒数
   */
  private async waitForState(
    serverId: ServerId,
    target: ServerState,
    timeoutMs: number,
  ): Promise<void> {
    const entry = this.ensureServer(serverId);
    const deadline = Date.now() + timeoutMs;
    while (entry.state !== target) {
      if (Date.now() >= deadline) {
        logger.warn(
          { serverId, target, state: entry.state },
          "waitForState 超时——降级继续",
        );
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  /** 内部 start——不检查 activeOperation（由 restart / scheduleCrashRestart 统一管理）。
   *
   * preStartHook：在 transition STARTING + PTY spawn **之前**执行的钩子（U3DS 必然 STOPPED）。
   * 设计意图：让调用方（restart / applyChangesCore）在 spawn 前把 staging Mod 移入 content、
   * 备份关键文件等——避免在 RUNNING 实例写运行中读的位置。
   *
   * ★ P2 #4 改动：v2.6 直接调 `workshopApply.applyStaged` 已被移除（隐式耦合）。
   *   由 restart / applyChangesCore 通过 preStartHook 显式传入，保持调用方可观测可重入。
   *
   * @param serverId - 实例标识
   * @param preStartHook - spawn 前钩子（抛错则阻止 spawn）
   */
  private async startInternal(
    serverId: ServerId,
    preStartHook?: () => Promise<void>,
  ): Promise<void> {
    const entry = this.ensureServer(serverId);
    if (entry.state === ServerState.RUNNING) return;

    if (preStartHook) {
      await preStartHook();
    }

    this.transition(serverId, ServerState.STARTING);
    await this.startPty(serverId);
  }

  /**
   * ADR-0004 Phase 2 核心：spawn 永驻 PTY bash → 立即返回 → 1s 后塞 startCommand。
   *
   * - bash 永驻（§6.2/6.3）：U3DS 是 bash 子进程，退出后 bash 回提示符、终端仍可交互
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
    // ★ BUG-1 兜底：任何来源（生成 / DB 恢复 / 用户编辑）都过 normalizeStartCommand——
    //   保证 +InternetServer/<id> 在末位（U3-SDK tryGetServer 取到行末，见 startScript.ts）。
    //   changed 时写回 DB，旧格式的已持久化命令一次重启即自愈。
    let startCommand = entry.config.startCommand;
    if (!startCommand) {
      startCommand = await this.buildStartCommand(id, installDir);
      entry.config = { ...entry.config, startCommand };
    } else {
      const { command, changed } = normalizeStartCommand(startCommand);
      if (changed) {
        logger.info(
          { serverId, from: startCommand, to: command },
          "startCommand 已归一化（+InternetServer 未在末位）",
        );
        startCommand = command;
        entry.config = { ...entry.config, startCommand };
        setStartCommand(this.db, id, command);
      }
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
      this.ptyManager.write(id, `${startCommand}\n`);
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

      // ★ ADR-0005 Phase 7：PTY spawn 成功 → 持久化终端会话（1:1 GSM3 TerminalManager.ts:1030）
      if (this.sessionManager) {
        const now = new Date().toISOString();
        void this.sessionManager.saveSession({
          id,
          name: `终端 - ${id}`,
          workingDirectory: installDir,
          createdAt: now,
          lastActivity: now,
          isActive: true,
        });
      }

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
        // ★ ADR-0005 Phase 7：PTY 退出 → 标记会话 inactive（GSM3 TerminalManager.ts:2962 形态）
        if (this.sessionManager) {
          void this.sessionManager.setSessionActive(id, false);
        }
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
        this.ptyManager.write(id, `${startCommand}\n`);
        this.transition(id, ServerState.RUNNING);
      }, START_COMMAND_DELAY);
    }

    return { terminalSessionId: id, pid };
  }

  /**
   * 把 serverId 的 PTY stdout 接线到 console_output / console_line 双事件广播。
   *
   * 双订阅设计：
   * - onChunk 推 console_output 给前端 xterm——保留原始字节流，由 xterm 内部
   *   ANSI 状态机自处理跨 chunk 不完整转义序列（行切分会把 ESC 序列切碎）
   * - onData 推 console_line 给 LogStreamer 文件 tail 等行匹配消费者
   * - U3DS_READY_PATTERNS 仍在 onData 上匹配——依赖完整单行文本
   *
   * PtyManager.exit 已自动清 callbacks，每次 spawn 重新注册。幂等调用安全
   * （重复注册仅多一次广播，PtyManager 行为一致）。
   */
  private pipePtyOutput(serverId: ServerId): void {
    this.ptyManager.onChunk(serverId, (chunk: string) => {
      this.broadcaster.broadcast({
        type: "console_output",
        serverId,
        chunk,
      });
      // PTY 每收到 stdout → 刷新 lastActivity（5 秒节流，SessionManager 内部处理）
      if (this.sessionManager) {
        void this.sessionManager.touchActivity(serverId);
      }
    });
    this.ptyManager.onData(serverId, (line: string) => {
      // U3DS 就绪正则匹配：命中 "Done (" / "For help" 等模式后立即 transition(RUNNING)，
      // 不等 START_COMMAND_DELAY 兜底。transition 自身幂等，正则 + 定时器谁先到用哪个。
      if (U3DS_READY_PATTERNS.some((re) => re.test(line))) {
        this.transition(serverId, ServerState.RUNNING);
      }
    });
  }

  /**
   * 优雅停止控制台：写存档与关服命令 → 写中断键 → 写退出关掉常驻 bash → 等退出（30 秒超时强杀）。
   *
   * 顺序保证数据安全：先存档刷盘，再双路关停（关服命令 + 中断键）。
   *
   * 实机行为：服务端进程在前台时，退出命令的字节进的是服务端标准输入而非 bash（终端输入送达
   * 前台进程组），会被当成控制台命令忽略——因此优雅关闭的主力是存档/关服命令加中断键，退出命令
   * 只在服务端已退出、bash 回到提示符后才有机会命中。真实停止耗时约等于关服倒计时 30 秒，
   * 等待超时后强杀收尾是常态路径而非兜底。
   */
  private async stopPty(serverId: ServerId, reason: string): Promise<void> {
    const entry = this.ensureServer(serverId);
    entry.stopRequested = true; // 防 onExit 误判崩溃重启

    // ① PTY 写 Save + Shutdown 优雅关闭（U3DS 已知可靠路径——Phase 6 替代原 RCON.execute）
    try {
      this.ptyManager.write(serverId, "Save\n");
      this.ptyManager.write(serverId, `Shutdown 30 "${reason}"\n`);
    } catch {
      /* PTY 可能已死——fallthrough 到 ctrl+c 强杀 */
    }

    // ② PTY 写 ctrl+c（ADR-0004 §2.2）——U3DS 收到 SIGINT 退出
    this.ptyManager.write(serverId, "\u0003");

    // ③ 写 exit 尽力关 bash（U3DS 已退、bash 回提示符时命中；否则被 U3DS stdin 吞掉，
    //    由 ④ waitExit 超时 forceKill 兜底）
    this.ptyManager.write(serverId, "exit\n");

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
   * `./<script> -ThreadedConsole +InternetServer/<id>`。Phase 4 用户可在控制卡片编辑覆盖。
   *
   * ★ BUG-1 修复（2026-08-13 实机根因）：`+InternetServer/<id>` 必须是命令行**最后一个参数**。
   * U3-SDK `CommandLine.tryGetServer` 把 serverID 从 `+internetserver/` 一直取到行末
   * （CommandLine.cs:203-216），而 ServerHelper.sh 透传 `$@`——若写成
   * `+InternetServer/<id> -ThreadedConsole`，serverID 会被污染成 `<id> -ThreadedConsole`，
   * U3DS 去读 `Servers/<id> -ThreadedConsole/`，面板写入的 `Servers/<id>/` 全部失效。
   * 故把 `-ThreadedConsole` 前置，保证 server 参数在末位。
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
        `Unturned 服务端未安装或安装不完整（${installDir} 下未找到 ServerHelper.sh/ExampleServer.sh）。请先在「服务器设置」页点击「安装 Unturned 服务端」后再启动。`,
        409,
      );
    }
    await ensureStartScriptExecutable(installDir, script);
    // -ThreadedConsole 置于 server 参数前，确保 +InternetServer/<id> 是命令行最后一个参数。
    return `./${script} -ThreadedConsole +InternetServer/${id}`;
  }

  /**
   * 崩溃 5s 硬重启（T6 抄 GSM GameManager.ts:331-335）。
   *
   * 崩溃语义（review 风险-1 澄清）：触发点是「bash 退出」——bash 是 U3DS 的父进程，
   * bash 退出 ⇒ U3DS 必死（PTY 会话整体结束）。U3DS 单独崩溃时 bash 回提示符不退出，
   * 不走此路径，由 RCON 心跳失败 → DEGRADED 承接（用户看状态手动处理，不做自动拉起）。
   *
   * 守卫：
   *   - 主动停止类操作（manual_stop/manual_restart）期间退出 → 不重启。
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
    if (op === "manual_stop" || op === "manual_restart") {
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

    // stopRequested 置位防 onExit 误判崩溃重启。
    entry.stopRequested = true;
    this.ptyManager.forceKill(serverId);
    this.transition(serverId, ServerState.STOPPED);
    entry.activeOperation = { type: "none" };
  }

  // ── Update（Phase 3 待实现）─────────

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
    // 幂等：to === from 直接返回，避免双触发（stdout 命中 ready + setTimeout 兜底
    // 都可能先后触发同一 transition，不幂等会重复广播 + 状态机白绕一圈）
    if (entry.state === to) return;
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

    // Status Block 事件——记录 SPEC: STARTING/RUNNING/STOPPED 三个关键节点
    this.recordIncidentForTransition(serverId, from, to, entry);

    logger.info({ serverId, from, to }, "状态转换");
  }

  /**
   * 状态转换 → Status Block 事件映射。
   *
   * 关键设计：
   * - STARTING 时记录"启动请求已发起" + 写 startTimestamp 用于后续计算 durationMs
   * - RUNNING 时记录"启动完成" + durationMs（启动耗时）
   * - STOPPED 时根据 stopRequested 区分 stop（用户主动） vs crash（异常退出）
   * - STOPPING 不记录（噪声），统一以 STOPPED 终态记录
   */
  private recordIncidentForTransition(
    serverId: ServerId,
    from: ServerState,
    to: ServerState,
    entry: RuntimeServerState,
  ): void {
    if (!this.incidentsService) return;
    try {
      if (to === ServerState.STARTING) {
        entry.startTimestamp = Date.now();
        this.incidentsService.record(
          serverId,
          "start",
          "info",
          "启动请求已发起",
        );
        return;
      }
      if (to === ServerState.RUNNING) {
        const durationMs =
          entry.startTimestamp !== undefined
            ? Date.now() - entry.startTimestamp
            : undefined;
        const details =
          durationMs !== undefined ? { durationMs } : undefined;
        this.incidentsService.record(
          serverId,
          "start",
          "info",
          "启动完成",
          details,
        );
        entry.startTimestamp = undefined;
        return;
      }
      if (to === ServerState.STOPPED) {
        const wasRunning = from === ServerState.RUNNING;
        const wasStarting = from === ServerState.STARTING;
        if (wasRunning || wasStarting) {
          if (entry.stopRequested) {
            this.incidentsService.record(
              serverId,
              "stop",
              "info",
              "已停止",
            );
          } else {
            this.incidentsService.record(
              serverId,
              "crash",
              "error",
              "服务器异常退出",
            );
          }
        }
        entry.startTimestamp = undefined;
        return;
      }
    } catch {
      /* 事件记录失败不影响主流程 */
    }
  }

  /**
   * ADR-0004 Phase 4：从 settings K-V 恢复 startCommand 到 in-memory config。
   * loadServersFromDisk 时调用——用户编辑过的 startCommand 跨重启保留。
   * ★ Phase 6：RCON 通道已删除，对应 restoreRcon 不再需要。
   * ★ BUG-1：恢复时过 normalizeStartCommand（+InternetServer 必须末位），changed 则自愈持久化。
   */
  private restoreStartCommand(serverId: ServerId): void {
    const entry = this.servers.get(serverId);
    if (!entry) return;
    const persisted = getStartCommand(this.db, serverId);
    if (persisted) {
      const { command, changed } = normalizeStartCommand(persisted);
      if (changed) {
        logger.info(
          { serverId, from: persisted, to: command },
          "恢复 startCommand 时已归一化（+InternetServer 未在末位）",
        );
        setStartCommand(this.db, serverId, command);
      }
      entry.config = { ...entry.config, startCommand: command };
    }
  }
}
