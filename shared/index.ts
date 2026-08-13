// @unturned-manager/shared — 统一导出

// Types
export * from "./types/branded.js";
export * from "./types/state.js";
export * from "./types/domain.js";

// Constants（AppID 等全局唯一真源）
export * from "./constants.js";

// Contracts
export type { IServerManager } from "./contracts/server.js";
export type {
  IServerDiscovery,
  DiscoveredServer,
} from "./contracts/discovery.js";
export type { IConfigService } from "./contracts/config.js";
export type { IProcessSupervisor } from "./contracts/process.js";
export type {
  IPtyManager,
  PtyKey,
  PtySpawnOptions,
  PtyDataCallback,
  PtyExitCallback,
} from "./contracts/pty.js";
export type {
  IBroadcaster,
  ServerEvent,
  WsConnection,
  WsRequestResult,
  WsRequestHandler,
} from "./contracts/broadcast.js";
export type { ClientWsMessage, ClientWsRequestMessage } from "./contracts/ws.js";
export type {
  IFilesService,
  WritableFileStream,
  PanelDirectoryResult,
} from "./contracts/files.js";
export type { IAuthService, JwtPayload } from "./contracts/auth.js";
export type { IFileLockProvider } from "./contracts/filelock.js";
export type { ISteamCmdManager } from "./contracts/steamcmd.js";
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
} from "./contracts/workshop.js";
export type { ILogStreamer } from "./contracts/logstream.js";
export type {
  ISessionManager,
  PersistedTerminalSession,
  TerminalSessionsConfig,
} from "./contracts/sessions.js";
export type { IU3dsStatusProvider } from "./contracts/u3ds.js";
export type {
  ILdmDiscoveryService,
  ILdmPluginCommandsService,
  ILdmPluginSourceService,
  ILdmAssemblyVersionReader,
  LdmRuntimeStatusReader,
} from "./contracts/ldm.js";

// Schemas (Sprint 2: zod-openapi 契约层)
export * from "./schemas/index.js";
