import type { SteamCmdStatus } from "../types/domain.js";

/** SteamCMD 更新检查结果（抄 GSM3 steamcmd.ts:34-62 SSE 路线同源结构） */
export interface SteamCmdUpdateInfo {
  /** 当前本地 SteamCMD 报告的 buildid（来自 app_info_print 解析） */
  currentBuildId: string | null;
  /** SteamCMD 自己报出的版本字符串（来自 app_info_print 的 name 字段） */
  latestVersion: string;
  /** 检查时间（ISO 8601） */
  lastChecked: string;
}

export interface ISteamCmdManager {
  getStatus(): Promise<SteamCmdStatus>;
  /** 运行时设置 SteamCMD 安装目录（前端路径编辑 dialog；内存态，重启回落 STEAMCMD_DIR env） */
  setInstallPath(installPath: string): void;
  install(installDir: string): Promise<void>;
  updateU3DS(installDir: string): Promise<void>;
  /**
   * 下载 Workshop Mod 到 staging 目录（异步启动，BUG-5/6 修复）。
   * spawn 后立即返回 jobId（不等待 SteamCMD 退出），进度/完成/失败经 WS `steamcmd_progress` 广播。
   *
   * ⚠️ BUG-5/6（第四版）：staging 路径**必须**落在 `<installDir>/Servers/<serverId>/Workshop/staging`
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
  /** 检测 SteamCMD 自身版本（不涉及 U3DS）；B-1 路径：app_info_print 1110390 解析 */
  checkUpdate(installDir?: string): Promise<SteamCmdUpdateInfo>;
  /** 重装 SteamCMD：删旧 + 拉新 + +quit 初始化（GSM3 installOnline 模式） */
  reinstall(installDir?: string): Promise<void>;
  /**
   * 安装 U3DS 二进制（BUG-3/7 修复入口，BUG-2 异步化）。
   * 引导式：必须由前端用户在 U3dsCard 点击「安装 U3DS」按钮触发，**不**自动。
   * **异步启动**：spawn 后立即返回 jobId，不等待 SteamCMD 下载/安装完成——
   * 进度/完成/失败经 WS `steamcmd_progress`（带 jobId）广播（HTTP 不再同步等 → 避免 axios 超时）。
   *
   * @param installDir - U3DS 安装根目录（典型 /opt/unturned）
   * @param callbacks - 进度回调（GSM3 onProgress/onStatusChange 形态；route 不传，靠 WS）
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
