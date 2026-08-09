import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import type {
  ISteamCmdManager,
  IProcessSupervisor,
  IBroadcaster,
  SteamCmdStatus,
  ServerId,
} from '@unturned-manager/shared';
import { logger } from '../../utils/logger.js';
import { AppError } from '../../utils/AppError.js';

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
  '/usr/games/steamcmd',
  '/usr/bin/steamcmd',
  '/opt/steamcmd',
  '/home/steam/steamcmd',
];

/** SteamCMD 进度行正则（例： " Update state (0x61) downloading,78.36 MB, 3597137 / 4589923"）
 *  粗略匹配关键字 + 可选百分比。不强制精确。 */
const PROGRESS_RE = /\b(downloading|validating|installed|preallocating|checking|updating|update complete|deprecated)\b/i;
const PERCENT_RE = /(\d{1,3})\s*%/;

/** U3DS AppID（CLAUDE.md §4 锁定） */
const U3DS_APPID = '1110390';

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
   * @param steamCmdPath - SteamCMD 可执行路径（测试注入；生产用 DEFAULT_PATHS 探测）
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
    const exePath = this.steamCmdPath ?? this.findSteamCmd();
    const isInstalled = exePath !== null && fs.existsSync(exePath);

    // 抄 GSM3 SteamCMDManager.ts:115-133 —— 补充 version 字段（spawn steamcmd +version 解析）
    let version: string | undefined;
    if (isInstalled && exePath) {
      try {
        const { stdout } = await this.execFileAdapter(exePath, ['+version', '+quit'], { timeout: 10_000 });
        // SteamCMD v2 输出形如："Steam Console Client (Linux) Version 1719583862 ..."
        const match = stdout.match(/Version\s+(\d+)(?:\s*-\s*([^\n]+))?/);
        if (match) {
          version = match[2] ? `${match[1]} (${match[2].trim()})` : match[1];
        }
      } catch (err) {
        logger.warn({ err, exePath }, 'SteamCMD 版本解析失败');
      }
    }

    return {
      isInstalled,
      installPath: exePath ?? undefined,
      version,
      lastChecked: new Date().toISOString(),
    };
  }

  async install(_installDir: string): Promise<void> {
    // SteamCMD 安装通常由 docker 镜像自带；面板只做状态展示
    const status = await this.getStatus();
    if (!status.isInstalled) {
      throw new Error('SteamCMD 未安装。请使用包含 SteamCMD 的镜像。');
    }
  }

  /**
   * 安装 U3DS 二进制（BUG-3/7 修复入口）。
   * 抄 GSM3 `installOnline` 模式：runscript 模板 + spawn + 解析 stdout + progress 广播。
   * 与 updateU3DS 区别：首次安装**不加** validate（没东西可校验），且事后验证启动脚本存在。
   *
   * @param installDir - U3DS 安装根目录（典型 /opt/unturned）
   * @param callbacks - 进度回调（抄 GSM3 onProgress/onStatusChange 形态）
   * @throws {AppError} code=operation_conflict if 服务端正在运行
   * @throws {AppError} code=steamcmd-busy if 已有 SteamCMD 任务在跑
   * @throws {AppError} code=steamcmd-not-found if SteamCMD 未安装
   * @throws {AppError} code=install-script-missing if 安装后仍找不到 ServerHelper.sh/ExampleServer.sh
   */
  async installU3DS(
    installDir: string,
    callbacks?: { onProgress?: (progress: number) => void; onStatusChange?: (status: string) => void },
  ): Promise<void> {
    // 1. 前置检查：所有实例 STOPPED（架构 spec §1.4）
    const activeIds = this.activeProbe();
    if (activeIds.length > 0) {
      throw new AppError(
        'servers-active',
        `以下服务端仍在运行，无法安装 U3DS：${activeIds.join(', ')}。请先停止所有实例。`,
        409,
      );
    }
    if (this.activeJobs.has(installDir)) {
      throw new AppError('steamcmd-busy', '该 installDir 已有 SteamCMD 任务在跑', 409);
    }

    const exePath = this.steamCmdPath ?? this.findSteamCmd();
    if (!exePath || !fs.existsSync(exePath)) {
      throw new AppError('steamcmd-not-found', 'SteamCMD 未安装', 500);
    }

    this.activeJobs.add(installDir);
    // ★ 提到 try 之外：catch 块里需要引用
    const jobId = `steamcmd-install-${installDir}`;
    try {
      // 2. 生成 runscript（与 updateU3DS 同模板，去 validate）
      const scriptContent = [
        '@ShutdownOnFailedCommand 1',
        '@NoPromptForPassword 1',
        `force_install_dir "${installDir}"`,
        'login anonymous',
        `app_update ${U3DS_APPID}`,  // ★ 首次安装：去掉 validate
        'quit',
      ].join('\n');
      const scriptPath = path.join(installDir, '.steamcmd-install.scf');
      await fs.promises.mkdir(installDir, { recursive: true });
      await fs.promises.writeFile(scriptPath, scriptContent, { mode: 0o600 });

      callbacks?.onStatusChange?.('spawned');
      this.broadcastProgressWithJobId(jobId, 'installing', 0, 'spawned');

      // 3. spawn（同 updateU3DS）
      const pid = await this.processSupervisor.spawn(
        jobId as never,
        exePath,
        ['+runscript', scriptPath],
        path.dirname(exePath),
      );
      this.loggerUpdate().info({ installDir, pid }, 'SteamCMD install 进程已 spawn');

      // 4. 解析 stdout + 进度回调（抄 GSM3: 两条通道：callback + WS 广播）
      this.processSupervisor.onStdout(jobId as never, (line: string) => {
        const { stage, percent } = this.parseProgressLine(line);
        callbacks?.onProgress?.(percent ?? 0);
        callbacks?.onStatusChange?.(stage);
        this.broadcaster.broadcast({
          type: 'steamcmd_progress',
          jobId,
          stage,
          percent,
        } as never);
      });

      try {
        await this.processSupervisor.waitForExit(jobId as never, UPDATE_TIMEOUT_MS);
      } finally {
        try { await fs.promises.unlink(scriptPath); } catch { /* noop */ }
      }

      // 5. 事后验证：启动脚本必须出现（detectStartScript 复用现有逻辑）
      const { detectStartScript } = await import('../server/startScript.js');
      const script = await detectStartScript(installDir);
      if (!script) {
        throw new AppError(
          'install-script-missing',
          `U3DS 安装完成但未检测到启动脚本（${installDir}）。可能 Mono 兼容性问题或下载中断。`,
          500,
        );
      }

      callbacks?.onStatusChange?.('completed');
      this.broadcastProgressWithJobId(jobId, 'completed', 100, 'completed');
      this.loggerUpdate().info({ installDir, script }, 'SteamCMD install 完成');
    } catch (err) {
      callbacks?.onStatusChange?.('failed');
      this.broadcastProgressWithJobId(jobId, 'failed', 0, 'failed');
      throw err;
    } finally {
      this.activeJobs.delete(installDir);
    }
  }

  /** BUG-2 修复：广播带 jobId 的进度事件（多任务并发隔离） */
  private broadcastProgressWithJobId(jobId: string, stage: string, percent: number | undefined, label: string): void {
    try {
      this.broadcaster.broadcast({
        type: 'steamcmd_progress',
        jobId,
        stage: label,
        ...(percent != null ? { percent } : {}),
      } as never);
    } catch { /* noop */ }
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
        'servers-active',
        `以下服务端仍在运行，无法更新 U3DS：${activeIds.join(', ')}。请先停止所有实例。`,
        409,
      );
    }
    if (this.activeJobs.has(installDir)) {
      throw new AppError('steamcmd-busy', '该 installDir 已有 SteamCMD 任务在跑', 409);
    }

    const exePath = this.steamCmdPath ?? this.findSteamCmd();
    if (!exePath || !fs.existsSync(exePath)) {
      throw new Error('SteamCMD 未安装');
    }

    this.activeJobs.add(installDir);
    try {
      // 方案借鉴 GSM3（research_gsm3_steamcmd_unturned_2026-08-08.md §2.2）：
      // 先生成 runscript 文件，再 spawn `+runscript`，避免命令行转义问题
      const scriptContent = [
        '@ShutdownOnFailedCommand 1',
        '@NoPromptForPassword 1',
        `force_install_dir "${installDir}"`,
        'login anonymous',
        `app_update ${U3DS_APPID} validate`,
        'quit',
      ].join('\n');
      const scriptPath = path.join(installDir, '.steamcmd-update.scf');
      await fs.promises.mkdir(installDir, { recursive: true });
      await fs.promises.writeFile(scriptPath, scriptContent, { mode: 0o600 });

      const jobId = `steamcmd-update-${installDir}`;
      this.broadcastProgressWithJobId(jobId, 'installing', 0, 'spawned');

      // 进程 serverId 套用 installDir 路径（permit 用 installDir 作 ID，对齐内部约定）
      const pid = await this.processSupervisor.spawn(
        jobId as never,
        exePath,
        ['+runscript', scriptPath],
        path.dirname(exePath),
      );

      this.loggerUpdate().info({ installDir, pid }, 'SteamCMD update 进程已 spawn');

      // 解析 stdout（卡 C #2：进度广播 + BUG-2：补 jobId）
      this.processSupervisor.onStdout(jobId as never, (line: string) => {
        const broadcast = this.parseProgressLine(line);
        this.broadcaster.broadcast({
          type: 'steamcmd_progress',
          jobId,
          stage: broadcast.stage,
          percent: broadcast.percent,
        } as never);
      });

      // 等待退出
      try {
        await this.processSupervisor.waitForExit(jobId as never, UPDATE_TIMEOUT_MS);
      } finally {
        // 清理 runscript 临时文件（35 分钟内 GSM3 自动清理——我们立即清）
        try { await fs.promises.unlink(scriptPath); } catch { /* noop */ }
      }

      this.broadcastProgressWithJobId(jobId, 'completed', 100, 'completed');
      this.loggerUpdate().info({ installDir }, 'SteamCMD update 完成');
    } catch (err) {
      this.broadcastProgressWithJobId(`steamcmd-update-${installDir}`, 'failed', 0, 'failed');
      throw err;
    } finally {
      this.activeJobs.delete(installDir);
    }
  }

  /**
   * 卡 C #6：下载 Workshop Mod 到 staging 目录（不停服）。
   * 命令：steamcmd +force_install_dir <staging> +login anonymous +workshop_download_item 1110390 <id> +quit
   * 应用由 ServerManager.applyModChanges 流水线负责（卡 B 已实装）。
   */
  async downloadWorkshopItem(installDir: string, itemIds: string[]): Promise<void> {
    if (!itemIds.length) return;
    if (this.activeJobs.has(installDir)) {
      throw new Error('该 installDir 已有 SteamCMD 任务在跑');
    }
    const exePath = this.steamCmdPath ?? this.findSteamCmd();
    if (!exePath || !fs.existsSync(exePath)) {
      throw new Error('SteamCMD 未安装');
    }

    const stagingDir = path.join(installDir, 'Workshop', 'staging');

    const scriptContent = [
      '@ShutdownOnFailedCommand 1',
      '@NoPromptForPassword 1',
      `force_install_dir "${stagingDir}"`,
      'login anonymous',
      ...itemIds.map((id) => `workshop_download_item ${U3DS_APPID} ${id}`),
      'quit',
    ].join('\n');
    const scriptPath = path.join(stagingDir, '.steamcmd-download.scf');
    await fs.promises.mkdir(stagingDir, { recursive: true });
    await fs.promises.writeFile(scriptPath, scriptContent, { mode: 0o600 });

    this.activeJobs.add(installDir);
    try {
      const jobId = `steamcmd-download-${installDir}`;
      this.broadcastProgress('downloading', 0, 'spawned');

      await this.processSupervisor.spawn(
        jobId as never,
        exePath,
        ['+runscript', scriptPath],
        path.dirname(exePath),
      );

      this.processSupervisor.onStdout(jobId as never, (line: string) => {
        const { stage, percent } = this.parseProgressLine(line);
        this.broadcaster.broadcast({
          type: 'steamcmd_progress',
          stage,
          percent,
        } as never);
      });

      try {
        await this.processSupervisor.waitForExit(jobId as never, DOWNLOAD_TIMEOUT_MS);
      } finally {
        try { await fs.promises.unlink(scriptPath); } catch { /* noop */ }
        this.activeJobs.delete(installDir);
      }

      this.broadcastProgress('completed', 100, 'completed');
    } catch (err) {
      this.broadcastProgress('failed', 0, 'failed');
      this.activeJobs.delete(installDir);
      throw err;
    }
  }

  /**
   * 检测 SteamCMD 自身版本（B-1 修复路径）。
   * 抄 GSM3 `steamcmd +app_info_print` 解析 buildid/name 模式。
   *
   * @param installDir - 可选：U3DS installDir（用于 SteamCMD 上下文，强制 +force_install_dir）
   * @returns 解析后的版本信息
   * @throws {AppError} code=steamcmd-not-found, status=404 当 SteamCMD 未安装
   */
  async checkUpdate(installDir?: string): Promise<{
    currentBuildId: string | null;
    latestVersion: string;
    lastChecked: string;
  }> {
    const exePath = this.steamCmdPath ?? this.findSteamCmd();
    if (!exePath || !fs.existsSync(exePath)) {
      throw new AppError('steamcmd-not-found', 'SteamCMD 未安装', 404);
    }

    // 跑 +app_info_print 拿当前 buildid（注意：app_info_print 仅对已/将装游戏有效）
    // 走通用 SteamCMD 探测（不传 installDir 让 SteamCMD 自决定）
    const args = ['+login', 'anonymous', '+app_info_print', '1110390', '+quit'];
    // SteamCMD 在缺少 force_install_dir 时会问"Enter 'quit' to quit"——给个临时目录绕过
    const tmpDir = installDir ?? '/tmp/steamcmd-check';
    args.splice(0, 0, `+force_install_dir "${tmpDir}"`);

    const { stdout } = await this.execFileAdapter(exePath, args, { timeout: 30_000 });
    const buildIdMatch = stdout.match(/buildid[\s"]+(\d+)/);
    const nameMatch = stdout.match(/name[\s"]+([^"\n]+)/);
    return {
      currentBuildId: buildIdMatch?.[1] ?? null,
      latestVersion: nameMatch?.[1]?.trim() ?? 'unknown',
      lastChecked: new Date().toISOString(),
    };
  }

  /**
   * 重装 SteamCMD（B-1 附 修复路径）。
   * 抄 GSM3 `installOnline` 模式：删旧 + 拉新 + run +quit 初始化。
   * 进度通过 steamcmd_progress 广播。
   *
   * @param installDir - SteamCMD 安装目录（默认用探测到的路径）
   */
  async reinstall(installDir?: string): Promise<void> {
    const targetDir = installDir ?? this.steamCmdPath ?? this.findSteamCmd();
    if (!targetDir) {
      throw new AppError('steamcmd-not-found', 'SteamCMD 未安装，无法定位重装目录', 404);
    }

    // 1. 清理旧文件（保留 sdk 符号链接）
    const dirsToClean = ['linux32', 'linux64', 'package', 'steamapps', 'logs'];
    for (const dir of dirsToClean) {
      try {
        await fs.promises.rm(path.join(targetDir, dir), { recursive: true, force: true });
      } catch { /* noop */ }
    }
    for (const f of ['steamcmd.sh', 'steamcmd', 'steamerrorreporter']) {
      try {
        await fs.promises.unlink(path.join(targetDir, f));
      } catch { /* noop */ }
    }

    // 2. 拉新（GSM3 走 multi-URL fallback；本项目延用 execFileAdapter）
    await fs.promises.mkdir(targetDir, { recursive: true });
    const tarPath = path.join(targetDir, 'steamcmd_linux.tar.gz');
    this.loggerUpdate().info({ targetDir }, 'SteamCMD reinstall 开始下载');
    // 用 adapter 调 curl（避免引入额外文件依赖）
    await this.execFileAdapter('curl', ['-fsSL', '-o', tarPath, 'https://steamcdn-a.akamaihd.net/client/installer/steamcmd_linux.tar.gz'], { timeout: 120_000 });

    // 3. 解压（用 adapter 调 system tar）
    await this.execFileAdapter('tar', ['-xzf', tarPath, '-C', targetDir], { timeout: 60_000 });
    await fs.promises.unlink(tarPath).catch(() => undefined);

    // 4. 修复 steamcmd.sh 可执行
    await fs.promises.chmod(path.join(targetDir, 'steamcmd.sh'), 0o755).catch(() => undefined);

    // 5. +quit 初始化（SteamCMD 首次跑会下载 steamclient.so）
    const exePath = path.join(targetDir, 'steamcmd.sh');
    this.broadcastProgress('installing', 50, 'spawned');
    await this.execFileAdapter(exePath, ['+quit'], { timeout: 120_000 }).catch((err: unknown) => {
      this.loggerUpdate().warn({ err }, 'SteamCMD 初始化 +quit 失败（可能允许后续手动重试）');
    });

    this.broadcastProgress('completed', 100, 'completed');
    this.loggerUpdate().info({ targetDir }, 'SteamCMD reinstall 完成');
  }

  // ── 内部 ──────────────────────────────────────────────

  private findSteamCmd(): string | null {
    for (const p of DEFAULT_PATHS) {
      if (fs.existsSync(p)) return p;
      if (fs.existsSync(p + '.sh')) return p + '.sh';
      if (fs.existsSync(p + '.exe')) return p + '.exe';
    }
    return null;
  }

  /**
   * 解析 SteamCMD 单行输出，提取 stage + 可选 percent。
   * 已知关键字：downloading/validating/installed/checking/update complete/deprecated/preallocating
   */
  private parseProgressLine(line: string): { stage: string; percent?: number } {
    const match = PROGRESS_RE.exec(line);
    if (!match) return { stage: 'downloading' };  // 默认视为进行中
    const stage = match[1]!.toLowerCase().replace(/\s+/g, '_');
    const pctMatch = PERCENT_RE.exec(line);
    const percent = pctMatch ? parseInt(pctMatch[1]!, 10) : undefined;
    return { stage, percent };
  }

  private broadcastProgress(stage: string, percent: number | undefined, label: string): void {
    try {
      this.broadcaster.broadcast({
        type: 'steamcmd_progress',
        stage: label,
        ...(percent != null ? { percent } : {}),
      } as never);
    } catch { /* noop */ }
  }

  /** 避免每行 logger 字段同名冲突 */
  private loggerUpdate() {
    return logger;
  }
}
