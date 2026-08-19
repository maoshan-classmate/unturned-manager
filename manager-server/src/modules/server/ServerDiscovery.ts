import fs from 'fs';
import path from 'path';
import type {
  IServerDiscovery,
  DiscoveredServer,
  ServerId,
  SteamId64,
  Port,
} from '@unturned-manager/shared';
import { parseCommandsDatContent } from '../config/ConfigService.js';
import { logger } from '../../utils/logger.js';

/**
 * 目录扫描真源——实例从磁盘目录树直接读取。
 *
 * 实例成立条件：<installDir>/Servers/<ServerID>/Server/Commands.dat 存在。
 * 身份字段（Name/Port/Owner）从 Commands.dat 解析。
 * 纯同步扫描——ServerManager 构造时一次性加载, 不走事件循环。
 */
export class ServerDiscovery implements IServerDiscovery {
  /**
   * 扫描 <installDir>/Servers/，返回所有成立实例。
   *
   * @param installDir - U3DS 安装根目录（全局 config.installDir）
   * @returns 成立实例列表；Servers/ 不存在或为空时返回空数组
   *
   * @example
   * ```typescript
   * const servers = new ServerDiscovery().scanSync('/opt/unturned');
   * ```
   */
  scanSync(installDir: string): DiscoveredServer[] {
    const serversDir = path.join(installDir, 'Servers');
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(serversDir, { withFileTypes: true });
    } catch {
      logger.debug({ serversDir }, 'Servers/ 目录不存在，跳过目录扫描');
      return [];
    }

    const result: DiscoveredServer[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const id = entry.name;
      const cmdsPath = path.join(serversDir, id, 'Server', 'Commands.dat');
      if (!fs.existsSync(cmdsPath)) continue; // 实例成立条件

      let record;
      try {
        record = parseCommandsDatContent(fs.readFileSync(cmdsPath, 'utf-8'));
      } catch {
        logger.warn({ serverId: id, path: cmdsPath }, 'Commands.dat 读取失败，跳过该实例');
        continue;
      }

      result.push({
        id: id as ServerId,
        name: record.known.Name || id,
        gamePort: (parseInt(record.known.Port || '27015', 10) || 27015) as Port,
        ownerSteamId: (record.known.Owner || '') as SteamId64,
      });
    }
    return result;
  }
}
