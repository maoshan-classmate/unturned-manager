import type { ServerId } from "../types/branded.js";

/**
 * 进程 key——可以是 ServerId（服务器实例）或 jobId（SteamCMD 长任务异步化）。
 * SteamCmdManager 用 `steamcmd-<op>-<dir>` jobId 作为托管进程 ID，与 ServerId 共用
 * 同一 IProcessSupervisor。key 放宽为 `ServerId | string`。
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
   * 返回退出码（0=成功；null=无进程/无退出码信息）——SteamCmd 长任务据此判断成败。
   * 超时 reject。
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
  /**
   * 订阅进程 stderr 行事件。
   * SteamCMD 的 `ERROR! ...` 行走 stderr（fprintf(stderr)），仅监听 stdout 会丢真实下载失败原因
   * （SteamCmdManager 只收到兜底文案）。该回调用于把错误行也纳入失败原因收集。
   *
   * @param serverId - 托管进程 ID（ServerId 或 SteamCMD jobId）
   * @param callback - stderr 行回调；进程退出后自动移除
   */
  onStderr(serverId: ProcessKey, callback: (line: string) => void): void;
  onCrash(
    callback: (serverId: ServerId, exitCode: number | null) => void,
  ): void;
}
