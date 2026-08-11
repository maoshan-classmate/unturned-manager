import path from 'path';
import { config } from '../../config.js';
import type { ServerId } from '@unturned-manager/shared';

/**
 * 路径解析器（ADR-0003 / T2）——替代 8 处散落的 `SELECT install_dir FROM servers` 查询。
 *
 * 设计原则：
 * - 纯函数，零 IO
 * - 单一真源 = `config.installDir`（`config.ts`）
 * - 路径分隔符由 `path.join` 跨平台处理
 *
 * 之前：每个模块都依赖 `db` 仅为了取 `install_dir`——本工具接管后，模块的 db 依赖可剪。
 * 路径布局对齐 `.claude/rules/unturned-sop.md`：
 *   <installDir>/Servers/<ServerID>/Server/Commands.dat
 *   <installDir>/Servers/<ServerID>/Config.txt
 *   <installDir>/Servers/<ServerID>/Server/WorkshopDownloadConfig.json
 *   <installDir>/Servers/<ServerID>/Logs/
 *   <installDir>/Servers/<ServerID>/Workshop/steamapps/workshop/content/304930/
 *   <installDir>/Servers/<ServerID>/Workshop/staging/...
 */

/**
 * 拼接 ServerID 下的任意相对路径。
 * @param serverId - 服务端实例 ID
 * @param relative - 相对 `<installDir>/Servers/<serverId>/` 的路径
 * @returns 绝对路径
 */
export function resolveServerPath(serverId: ServerId, relative: string): string {
  return path.join(config.installDir, 'Servers', serverId, relative);
}

/**
 * 全局 `<installDir>` 根目录（同步 SteamCMD 启动 / U3DS spawn 用）。
 * @returns installDir 绝对路径
 */
export function resolveInstallDir(): string {
  return config.installDir;
}
