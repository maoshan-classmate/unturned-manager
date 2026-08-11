import type { U3dsStatus } from "../types/domain.js";

/**
 * Unturned 服务端安装状态查询。
 *
 * 与 ISteamCmdManager 的职责边界：后者管「下载工具」的状态与下载动作，
 * 本接口只回答「被下载的服务端程序当前是什么状态」，纯读、无副作用。
 */
export interface IU3dsStatusProvider {
  /**
   * 读取当前安装状态。
   *
   * 数据来自三处文件，任一缺失都不抛错，只让对应字段为空：
   * 启动脚本存在性判定是否已安装、`Status.json` 提供游戏版本号、
   * 安装清单提供构建号与更新时间。
   */
  getStatus(): Promise<U3dsStatus>;
}
