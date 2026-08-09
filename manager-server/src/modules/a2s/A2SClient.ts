import type { ServerId } from '@unturned-manager/shared';
import type { IA2SClient, A2SInfo } from '@unturned-manager/shared';
import { logger } from '../../utils/logger.js';

// @fabricio-191/valve-server-query 是 CJS 包，使用 createRequire 加载
// ★ BUG-FIX（2026-08-10）：库 4.x 官方 API 是 `Server({ip,port,timeout})` → `server.getInfo()`，
//   没有 `queryA2SInfo` 导出（此前解构得到 undefined → TypeError: queryA2SInfo is not a function，
//   实机 BUG 3/7「启动失败」的最终根因）。证据：库自带 README.MD:54-61 + typings/index.d.ts:158。
import { createRequire } from 'module';
const _require = createRequire(import.meta.url);
const { Server } = _require('@fabricio-191/valve-server-query');

const A2S_TIMEOUT_MS = 3_000;

/** 库 getInfo() 返回的原始 A2S_INFO 结构（players 是嵌套对象，无 maxPlayers 顶层字段） */
interface RawA2SInfo {
  players?: { online?: number; max?: number; bots?: number };
  map?: string;
  version?: string;
}

/** Server 工厂——生产用真实库，测试注入 mock（createRequire 加载的库无法被 vi.mock 拦截） */
export type A2SServerFactory = (opts: {
  ip: string;
  port: number;
  timeout: number;
}) => Promise<{ getInfo(): Promise<RawA2SInfo> }>;

/** 默认工厂：真实库官方用法 `Server({ip,port,timeout})` 返回实例 */
const defaultServerFactory: A2SServerFactory = async (opts) => {
  return Server(opts);
};

/**
 * Valve A2S_INFO UDP 查询封装。
 *
 * 每次 query 是独立的 UDP 数据报，无连接状态。
 * 端口 = 游戏端口 + 1（Steam 查询端口惯例）。
 *
 * @param serverFactory - Server 工厂（测试注入 mock；默认走真实库 createRequire 加载）
 */
export class A2SClient implements IA2SClient {
  private serverAddresses = new Map<ServerId, { host: string; port: number }>();
  private serverFactory: A2SServerFactory;

  constructor(serverFactory: A2SServerFactory = defaultServerFactory) {
    this.serverFactory = serverFactory;
  }

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
      // 官方用法（README.MD:54-61）：Server({ip,port,timeout}) 返回实例 → getInfo() 查询 A2S_INFO
      const server = await this.serverFactory({
        ip: addr.host,
        port: addr.port,
        timeout: A2S_TIMEOUT_MS,
      });
      const result = await server.getInfo();
      const latency = Date.now() - start;

      // Info 字段结构（typings：players 是 { online, max, bots } 嵌套对象，无 maxPlayers 顶层字段）
      return {
        players: result.players?.online ?? 0,
        maxPlayers: result.players?.max ?? 0,
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
