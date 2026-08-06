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

// ─── Stub factories ───────────────────────────────────

function createFileLockProviderStub(): IFileLockProvider {
  return {
    acquire: async () => {},
    release: () => {},
    isLocked: () => false,
  };
}

function createA2SClientStub(): IA2SClient {
  return {
    query: async () => ({ players: 0, maxPlayers: 0, map: '', version: '', latency: 0 }),
    destroy: async () => {},
  };
}

function createRconManagerStub(): IRconManager {
  return {
    connect: async () => {},
    disconnect: () => {},
    execute: async () => { throw new Error('Not implemented: RconManager.execute'); },
    getProtocol: () => RconProtocol.UNREACHABLE,
    isReachable: () => false,
    destroy: async () => {},
    onStateChange: () => {},
  };
}

function createProcessSupervisorStub(): IProcessSupervisor {
  return {
    spawn: async () => { throw new Error('Not implemented: ProcessSupervisor.spawn'); },
    gracefulShutdown: async () => {},
    waitForExit: async () => {},
    forceKill: () => {},
    isRunning: () => false,
    destroy: async () => {},
    onStdout: () => {},
    onCrash: () => {},
  };
}

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

function createServerManagerStub(
  processSupervisor: IProcessSupervisor,
  rconManager: IRconManager,
  a2sClient: IA2SClient,
  configService: IConfigService,
  broadcaster: IBroadcaster,
): IServerManager {
  return {
    getState: () => ServerState.STOPPED,
    getActiveOperation: () => ({ type: 'none' }),
    listServers: async () => [],
    createServer: async () => { throw new Error('Not implemented'); },
    configureServer: async () => { throw new Error('Not implemented'); },
    start: async () => { throw new Error('Not implemented'); },
    stop: async () => { throw new Error('Not implemented'); },
    restart: async () => { throw new Error('Not implemented'); },
    forceStop: async () => { throw new Error('Not implemented'); },
    applyModChanges: async () => { throw new Error('Not implemented'); },
    updateServerBinaries: async () => { throw new Error('Not implemented'); },
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
  const fileLock = createFileLockProviderStub();
  const a2sClient = createA2SClientStub();
  const rconManager = createRconManagerStub();
  const processSupervisor = createProcessSupervisorStub();
  const broadcaster = createBroadcasterStub();
  const configService = createConfigServiceStub();
  const filesService = createFilesServiceStub();
  const steamCmdManager = createSteamCmdManagerStub();
  const workshopMeta = createWorkshopMetadataServiceStub();
  const logStreamer = createLogStreamerStub();
  const serverManager = createServerManagerStub(
    processSupervisor, rconManager, a2sClient, configService, broadcaster
  );

  // AuthService 是 Sprint 1 唯一真实实现
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
