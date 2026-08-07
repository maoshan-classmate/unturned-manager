import type { ServerId } from '../types/branded.js';
import type { RconProtocol, RconConnectionState } from '../types/state.js';

export interface RconServerConfig {
  host: string;
  gamePort: number;
  openModPort?: number;
  /** OpenMod 认证格式: "SteamID:密码"（完整的 credential 字符串） */
  openModCredential?: string;
  /** RocketMod Telnet RCON 裸密码（不含 SteamID 前缀） */
  rocketModPassword?: string;
  ownerSteamId?: string;
}

export interface IRconManager {
  register(serverId: ServerId, config: RconServerConfig): void;
  unregister(serverId: ServerId): void;
  connect(serverId: ServerId): Promise<void>;
  disconnect(serverId: ServerId): void;
  execute(serverId: ServerId, command: string): Promise<string>;
  getProtocol(serverId: ServerId): RconProtocol;
  isReachable(serverId: ServerId): boolean;
  destroy(): Promise<void>;

  onStateChange(callback: (serverId: ServerId, state: RconConnectionState) => void): void;
}
