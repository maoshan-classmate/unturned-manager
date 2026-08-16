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
// ★ PTY 输出节流：onData 同步推 WS.send 在 U3DS 高频输出时阻塞链反向传导（master read
// 不消费 → PTY buffer 满 → U3DS Console.WriteLine 阻塞 → consoleMain 死锁 → 后续命令
// 卡死）。改成 onData 只 push 进环形 buffer + 定时器 50ms 批量 flush，断开阻塞链。
// 范式对齐 MCSManager daemon/src/entity/instance/instance.ts:startOutputLoop。
const OUTPUT_BUFFER_CAPACITY = 256;
const OUTPUT_FLUSH_INTERVAL_MS = 50;

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
  // PTY 输出节流（MCSManager 范式）：每行 push 进环形 buffer（>256 丢弃最老），
  // 50ms 定时器批量 flush 单条 emit——避免同步 ws.send 阻塞 PTY read。
  private outputBuffers = new Map<PtyKey, string[]>();
  private flushTimers = new Map<PtyKey, NodeJS.Timeout>();

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
      let buffered = lineBuffer.get(serverId) ?? "";
      buffered += chunk;
      const lines = buffered.split(/\r?\n/);
      // 最后一段可能是未完成的行，留给下一个 chunk
      lineBuffer.set(serverId, lines.pop() ?? "");
      if (lines.length === 0) return;

      // ★ 节流（MCSManager 范式）：每行 push 进环形 buffer（O(1) 同步操作，
      // 不阻塞 PTY read），50ms 后批量 flush 单条 emit——断开「onData 同步 → ws.send
      // 阻塞 → master read 不消费 → PTY buffer 满 → U3DS 死锁」链。
      const buf = this.outputBuffers.get(serverId) ?? [];
      for (const line of lines) {
        buf.push(line);
        if (buf.length > OUTPUT_BUFFER_CAPACITY) buf.shift();
      }
      this.outputBuffers.set(serverId, buf);

      if (!this.flushTimers.has(serverId)) {
        this.flushTimers.set(
          serverId,
          setTimeout(() => this.flushOutputBuffer(serverId), OUTPUT_FLUSH_INTERVAL_MS),
        );
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
      // ★ 节流清理：flush 待处理 buffer + 清 timer + 释放 Map entry
      this.flushOutputBuffer(serverId);
      const timer = this.flushTimers.get(serverId);
      if (timer) clearTimeout(timer);
      this.flushTimers.delete(serverId);
      this.outputBuffers.delete(serverId);
      // ★ P0-2 修复：自然 exit 后清理 callback Map，避免长寿命 PtyManager 累积闭包泄漏
      this.exitCallbacks.delete(serverId);
      this.dataCallbacks.delete(serverId);
    });

    return entry.pid;
  }

  /**
   * 批量 flush 输出 buffer（节流机制核心）。
   *
   * 50ms 内累积的所有 PTY 行逐条 emit——避免每次 onData 都同步触发 ws.send
   * 导致反向阻塞 PTY read（MCSManager daemon/src/entity/instance/instance.ts
   * startOutputLoop 同款范式）。逐行回调保持 console_line 单行语义：若合并成单条
   * （join "\n"）会让前端把多行当一行渲染，xterm 里裸 LF 只下移不归列首，产生
   * 逐行递增的缩进错乱。
   *
   * @param serverId - PTY key
   */
  private flushOutputBuffer(serverId: PtyKey): void {
    const buf = this.outputBuffers.get(serverId);
    if (!buf || buf.length === 0) return;
    this.outputBuffers.delete(serverId);
    const timer = this.flushTimers.get(serverId);
    if (timer) clearTimeout(timer);
    this.flushTimers.delete(serverId);
    const cbs = this.dataCallbacks.get(serverId) ?? [];
    for (const line of buf) {
      for (const cb of cbs) {
        try {
          cb(line);
        } catch (err) {
          logger.error({ err, serverId }, "PTY data 回调异常");
        }
      }
    }
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
    // ★ 节流清理：kill 触发 exit 异步，timer 先清避免 fire-and-forget 调空 cb
    const timer = this.flushTimers.get(serverId);
    if (timer) clearTimeout(timer);
    this.flushTimers.delete(serverId);
    this.outputBuffers.delete(serverId);
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

  onData(serverId: PtyKey, callback: PtyDataCallback): () => void {
    const cbs = this.dataCallbacks.get(serverId);
    if (cbs) {
      cbs.push(callback);
    } else {
      this.dataCallbacks.set(serverId, [callback]);
    }
    // 退订：从数组摘除该 callback（settle 后幂等——Map 可能已被 exit 清理）
    return () => {
      const list = this.dataCallbacks.get(serverId);
      if (!list) return;
      const idx = list.indexOf(callback);
      if (idx >= 0) list.splice(idx, 1);
    };
  }

  onExit(serverId: PtyKey, callback: PtyExitCallback): () => void {
    const cbs = this.exitCallbacks.get(serverId);
    if (cbs) {
      cbs.push(callback);
    } else {
      this.exitCallbacks.set(serverId, [callback]);
    }
    return () => {
      const list = this.exitCallbacks.get(serverId);
      if (!list) return;
      const idx = list.indexOf(callback);
      if (idx >= 0) list.splice(idx, 1);
    };
  }

  /**
   * 等待 PTY 输出出现匹配行（ws-wrapper-design §2.4：save 等命令的完成信号探测）。
   * 三条 settle 路径互斥（settled 标记兜底）：
   *   ① 某行命中 marker → resolve
   *   ② 进程先退出 → reject pty-exited（输出流已断，marker 不可能再来）
   *   ③ 超时 → reject pty-marker-timeout
   * settle 后双向退订，一次性订阅不泄漏 callback。
   *
   * 错误文案规则：超时场景的 AppError.message 由 `errorMessage` 决定（调用方传用户友好文案）；
   * 不传则用通用文案「等待控制台输出超时」——避免把正则源码暴露给前端 toast
   * （backend-development.md §界面文案规范）。
   *
   * @param serverId - PTY key
   * @param marker - 匹配正则（对切分后的单行文本 test）
   * @param timeoutMs - 等待毫秒数
   * @param errorMessage - 超时场景下用户可见的错误文案；不传则用通用文案
   */
  waitForMarker(
    serverId: PtyKey,
    marker: RegExp,
    timeoutMs: number,
    errorMessage?: string,
  ): Promise<void> {
    if (!this.processes.has(serverId)) {
      return Promise.reject(
        new AppError("pty-not-running", "控制台未在运行", 409),
      );
    }
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (err?: AppError) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        offData();
        offExit();
        if (err) reject(err);
        else resolve();
      };
      const offData = this.onData(serverId, (line) => {
        if (marker.test(line)) finish();
      });
      const offExit = this.onExit(serverId, () => {
        finish(new AppError("pty-exited", "控制台已关闭", 409));
      });
      const timer = setTimeout(() => {
        finish(
          new AppError(
            "pty-marker-timeout",
            errorMessage?.trim() || "等待控制台输出超时",
            504,
          ),
        );
      }, timeoutMs);
      timer.unref?.();
    });
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
