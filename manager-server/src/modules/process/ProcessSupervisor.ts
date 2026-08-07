import { spawn, type ChildProcess } from 'child_process';
import { createInterface } from 'readline';
import type { ServerId } from '@unturned-manager/shared';
import type { IProcessSupervisor } from '@unturned-manager/shared';
import { logger } from '../../utils/logger.js';

interface ManagedProcess {
  process: ChildProcess;
  pid: number;
  serverId: ServerId;
}

type StdoutCallback = (line: string) => void;
type CrashCallback = (serverId: ServerId, exitCode: number | null) => void;

const DEFAULT_SHUTDOWN_TIMEOUT = 30_000;
const FORCE_KILL_GRACE = 5_000;

/**
 * U3DS 进程生命周期管理器。
 *
 * - 通过 child_process.spawn 启动 ServerHelper.sh
 * - 维护 ServerId → ChildProcess 的映射
 * - 支持优雅关停（SIGTERM → waitForExit → SIGKILL）
 * - stdout 行事件 + 崩溃回调
 */
export class ProcessSupervisor implements IProcessSupervisor {
  private processes = new Map<ServerId, ManagedProcess>();
  private stdoutCallbacks = new Map<ServerId, StdoutCallback[]>();
  private crashCallbacks: CrashCallback[] = [];

  // ── spawn ────────────────────────────────────────────

  async spawn(serverId: ServerId, command: string, args: string[], cwd?: string): Promise<number> {
    if (this.processes.has(serverId)) {
      throw new Error(`Server ${serverId} 已有进程在运行`);
    }

    logger.info({ serverId, command, args, cwd }, '启动 U3DS 进程');

    const child = spawn(command, args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false, // 安全：不经过 Shell 解析
    });

    const entry: ManagedProcess = { process: child, pid: child.pid!, serverId };
    this.processes.set(serverId, entry);

    // stdout → 行事件
    if (child.stdout) {
      const rl = createInterface({ input: child.stdout });
      rl.on('line', (line: string) => {
        const cbs = this.stdoutCallbacks.get(serverId);
        if (cbs) {
          for (const cb of cbs) {
            try {
              cb(line);
            } catch (err) {
              logger.error({ err, serverId }, 'stdout 回调异常');
            }
          }
        }
      });
    }

    // stderr → 日志
    if (child.stderr) {
      const rl = createInterface({ input: child.stderr });
      rl.on('line', (line: string) => {
        logger.warn({ serverId, line }, 'U3DS stderr');
      });
    }

    // 进程退出
    child.on('exit', (exitCode) => {
      logger.info({ serverId, exitCode }, 'U3DS 进程退出');
      this.processes.delete(serverId);
      this.stdoutCallbacks.delete(serverId);
      for (const cb of this.crashCallbacks) {
        try {
          cb(serverId, exitCode);
        } catch (err) {
          logger.error({ err, serverId }, 'crash 回调异常');
        }
      }
    });

    child.on('error', (err) => {
      logger.error({ serverId, err }, 'U3DS 进程错误');
      this.processes.delete(serverId);
    });

    return child.pid!;
  }

  // ── lifecycle ────────────────────────────────────────

  async gracefulShutdown(serverId: ServerId, timeoutMs = DEFAULT_SHUTDOWN_TIMEOUT): Promise<void> {
    const entry = this.processes.get(serverId);
    if (!entry) {
      logger.warn({ serverId }, 'gracefulShutdown: 没有运行中的进程');
      return;
    }

    logger.info({ serverId, timeoutMs }, '发送 SIGTERM 优雅关停');
    entry.process.kill('SIGTERM');

    try {
      await this.waitForExit(serverId, timeoutMs - FORCE_KILL_GRACE);
      logger.info({ serverId }, '进程优雅退出');
    } catch {
      logger.warn({ serverId }, '进程未在超时内退出，强制 kill');
      this.forceKill(serverId);
    }
  }

  waitForExit(serverId: ServerId, timeoutMs: number): Promise<void> {
    const entry = this.processes.get(serverId);
    if (!entry) {
      return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`等待进程退出超时: ${serverId} (${timeoutMs}ms)`));
      }, timeoutMs);

      entry.process.on('exit', () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  forceKill(serverId: ServerId): void {
    const entry = this.processes.get(serverId);
    if (!entry) {
      return;
    }
    logger.warn({ serverId, pid: entry.pid }, '强制 SIGKILL');
    try {
      entry.process.kill('SIGKILL');
    } catch {
      // 进程可能已退出
    }
    this.processes.delete(serverId);
  }

  isRunning(serverId: ServerId): boolean {
    const entry = this.processes.get(serverId);
    if (!entry) return false;
    return !entry.process.killed && entry.process.exitCode === null;
  }

  // ── callbacks ────────────────────────────────────────

  onStdout(serverId: ServerId, callback: (line: string) => void): void {
    const cbs = this.stdoutCallbacks.get(serverId);
    if (cbs) {
      cbs.push(callback);
    } else {
      this.stdoutCallbacks.set(serverId, [callback]);
    }
  }

  onCrash(callback: (serverId: ServerId, exitCode: number | null) => void): void {
    this.crashCallbacks.push(callback);
  }

  // ── destroy ──────────────────────────────────────────

  async destroy(): Promise<void> {
    const ids = Array.from(this.processes.keys());
    logger.info({ count: ids.length }, 'ProcessSupervisor.destroy: 杀死所有子进程');
    for (const id of ids) {
      this.forceKill(id);
    }
    this.crashCallbacks.length = 0;
  }
}
