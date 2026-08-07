import Database from 'better-sqlite3';
import {
  ServerState,
  RconProtocol,
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

// ─── Stub factories (Wave 2+ 逐步替换为真实实现) ────────

function createBroadcasterStub(): IBroadcaster {
  return {
    broadcast: () => {},
    register: () => {},
    unregister: () => {},
    destroy: async () => {},
  };
}

function createConfigServiceStub(): IConfigService {
  return {
    readCommandsDat: async () => { throw new Error('Not implemented'); },
    writeCommandsDat: async () => { throw new Error('Not implemented'); },
    readConfigTxt: async () => { throw new Error('Not implemented'); },
    writeConfigTxt: async () => { throw new Error('Not implemented'); },
    readWorkshopConfig: async () => { throw new Error('Not implemented'); },
    writeWorkshopFileIds: async () => { throw new Error('Not implemented'); },
    backup: async () => { throw new Error('Not implemented'); },
    readOpenModConfig: async () => { throw new Error('Not implemented'); },
    writeOpenModConfig: async () => { throw new Error('Not implemented'); },
    readRocketModConfig: async () => { throw new Error('Not implemented'); },
    writeRocketModConfig: async () => { throw new Error('Not implemented'); },
  };
}

function createFilesServiceStub(): IFilesService {
  return {
    listDirectory: async () => [],
    readFile: async () => new Uint8Array(0),
    writeFile: async () => {},
    deleteEntry: async () => {},
    createDirectory: async () => {},
    renameEntry: async () => {},
    getPermissions: async () => ({ owner: 'read', group: 'none', other: 'none' }),
    createUploadStream: () => { throw new Error('Not implemented'); },
  };
}

function createSteamCmdManagerStub(): ISteamCmdManager {
  return {
    getStatus: async () => ({ isInstalled: false }),
    install: async () => { throw new Error('Not implemented'); },
    updateU3DS: async () => { throw new Error('Not implemented'); },
  };
}

function createWorkshopMetadataServiceStub(): IWorkshopMetadataService {
  return {
    getModDetails: async () => null,
    searchMods: async () => [],
    refreshCache: async () => {},
  };
}

function createLogStreamerStub(): ILogStreamer {
  return {
    startStreaming: () => {},
    stopStreaming: () => {},
  };
}

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
  // ── Wave 1: 基础设施层（真实实现）────────────────────
  const fileLock = new FileLockProvider();
  const a2sClient = new A2SClient();
  const rconManager = new RconManager();
  const processSupervisor = new ProcessSupervisor();

  // ── Wave 1: API 层 ───────────────────────────────────
  const broadcaster = createBroadcasterStub();
  // ── Wave 2: 核心域层（逐步替换 stub）──────────────
  const configService = createConfigServiceStub();
  const filesService = createFilesServiceStub();
  const steamCmdManager = createSteamCmdManagerStub();
  const workshopMeta = createWorkshopMetadataServiceStub();
  const logStreamer = createLogStreamerStub();

  // ServerManager (Wave 2: 真实实现)
  const serverManager = new ServerManager(
    db, processSupervisor, rconManager, a2sClient, configService, broadcaster,
  );

  // AuthService (Sprint 1: 真实实现)
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
