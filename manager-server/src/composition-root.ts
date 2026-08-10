import Database from "better-sqlite3";
import {
  type IServerManager,
  type IConfigService,
  type IFilesService,
  type ISteamCmdManager,
  type IWorkshopMetadataService,
  type IWorkshopAcfService,
  type IWorkshopApplyService,
  type IWorkshopDeleteService,
  type ILogStreamer,
  type IRconManager,
  type IProcessSupervisor,
  type IBroadcaster,
  type IFileLockProvider,
  type IAuthService,
  type IPtyManager,
} from "@unturned-manager/shared";

import { config } from "./config.js";
import { AuthService } from "./modules/auth/AuthService.js";
import { FileLockProvider } from "./modules/filelock/FileLockProvider.js";
import { ProcessSupervisor } from "./modules/process/ProcessSupervisor.js";
import { PtyManager } from "./modules/process/PtyManager.js";
import { RconManager } from "./modules/rcon/RconManager.js";
import { ServerManager } from "./modules/server/ServerManager.js";
import { ServerDiscovery } from "./modules/server/ServerDiscovery.js";
import { ConfigService } from "./modules/config/ConfigService.js";
import { FilesService } from "./modules/files/FilesService.js";
import { SteamCmdManager } from "./modules/steamcmd/SteamCmdManager.js";
import { WorkshopMetadataService } from "./modules/workshop/WorkshopMetadataService.js";
import { WorkshopAcfService } from "./modules/workshop/WorkshopAcfService.js";
import { WorkshopApplyService } from "./modules/workshop/WorkshopApplyService.js";
import { WorkshopDeleteService } from "./modules/workshop/WorkshopDeleteService.js";
import { LogStreamer } from "./modules/logs/LogStreamer.js";
import { wsBroadcaster } from "./ws/gateway.js";

// ─── Container ────────────────────────────────────────

export interface AppContainer {
  authService: IAuthService;
  serverManager: IServerManager;
  configService: IConfigService;
  filesService: IFilesService;
  steamCmdManager: ISteamCmdManager;
  workshopMeta: IWorkshopMetadataService;
  workshopAcf: IWorkshopAcfService;
  workshopApply: IWorkshopApplyService;
  workshopDelete: IWorkshopDeleteService;
  logStreamer: ILogStreamer;
  rconManager: IRconManager;
  broadcaster: IBroadcaster;
  processSupervisor: IProcessSupervisor;
  ptyManager: IPtyManager;
}

export function buildContainer(db: Database.Database): AppContainer {
  // ── 基础设施层 ──────────────────────────────────────
  const fileLock = new FileLockProvider();
  const rconManager = new RconManager();
  const processSupervisor = new ProcessSupervisor();
  // ★ ADR-0004 Phase 1：U3DS 是 TTY-only 进程——PTY 模拟让 U3DS 走 ANSI 色彩进度条
  // （GSM3 同款依赖）。ProcessSupervisor 保留作非 PTY spawn（SteamCMD execFile/进程）
  const ptyManager = new PtyManager();

  // ── API 层 ────────────────────────────────────────────
  const broadcaster = wsBroadcaster; // 单例，已在 index.ts 中 init

  // ── 核心域层 ──────────────────────────────────────────
  const configService = new ConfigService(fileLock);
  const filesService = new FilesService(fileLock);

  // SteamCmdManager 依赖 ServerManager 活跃实例探活（B2 §3.4：DB state 列已删）——
  // 用延迟绑定闭包打破构造循环：先声明 serverManager，SteamCmdManager 的 activeProbe 在
  // 闭包内解引用，构造完成后再赋值。
  let serverManager: ServerManager | undefined;
  const steamCmdManager = new SteamCmdManager(
    processSupervisor,
    broadcaster,
    config.steamCmdDir, // STEAMCMD_DIR env 显式声明；未设回落 DEFAULT_PATHS 探测
    () => serverManager?.listActiveServerIds() ?? [],
  );
  const workshopMeta = new WorkshopMetadataService(db);
  const workshopAcf = new WorkshopAcfService(configService);
  const workshopApply = new WorkshopApplyService(
    workshopAcf,
    configService,
    broadcaster,
  );
  const workshopDelete = new WorkshopDeleteService(workshopAcf, configService);
  const logStreamer = new LogStreamer(broadcaster, processSupervisor);

  // ServerManager（聚合根）——目录扫描真源 + settings K-V 凭证
  serverManager = new ServerManager(
    db,
    new ServerDiscovery(),
    processSupervisor,
    rconManager,
    configService,
    broadcaster,
    workshopApply,
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
    workshopAcf,
    workshopApply,
    workshopDelete,
    logStreamer,
    rconManager,
    broadcaster,
    processSupervisor,
    ptyManager,
  };
}
