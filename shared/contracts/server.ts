import type { ServerId, WorkshopFileId } from '../types/branded.js';
import type { ServerState, ActiveOperation } from '../types/state.js';
import type { ServerConfig } from '../types/domain.js';

export interface IServerManager {
  getState(serverId: ServerId): ServerState;
  getActiveOperation(serverId: ServerId): ActiveOperation;
  listServers(): Promise<ServerConfig[]>;
  listServersSync(): string[];

  createServer(config: ServerConfig): Promise<void>;
  configureServer(serverId: ServerId, patch: Partial<ServerConfig>): Promise<void>;
  /** 删除实例（ADR-0003 B2 §3.6）：先 stop → 删目录 → 删 RCON 凭证 K-V → unregister。目录不存在幂等返回。 */
  removeServer(serverId: ServerId): Promise<void>;
  /** 返回状态非 STOPPED 的实例（SteamCmdManager 活跃实例探活用，替代 DB state 列） */
  listActiveServerIds(): ServerId[];

  start(serverId: ServerId): Promise<void>;
  stop(serverId: ServerId, reason: string): Promise<void>;
  restart(serverId: ServerId, reason: string): Promise<void>;
  forceStop(serverId: ServerId): Promise<void>;

  applyModChanges(serverId: ServerId, modIds: WorkshopFileId[]): Promise<void>;
  updateServerBinaries(installDir: string): Promise<void>;
}
