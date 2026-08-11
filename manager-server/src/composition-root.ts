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
  type IProcessSupervisor,
  type IBroadcaster,
  type IFileLockProvider,
  type IAuthService,
  type IPtyManager,
  type ISessionManager,
  type IU3dsStatusProvider,
} from "@unturned-manager/shared";

import { config } from "./config.js";
import { logger } from "./utils/logger.js";
import { AuthService } from "./modules/auth/AuthService.js";
import { FileLockProvider } from "./modules/filelock/FileLockProvider.js";
import { ProcessSupervisor } from "./modules/process/ProcessSupervisor.js";
import { PtyManager } from "./modules/process/PtyManager.js";
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
import { SessionManager } from "./modules/sessions/SessionManager.js";
import { U3dsStatusProvider } from "./modules/u3ds/U3dsStatusProvider.js";
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
  broadcaster: IBroadcaster;
  processSupervisor: IProcessSupervisor;
  ptyManager: IPtyManager;
  sessionManager: ISessionManager;
  u3dsStatus: IU3dsStatusProvider;
}

export function buildContainer(db: Database.Database): AppContainer {
  // ── 基础设施层 ──────────────────────────────────────
  const fileLock = new FileLockProvider();
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

  // Phase 7：终端会话持久化（1:1 GSM3 TerminalSessionManager）
  const sessionManager = new SessionManager(logger, config.dataDir);

  // Unturned 服务端（U3DS）安装状态查询器——读启动脚本 + Status.json + 安装清单
  const u3dsStatus = new U3dsStatusProvider(logger);

  // ServerManager（聚合根）——目录扫描真源 + settings K-V 凭证
  // ★ ADR-0004 Phase 2：U3DS 实例进程走 PTY（ptyManager）；processSupervisor 只服务 SteamCMD 等非 PTY spawn
  // ★ ADR-0004 Phase 6：RCON 通道已删除——所有命令通过 PTY 终端 owner-trust 模型执行
  // ★ ADR-0005 Phase 7：注入 sessionManager——PTY spawn/exit 时调 saveSession / setSessionActive
  serverManager = new ServerManager(
    db,
    new ServerDiscovery(),
    ptyManager,
    configService,
    broadcaster,
    workshopApply,
    sessionManager,
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
    broadcaster,
    processSupervisor,
    ptyManager,
    sessionManager,
    u3dsStatus,
  };
}
