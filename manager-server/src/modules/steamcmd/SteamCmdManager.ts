import fs from 'fs';
import path from 'path';
import type {
  ISteamCmdManager,
  IProcessSupervisor,
  IBroadcaster,
  SteamCmdStatus,
  ServerId,
} from '@unturned-manager/shared';
import { logger } from '../../utils/logger.js';
import { AppError } from '../../utils/AppError.js';

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
  ) {}

  async getStatus(): Promise<SteamCmdStatus> {
    const exePath = this.steamCmdPath ?? this.findSteamCmd();
    const isInstalled = exePath !== null && fs.existsSync(exePath);

    return {
      isInstalled,
      installPath: exePath ?? undefined,
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
      this.broadcastProgress('spawned', 0, 'spawned');

      // 进程 serverId 套用 installDir 路径（permit 用 installDir 作 ID，对齐内部约定）
      const pid = await this.processSupervisor.spawn(
        jobId as never,
        exePath,
        ['+runscript', scriptPath],
        path.dirname(exePath),
      );

      this.loggerUpdate().info({ installDir, pid }, 'SteamCMD update 进程已 spawn');

      // 解析 stdout（卡 C #2：进度广播）
      this.processSupervisor.onStdout(jobId as never, (line: string) => {
        const broadcast = this.parseProgressLine(line);
        this.broadcaster.broadcast({
          type: 'steamcmd_progress',
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
        this.activeJobs.delete(installDir);
      }

      this.broadcastProgress('completed', 100, 'completed');
      this.loggerUpdate().info({ installDir }, 'SteamCMD update 完成');
    } catch (err) {
      this.broadcastProgress('failed', 0, 'failed');
      this.activeJobs.delete(installDir);
      throw err;
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
