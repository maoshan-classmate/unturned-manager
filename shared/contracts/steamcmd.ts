import type { SteamCmdStatus } from '../types/domain.js';

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
  install(installDir: string): Promise<void>;
  updateU3DS(installDir: string): Promise<void>;
  downloadWorkshopItem(installDir: string, itemIds: string[]): Promise<void>;
  /** 检测 SteamCMD 自身版本（不涉及 U3DS）；B-1 路径：app_info_print 1110390 解析 */
  checkUpdate(installDir?: string): Promise<SteamCmdUpdateInfo>;
  /** 重装 SteamCMD：删旧 + 拉新 + +quit 初始化（GSM3 installOnline 模式） */
  reinstall(installDir?: string): Promise<void>;
  /**
   * 安装 U3DS 二进制（BUG-3 修复入口）。
   * 引导式：必须由前端用户在 U3dsCard 点击「安装 U3DS」按钮触发，**不**自动。
   * 抄 GSM3 `installOnline` 模式：runscript + spawn + 解析 stdout + progress 回调。
   */
  installU3DS(
    installDir: string,
    callbacks?: { onProgress?: (progress: number) => void; onStatusChange?: (status: string) => void },
  ): Promise<void>;
}
