import type { ServerId, SteamId64 } from '../types/branded.js';
import type { ServerState, RconProtocol } from '../types/state.js';

// 泛化 WebSocket 连接类型——共享层不依赖 ws 库
export interface WsConnection {
  send(data: string): void;
  readyState: number;
  close(): void;
}

export const WsReadyState = {
  OPEN: 1,
} as const;

export type ServerEvent =
  | { type: 'state_change'; serverId: ServerId; from: ServerState; to: ServerState }
  | { type: 'console_line'; serverId: ServerId; line: string; source: 'stdout' | 'file' }
  | { type: 'rcon_status'; serverId: ServerId; protocol: RconProtocol; reachable: boolean }
  | { type: 'player_join'; serverId: ServerId; playerName: string; steamId: SteamId64 }
  | { type: 'player_leave'; serverId: ServerId; playerName: string; steamId: SteamId64 }
  | { type: 'mod_apply_progress'; serverId: ServerId; stage: string; remainingSeconds?: number }
  | { type: 'file_changed'; serverId: ServerId; path: string }
  | { type: 'steamcmd_progress'; stage: string; percent?: number };

export interface IBroadcaster {
  broadcast(event: ServerEvent): void;
  register(ws: WsConnection, serverIds: ServerId[]): void;
  unregister(ws: WsConnection): void;
  destroy(): Promise<void>;
}
