// 状态机核心类型

export enum ServerState {
  STOPPED = 'STOPPED',
  STARTING = 'STARTING',
  RUNNING = 'RUNNING',
  DEGRADED = 'DEGRADED',
  STOPPING = 'STOPPING',
}

export type ActiveOperation =
  | { type: 'none' }
  | { type: 'manual_start'; startedAt: string }
  | { type: 'manual_restart'; startedAt: string }
  | { type: 'manual_stop'; startedAt: string }
  | { type: 'mod_apply'; startedAt: string; modIds: string[] }
  | { type: 'steamcmd_update'; startedAt: string }
  | { type: 'initial_setup'; startedAt: string };

export enum RconProtocol {
  OPENMOD = 'openmod',
  ROCKETMOD = 'rocketmod',
  UNREACHABLE = 'unreachable',
}

// RCON 连接级状态（与 ServerState 是不同层级的概念）
// RconManager 回调此状态 → ServerManager 消费后决定是否将 ServerState 转为 DEGRADED
export enum RconConnectionState {
  CONNECTED = 'connected',
  DISCONNECTED = 'disconnected',
  DEGRADED = 'degraded',
}
