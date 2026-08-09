import type { ServerId, SteamId64, Port } from '../types/branded.js';

/**
 * 目录扫描发现的实例身份（ADR-0003 B2 §3.1）。
 * 真源 = <installDir>/Servers/<ServerID>/Server/Commands.dat 存在性。
 */
export interface DiscoveredServer {
  id: ServerId;
  name: string;
  gamePort: Port;
  ownerSteamId: SteamId64;
}

/**
 * 目录扫描真源——替代 DB servers 表。
 * 纯同步（fs 同步 API），供 ServerManager 构造时一次性加载。
 */
export interface IServerDiscovery {
  /** 扫描 <installDir>/Servers/，返回所有成立实例 */
  scanSync(installDir: string): DiscoveredServer[];
}
