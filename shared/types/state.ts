// 状态机核心类型

export enum ServerState {
  STOPPED = "STOPPED",
  STARTING = "STARTING",
  RUNNING = "RUNNING",
  STOPPING = "STOPPING",
}

export type ActiveOperation =
  | { type: "none" }
  | { type: "manual_start"; startedAt: string }
  | { type: "manual_restart"; startedAt: string }
  | { type: "manual_stop"; startedAt: string }
  | { type: "steamcmd_update"; startedAt: string }
  | { type: "initial_setup"; startedAt: string };
