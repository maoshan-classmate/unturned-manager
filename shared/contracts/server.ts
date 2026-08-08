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

  start(serverId: ServerId): Promise<void>;
  stop(serverId: ServerId, reason: string): Promise<void>;
  restart(serverId: ServerId, reason: string): Promise<void>;
  forceStop(serverId: ServerId): Promise<void>;

  applyModChanges(serverId: ServerId, modIds: WorkshopFileId[]): Promise<void>;
  updateServerBinaries(installDir: string): Promise<void>;
}
