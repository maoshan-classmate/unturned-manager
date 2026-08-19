import { spawn, exec, type ChildProcess } from "child_process";
import { createInterface } from "readline";
import { promisify } from "util";
import os from "os";
import type { ServerId } from "@unturned-manager/shared";
import type { IProcessSupervisor } from "@unturned-manager/shared";
import { logger } from "../../utils/logger.js";
import { buildChildProcessEnvironment } from "../../utils/childProcessEnvironment.js";

interface ManagedProcess {
  process: ChildProcess;
  pid: number;
  serverId: ServerId;
}

type StdoutCallback = (line: string) => void;
type CrashCallback = (serverId: ServerId, exitCode: number | null) => void;

const DEFAULT_SHUTDOWN_TIMEOUT = 30_000;

// ─── 三段关停时长 ───

/** 关停各阶段等待时长（可注入——测试用短时长避免真实等待） */
export interface TerminateTimings {
  /** SIGINT 等待时长 ms（默认 2000） */
  sigint: number;
  /** SIGTERM 等待时长 ms（默认 2000） */
  sigterm: number;
  /** SIGKILL 等待时长 ms（默认 1000） */
  sigkill: number;
  /** Win taskkill 等待时长 ms（默认 1000） */
  taskkill: number;
}

const DEFAULT_TIMINGS: TerminateTimings = {
  sigint: 2_000,
  sigterm: 2_000,
  sigkill: 1_000,
  taskkill: 1_000,
};

const execAsync = promisify(exec);

/**
 * U3DS 进程生命周期管理器。
 *
 * - 通过 child_process.spawn 启动启动脚本（detached 进程组, 非 win32）
 * - 维护 ServerId → ChildProcess 的映射
 * - 关停走三段：SIGINT 2s → SIGTERM 2s → SIGKILL 1s → Win taskkill 1s
 *   （进程组杀：非 win32 `process.kill(-pid, signal)`）
 * - 子进程环境剥离面板 secret（JWT_SECRET / ENCRYPTION_KEY）
 * - stdout 行事件 + 崩溃回调
 */
export class ProcessSupervisor implements IProcessSupervisor {
  private processes = new Map<ServerId, ManagedProcess>();
  private stdoutCallbacks = new Map<ServerId, StdoutCallback[]>();
  private stderrCallbacks = new Map<ServerId, StdoutCallback[]>();
  private crashCallbacks: CrashCallback[] = [];

  constructor(private timings: TerminateTimings = DEFAULT_TIMINGS) {}

  // ── spawn ────────────────────────────────────────────

  async spawn(
    serverId: ServerId,
    command: string,
    args: string[],
    cwd?: string,
  ): Promise<number> {
    // 残留进程 entry 清理：若 entry 存在但进程实际已退出（exitCode/signalCode 已置
    // 或 kill(pid,0) ESRCH），视为僵尸清理后放行——失败启动留下的残留会让用户无法再次启动。
    const existing = this.processes.get(serverId);
    if (existing) {
      if (this.hasProcessExited(existing)) {
        logger.warn(
          { serverId },
          "检测到已退出的残留进程 entry，清理后继续 spawn",
        );
        this.processes.delete(serverId);
        this.stdoutCallbacks.delete(serverId);
      } else {
        throw new Error(`Server ${serverId} 已有进程在运行`);
      }
    }

    logger.info({ serverId, command, args, cwd }, "启动 U3DS 进程");

    const child = spawn(command, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      shell: false, // 安全：不经过 Shell 解析
      // 进程组——非 win32 起进程组, 便于 -pid 整组杀
      detached: os.platform() !== "win32",
      // 剥离面板 secret
      env: buildChildProcessEnvironment(),
    });

    const entry: ManagedProcess = { process: child, pid: child.pid!, serverId };
    this.processes.set(serverId, entry);

    // 进程组验证
    if (os.platform() !== "win32" && child.pid) {
      try {
        process.kill(-child.pid, 0);
        logger.info({ serverId, pid: child.pid }, "进程组设置成功");
      } catch (err) {
        logger.warn({ serverId, err }, "进程组设置失败");
      }
    }

    // stdout → 行事件
    if (child.stdout) {
      const rl = createInterface({ input: child.stdout });
      rl.on("line", (line: string) => {
        const cbs = this.stdoutCallbacks.get(serverId);
        if (cbs) {
          for (const cb of cbs) {
            try {
              cb(line);
            } catch (err) {
              logger.error({ err, serverId }, "stdout 回调异常");
            }
          }
        }
      });
    }

    // stderr → 日志 + 回调转发（SteamCMD 的 ERROR! 行走 stderr，必须转给订阅方）
    if (child.stderr) {
      const rl = createInterface({ input: child.stderr });
      rl.on("line", (line: string) => {
        logger.warn({ serverId, line }, "U3DS stderr");
        const cbs = this.stderrCallbacks.get(serverId);
        if (cbs) {
          for (const cb of cbs) {
            try {
              cb(line);
            } catch (err) {
              logger.error({ err, serverId }, "stderr 回调异常");
            }
          }
        }
      });
    }

    // 进程退出
    child.on("exit", (exitCode) => {
      logger.info({ serverId, exitCode }, "U3DS 进程退出");
      this.processes.delete(serverId);
      this.stdoutCallbacks.delete(serverId);
      this.stderrCallbacks.delete(serverId);
      for (const cb of this.crashCallbacks) {
        try {
          cb(serverId, exitCode);
        } catch (err) {
          logger.error({ err, serverId }, "crash 回调异常");
        }
      }
    });

    child.on("error", (err) => {
      logger.error({ serverId, err }, "U3DS 进程错误");
      this.processes.delete(serverId);
      this.stdoutCallbacks.delete(serverId);
      this.stderrCallbacks.delete(serverId);
    });

    return child.pid!;
  }

  // ── lifecycle ────────────────────────────────────────

  /** 优雅关停——SIGINT 2s → SIGTERM 2s → SIGKILL 1s → Win taskkill 1s。 */
  async gracefulShutdown(
    serverId: ServerId,
    _timeoutMs = DEFAULT_SHUTDOWN_TIMEOUT,
  ): Promise<void> {
    const entry = this.processes.get(serverId);
    if (!entry) {
      logger.warn({ serverId }, "gracefulShutdown: 没有运行中的进程");
      return;
    }

    const exited = await this.terminateProcess(entry, { graceful: true });
    if (!exited) {
      logger.error({ serverId, pid: entry.pid }, "优雅关停未确认退出");
    }
    this.processes.delete(serverId);
  }

  waitForExit(serverId: ServerId, timeoutMs: number): Promise<number | null> {
    const entry = this.processes.get(serverId);
    if (!entry) {
      return Promise.resolve(null);
    }

    return this.waitChildExit(entry, timeoutMs).then((exited) => {
      if (!exited) {
        throw new Error(`等待进程退出超时: ${serverId} (${timeoutMs}ms)`);
      }
      // 返回退出码（0=成功）——SteamCmd 长任务据此判断成败
      return entry.process.exitCode ?? null;
    });
  }

  /** 强制停止——跳过优雅段，直接 SIGKILL 1s + Win taskkill 兜底。 */
  forceKill(serverId: ServerId): void {
    const entry = this.processes.get(serverId);
    if (!entry) {
      return;
    }
    logger.warn({ serverId, pid: entry.pid }, "强制 SIGKILL");

    void this.terminateProcess(entry, { graceful: false }).then((exited) => {
      if (!exited) {
        logger.error({ serverId, pid: entry.pid }, "强杀后仍未确认退出");
      }
      this.processes.delete(serverId);
    });
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

  onStderr(serverId: ServerId, callback: (line: string) => void): void {
    const cbs = this.stderrCallbacks.get(serverId);
    if (cbs) {
      cbs.push(callback);
    } else {
      this.stderrCallbacks.set(serverId, [callback]);
    }
  }

  onCrash(
    callback: (serverId: ServerId, exitCode: number | null) => void,
  ): void {
    this.crashCallbacks.push(callback);
  }

  // ── destroy ──────────────────────────────────────────

  async destroy(): Promise<void> {
    const ids = Array.from(this.processes.keys());
    logger.info(
      { count: ids.length },
      "ProcessSupervisor.destroy: 杀死所有子进程",
    );
    for (const id of ids) {
      this.forceKill(id);
    }
    this.crashCallbacks.length = 0;
  }

  // ── 内部：三段关停 + 进程组杀 ─────────────────

  /**
   * 逐级终止进程。
   *
   * @param entry - 托管进程
   * @param options.graceful - true=完整三段（SIGINT→SIGTERM→SIGKILL）；false=跳过优雅段直接 SIGKILL
   * @returns 是否在终止期限内确认退出
   */
  private async terminateProcess(
    entry: ManagedProcess,
    options: { graceful: boolean },
  ): Promise<boolean> {
    if (this.hasProcessExited(entry)) return true;
    const { pid, serverId } = entry;

    if (options.graceful) {
      this.signalToProcess(entry, "SIGINT");
      if (await this.waitChildExit(entry, this.timings.sigint)) return true;
      this.logTerminationStep(serverId, pid, "SIGINT 未响应，尝试 SIGTERM");

      this.signalToProcess(entry, "SIGTERM");
      if (await this.waitChildExit(entry, this.timings.sigterm)) return true;
      this.logTerminationStep(serverId, pid, "SIGTERM 未响应，尝试 SIGKILL");
    }

    this.signalToProcess(entry, "SIGKILL");
    if (await this.waitChildExit(entry, this.timings.sigkill)) return true;

    // Win 兜底：taskkill /F /T /PID
    if (os.platform() === "win32" && pid) {
      try {
        await execAsync(`taskkill /F /T /PID ${pid}`, { timeout: 3000 });
      } catch (err) {
        logger.warn({ serverId, err }, "taskkill 终止进程失败");
      }
      if (await this.waitChildExit(entry, this.timings.taskkill)) return true;
    }

    logger.error({ serverId, pid }, "进程在终止期限内仍未确认退出");
    return false;
  }

  /** 进程组发信号：非 win32 向 -pid, 否则 child.kill。 */
  private signalToProcess(entry: ManagedProcess, signal: NodeJS.Signals): void {
    const { process: child, pid } = entry;
    if (os.platform() !== "win32" && pid) {
      try {
        process.kill(-pid, signal);
        logger.info(
          { serverId: entry.serverId, pid },
          `已向进程组发送 ${signal}: -${pid}`,
        );
        return;
      } catch (err) {
        logger.warn(
          { serverId: entry.serverId, err },
          `向进程组发送 ${signal} 失败，尝试主进程`,
        );
      }
    }
    try {
      child.kill(signal);
    } catch {
      // 进程可能已退出
    }
  }

  /** 进程是否已退出：exitCode/signalCode 或 kill(pid,0) ESRCH。 */
  private hasProcessExited(entry: ManagedProcess): boolean {
    const { process: child, pid } = entry;
    if (child.exitCode !== null && child.exitCode !== undefined) return true;
    if (child.signalCode !== null && child.signalCode !== undefined)
      return true;
    if (!pid) return false;
    try {
      process.kill(pid, 0);
      return false;
    } catch (err) {
      return (err as NodeJS.ErrnoException).code === "ESRCH";
    }
  }

  /** 等待进程退出——监听 exit+close, 超时复查探活。 */
  private waitChildExit(
    entry: ManagedProcess,
    timeoutMs: number,
  ): Promise<boolean> {
    if (this.hasProcessExited(entry)) return Promise.resolve(true);

    return new Promise((resolve) => {
      const child = entry.process;
      let settled = false;
      let timer: NodeJS.Timeout;
      const finish = (exited: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        child.removeListener("exit", onExit);
        child.removeListener("close", onExit);
        resolve(exited);
      };
      const onExit = () => finish(true);

      child.once("exit", onExit);
      child.once("close", onExit);
      timer = setTimeout(() => finish(this.hasProcessExited(entry)), timeoutMs);
      timer.unref?.();
      if (this.hasProcessExited(entry)) {
        finish(true);
      }
    });
  }

  private logTerminationStep(
    serverId: ServerId,
    pid: number,
    msg: string,
  ): void {
    logger.warn({ serverId, pid }, msg);
  }
}
