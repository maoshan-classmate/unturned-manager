import Database from 'better-sqlite3';
import {
  type IServerManager,
  type IConfigService,
  type IFilesService,
  type ISteamCmdManager,
  type IWorkshopMetadataService,
  type ILogStreamer,
  type IRconManager,
  type IA2SClient,
  type IProcessSupervisor,
  type IBroadcaster,
  type IFileLockProvider,
  type IAuthService,
} from '@unturned-manager/shared';

import { AuthService } from './modules/auth/AuthService.js';
import { FileLockProvider } from './modules/filelock/FileLockProvider.js';
import { ProcessSupervisor } from './modules/process/ProcessSupervisor.js';
import { A2SClient } from './modules/a2s/A2SClient.js';
import { RconManager } from './modules/rcon/RconManager.js';
import { ServerManager } from './modules/server/ServerManager.js';
import { ConfigService } from './modules/config/ConfigService.js';
import { FilesService } from './modules/files/FilesService.js';
import { SteamCmdManager } from './modules/steamcmd/SteamCmdManager.js';
import { WorkshopMetadataService } from './modules/workshop/WorkshopMetadataService.js';
import { LogStreamer } from './modules/logs/LogStreamer.js';
import { wsBroadcaster } from './ws/gateway.js';

// ─── Container ────────────────────────────────────────

export interface AppContainer {
  authService: IAuthService;
  serverManager: IServerManager;
  configService: IConfigService;
  filesService: IFilesService;
  steamCmdManager: ISteamCmdManager;
  workshopMeta: IWorkshopMetadataService;
  logStreamer: ILogStreamer;
  rconManager: IRconManager;
  a2sClient: IA2SClient;
  broadcaster: IBroadcaster;
  processSupervisor: IProcessSupervisor;
}

export function buildContainer(db: Database.Database): AppContainer {
  // ── 基础设施层 ───────────────────────────────────────
  const fileLock = new FileLockProvider();
  const a2sClient = new A2SClient();
  const rconManager = new RconManager();
  const processSupervisor = new ProcessSupervisor();

  // ── API 层 ────────────────────────────────────────────
  const broadcaster = wsBroadcaster;  // 单例，已在 index.ts 中 init

  // ── 核心域层 ──────────────────────────────────────────
  const configService = new ConfigService(db, fileLock);
  const filesService = new FilesService(fileLock, db);
  const steamCmdManager = new SteamCmdManager(db, processSupervisor, broadcaster);
  const workshopMeta = new WorkshopMetadataService(db);
  const logStreamer = new LogStreamer(broadcaster, processSupervisor, db);

  // ServerManager（聚合根）
  const serverManager = new ServerManager(
    db, processSupervisor, rconManager, a2sClient, configService, broadcaster,
  );

  // AuthService
  const authService = new AuthService(db);

  return {
    authService,
    serverManager,
    configService,
    filesService,
    steamCmdManager,
    workshopMeta,
    logStreamer,
    rconManager,
    a2sClient,
    broadcaster,
    processSupervisor,
  };
}
