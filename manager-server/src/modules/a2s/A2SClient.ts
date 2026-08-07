import type { ServerId } from '@unturned-manager/shared';
import type { IA2SClient, A2SInfo } from '@unturned-manager/shared';
import { logger } from '../../utils/logger.js';

// @fabricio-191/valve-server-query 是 CJS 包，使用 createRequire 加载
import { createRequire } from 'module';
const _require = createRequire(import.meta.url);
const { queryA2SInfo } = _require('@fabricio-191/valve-server-query');

const A2S_TIMEOUT_MS = 3_000;

/**
 * Valve A2S_INFO UDP 查询封装。
 *
 * 每次 query 是独立的 UDP 数据报，无连接状态。
 * 端口 = 游戏端口 + 1（Steam 查询端口惯例）。
 */
export class A2SClient implements IA2SClient {
  private serverAddresses = new Map<ServerId, { host: string; port: number }>();

  /**
   * 注册服务器地址。ServerManager 在创建/配置服务器时调用。
   */
  register(serverId: ServerId, host: string, gamePort: number): void {
    this.serverAddresses.set(serverId, { host, port: gamePort + 1 });
  }

  unregister(serverId: ServerId): void {
    this.serverAddresses.delete(serverId);
  }

  async query(serverId: ServerId): Promise<A2SInfo> {
    const addr = this.serverAddresses.get(serverId);
    if (!addr) {
      throw new Error(`A2S: 未注册的服务器 ${serverId}`);
    }

    const start = Date.now();
    try {
      const result = await queryA2SInfo(addr.host, addr.port, A2S_TIMEOUT_MS);
      const latency = Date.now() - start;

      return {
        players: result.players ?? 0,
        maxPlayers: result.maxPlayers ?? 0,
        map: result.map ?? '',
        version: result.version ?? '',
        latency,
      };
    } catch (err) {
      logger.warn({ serverId, host: addr.host, port: addr.port, err }, 'A2S 查询失败');
      throw err;
    }
  }

  async destroy(): Promise<void> {
    this.serverAddresses.clear();
  }
}
