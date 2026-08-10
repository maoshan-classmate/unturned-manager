import type { ServerId } from "../types/branded.js";

/**
 * 进程 key——可以是 ServerId（服务器实例）或 jobId（SteamCMD 长任务异步化，Phase 0）。
 * SteamCmdManager 用 `steamcmd-<op>-<dir>` jobId 作为托管进程 ID，与 ServerId 共用
 * 同一 IProcessSupervisor（ADR-0004 §4 Phase 0）。此前 SteamCmdManager 被迫 `jobId as never`
 * 绕过类型；把 key 放宽为 `ServerId | string` 让契约诚实。
 */
type ProcessKey = ServerId | string;

export interface IProcessSupervisor {
  spawn(
    serverId: ProcessKey,
    command: string,
    args: string[],
    cwd?: string,
  ): Promise<number>;
  gracefulShutdown(serverId: ProcessKey, timeoutMs?: number): Promise<void>;
  /**
   * 等待进程退出。
   * 返回退出码（0=成功；null=无进程/无退出码信息）——SteamCmd 长任务据此判断成败
   * （BUG-3/7：steamcmd 下载失败 exitCode≠0 时不再被吞成"装完但没脚本"）。超时 reject。
   *
   * @param serverId - 托管进程 ID（ServerId 或 SteamCMD jobId）
   * @param timeoutMs - 最长等待毫秒，超时 reject
   * @returns 退出码；null 当进程不存在或退出码不可读
   */
  waitForExit(serverId: ProcessKey, timeoutMs: number): Promise<number | null>;
  forceKill(serverId: ProcessKey): void;
  isRunning(serverId: ProcessKey): boolean;
  destroy(): Promise<void>;

  onStdout(serverId: ProcessKey, callback: (line: string) => void): void;
  onCrash(
    callback: (serverId: ServerId, exitCode: number | null) => void,
  ): void;
}
