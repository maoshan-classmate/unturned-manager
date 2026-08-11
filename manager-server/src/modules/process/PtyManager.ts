import * as pty from "node-pty";
import os from "os";
import { logger } from "../../utils/logger.js";
import { buildChildProcessEnvironment } from "../../utils/childProcessEnvironment.js";
import { AppError } from "../../utils/AppError.js";
import type {
  IPtyManager,
  PtyKey,
  PtySpawnOptions,
  PtyDataCallback,
  PtyExitCallback,
} from "@unturned-manager/shared";

interface ManagedPty {
  process: pty.IPty;
  pid: number;
  key: PtyKey;
}

const DEFAULT_GRACEFUL_TIMEOUT_MS = 5_000;

/**
 * PTY 进程生命周期管理器（ADR-0004 §2.5 Phase 1）。
 *
 * 封装 node-pty，把 TTY-only 的 U3DS 进程拉到面板可观测的 PTY 通道——
 * U3DS 用 isatty() 检测 stdout 决定 ANSI 进度条 / 颜色，普通 pipe spawn 会
 * 让 U3DS 关闭色彩显示，GSM3 同款依赖（ADR §2.5）。
 *
 * 与 ProcessSupervisor 并列存在：
 * - ProcessSupervisor 管「非 PTY」spawn（SteamCMD execFile、steamcmd 进程）
 * - PtyManager 管「TTY 模拟」spawn（U3DS 实例进程）
 *
 * 两个 manager 都用 PtyKey = ServerId | string——同一 serverId 维度，contract 一致。
 *
 * 关键实现细节：
 * - node-pty 'data' 事件是**chunk**（不按行切），内部按 \n 切行后回调 onData
 * - node-pty 'exit' 事件只触发一次——destroy 时通过 kill 触发；外部 spawn 进程死亡也会触发
 * - onData/onExit 在 spawn 之前注册才有效，spawn 后注册需要保留 reference 数组
 */
export class PtyManager implements IPtyManager {
  private processes = new Map<PtyKey, ManagedPty>();
  private dataCallbacks = new Map<PtyKey, PtyDataCallback[]>();
  private exitCallbacks = new Map<PtyKey, PtyExitCallback[]>();

  // ── spawn ────────────────────────────────────────────

  async spawn(
    serverId: PtyKey,
    file: string,
    args: string[],
    options: PtySpawnOptions = {},
  ): Promise<number> {
    const existing = this.processes.get(serverId);
    if (existing) {
      throw new AppError(
        "pty-already-running",
        `Server ${serverId} 的控制台已经在运行 (PID ${existing.pid})。请先停止再启动。`,
        409,
      );
    }

    const cols = options.cols ?? 80;
    const rows = options.rows ?? 24;
    const term = options.term ?? "xterm-256color";
    const cwd = options.cwd ?? process.cwd();
    // T6: 子进程环境剥离面板 secret（与 ProcessSupervisor 同步）
    const env = options.env ?? buildChildProcessEnvironment();

    logger.info(
      { serverId, file, args, cols, rows, term, cwd },
      "启动 PTY 进程",
    );

    let ptyProcess: pty.IPty;
    try {
      // node-pty.spawn 在 Windows 上必须传 cols/rows/env/cwd/name
      // name 是 PTY 进程名（ps/top 显示），与 file basename 同——便于调试
      const fileBasename = file.split(/[\\/]/).pop() ?? "pty";
      ptyProcess = pty.spawn(file, args, {
        name: term,
        cols,
        rows,
        cwd,
        env,
        // node-pty 跨平台：Linux/macOS 用 forkpty(2)；Windows 用 ConPTY (Win10+)
        // GSM3 同款依赖
        useConpty: os.platform() === "win32",
      });
    } catch (err) {
      throw new AppError(
        "pty-spawn-failed",
        `控制台启动失败: ${err instanceof Error ? err.message : String(err)}`,
        500,
      );
    }

    const entry: ManagedPty = {
      process: ptyProcess,
      pid: ptyProcess.pid,
      key: serverId,
    };
    this.processes.set(serverId, entry);

    // data chunk → 按 \n 切行（保留尾部未完成行供下次 chunk 拼接）
    const lineBuffer = new Map<PtyKey, string>();
    ptyProcess.onData((chunk: string) => {
      const cbs = this.dataCallbacks.get(serverId);
      if (!cbs || cbs.length === 0) return;

      let buffered = lineBuffer.get(serverId) ?? "";
      buffered += chunk;
      const lines = buffered.split(/\r?\n/);
      // 最后一段可能是未完成的行，留给下一个 chunk
      lineBuffer.set(serverId, lines.pop() ?? "");
      for (const line of lines) {
        // 空行也要转发（PTY 进度条刷新常见空行）
        for (const cb of cbs) {
          try {
            cb(line);
          } catch (err) {
            logger.error({ err, serverId }, "PTY data 回调异常");
          }
        }
      }
    });

    ptyProcess.onExit(({ exitCode, signal }) => {
      logger.info(
        { serverId, pid: entry.pid, exitCode, signal },
        "PTY 进程退出",
      );
      // flush 未完成行
      const tail = lineBuffer.get(serverId);
      if (tail) {
        const cbs = this.dataCallbacks.get(serverId);
        if (cbs) {
          for (const cb of cbs) {
            try {
              cb(tail);
            } catch (err) {
              logger.error({ err, serverId }, "PTY 尾行回调异常");
            }
          }
        }
        lineBuffer.delete(serverId);
      }
      this.processes.delete(serverId);
      const exitCbs = this.exitCallbacks.get(serverId) ?? [];
      for (const cb of exitCbs) {
        try {
          cb({ exitCode, signal });
        } catch (err) {
          logger.error({ err, serverId }, "PTY exit 回调异常");
        }
      }
      // ★ P0-2 修复：自然 exit 后清理 callback Map，避免长寿命 PtyManager 累积闭包泄漏
      this.exitCallbacks.delete(serverId);
      this.dataCallbacks.delete(serverId);
    });

    return entry.pid;
  }

  // ── write / resize ───────────────────────────────────

  write(serverId: PtyKey, data: string): void {
    const entry = this.processes.get(serverId);
    if (!entry) {
      logger.warn({ serverId }, "PTY write: 进程不存在");
      return;
    }
    try {
      entry.process.write(data);
    } catch (err) {
      logger.warn({ err, serverId }, "PTY write 失败");
    }
  }

  resize(serverId: PtyKey, cols: number, rows: number): void {
    const entry = this.processes.get(serverId);
    if (!entry) {
      logger.warn({ serverId }, "PTY resize: 进程不存在");
      return;
    }
    try {
      entry.process.resize(cols, rows);
    } catch (err) {
      logger.warn({ err, serverId }, "PTY resize 失败");
    }
  }

  // ── lifecycle ────────────────────────────────────────

  /**
   * 优雅停止：SIGTERM → 等 5s → SIGKILL 兜底。
   * 与 ProcessSupervisor 三段（SIGINT/SIGTERM/SIGKILL）不同——PTY 不需要 SIGINT 阶段
   * 因为 U3DS 不响应 SIGINT 优雅关停（Unturned 仅响应 SIGTERM）。
   */
  async kill(serverId: PtyKey): Promise<void> {
    const entry = this.processes.get(serverId);
    if (!entry) return;

    try {
      entry.process.kill("SIGTERM");
    } catch (err) {
      logger.warn({ err, serverId }, "PTY SIGTERM 失败");
    }

    // 等 5s；若仍在跑则强杀
    const exited = await this.waitExitOnce(entry, DEFAULT_GRACEFUL_TIMEOUT_MS);
    if (!exited) {
      logger.warn(
        { serverId, pid: entry.pid },
        "PTY 优雅关停超时，强杀 SIGKILL",
      );
      this.forceKill(serverId);
    }
  }

  forceKill(serverId: PtyKey): void {
    const entry = this.processes.get(serverId);
    if (!entry) return;
    try {
      entry.process.kill("SIGKILL");
    } catch (err) {
      logger.warn({ err, serverId }, "PTY SIGKILL 失败");
    }
  }

  isRunning(serverId: PtyKey): boolean {
    return this.processes.has(serverId);
  }

  /**
   * 等待 PTY 进程退出（在 timeoutMs 内确认退出即返回 true）。
   * Phase 2：ServerManager.stop 在写 ctrl+c / exit 后调用，等永驻 bash 退出。
   *
   * @param serverId - PTY key
   * @param timeoutMs - 等待毫秒数
   * @returns true=已退出（或进程不存在）；false=超时仍未退出
   */
  async waitExit(serverId: PtyKey, timeoutMs: number): Promise<boolean> {
    const entry = this.processes.get(serverId);
    if (!entry) return true; // 无进程 = 已退出
    return this.waitExitOnce(entry, timeoutMs);
  }

  // ── callbacks ────────────────────────────────────────

  onData(serverId: PtyKey, callback: PtyDataCallback): void {
    const cbs = this.dataCallbacks.get(serverId);
    if (cbs) {
      cbs.push(callback);
    } else {
      this.dataCallbacks.set(serverId, [callback]);
    }
  }

  onExit(serverId: PtyKey, callback: PtyExitCallback): void {
    const cbs = this.exitCallbacks.get(serverId);
    if (cbs) {
      cbs.push(callback);
    } else {
      this.exitCallbacks.set(serverId, [callback]);
    }
  }

  // ── destroy ──────────────────────────────────────────

  async destroy(): Promise<void> {
    const ids = Array.from(this.processes.keys());
    logger.info({ count: ids.length }, "PtyManager.destroy: 关闭所有 PTY 进程");
    for (const id of ids) {
      this.forceKill(id);
    }
    // 给 OS 一点时间回收 PTY 进程
    await new Promise((resolve) => setTimeout(resolve, 100));
    this.dataCallbacks.clear();
    this.exitCallbacks.clear();
  }

  // ── 内部辅助 ─────────────────────────────────────────

  /**
   * 等待 PTY 进程退出（在 timeoutMs 内确认退出即返回 true）。
   * 实现：注册一次性 onExit，setTimeout 兜底。
   */
  private waitExitOnce(entry: ManagedPty, timeoutMs: number): Promise<boolean> {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (exited: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(exited);
      };
      // node-pty 的 onExit 是一次性事件——直接注册
      entry.process.onExit(() => finish(true));
      const timer = setTimeout(() => finish(false), timeoutMs);
      timer.unref?.();
    });
  }
}
