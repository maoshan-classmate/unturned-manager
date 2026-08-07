import type { ServerId } from '../types/branded.js';
import type { A2SInfo } from '../types/domain.js';

export interface IA2SClient {
  register(serverId: ServerId, host: string, gamePort: number): void;
  unregister(serverId: ServerId): void;
  query(serverId: ServerId): Promise<A2SInfo>;
  destroy(): Promise<void>;
}
