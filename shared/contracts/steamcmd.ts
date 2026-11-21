import type { SteamCmdStatus } from "../types/domain.js";

/** 任务输出中的一行 */
export interface SteamCmdJobLogLine {
  /** 行序号——同一任务内从 0 递增，用于把实时推送与历史回看两份数据对齐 */
  seq: number;
  /** 输出文本（SteamCMD 原文或面板生成的中文步骤说明） */
  text: string;
}

/**
 * 一个长任务（安装 / 更新 / 重装 / 检查）的输出快照。
 * 前端「任务输出」面板用它回看历史——刷新页面后仍能看到上次跑到哪一步。
 */
export interface SteamCmdJobLog {
  /** 任务标识 */
  jobId: string;
  /** 输出行（按发生顺序） */
  lines: SteamCmdJobLogLine[];
  /** 最新阶段 */
  stage?: string;
  /** 最新进度百分比（0-100） */
  percent?: number;
  /** 任务是否已结束（完成或失败） */
  finished: boolean;
  /** 失败原因（仅失败时有值） */
  errorMessage?: string;
  /** 任务开始时间 */
  startedAt: string;
}

export interface ISteamCmdManager {
  getStatus(): Promise<SteamCmdStatus>;
  /**
   * 读取某个任务的输出快照。
   * 面板刷新页面后用它回看历史输出——任务缓冲在面板进程内存中，重启即丢。
   *
   * @param jobId - 任务标识（如 `steamcmd-install-/opt/unturned`）
   * @returns 输出快照；任务从未出现过时返回空快照，不抛错
   */
  getJobLog(jobId: string): SteamCmdJobLog;
  /** 运行时设置 SteamCMD 安装目录（前端路径编辑 dialog；内存态，重启回落 STEAMCMD_DIR env） */
  setInstallPath(installPath: string): void;
  install(installDir: string): Promise<void>;
  /**
   * 更新 U3DS 二进制（Phase 0 异步化）。
   * spawn 后立即返回 jobId，不等待 SteamCMD 退出——进度/完成/失败经 WS `steamcmd_progress`（带 jobId）广播。
   *
   * @param installDir - U3DS 安装根目录
   * @returns jobId（`steamcmd-update-<installDir>`），前端用它关联 WS 进度事件
   * @throws {AppError} code=servers-active/steamcmd-busy/steamcmd-not-found（spawn 前同步抛）
   */
  updateU3DS(installDir: string): Promise<string>;
  /**
   * 下载 Workshop Mod 到 staging 目录（异步启动）。
   * spawn 后立即返回 jobId（不等待 SteamCMD 退出），进度/完成/失败经 WS `steamcmd_progress` 广播。
   *
   * ⚠️ staging 路径**必须**落在 `<installDir>/Servers/<serverId>/Workshop/staging`
   * （U3DS 只加载 Servers/<id>/Workshop/ 下的内容，acf 扫描/apply 流水线也读这），
   * 不是 `<installDir>/Workshop/staging`（顶层）——否则下载成功但列表扫不到、Mod 永不生效。
   *
   * @param installDir - U3DS 安装根目录（全局，非 per-server）
   * @param itemIds - Workshop File ID 列表
   * @param serverId - 目标 ServerID（决定 staging 落在哪个实例目录；不传则回落旧路径，仅兼容旧调用）
   * @returns jobId（`steamcmd-download-<installDir>`），前端用它关联 WS 进度事件
   * @throws {Error} SteamCMD 未安装 或 同 installDir 已有下载任务在跑（spawn 前同步抛）
   */
  downloadWorkshopItem(
    installDir: string,
    itemIds: string[],
    serverId?: string,
  ): Promise<string>;
  /**
   * 检查 U3DS（AppID 1110390）当前 buildid/name（Phase 0 异步化）。
   * spawn 后立即返回 jobId，结果通过 WS `steamcmd_progress`（带 jobId）广播。
   * 结果通过 WS `steamcmd_progress` 广播，前端不等待 HTTP body。
   *
   * @param installDir - 可选：临时 runscript/install 目录（默认 /tmp/steamcmd-check）
   * @returns jobId（`steamcmd-check-<installDir>`），前端用它关联 WS 进度事件
   * @throws {AppError} code=steamcmd-not-found, status=404 当 SteamCMD 未安装
   */
  checkUpdate(installDir?: string): Promise<string>;
  /**
   * 重装 SteamCMD（Phase 0 异步化）：删旧 + 拉新 + +quit 初始化。
   * spawn 后立即返回 jobId，进度/完成/失败经 WS `steamcmd_progress` 广播。
   *
   * @param installDir - SteamCMD 安装目录（默认用探测到的路径）
   * @returns jobId（`steamcmd-reinstall-<installDir>`），前端用它关联 WS 进度事件
   * @throws {AppError} code=steamcmd-not-found（spawn 前同步抛）
   */
  reinstall(installDir?: string): Promise<string>;
  /**
   * 安装 U3DS 二进制。
   * 引导式：必须由前端用户在 U3dsCard 点击「安装 U3DS」按钮触发，**不**自动。
   * **异步启动**：spawn 后立即返回 jobId，不等待 SteamCMD 下载/安装完成——
   * 进度/完成/失败经 WS `steamcmd_progress`（带 jobId）广播。
   *
   * @param installDir - U3DS 安装根目录（典型 /opt/unturned）
   * @param callbacks - 进度回调（route 不传，靠 WS 广播）
   * @returns jobId（`steamcmd-install-<installDir>`），前端用它关联 WS 进度事件
   * @throws {AppError} code=operation_conflict/steamcmd-busy/steamcmd-not-found（spawn 前同步抛）
   */
  installU3DS(
    installDir: string,
    callbacks?: {
      onProgress?: (progress: number) => void;
      onStatusChange?: (status: string) => void;
    },
  ): Promise<string>;
}
