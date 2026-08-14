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
  type ILdmDiscoveryService,
  type ILdmPluginCommandsService,
  type ILdmPluginSourceService,
  type IItemService,
} from "@unturned-manager/shared";

import { config } from "./config.js";
import { logger } from "./utils/logger.js";
import { AppError } from "./utils/AppError.js";
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
import { ItemService } from "./modules/items/ItemService.js";
import { LdmAssemblyVersionReader } from "./modules/ldm/LdmAssemblyVersionReader.js";
import { LdmDiscoveryService } from "./modules/ldm/LdmDiscoveryService.js";
import { LdmPluginCommandsService } from "./modules/ldm/LdmPluginCommandsService.js";
import { LdmPluginSourceService } from "./modules/ldm/LdmPluginSourceService.js";
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
  // LDM（Mod 框架）Phase 1——3 模块 + 1 个 reader（独立于 PtyManager/RocketRuntimeReader）
  ldmVersionReader: LdmAssemblyVersionReader;
  ldmDiscovery: ILdmDiscoveryService;
  ldmCommands: ILdmPluginCommandsService;
  ldmSource: ILdmPluginSourceService;
  // 物品清单（开局物品选择器 + 名称反查）——全局一份
  itemService: IItemService;
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

  // 物品清单服务——内置种子幂等播种（INSERT OR IGNORE，启动时执行一次）
  const itemService = new ItemService(db);
  itemService.seedBuiltinItems();

  // ── LDM Mod 框架 Phase 1 模块 ─────────────────────────────────
  const ldmVersionReader = new LdmAssemblyVersionReader();
  // LdmRuntimeStatusReader 当前返回空对象（runtimeStatus 全部 unknown）——
  // Phase 2 接 PtyManager 真实监听 /rocket plugins 输出解析。
  const ldmRuntimeStatusReader = async () => ({});
  const ldmDiscovery = new LdmDiscoveryService(
    ldmVersionReader,
    ldmRuntimeStatusReader,
  );
  const ldmCommands = new LdmPluginCommandsService(
    ptyManager,
    serverManager as unknown as Pick<IServerManager, "getState">,
    ldmRuntimeStatusReader,
  );
  const ldmSource = new LdmPluginSourceService();

  // ── WS 请求-应答处理器注册（ws-wrapper-design §2.4）────────────────
  // 三个 ACK 语义的终端操作：关控制台 / 存档 / 关服。ack 经 gateway 回给请求方，
  // 业务失败走 error 字段（code 用 snake_case，message 是用户可见中文）。

  broadcaster.registerRequestHandler("terminal_close", async (msg) => {
    // 关控制台 = 终止 PTY 进程（SIGTERM → 5s → SIGKILL）。owner-trust 核选项：
    // 服务端进程随 bash 终止且不自动存档——前端按钮有 ConfirmDialog 拦截。
    // PTY 不存在时 kill 幂等返回（关闭一个已关闭的终端 = 目标状态已达成）。
    await ptyManager.kill(msg.serverId);
    return { ok: true };
  });

  broadcaster.registerRequestHandler("save", async (msg) => {
    if (!ptyManager.isRunning(msg.serverId)) {
      return {
        ok: false,
        error: { code: "pty_not_running", message: "服务器没在运行，无法存档" },
      };
    }
    ptyManager.write(msg.serverId, "Save\n");
    try {
      // ★ 2026-08-14 对齐官方真源：U3-SDK `CommandSave.cs:15` 存档完成后打本地化 SaveText
      // `SaveText` = "Successfully saved the game."（实机 `Localization/English/Server/ServerCommandSave.dat`
      // xxd 提取确认）。旧正则 /world saved/i 与官方文本不匹配 → 存档永远超时。
      // 负向信号：`SaveManager.cs:51` 地图未加载完时 warn `Ignoring request to save before level finished loading`
      // → 直接判「地图未就绪」而非等满 30s 超时。
      const success = /successfully saved the game/i;
      const failure = /ignoring request to save before level finished loading/i;
      await new Promise<void>((resolve, reject) => {
        let settled = false;
        const settle = (err?: AppError): void => {
          if (settled) return;
          settled = true;
          offData();
          offExit();
          if (err) reject(err);
          else resolve();
        };
        const offData = ptyManager.onData(msg.serverId, (line: string) => {
          if (success.test(line)) {
            settle();
          } else if (failure.test(line)) {
            settle(
              new AppError(
                "save_level_not_loaded",
                "地图还没加载完，无法存档——请等服务端就绪后再试",
                409,
              ),
            );
          }
        });
        const offExit = ptyManager.onExit(msg.serverId, () => {
          settle(new AppError("pty-exited", "控制台已关闭，存档中断", 409));
        });
        const timer = setTimeout(() => {
          settle(
            new AppError(
              "save_timeout",
              "存档超时——没有等到保存完成的信号",
              504,
            ),
          );
        }, 30_000);
        timer.unref?.();
      });
      return { ok: true };
    } catch (err) {
      return {
        ok: false,
        error: {
          code:
            err instanceof AppError ? err.code : "save_timeout",
          message:
            err instanceof Error ? err.message : "存档失败",
        },
      };
    }
  });

  broadcaster.registerRequestHandler("shutdown", async (msg) => {
    // 注册表按 string 分发、契约是联合类型——先收窄到 shutdown 变体（gateway 按 type 精确路由，实际不会 miss）
    if (msg.type !== "shutdown") {
      return {
        ok: false,
        error: { code: "invalid_message", message: "消息类型不匹配" },
      };
    }
    if (!ptyManager.isRunning(msg.serverId)) {
      return {
        ok: false,
        error: { code: "pty_not_running", message: "服务器没在运行" },
      };
    }
    // delaySeconds 钳制 0–600（防手滑输入天文数字把服挂在那里倒数）
    const delaySeconds = Math.min(
      Math.max(Math.trunc(msg.delaySeconds) || 0, 0),
      600,
    );
    // reason 进 PTY 命令行：剥引号/换行防命令拼接断裂（owner-trust 但也防手滑）
    const reason =
      (msg.reason ?? "").replace(/["\r\n]+/g, " ").trim() || "面板请求关服";
    // SOP 重启流水线：先 Save 刷盘再 Shutdown（与 REST stop 同序）
    ptyManager.write(msg.serverId, "Save\n");
    ptyManager.write(msg.serverId, `Shutdown ${delaySeconds} "${reason}"\n`);
    // 等控制台进程退出（倒计时 + 30s 冗余）；超时由用户在终端里人工处置
    const exited = await ptyManager.waitExit(
      msg.serverId,
      (delaySeconds + 30) * 1000,
    );
    return exited
      ? { ok: true }
      : {
          ok: false,
          error: {
            code: "shutdown_timeout",
            message: "关服超时——进程没有在预期时间内退出",
          },
        };
  });

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
    ldmVersionReader,
    ldmDiscovery,
    ldmCommands,
    ldmSource,
    itemService,
  };
}
