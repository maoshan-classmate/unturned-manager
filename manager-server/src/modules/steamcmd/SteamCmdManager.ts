import fs from "fs";
import os from "os";
import path from "path";
import https from "https";
import { createWriteStream } from "fs";
import { execFile } from "child_process";
import { promisify } from "util";
import * as tar from "tar";
import { STEAM_APP_IDS } from "@unturned-manager/shared";
import type {
  ISteamCmdManager,
  IProcessSupervisor,
  IBroadcaster,
  SteamCmdStatus,
  ServerId,
} from "@unturned-manager/shared";
import { logger } from "../../utils/logger.js";
import { AppError } from "../../utils/AppError.js";

const execFileAsync = promisify(execFile);

/** execFile 注入点类型（测试替身用） */
export type ExecFileAdapter = (
  cmd: string,
  args: string[],
  opts: { timeout: number; cwd?: string },
) => Promise<{ stdout: string; stderr: string }>;

/** 默认 execFile 适配器（生产用真实 child_process） */
const defaultExecFileAdapter: ExecFileAdapter = (cmd, args, opts) =>
  execFileAsync(cmd, args, opts) as Promise<{ stdout: string; stderr: string }>;

// ─── 常量 ────────────────────────────────────────────────

/** SteamCMD 常见安装路径 */
const DEFAULT_PATHS = [
  "/usr/games/steamcmd",
  "/usr/bin/steamcmd",
  "/opt/steamcmd",
  "/home/steam/steamcmd",
];

/** SteamCMD 进度行正则（例： " Update state (0x61) downloading,78.36 MB, 3597137 / 4589923"）
 *  粗略匹配关键字 + 可选百分比。不强制精确。 */
const PROGRESS_RE =
  /\b(downloading|validating|installed|preallocating|checking|updating|update complete|deprecated)\b/i;
const PERCENT_RE = /(\d{1,3})\s*%/;

// AppID 唯一真源 = shared/constants.ts 的 STEAM_APP_IDS——
// U3DS_SERVER=1110390（app_update/查版本），UNTURNED_GAME=304930（workshop 全链路）

/** 下载超时（Cardinal）/ 验证超时 */
const UPDATE_TIMEOUT_MS = 30 * 60 * 1000;
const DOWNLOAD_TIMEOUT_MS = 60 * 60 * 1000;

// ─── 实现 ────────────────────────────────────────────────

export class SteamCmdManager implements ISteamCmdManager {
  /** 当前正在跑的 steamcmd 子进程写目录集合（防同一目录并发写入竞态） */
  private activeJobs = new Set<string>();

  /**
   * 计算 activeJobs 锁 key——语义「SteamCMD 进程会写入的目录」。
   *
   * review 修复（P2-2 锁 key 统一）：之前 5 个方法各自取「最自然的字符串」做 key，
   * 缺乏统一语义边界，导致 downloadWorkshopItem 同 installDir 不同 serverId 误互斥
   * （实写 stagingDir 不同——`/opt/unturned/Servers/A/Workshop/staging` vs
   * `/opt/unturned/Servers/B/Workshop/staging`，本可并发）。
   *
   * 锁的**真实边界**是「SteamCMD 进程写入的目录」——并发写同一目录才互斥。
   *
   * @param writeDir - 该方法内部 SteamCMD 进程将写入的目录
   * @returns 锁 key 字符串（用 fs.realpathSync 归一解析软链接等，同一物理目录拿到同一 key）
   */
  private resolveLockKey(writeDir: string): string {
    try {
      // realpathSync 解析软链接/../，确保 `/opt/unturned/./` 与 `/opt/unturned` 同 key
      // 目录可能尚未存在（重装首次调用），用 try/catch 回落原字符串
      return fs.realpathSync(writeDir);
    } catch {
      return path.resolve(writeDir);
    }
  }

  /**
   * @param processSupervisor - 进程编排
   * @param broadcaster - WS 广播
   * @param steamCmdPath - SteamCMD 安装目录或可执行文件路径（STEAMCMD_DIR 注入通常是目录；测试注入可以是文件）
   * @param activeProbe - 活跃实例探活器（ADR-0003 B2 §3.4：DB state 列已删，改依赖 ServerManager 内存态）
   */
  constructor(
    private processSupervisor: IProcessSupervisor,
    private broadcaster: IBroadcaster,
    private steamCmdPath?: string,
    private activeProbe: () => ServerId[] = () => [],
    /** 测试注入点：生产环境不传，走默认 execFileAdapter */
    private execFileAdapter: ExecFileAdapter = defaultExecFileAdapter,
  ) {}

  async getStatus(): Promise<SteamCmdStatus> {
    const candidate = this.steamCmdPath ?? this.findSteamCmd();
    const exePath = candidate ? this.resolveExecutable(candidate) : null;
    const isInstalled = exePath !== null;

    // 抄 GSM3 SteamCMDManager.ts:115-133 —— 补充 version 字段（spawn steamcmd +version 解析）
    let version: string | undefined;
    if (isInstalled && exePath) {
      try {
        const { stdout } = await this.execFileAdapter(
          exePath,
          ["+version", "+quit"],
          { timeout: 10_000 },
        );
        // SteamCMD v2 输出实测（BUG-9 第五版）：
        //   "Steam Console Client (Linux) Version 1785799152 - type 'quit' to exit --"
        // 末尾 " - type 'quit' to exit --" 是交互提示。
        // 此前截断逻辑只剥 type 'quit'，残留 " - --"；改为：从 " - " 开始一刀切，
        // 取 group 1（版本号）作为主值；group 2 仅在看起来像日期（YYYY-...）时拼接。
        const match = stdout.match(/Version\s+(\d+)(?:\s*-\s*([^\n]+))?/i);
        if (match) {
          const raw = (match[2] ?? "").split(" - ")[0]?.trim() ?? "";
          // 仅在像 build date（ISO 日期前缀 / "YYYY-MM-DD..."）时拼接，否则只显示版本号
          const looksLikeDate = /^\d{4}-\d{2}-\d{2}/.test(raw);
          version = looksLikeDate ? `${match[1]} (${raw})` : match[1];
        }
      } catch (err) {
        logger.warn({ err, exePath }, "SteamCMD 版本解析失败");
      }
    }

    return {
      isInstalled,
      // installPath 返回用户配置/探测的**目录**（对齐 GSM3 config.installPath 语义），
      // 而非解析后的可执行文件——前端路径编辑 dialog 用它做初值，避免保存后显示跳动
      installPath: candidate ?? undefined,
      version,
      lastChecked: new Date().toISOString(),
    };
  }

  /** 运行时设置 SteamCMD 安装目录（前端路径编辑 dialog；内存态，重启回落 STEAMCMD_DIR env） */
  setInstallPath(installPath: string): void {
    this.steamCmdPath = installPath;
  }

  async install(_installDir: string): Promise<void> {
    // SteamCMD 安装通常由 docker 镜像自带；面板只做状态展示
    const status = await this.getStatus();
    if (!status.isInstalled) {
      throw new AppError(
        "steamcmd-not-found",
        "SteamCMD 未安装。请使用包含 SteamCMD 的镜像。",
        500,
      );
    }
  }

  /**
   * 安装 U3DS 二进制（BUG-3/7 修复入口，BUG-2 异步化）。
   * 抄 GSM3 `installOnline` 模式：runscript 模板 + spawn + 解析 stdout + progress 广播。
   * 与 updateU3DS 区别：首次安装**不加** validate（没东西可校验），且事后验证启动脚本存在。
   *
   * **异步启动**：spawn 后立即返回 jobId，不等待 SteamCMD 下载/安装完成——下载 10GB 是长任务，
   * HTTP 同步等会挂起导致前端 axios 超时（同 BUG-5/6）。后台完成/失败经 WS `steamcmd_progress` 广播。
   *
   * @param installDir - U3DS 安装根目录（典型 /opt/unturned）
   * @param callbacks - 进度回调（抄 GSM3 onProgress/onStatusChange 形态；route 不传，靠 WS）
   * @returns jobId（`steamcmd-install-<installDir>`）
   * @throws {AppError} code=servers-active/steamcmd-busy/steamcmd-not-found（spawn 前同步抛）
   * @throws {Error} spawn 失败（同步抛，route 转 500）
   */
  async installU3DS(
    installDir: string,
    callbacks?: {
      onProgress?: (progress: number) => void;
      onStatusChange?: (status: string) => void;
    },
  ): Promise<string> {
    // 1. 前置检查：所有实例 STOPPED（架构 spec §1.4）
    const activeIds = this.activeProbe();
    if (activeIds.length > 0) {
      throw new AppError(
        "servers-active",
        `以下服务端仍在运行，无法安装 U3DS：${activeIds.join(", ")}。请先停止所有实例。`,
        409,
      );
    }
    // P2-2 锁 key 统一：锁边界 = SteamCMD 写入目录
    const lockKey = this.resolveLockKey(installDir);
    if (this.activeJobs.has(lockKey)) {
      throw new AppError(
        "steamcmd-busy",
        "该 installDir 已有 SteamCMD 任务在跑",
        409,
      );
    }

    const exePath = this.getExePath();
    if (!exePath) {
      throw new AppError("steamcmd-not-found", "SteamCMD 未安装", 500);
    }

    this.activeJobs.add(lockKey);
    const jobId = `steamcmd-install-${installDir}`;

    // 2. 生成 runscript（与 updateU3DS 同模板，去 validate）
    const scriptContent = [
      "@ShutdownOnFailedCommand 1",
      "@NoPromptForPassword 1",
      `force_install_dir "${installDir}"`,
      "login anonymous",
      `app_update ${STEAM_APP_IDS.U3DS_SERVER}`, // ★ 首次安装：去掉 validate
      "quit",
    ].join("\n");
    const scriptPath = path.join(installDir, ".steamcmd-install.scf");
    await fs.promises.mkdir(installDir, { recursive: true });
    await fs.promises.writeFile(scriptPath, scriptContent, { mode: 0o600 });

    callbacks?.onStatusChange?.("spawned");
    this.broadcastProgressWithJobId(jobId, 0, "spawned");

    // 3. spawn（失败同步抛 → route 转 500；锁在此释放）
    try {
      const pid = await this.processSupervisor.spawn(
        jobId,
        exePath,
        ["+runscript", scriptPath],
        path.dirname(exePath),
      );
      this.loggerUpdate().info(
        { installDir, pid },
        "SteamCMD install 进程已 spawn",
      );
    } catch (err) {
      callbacks?.onStatusChange?.("failed");
      this.broadcastProgressWithJobId(jobId, 0, "failed");
      this.activeJobs.delete(lockKey);
      try {
        await fs.promises.unlink(scriptPath);
      } catch {
        /* noop */
      }
      throw err;
    }

    // 4. 解析 stdout + 进度回调（抄 GSM3: 两条通道：callback + WS 广播）
    this.processSupervisor.onStdout(jobId, (line: string) => {
      const { stage, percent } = this.parseProgressLine(line);
      callbacks?.onProgress?.(percent ?? 0);
      callbacks?.onStatusChange?.(stage);
      this.broadcaster.broadcast({
        type: "steamcmd_progress",
        jobId,
        stage,
        percent,
      });
    });

    // 5. 后台收尾（BUG-2 异步化）：等待退出 → 清临时脚本 → 验证启动脚本 → 广播 completed/failed → 释放锁
    void (async () => {
      try {
        const installExitCode = await this.processSupervisor.waitForExit(
          jobId,
          UPDATE_TIMEOUT_MS,
        );
        // BUG-3/7：steamcmd 下载失败（exitCode≠0）报真实错误，
        // 不再误报"安装完成但未检测到启动脚本"（否则用户误以为装好，点启动才炸）
        if (installExitCode !== 0 && installExitCode != null) {
          throw new Error(
            `SteamCMD 安装进程异常退出 (code ${installExitCode})`,
          );
        }
        try {
          await fs.promises.unlink(scriptPath);
        } catch {
          /* noop */
        }

        // 事后验证：启动脚本必须出现（detectStartScript 复用现有逻辑）
        const { detectStartScript } = await import("../server/startScript.js");
        const script = await detectStartScript(installDir);
        if (!script) {
          throw new AppError(
            "install-script-missing",
            `U3DS 安装完成但未检测到启动脚本（${installDir}）。可能 Mono 兼容性问题或下载中断。`,
            500,
          );
        }

        callbacks?.onStatusChange?.("completed");
        this.broadcastProgressWithJobId(jobId, 100, "completed");
        this.loggerUpdate().info(
          { installDir, script },
          "SteamCMD install 完成",
        );
      } catch (err) {
        callbacks?.onStatusChange?.("failed");
        this.broadcastProgressWithJobId(jobId, 0, "failed");
        this.loggerUpdate().error({ err, installDir }, "SteamCMD install 失败");
      } finally {
        this.activeJobs.delete(lockKey);
      }
    })();

    return jobId;
  }

  /** BUG-2 修复：广播带 jobId 的进度事件（多任务并发隔离）。
   *  review 修复（P2-1）：删死参数 stage——方法体只广播 label，原第一个 stage 参数完全被忽略，
   *  调用者易误把 "completed"/"failed" 传进 stage 位导致广播错 stage。签名收敛为 (jobId, percent, label)。 */
  private broadcastProgressWithJobId(
    jobId: string,
    percent: number | undefined,
    label: string,
  ): void {
    try {
      this.broadcaster.broadcast({
        type: "steamcmd_progress",
        jobId,
        stage: label,
        ...(percent != null ? { percent } : {}),
      });
    } catch {
      /* noop */
    }
  }

  /**
   * 更新 U3DS 二进制（Phase 0 异步化——ADR-0004 §4 Phase 0）。
   *
   * 异步启动：spawn 后立即返回 jobId，不等待 SteamCMD 退出。进度/完成/失败经 WS
   * `steamcmd_progress`（带 jobId）广播。前端订阅完成后弹 toast「U3DS 更新完成」。
   *
   * @param installDir - U3DS 安装根目录
   * @returns jobId（`steamcmd-update-<installDir>`），前端用它关联 WS 进度事件
   * @throws {AppError} code=servers-active/steamcmd-busy/steamcmd-not-found（spawn 前同步抛）
   */
  async updateU3DS(installDir: string): Promise<string> {
    // 前置检查（同步抛，不进异步路径）
    const activeIds = this.activeProbe();
    if (activeIds.length > 0) {
      throw new AppError(
        "servers-active",
        `以下服务端仍在运行，无法更新 U3DS：${activeIds.join(", ")}。请先停止所有实例。`,
        409,
      );
    }
    // P2-2 锁 key 统一：锁边界 = SteamCMD 写入目录
    const lockKey = this.resolveLockKey(installDir);
    if (this.activeJobs.has(lockKey)) {
      throw new AppError(
        "steamcmd-busy",
        "该 installDir 已有 SteamCMD 任务在跑",
        409,
      );
    }

    const exePath = this.getExePath();
    if (!exePath) {
      throw new AppError("steamcmd-not-found", "SteamCMD 未安装", 500);
    }

    this.activeJobs.add(lockKey);
    const jobId = `steamcmd-update-${installDir}`;

    // runscript + spawn（与 installU3DS 同形态）
    const scriptContent = [
      "@ShutdownOnFailedCommand 1",
      "@NoPromptForPassword 1",
      `force_install_dir "${installDir}"`,
      "login anonymous",
      `app_update ${STEAM_APP_IDS.U3DS_SERVER} validate`,
      "quit",
    ].join("\n");
    const scriptPath = path.join(installDir, ".steamcmd-update.scf");

    try {
      await fs.promises.mkdir(installDir, { recursive: true });
      await fs.promises.writeFile(scriptPath, scriptContent, { mode: 0o600 });

      this.broadcastProgressWithJobId(jobId, 0, "spawned");

      const pid = await this.processSupervisor.spawn(
        jobId,
        exePath,
        ["+runscript", scriptPath],
        path.dirname(exePath),
      );

      this.loggerUpdate().info(
        { installDir, pid },
        "SteamCMD update 进程已 spawn",
      );

      // 解析 stdout 推进度
      this.processSupervisor.onStdout(jobId, (line: string) => {
        const { stage, percent } = this.parseProgressLine(line);
        this.broadcaster.broadcast({
          type: "steamcmd_progress",
          jobId,
          stage,
          percent,
        });
      });

      // 后台收尾：等退出 → 清临时脚本 → 广播 completed/failed → 释放锁
      void (async () => {
        try {
          const updateExitCode = await this.processSupervisor.waitForExit(
            jobId,
            UPDATE_TIMEOUT_MS,
          );
          if (updateExitCode !== 0 && updateExitCode != null) {
            throw new Error(
              `SteamCMD 更新进程异常退出 (code ${updateExitCode})`,
            );
          }
          this.broadcastProgressWithJobId(jobId, 100, "completed");
          this.loggerUpdate().info({ installDir }, "SteamCMD update 完成");
        } catch (err) {
          this.broadcastProgressWithJobId(jobId, 0, "failed");
          this.loggerUpdate().error(
            { err, installDir },
            "SteamCMD update 失败",
          );
        } finally {
          try {
            await fs.promises.unlink(scriptPath);
          } catch {
            /* noop */
          }
          this.activeJobs.delete(lockKey);
        }
      })();

      return jobId;
    } catch (err) {
      // spawn 失败同步抛（route 转 500）；锁在此释放
      this.activeJobs.delete(lockKey);
      try {
        await fs.promises.unlink(scriptPath);
      } catch {
        /* noop */
      }
      this.broadcastProgressWithJobId(jobId, 0, "failed");
      throw err;
    }
  }

  /**
   * 卡 C #6：下载 Workshop Mod 到 staging 目录（不停服）。
   * 命令：steamcmd +force_install_dir <staging> +login anonymous +workshop_download_item 304930 <id> +quit
   * 应用由 ServerManager.applyModChanges 流水线负责（卡 B 已实装）。
   *
   * BUG-5/6 修复：**异步启动**——spawn 后立即返回 jobId，不等待 SteamCMD 退出。
   * 下载进程在后台跑，进度/完成/失败经 WS `steamcmd_progress`（带 jobId）广播，
   * 前端不再等 HTTP（原来同步等导致 axios 10s 超时）。互斥锁借鉴 DST
   * `ModDownloadExecuting`（dst/mod.go:72-75）：同 installDir 一次一个下载任务防并发写 staging。
   */
  async downloadWorkshopItem(
    installDir: string,
    itemIds: string[],
    serverId?: string,
  ): Promise<string> {
    if (!itemIds.length) return "";
    // ★ BUG-5/6（第四版根因）：staging 必须落在 <installDir>/Servers/<serverId>/Workshop/staging——
    //   U3DS 只加载 Servers/<id>/Workshop/ 下的内容，acf 扫描（workshopAcfService.ts:24）与
    //   apply 流水线（WorkshopApplyService.ts:141）都读这个路径。传 serverId 拼对目录；
    //   不传则回落旧顶层路径（兼容 /steamcmd/download-workshop 老端点）。
    const stagingDir = serverId
      ? path.join(installDir, "Servers", serverId, "Workshop", "staging")
      : path.join(installDir, "Workshop", "staging");

    // P2-2 锁 key 统一：锁边界 = SteamCMD 写入目录 = stagingDir
    // review 修复：之前用 installDir 做锁，同 installDir 不同 serverId 的 download 误互斥——
    // 实写不同 staging（`Servers/A/Workshop/staging` vs `Servers/B/Workshop/staging`），
    // 本可并发。lockKey 用 path.resolve(stagingDir) 提前可算（在 mkdir 之前）。
    const lockKey = this.resolveLockKey(stagingDir);
    // review 修复（P2-4）：裸 new Error → AppError（busy=409 / not-found=500），
    // 路由才能区分错误类型（mods.ts 的 502 包装不再吞掉 409 语义）
    if (this.activeJobs.has(lockKey)) {
      throw new AppError(
        "steamcmd-busy",
        "该 staging 目录已有 SteamCMD 下载任务在跑",
        409,
      );
    }
    const exePath = this.getExePath();
    if (!exePath) {
      throw new AppError("steamcmd-not-found", "SteamCMD 未安装", 500);
    }

    // ★ review 修复（P2-3）：加锁提前到任何 await 之前（原实现在 mkdir/writeFile 之后才 add）——
    //   TOCTOU：两个并发请求同时通过 busy 检查 → 都 spawn SteamCMD 写同一 staging。
    this.activeJobs.add(lockKey);

    const scriptContent = [
      "@ShutdownOnFailedCommand 1",
      "@NoPromptForPassword 1",
      `force_install_dir "${stagingDir}"`,
      "login anonymous",
      ...itemIds.map((id) => `workshop_download_item ${STEAM_APP_IDS.UNTURNED_GAME} ${id}`),
      "quit",
    ].join("\n");
    const scriptPath = path.join(stagingDir, ".steamcmd-download.scf");
    try {
      await fs.promises.mkdir(stagingDir, { recursive: true });
      await fs.promises.writeFile(scriptPath, scriptContent, { mode: 0o600 });
    } catch (err) {
      // mkdir/writeFile 失败：释放锁并同步抛（route 转 500），不留悬挂锁
      this.activeJobs.delete(lockKey);
      throw err;
    }

    const jobId = `steamcmd-download-${installDir}`;
    this.broadcastProgressWithJobId(jobId, 0, "spawned");

    // spawn 失败（如 steamcmd 缺依赖）同步抛，route 层转 502；锁在此释放
    try {
      await this.processSupervisor.spawn(
        jobId,
        exePath,
        ["+runscript", scriptPath],
        path.dirname(exePath),
      );
    } catch (err) {
      this.broadcastProgressWithJobId(jobId, 0, "failed");
      this.activeJobs.delete(lockKey);
      try {
        await fs.promises.unlink(scriptPath);
      } catch {
        /* noop */
      }
      throw err;
    }

    this.processSupervisor.onStdout(jobId, (line: string) => {
      const { stage, percent } = this.parseProgressLine(line);
      this.broadcaster.broadcast({
        type: "steamcmd_progress",
        jobId,
        stage,
        percent,
      });
    });

    // 后台收尾：等待退出 → 验证内容落盘 → 清临时脚本 → 广播 completed/failed → 释放互斥锁
    void this.processSupervisor
      .waitForExit(jobId, DOWNLOAD_TIMEOUT_MS)
      .then(async (downloadExitCode) => {
        if (downloadExitCode !== 0 && downloadExitCode != null) {
          throw new Error(
            `SteamCMD 下载进程异常退出 (code ${downloadExitCode})`,
          );
        }
        // ★ BUG-5/6（第四版）：steamcmd 下载失败时**也可能 exit 0**——item 只进
        //   WorkshopItemDetails 元数据缓存，WorkshopItemsInstalled 空、SizeOnDisk 0，
        //   前端却收到 completed 误报「下载成功」。
        //   只查 exitCode 不可靠：必须验证 content/<appid>/<id>/ 目录落盘且非空。
        //   （「假成功」的总根因 = 下载命令误用服务端 appid 1110390，已修正为游戏本体
        //   304930；本落盘校验作兜底保留）
        const missing: string[] = [];
        for (const id of itemIds) {
          const itemDir = path.join(
            stagingDir,
            "steamapps",
            "workshop",
            "content",
            STEAM_APP_IDS.UNTURNED_GAME,
            id,
          );
          try {
            const files = await fs.promises.readdir(itemDir);
            if (files.length === 0) missing.push(id);
          } catch {
            missing.push(id);
          }
        }
        if (missing.length > 0) {
          throw new Error(
            `SteamCMD 下载未完成（staging 无实际内容，仅元数据缓存）: ${missing.join(", ")}`,
          );
        }
        try {
          await fs.promises.unlink(scriptPath);
        } catch {
          /* noop */
        }
        this.broadcastProgressWithJobId(jobId, 100, "completed");
      })
      .catch(() => {
        this.broadcastProgressWithJobId(jobId, 0, "failed");
      })
      .finally(() => {
        this.activeJobs.delete(lockKey);
      });

    return jobId;
  }

  /**
   * 检查 U3DS（AppID 1110390）当前 buildid/name（Phase 0 异步化——ADR-0004 §4 Phase 0）。
   * 抄 GSM3 `fetchAppBranches:444-511`：runscript 文件驱动 + 多套命令序列 fallback。
   * 冷启动 steamcmd 首次 app_info_request 常拿不到 appinfo（实测输出为空），GSM3 试 3 套序列；
   * 本实现同样 3 套——buildid 解析为空或进程报错则换下一套，全部失败才广播 failed。
   *
   * **异步启动**：HTTP 立即返回 jobId，结果通过 WS `steamcmd_progress`（带 jobId）广播。
   * stage='completed' 携带 latestVersion 字段，前端订阅后弹 toast「U3DS 最新版本: xxx」。
   *
   * @param installDir - 可选：临时 runscript/install 目录（默认 /tmp/steamcmd-check）
   * @returns jobId（`steamcmd-check-<installDir>`），前端用它关联 WS 进度事件
   * @throws {AppError} code=steamcmd-not-found, status=404 当 SteamCMD 未安装
   */
  async checkUpdate(installDir?: string): Promise<string> {
    const exePath = this.getExePath();
    if (!exePath) {
      throw new AppError("steamcmd-not-found", "SteamCMD 未安装", 404);
    }

    // jobId 与 lockKey 分离：jobId 包含 installDir 供前端按 installPath 订阅；
    // lockKey 是 SteamCMD 写入目录 = jobDir（全局 tmp）——所有 checkUpdate 共享，
    // 自然实现「同一 tmp 目录不能并发写」的互斥。
    const jobDir = path.join(os.tmpdir(), "steamcmd-check");
    const lockKey = this.resolveLockKey(jobDir);
    if (this.activeJobs.has(lockKey)) {
      throw new AppError("steamcmd-busy", "已有一个检查更新任务在跑", 409);
    }
    this.activeJobs.add(lockKey);

    const jobId = `steamcmd-check-${installDir ?? "default"}`;

    // ★ review 修复（P1-2）：mkdir 移到广播/后台启动之前 + try/catch 释放锁——
    //   原来 add 锁后 mkdir 在 try/finally 之外，/tmp 满或权限异常时函数 reject 但
    //   lockKey 永久残留 → 后续所有 check-update 都 409 steamcmd-busy，且无 failed 广播。
    try {
      await fs.promises.mkdir(jobDir, { recursive: true });
    } catch (err) {
      this.activeJobs.delete(lockKey);
      throw err;
    }

    this.broadcastProgressWithJobId(jobId, 0, "spawned");

    const attempts: string[][] = [
      [
        "login anonymous",
        `app_info_request ${STEAM_APP_IDS.U3DS_SERVER}`,
        "app_info_update 1",
        `app_info_print ${STEAM_APP_IDS.U3DS_SERVER}`,
        "logoff",
        "quit",
      ],
      [
        "login anonymous",
        `app_info_request ${STEAM_APP_IDS.U3DS_SERVER}`,
        "login anonymous",
        `app_info_print ${STEAM_APP_IDS.U3DS_SERVER}`,
        `app_info_print ${STEAM_APP_IDS.U3DS_SERVER}`,
        "logoff",
        "quit",
      ],
      [
        "login anonymous",
        "app_info_update 1",
        `app_info_print ${STEAM_APP_IDS.U3DS_SERVER}`,
        "logoff",
        "quit",
      ],
    ];

    // 后台：3 套 fallback 顺序跑，拿到 buildid → 广播 completed（含 latestVersion）
    void (async () => {
      let lastError: unknown;
      try {
        for (let attempt = 0; attempt < attempts.length; attempt++) {
          if (attempt > 0) {
            await new Promise((resolve) => setTimeout(resolve, attempt * 750));
          }
          const scriptPath = path.join(
            jobDir,
            `${encodeURIComponent(installDir ?? "default")}-${attempt}.scf`,
          );
          try {
            await fs.promises.writeFile(
              scriptPath,
              [...attempts[attempt]!, ""].join("\n"),
              { mode: 0o600 },
            );
            const { stdout } = await this.execFileAdapter(
              exePath,
              ["+runscript", scriptPath],
              { timeout: 60_000 },
            );
            const buildIdMatch = stdout.match(/buildid[\s"]+(\d+)/);
            const nameMatch = stdout.match(/name[\s"]+([^"\n]+)/);
            const currentBuildId = buildIdMatch?.[1] ?? null;
            if (!currentBuildId) {
              lastError = new Error("app_info_print 未返回有效 buildid");
              continue;
            }
            // 成功：广播 completed 携带 latestVersion，前端 toast 显示。
            // review 修复：版本号取 buildid（如 "12345678"），不用 name——name 是服务名
            // （"Unturned Dedicated Server"），显示它没有意义。
            this.broadcaster.broadcast({
              type: "steamcmd_progress",
              jobId,
              stage: "completed",
              percent: 100,
              latestVersion:
                buildIdMatch?.[1] ?? nameMatch?.[1]?.trim() ?? "unknown",
            });
            return;
          } catch (err) {
            lastError = err;
          } finally {
            await fs.promises.unlink(scriptPath).catch(() => undefined);
          }
        }
        throw new AppError(
          "steamcmd-check-failed",
          lastError instanceof Error ? lastError.message : "检查更新失败",
          500,
        );
      } catch (err) {
        this.broadcastProgressWithJobId(jobId, 0, "failed");
        this.loggerUpdate().error({ err, jobDir }, "SteamCMD checkUpdate 失败");
      } finally {
        this.activeJobs.delete(lockKey);
      }
    })();

    return jobId;
  }

  /**
   * 重装 SteamCMD（Phase 0 异步化——ADR-0004 §4 Phase 0）。
   * 抄 GSM3 `installOnline` 模式：删旧 + 拉新 + +quit 初始化。
   * **异步启动**：HTTP 立即返回 jobId，下载/解压/初始化在后台串行跑，进度/完成/失败经 WS 广播。
   *
   * 注意：前 3 步（清理/下载/解压）必须顺序在 `+quit` 初始化前完成——所以**后台串行执行**，
   * 不能简单 spawn 出去。spawn 只在最后 `+quit` 初始化时使用。
   *
   * @param installDir - SteamCMD 安装目录（默认用探测到的路径）
   * @returns jobId（`steamcmd-reinstall-<installDir>`），前端用它关联 WS 进度事件
   * @throws {AppError} code=steamcmd-not-found（同步抛——前置探测失败）
   */
  async reinstall(installDir?: string): Promise<string> {
    const rawTarget = installDir ?? this.steamCmdPath ?? this.findSteamCmd();
    if (!rawTarget) {
      throw new AppError(
        "steamcmd-not-found",
        "SteamCMD 未安装，无法定位重装目录",
        404,
      );
    }
    // 探测/注入可能给到可执行文件本身——重装需要的是安装目录，归一为目录
    let targetDir = rawTarget;
    try {
      if (fs.statSync(rawTarget).isFile()) targetDir = path.dirname(rawTarget);
    } catch {
      /* 目录尚不存在（重装会 mkdir），保持原值 */
    }

    // review 修复：reinstall 与其他 SteamCMD 方法一致加 activeJobs 锁（key=targetDir），
    // 防并发重装同一目录 → 删/下/解压互相踩踏
    // P2-2：锁 key 通过 resolveLockKey 统一计算（realpath 解析软链接/相对路径）
    const lockKey = this.resolveLockKey(targetDir);
    if (this.activeJobs.has(lockKey)) {
      throw new AppError("steamcmd-busy", "该目录已有 SteamCMD 任务在跑", 409);
    }
    this.activeJobs.add(lockKey);

    // ★ review 修复（P1-1）：jobId 必须用 **rawTarget**（getStatus().installPath 的原值），
    //   不能用归一后的 targetDir——前端 SteamCmdCard 按 `steamcmd-reinstall-${status.installPath}`
    //   订阅。Debian 布局 /usr/games/steamcmd 是脚本（isFile=true）→ targetDir=/usr/games，
    //   若 jobId 用 targetDir 则广播 `steamcmd-reinstall-/usr/games`，前端监听
    //   `steamcmd-reinstall-/usr/games/steamcmd` → 永不匹配：重装完成 toast 永不弹、loading 卡死。
    //   归一只用于锁与删/下/解压操作（都是目录语义）。
    const jobId = `steamcmd-reinstall-${rawTarget}`;

    // 立即广播「已提交」，HTTP 立即返回 jobId
    this.broadcastProgressWithJobId(jobId, 0, "spawned");

    // 后台串行：清理 → 下载 → 解压 → +quit 初始化 → 广播 completed/failed
    void (async () => {
      try {
        // 1. 清理旧文件（保留 sdk 符号链接）
        const dirsToClean = [
          "linux32",
          "linux64",
          "package",
          "steamapps",
          "logs",
        ];
        for (const dir of dirsToClean) {
          try {
            await fs.promises.rm(path.join(targetDir, dir), {
              recursive: true,
              force: true,
            });
          } catch {
            /* noop */
          }
        }
        for (const f of ["steamcmd.sh", "steamcmd", "steamerrorreporter"]) {
          try {
            await fs.promises.unlink(path.join(targetDir, f));
          } catch {
            /* noop */
          }
        }

        // 2. 拉新——Node https 下载（对齐 GSM3 installOnline:163-235 / downloadFile:262-298）。
        //    不用系统 curl + ca-certificates：Node 自带 CA bundle，runtime 缺 CA 也能下（BUG-1 重装 curl:77 根因）。
        //    multi-URL fallback 保留（GSM3 Dockerfile:250-251 同款：akamai 主源 + media.steampowered.com 备源）。
        await fs.promises.mkdir(targetDir, { recursive: true });
        const tarPath = path.join(targetDir, "steamcmd_linux.tar.gz");
        this.loggerUpdate().info({ targetDir }, "SteamCMD reinstall 开始下载");
        const downloadUrls = [
          "https://steamcdn-a.akamaihd.net/client/installer/steamcmd_linux.tar.gz",
          "https://media.steampowered.com/installer/steamcmd_linux.tar.gz",
        ];
        let lastDownloadError: unknown;
        for (const url of downloadUrls) {
          try {
            await this.downloadFile(url, tarPath, (percent) => {
              this.broadcastProgressWithJobId(jobId, percent, "downloading");
            });
            lastDownloadError = undefined;
            break;
          } catch (err) {
            lastDownloadError = err;
            this.loggerUpdate().warn(
              { err, url },
              "SteamCMD 下载源失败，尝试下一个",
            );
          }
        }
        if (lastDownloadError) {
          throw new AppError(
            "steamcmd-download-failed",
            `SteamCMD 下载失败: ${
              lastDownloadError instanceof Error
                ? lastDownloadError.message
                : String(lastDownloadError)
            }`,
            500,
          );
        }

        // 3. 解压——tar npm 库（对齐 GSM3 extractTarGz:312-330），不依赖系统 tar。
        await tar.extract({ file: tarPath, cwd: targetDir });
        await fs.promises.unlink(tarPath).catch(() => undefined);

        // 4. 修复 steamcmd.sh 可执行
        await fs.promises
          .chmod(path.join(targetDir, "steamcmd.sh"), 0o755)
          .catch(() => undefined);

        // 5. +quit 初始化（SteamCMD 首次跑会下载 steamclient.so）—— 长任务
        const exePath = path.join(targetDir, "steamcmd.sh");
        this.broadcastProgressWithJobId(jobId, 50, "spawned");
        try {
          // 这里仍走 execFileAdapter 因为 +quit 是一次性执行并等返回（不是长驻进程）
          await this.execFileAdapter(exePath, ["+quit"], { timeout: 120_000 });
        } catch (err) {
          this.loggerUpdate().warn(
            { err },
            "SteamCMD 初始化 +quit 失败（可能允许后续手动重试）",
          );
        }

        this.broadcastProgressWithJobId(jobId, 100, "completed");
        this.loggerUpdate().info({ targetDir }, "SteamCMD reinstall 完成");
      } catch (err) {
        this.broadcastProgressWithJobId(jobId, 0, "failed");
        this.loggerUpdate().error(
          { err, targetDir },
          "SteamCMD reinstall 失败",
        );
      } finally {
        this.activeJobs.delete(lockKey);
      }
    })();

    return jobId;
  }

  // ── 内部 ──────────────────────────────────────────────

  /**
   * 解析候选路径（可能是 SteamCMD 安装目录或可执行文件）为真正可执行的入口。
   * Linux 标准布局：/opt/steamcmd/ 内是 steamcmd.sh 脚本 + linux32/steamcmd 二进制；Windows 是 steamcmd.exe。
   * 抄 GSM3 `checkSteamCMDExists`/`getSteamCMDExecutablePath` 的「目录内找可执行」思路（whitelist §steamcmd）。
   *
   * @param candidate - 构造器注入的路径（STEAMCMD_DIR 通常是目录）或 DEFAULT_PATHS 探测到的路径
   * @returns 可执行文件绝对路径；不可解析返回 null
   */
  private resolveExecutable(candidate: string): string | null {
    if (!fs.existsSync(candidate)) return null;
    let isDirectory = false;
    try {
      isDirectory = fs.statSync(candidate).isDirectory();
    } catch {
      // statSync 失败（测试 mock existsSync / 候选不可 stat）→ 视为文件直接用
      return candidate;
    }
    if (!isDirectory) return candidate;
    for (const sub of [
      "steamcmd.sh",
      "linux32/steamcmd",
      "linux64/steamcmd",
      "steamcmd.exe",
    ]) {
      const p = path.join(candidate, sub);
      try {
        if (fs.existsSync(p) && fs.statSync(p).isFile()) return p;
      } catch {
        /* 该子路径不可用，继续探测下一个 */
      }
    }
    return null;
  }

  private findSteamCmd(): string | null {
    for (const p of DEFAULT_PATHS) {
      if (fs.existsSync(p)) return p;
      if (fs.existsSync(p + ".sh")) return p + ".sh";
      if (fs.existsSync(p + ".exe")) return p + ".exe";
    }
    return null;
  }

  /** 统一解析真正可执行的 SteamCMD 路径（注入的 STEAMCMD_DIR 目录 或 DEFAULT_PATHS 探测） */
  private getExePath(): string | null {
    const candidate = this.steamCmdPath ?? this.findSteamCmd();
    if (!candidate) return null;
    return this.resolveExecutable(candidate);
  }

  /**
   * 解析 SteamCMD 单行输出，提取 stage + 可选 percent。
   * 已知关键字：downloading/validating/installed/checking/update complete/deprecated/preallocating
   */
  private parseProgressLine(line: string): { stage: string; percent?: number } {
    const match = PROGRESS_RE.exec(line);
    if (!match) return { stage: "downloading" }; // 默认视为进行中
    const stage = match[1]!.toLowerCase().replace(/\s+/g, "_");
    return { stage, percent: this.parsePercent(line) };
  }

  /**
   * 从 SteamCMD 进度行提取百分比。
   * 优先 % 直出；无 % 时退化为行尾 "已下载字节 / 总字节" 字节比（BUG-2 第四版修复——
   * steamcmd 下载/校验行是 "downloading, 78.36 MB, 3597137 / 4589923"，无百分号，
   * 不改的话前端永远只显示 stage 看不到进度）。
   *
   * @param line - steamcmd stdout 单行
   * @returns 0-100 的整数百分比；无法解析返回 undefined
   */
  private parsePercent(line: string): number | undefined {
    const pctMatch = PERCENT_RE.exec(line);
    if (pctMatch) return parseInt(pctMatch[1]!, 10);
    const ratioMatch = line.match(/(\d+)\s*\/\s*(\d+)\s*$/);
    if (!ratioMatch) return undefined;
    const done = parseInt(ratioMatch[1]!, 10);
    const total = parseInt(ratioMatch[2]!, 10);
    if (!Number.isFinite(total) || total <= 0) return undefined;
    return Math.min(100, Math.round((done / total) * 100));
  }

  /**
   * 用 Node 内置 https 下载文件（对齐 GSM3 downloadFile:262-298）。
   * 不依赖系统 curl/ca-certificates——Node 自带 CA bundle，runtime 缺 CA 也能下载
   * （BUG-1 重装 curl:77 的根因在 runtime 缺 ca-certificates，走 Node https 从根上规避）。
   *
   * @param url - 下载 URL
   * @param filePath - 落盘路径
   * @param onProgress - 进度回调（0-100，content-length 未知时不回调）
   * @returns Promise<void>，下载完成 resolve
   * @throws {Error} HTTP 非 200 或网络错误；失败时删除半成品文件
   *
   * @example
   * ```typescript
   * await this.downloadFile(url, "/opt/steamcmd/steamcmd_linux.tar.gz", (p) => {});
   * ```
   */
  private async downloadFile(
    url: string,
    filePath: string,
    onProgress?: (percent: number) => void,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const file = createWriteStream(filePath);
      https
        .get(url, (response) => {
          if (response.statusCode !== 200) {
            reject(new Error(`下载失败: HTTP ${response.statusCode}`));
            file.destroy();
            return;
          }
          const total = parseInt(response.headers["content-length"] || "0", 10);
          let downloaded = 0;
          response.on("data", (chunk) => {
            downloaded += chunk.length;
            if (total > 0 && onProgress) {
              onProgress(Math.round((downloaded / total) * 100));
            }
          });
          response.pipe(file);
          file.on("finish", () => {
            file.close();
            resolve();
          });
          file.on("error", (err) => {
            fs.promises.unlink(filePath).catch(() => undefined);
            reject(err);
          });
        })
        .on("error", reject);
    });
  }

  /** 避免每行 logger 字段同名冲突 */
  private loggerUpdate() {
    return logger;
  }
}
