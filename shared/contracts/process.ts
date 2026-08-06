import type { ServerId } from '../types/branded.js';

export interface IProcessSupervisor {
  spawn(serverId: ServerId, command: string, args: string[]): Promise<number>;
  gracefulShutdown(serverId: ServerId, timeoutMs?: number): Promise<void>;
  waitForExit(serverId: ServerId, timeoutMs: number): Promise<void>;
  forceKill(serverId: ServerId): void;
  isRunning(serverId: ServerId): boolean;
  destroy(): Promise<void>;

  onStdout(serverId: ServerId, callback: (line: string) => void): void;
  onCrash(callback: (serverId: ServerId, exitCode: number | null) => void): void;
}
