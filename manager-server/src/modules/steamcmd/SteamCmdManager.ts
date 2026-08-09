import fs from "fs";
import path from "path";
import https from "https";
import { createWriteStream } from "fs";
import { execFile } from "child_process";
import { promisify } from "util";
import * as tar from "tar";
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

/** U3DS AppID（CLAUDE.md §4 锁定） */
const U3DS_APPID = "1110390";

/** 下载超时（Cardinal）/ 验证超时 */
const UPDATE_TIMEOUT_MS = 30 * 60 * 1000;
const DOWNLOAD_TIMEOUT_MS = 60 * 60 * 1000;

// ─── 实现 ────────────────────────────────────────────────

export class SteamCmdManager implements ISteamCmdManager {
  /** 当前正在跑的 steamcmd 子进程 serverId 集合（防竞态） */
  private activeJobs = new Set<string>();

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
        // SteamCMD v2 输出形如："Steam Console Client (Linux) Version 1719583862 ..."
        // 注意真实输出是小写 "version"，/i 大小写不敏感匹配（BUG-9 次生问题）
        const match = stdout.match(/Version\s+(\d+)(?:\s*-\s*([^\n]+))?/i);
        if (match) {
          version = match[2] ? `${match[1]} (${match[2].trim()})` : match[1];
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
      throw new Error("SteamCMD 未安装。请使用包含 SteamCMD 的镜像。");
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
    if (this.activeJobs.has(installDir)) {
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

    this.activeJobs.add(installDir);
    const jobId = `steamcmd-install-${installDir}`;

    // 2. 生成 runscript（与 updateU3DS 同模板，去 validate）
    const scriptContent = [
      "@ShutdownOnFailedCommand 1",
      "@NoPromptForPassword 1",
      `force_install_dir "${installDir}"`,
      "login anonymous",
      `app_update ${U3DS_APPID}`, // ★ 首次安装：去掉 validate
      "quit",
    ].join("\n");
    const scriptPath = path.join(installDir, ".steamcmd-install.scf");
    await fs.promises.mkdir(installDir, { recursive: true });
    await fs.promises.writeFile(scriptPath, scriptContent, { mode: 0o600 });

    callbacks?.onStatusChange?.("spawned");
    this.broadcastProgressWithJobId(jobId, "installing", 0, "spawned");

    // 3. spawn（失败同步抛 → route 转 500；锁在此释放）
    try {
      const pid = await this.processSupervisor.spawn(
        jobId as never,
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
      this.broadcastProgressWithJobId(jobId, "failed", 0, "failed");
      this.activeJobs.delete(installDir);
      try {
        await fs.promises.unlink(scriptPath);
      } catch {
        /* noop */
      }
      throw err;
    }

    // 4. 解析 stdout + 进度回调（抄 GSM3: 两条通道：callback + WS 广播）
    this.processSupervisor.onStdout(jobId as never, (line: string) => {
      const { stage, percent } = this.parseProgressLine(line);
      callbacks?.onProgress?.(percent ?? 0);
      callbacks?.onStatusChange?.(stage);
      this.broadcaster.broadcast({
        type: "steamcmd_progress",
        jobId,
        stage,
        percent,
      } as never);
    });

    // 5. 后台收尾（BUG-2 异步化）：等待退出 → 清临时脚本 → 验证启动脚本 → 广播 completed/failed → 释放锁
    void (async () => {
      try {
        const installExitCode = await this.processSupervisor.waitForExit(
          jobId as never,
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
        this.broadcastProgressWithJobId(jobId, "completed", 100, "completed");
        this.loggerUpdate().info(
          { installDir, script },
          "SteamCMD install 完成",
        );
      } catch (err) {
        callbacks?.onStatusChange?.("failed");
        this.broadcastProgressWithJobId(jobId, "failed", 0, "failed");
        this.loggerUpdate().error({ err, installDir }, "SteamCMD install 失败");
      } finally {
        this.activeJobs.delete(installDir);
      }
    })();

    return jobId;
  }

  /** BUG-2 修复：广播带 jobId 的进度事件（多任务并发隔离） */
  private broadcastProgressWithJobId(
    jobId: string,
    stage: string,
    percent: number | undefined,
    label: string,
  ): void {
    try {
      this.broadcaster.broadcast({
        type: "steamcmd_progress",
        jobId,
        stage: label,
        ...(percent != null ? { percent } : {}),
      } as never);
    } catch {
      /* noop */
    }
  }

  /**
   * 更新 U3DS 二进制——卡 C 真 spawn 实现。
   *
   * 1. 检查所有 U3DS 实例 STOPPED（schema 含状态列）
   * 2. spawn `steamcmd +force_install_dir <dir> +login anonymous +app_update 1110390 validate +quit`
   * 3. 解析 stdout 行，调 broadcaster.broadcast({type:'steamcmd_progress'})
   * 4. 等待进程退出；失败 throw
   */
  async updateU3DS(installDir: string): Promise<void> {
    // 前置检查：任何活跃实例必须 STOPPED（架构 spec §1.4；DB state 列已删 → 内存态探活）
    const activeIds = this.activeProbe();
    if (activeIds.length > 0) {
      throw new AppError(
        "servers-active",
        `以下服务端仍在运行，无法更新 U3DS：${activeIds.join(", ")}。请先停止所有实例。`,
        409,
      );
    }
    if (this.activeJobs.has(installDir)) {
      throw new AppError(
        "steamcmd-busy",
        "该 installDir 已有 SteamCMD 任务在跑",
        409,
      );
    }

    const exePath = this.getExePath();
    if (!exePath) {
      throw new Error("SteamCMD 未安装");
    }

    this.activeJobs.add(installDir);
    try {
      // 方案借鉴 GSM3（research_gsm3_steamcmd_unturned_2026-08-08.md §2.2）：
      // 先生成 runscript 文件，再 spawn `+runscript`，避免命令行转义问题
      const scriptContent = [
        "@ShutdownOnFailedCommand 1",
        "@NoPromptForPassword 1",
        `force_install_dir "${installDir}"`,
        "login anonymous",
        `app_update ${U3DS_APPID} validate`,
        "quit",
      ].join("\n");
      const scriptPath = path.join(installDir, ".steamcmd-update.scf");
      await fs.promises.mkdir(installDir, { recursive: true });
      await fs.promises.writeFile(scriptPath, scriptContent, { mode: 0o600 });

      const jobId = `steamcmd-update-${installDir}`;
      this.broadcastProgressWithJobId(jobId, "installing", 0, "spawned");

      // 进程 serverId 套用 installDir 路径（permit 用 installDir 作 ID，对齐内部约定）
      const pid = await this.processSupervisor.spawn(
        jobId as never,
        exePath,
        ["+runscript", scriptPath],
        path.dirname(exePath),
      );

      this.loggerUpdate().info(
        { installDir, pid },
        "SteamCMD update 进程已 spawn",
      );

      // 解析 stdout（卡 C #2：进度广播 + BUG-2：补 jobId）
      this.processSupervisor.onStdout(jobId as never, (line: string) => {
        const broadcast = this.parseProgressLine(line);
        this.broadcaster.broadcast({
          type: "steamcmd_progress",
          jobId,
          stage: broadcast.stage,
          percent: broadcast.percent,
        } as never);
      });

      // 等待退出
      try {
        const updateExitCode = await this.processSupervisor.waitForExit(
          jobId as never,
          UPDATE_TIMEOUT_MS,
        );
        if (updateExitCode !== 0 && updateExitCode != null) {
          throw new Error(`SteamCMD 更新进程异常退出 (code ${updateExitCode})`);
        }
      } finally {
        // 清理 runscript 临时文件（35 分钟内 GSM3 自动清理——我们立即清）
        try {
          await fs.promises.unlink(scriptPath);
        } catch {
          /* noop */
        }
      }

      this.broadcastProgressWithJobId(jobId, "completed", 100, "completed");
      this.loggerUpdate().info({ installDir }, "SteamCMD update 完成");
    } catch (err) {
      this.broadcastProgressWithJobId(
        `steamcmd-update-${installDir}`,
        "failed",
        0,
        "failed",
      );
      throw err;
    } finally {
      this.activeJobs.delete(installDir);
    }
  }

  /**
   * 卡 C #6：下载 Workshop Mod 到 staging 目录（不停服）。
   * 命令：steamcmd +force_install_dir <staging> +login anonymous +workshop_download_item 1110390 <id> +quit
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
  ): Promise<string> {
    if (!itemIds.length) return "";
    if (this.activeJobs.has(installDir)) {
      throw new Error("该 installDir 已有 SteamCMD 任务在跑");
    }
    const exePath = this.getExePath();
    if (!exePath) {
      throw new Error("SteamCMD 未安装");
    }

    const stagingDir = path.join(installDir, "Workshop", "staging");

    const scriptContent = [
      "@ShutdownOnFailedCommand 1",
      "@NoPromptForPassword 1",
      `force_install_dir "${stagingDir}"`,
      "login anonymous",
      ...itemIds.map((id) => `workshop_download_item ${U3DS_APPID} ${id}`),
      "quit",
    ].join("\n");
    const scriptPath = path.join(stagingDir, ".steamcmd-download.scf");
    await fs.promises.mkdir(stagingDir, { recursive: true });
    await fs.promises.writeFile(scriptPath, scriptContent, { mode: 0o600 });

    const jobId = `steamcmd-download-${installDir}`;
    this.activeJobs.add(installDir);
    this.broadcastProgressWithJobId(jobId, "downloading", 0, "spawned");

    // spawn 失败（如 steamcmd 缺依赖）同步抛，route 层转 502；锁在此释放
    try {
      await this.processSupervisor.spawn(
        jobId as never,
        exePath,
        ["+runscript", scriptPath],
        path.dirname(exePath),
      );
    } catch (err) {
      this.broadcastProgressWithJobId(jobId, "failed", 0, "failed");
      this.activeJobs.delete(installDir);
      try {
        await fs.promises.unlink(scriptPath);
      } catch {
        /* noop */
      }
      throw err;
    }

    this.processSupervisor.onStdout(jobId as never, (line: string) => {
      const { stage, percent } = this.parseProgressLine(line);
      this.broadcaster.broadcast({
        type: "steamcmd_progress",
        jobId,
        stage,
        percent,
      } as never);
    });

    // 后台收尾：等待退出 → 清临时脚本 → 广播 completed/failed → 释放互斥锁
    void this.processSupervisor
      .waitForExit(jobId as never, DOWNLOAD_TIMEOUT_MS)
      .then(async (downloadExitCode) => {
        if (downloadExitCode !== 0 && downloadExitCode != null) {
          throw new Error(
            `SteamCMD 下载进程异常退出 (code ${downloadExitCode})`,
          );
        }
        try {
          await fs.promises.unlink(scriptPath);
        } catch {
          /* noop */
        }
        this.broadcastProgressWithJobId(jobId, "completed", 100, "completed");
      })
      .catch(() => {
        this.broadcastProgressWithJobId(jobId, "failed", 0, "failed");
      })
      .finally(() => {
        this.activeJobs.delete(installDir);
      });

    return jobId;
  }

  /**
   * 检查 U3DS（AppID 1110390）当前 buildid/name（B-1 修复路径）。
   * 抄 GSM3 `fetchAppBranches:444-511`：runscript 文件驱动 + 多套命令序列 fallback。
   * 冷启动 steamcmd 首次 app_info_request 常拿不到 appinfo（实测输出为空），GSM3 试 3 套序列；
   * 本实现同样 3 套——buildid 解析为空或进程报错则换下一套，全部失败才抛 AppError（前端 toast 真实错误，
   * 不再误报「已是最新版本」）。
   *
   * @param installDir - 可选：临时 runscript/install 目录（默认 /tmp/steamcmd-check）
   * @returns 解析后的版本信息——{ currentBuildId, latestVersion, lastChecked }
   * @throws {AppError} code=steamcmd-not-found, status=404 当 SteamCMD 未安装
   * @throws {AppError} code=steamcmd-check-failed, status=500 当 3 套命令序列全部拿不到 buildid
   */
  async checkUpdate(installDir?: string): Promise<{
    currentBuildId: string | null;
    latestVersion: string;
    lastChecked: string;
  }> {
    const exePath = this.getExePath();
    if (!exePath) {
      throw new AppError("steamcmd-not-found", "SteamCMD 未安装", 404);
    }

    const tmpDir = installDir ?? "/tmp/steamcmd-check";
    const attempts: string[][] = [
      [
        "login anonymous",
        `app_info_request ${U3DS_APPID}`,
        "app_info_update 1",
        `app_info_print ${U3DS_APPID}`,
        "logoff",
        "quit",
      ],
      [
        "login anonymous",
        `app_info_request ${U3DS_APPID}`,
        "login anonymous",
        `app_info_print ${U3DS_APPID}`,
        `app_info_print ${U3DS_APPID}`,
        "logoff",
        "quit",
      ],
      [
        "login anonymous",
        "app_info_update 1",
        `app_info_print ${U3DS_APPID}`,
        "logoff",
        "quit",
      ],
    ];

    await fs.promises.mkdir(tmpDir, { recursive: true });
    let lastError: unknown;
    for (let attempt = 0; attempt < attempts.length; attempt++) {
      if (attempt > 0) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 750));
      }
      const scriptPath = path.join(tmpDir, `.steamcmd-check-${attempt}.scf`);
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
        return {
          currentBuildId,
          latestVersion: nameMatch?.[1]?.trim() ?? "unknown",
          lastChecked: new Date().toISOString(),
        };
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
  }

  /**
   * 重装 SteamCMD（B-1 附 修复路径）。
   * 抄 GSM3 `installOnline` 模式：删旧 + 拉新 + run +quit 初始化。
   * 进度通过 steamcmd_progress 广播。
   *
   * @param installDir - SteamCMD 安装目录（默认用探测到的路径）
   */
  async reinstall(installDir?: string): Promise<void> {
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

    // 1. 清理旧文件（保留 sdk 符号链接）
    const dirsToClean = ["linux32", "linux64", "package", "steamapps", "logs"];
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
          this.broadcastProgress("installing", percent, "downloading");
        });
        lastDownloadError = undefined;
        break;
      } catch (err) {
        lastDownloadError = err;
        this.loggerUpdate().warn({ err, url }, "SteamCMD 下载源失败，尝试下一个");
      }
    }
    if (lastDownloadError) {
      this.broadcastProgress("failed", 0, "failed");
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
    try {
      await tar.extract({ file: tarPath, cwd: targetDir });
    } catch (err) {
      this.broadcastProgress("failed", 0, "failed");
      throw new AppError(
        "steamcmd-extract-failed",
        `SteamCMD 解压失败: ${err instanceof Error ? err.message : String(err)}`,
        500,
      );
    }
    await fs.promises.unlink(tarPath).catch(() => undefined);

    // 4. 修复 steamcmd.sh 可执行
    await fs.promises
      .chmod(path.join(targetDir, "steamcmd.sh"), 0o755)
      .catch(() => undefined);

    // 5. +quit 初始化（SteamCMD 首次跑会下载 steamclient.so）
    const exePath = path.join(targetDir, "steamcmd.sh");
    this.broadcastProgress("installing", 50, "spawned");
    await this.execFileAdapter(exePath, ["+quit"], { timeout: 120_000 }).catch(
      (err: unknown) => {
        this.loggerUpdate().warn(
          { err },
          "SteamCMD 初始化 +quit 失败（可能允许后续手动重试）",
        );
      },
    );

    this.broadcastProgress("completed", 100, "completed");
    this.loggerUpdate().info({ targetDir }, "SteamCMD reinstall 完成");
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
    const pctMatch = PERCENT_RE.exec(line);
    const percent = pctMatch ? parseInt(pctMatch[1]!, 10) : undefined;
    return { stage, percent };
  }

  private broadcastProgress(
    stage: string,
    percent: number | undefined,
    label: string,
  ): void {
    try {
      this.broadcaster.broadcast({
        type: "steamcmd_progress",
        stage: label,
        ...(percent != null ? { percent } : {}),
      } as never);
    } catch {
      /* noop */
    }
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
          const total = parseInt(
            response.headers["content-length"] || "0",
            10,
          );
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
