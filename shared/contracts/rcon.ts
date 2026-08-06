import type { ServerId } from '../types/branded.js';
import type { RconProtocol, RconConnectionState } from '../types/state.js';

export interface IRconManager {
  connect(serverId: ServerId): Promise<void>;
  disconnect(serverId: ServerId): void;
  execute(serverId: ServerId, command: string): Promise<string>;
  getProtocol(serverId: ServerId): RconProtocol;
  isReachable(serverId: ServerId): boolean;
  destroy(): Promise<void>;

  onStateChange(callback: (serverId: ServerId, state: RconConnectionState) => void): void;
}
