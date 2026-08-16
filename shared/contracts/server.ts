import type { ServerId } from "../types/branded.js";
import type { ServerState, ActiveOperation } from "../types/state.js";
import type { ServerConfig } from "../types/domain.js";

export interface IServerManager {
  getState(serverId: ServerId): ServerState;
  getActiveOperation(serverId: ServerId): ActiveOperation;
  listServers(): Promise<ServerConfig[]>;
  listServersSync(): string[];

  createServer(config: ServerConfig): Promise<void>;
  configureServer(
    serverId: ServerId,
    patch: Partial<ServerConfig>,
  ): Promise<void>;
  /** 删除实例（ADR-0003 B2 §3.6）：先 stop → 删目录 → 删 RCON 凭证 K-V → unregister。目录不存在幂等返回。 */
  removeServer(serverId: ServerId): Promise<void>;
  /** 返回状态非 STOPPED 的实例（SteamCmdManager 活跃实例探活用，替代 DB state 列） */
  listActiveServerIds(): ServerId[];

  /**
   * 启动服务端（ADR-0004 Phase 2）。
   * spawn 永驻 PTY bash（cwd=installDir）后立即返回 terminalSessionId + pid，
   * 1s 后自动向 PTY 写入 startCommand 启动 U3DS。不等待 U3DS 就绪。
   */
  start(
    serverId: ServerId,
  ): Promise<{ terminalSessionId: string; pid: number }>;
  stop(serverId: ServerId, reason: string): Promise<void>;
  restart(serverId: ServerId, reason: string): Promise<void>;
  forceStop(serverId: ServerId): Promise<void>;

  /**
   * 配置变更后的「保存-关-启」流水线本体——Phase 2b 抽出。
   *
   * 复用：`stopInternal` + `startInternal`（不重新实现停止/启动逻辑）。
   * 钩子：preStopHook（停止前）+ preStartHook（spawn 前）+ postStartHook（启动后）
   *      —— 各 hook 模块独立实现业务逻辑。
   * 重入保护：activeOperation 与 restart/stop/start 共用同一锁。
   *
   * @param serverId - 实例 ID
   * @param opts.hook - 调用方身份（用于 activeOperation.type 标记 + 日志）
   * @param opts.preStopHook - 停止前同步任务（如移动 staging 内容 / 备份当前配置）
   * @param opts.preStartHook - spawn 前同步任务（U3DS 已 STOPPED；如把 staging Mod 移入 content）
   * @param opts.postStartHook - 启动后同步任务（如调 /p reload 触发权限重载 / 验证配置生效）
   * @throws AppError('operation-conflict') 已有 activeOperation 在跑
   * @throws AppError('server-not-running') 实例不在 RUNNING 状态
   *
   * Phase 2b 使用方：
   *   - LdmApplyService.apply（hook='ldm_apply'）：配置变更后应用
   *   - ServerManager.restartAndApplyMods（hook='mod_apply'）：手动重启并应用 staging Mod
   *   - 未来 modpack_apply 第三处共用
   */
  applyChangesCore(
    serverId: ServerId,
    opts: {
      hook: "mod_apply" | "ldm_apply" | "modpack_apply";
      preStopHook?: () => Promise<void>;
      preStartHook?: () => Promise<void>;
      postStartHook?: () => Promise<void>;
    },
  ): Promise<void>;

  /**
   * 重启实例并应用 staging Mod（preStartHook 把 staging 内容移入 content/304930/）。
   *
   * 由 POST /:id/restart 路由调用——保持「用户重启即应用 Mod 列表」既有语义，
   * 显式走 applyChangesCore 流水线本体（hook='mod_apply'）。
   *
   * @param serverId - 实例标识
   * @param reason - 重启原因（日志 + Shutdown 命令参数用）
   */
  restartAndApplyMods(serverId: ServerId, reason: string): Promise<void>;

  updateServerBinaries(installDir: string): Promise<void>;
}
