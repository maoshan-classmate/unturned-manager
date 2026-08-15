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
  | { type: "initial_setup"; startedAt: string }
  // Phase 2b：配置变更后的「保存-关-启」流水线（与 mod_apply / ldm_apply 共用）
  | { type: "mod_apply"; startedAt: string }
  | { type: "ldm_apply"; startedAt: string }
  | { type: "modpack_apply"; startedAt: string };
