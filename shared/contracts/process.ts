import type { ServerId } from "../types/branded.js";

export interface IProcessSupervisor {
  spawn(
    serverId: ServerId,
    command: string,
    args: string[],
    cwd?: string,
  ): Promise<number>;
  gracefulShutdown(serverId: ServerId, timeoutMs?: number): Promise<void>;
  /**
   * 等待进程退出。
   * 返回退出码（0=成功；null=无进程/无退出码信息）——SteamCmd 长任务据此判断成败
   * （BUG-3/7：steamcmd 下载失败 exitCode≠0 时不再被吞成"装完但没脚本"）。超时 reject。
   *
   * @param serverId - 托管进程 ID
   * @param timeoutMs - 最长等待毫秒，超时 reject
   * @returns 退出码；null 当进程不存在或退出码不可读
   */
  waitForExit(serverId: ServerId, timeoutMs: number): Promise<number | null>;
  forceKill(serverId: ServerId): void;
  isRunning(serverId: ServerId): boolean;
  destroy(): Promise<void>;

  onStdout(serverId: ServerId, callback: (line: string) => void): void;
  onCrash(
    callback: (serverId: ServerId, exitCode: number | null) => void,
  ): void;
}
