// @unturned-manager/shared — 统一导出

// Types
export * from './types/branded.js';
export * from './types/state.js';
export * from './types/domain.js';

// Contracts
export type { IServerManager } from './contracts/server.js';
export type { IConfigService } from './contracts/config.js';
export type { IRconManager, RconServerConfig } from './contracts/rcon.js';
export type { IProcessSupervisor } from './contracts/process.js';
export type { IBroadcaster, ServerEvent, WsConnection } from './contracts/broadcast.js';
export type { IFilesService, WritableFileStream } from './contracts/files.js';
export type { IAuthService, JwtPayload } from './contracts/auth.js';
export type { IA2SClient } from './contracts/a2s.js';
export type { IFileLockProvider } from './contracts/filelock.js';
export type { ISteamCmdManager } from './contracts/steamcmd.js';
export type {
  IWorkshopMetadataService,
  IWorkshopAcfService,
  IWorkshopApplyService,
  IWorkshopDeleteService,
  BrowseResult,
  ModSort,
  ModTimeRange,
  ModSearchType,
  ModDownloadResult,
  ModDeleteResult,
  // v1 向后兼容
  BrowseSort,
  BrowseTimeRange,
  BrowseSearchType,
} from './contracts/workshop.js';
export type { ILogStreamer } from './contracts/logstream.js';

// Schemas (Sprint 2: zod-openapi 契约层)
export * from './schemas/index.js';
