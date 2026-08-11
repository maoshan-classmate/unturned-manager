/**
 * ServerState / OperationType 内部枚举 → 中文用户可见字符串。
 *
 * 内部枚举（STOPPED/STARTING/RUNNING/STOPPING、manual_start/manual_stop/...）
 * 不适合直接拼到 AppError.message（玩家看不懂）。
 * 后端在 AppError 抛出前用这两个函数翻译，避免在每个调用点写散落的 if-else。
 */

const SERVER_STATE_LABELS: Record<string, string> = {
  STOPPED: "已停止",
  STARTING: "启动中",
  RUNNING: "运行中",
  STOPPING: "停止中",
};

/**
 * 把 ServerState 枚举翻译成中文。读不到(理论上不该发生)时回落到原文——总比空白好。
 */
export function formatServerState(state: string): string {
  return SERVER_STATE_LABELS[state] ?? state;
}

const OPERATION_TYPE_LABELS: Record<string, string> = {
  none: "空闲",
  manual_start: "启动",
  manual_stop: "停止",
  manual_restart: "重启",
  mod_apply: "应用 Mod 变更",
};

/**
 * 把 OperationType 翻译成中文。回落到原文作为兜底。
 */
export function formatOperationType(type: string): string {
  return OPERATION_TYPE_LABELS[type] ?? type;
}