import type { ServerId } from "../types/branded.js";

/**
 * PTY 进程 key——可以是 ServerId（服务器实例）或 jobId（SteamCMD 长任务异步化）。
 * 复用 ProcessKey 的同形态：PTY 进程与 Spawn 子进程共用同一个 ProcessSupervisor
 * 抽象维度（ADR-0004 §2.5）。
 */
export type PtyKey = ServerId | string;

/**
 * PTY 数据回调签名——接收单行已解码文本（含 UTF-8 BOM 处理）。
 */
export type PtyDataCallback = (data: string) => void;

/**
 * PTY 进程退出回调签名——非零退出码 = 进程异常退出。
 */
export type PtyExitCallback = (info: { exitCode: number; signal?: number }) => void;

/**
 * PTY 进程 spawn 选项。
 */
export interface PtySpawnOptions {
  /** 终端列数（默认 80） */
  cols?: number;
  /** 终端行数（默认 24） */
  rows?: number;
  /** 环境变量；不传则走 buildChildProcessEnvironment（剥离面板 secret） */
  env?: NodeJS.ProcessEnv;
  /** 终端类型（TERM），默认 xterm-256color（GSM3 同款） */
  term?: string;
  /** cwd；不传则用 process.cwd() */
  cwd?: string;
}

/**
 * PTY 进程生命周期管理（ADR-0004 §2.5）。
 *
 * U3DS 是 TTY-only 进程——它通过 isatty() 检测 stdout 是否为 TTY 决定走「带 ANSI 控制
 * 序列的进度条」还是「无色彩纯文本」。普通 child_process.spawn 的 stdio 管道不是 TTY，
 * U3DS 检测后会关闭色彩/进度条显示。node-pty 模拟真实 TTY，让 U3DS 输出与 GSM3 完全一致。
 *
 * 关键设计：
 * - spawn 返回 PID（PTY 进程 ID），与 ProcessSupervisor.spawn 签名对齐
 * - write 透传到 PTY stdin——前端 xterm.js 经 WS terminal_input 事件过来
 * - resize 让前端 xterm.js 窗口变化时同步终端尺寸
 * - onData 是**单行回调**（node-pty 的 'data' 事件是 chunk，需要内部按 \n 切分）
 * - onExit 区分正常退出（exitCode=0）与异常（kill -9 → signal=9）
 *
 * @example
 * ```typescript
 * const pid = await ptyManager.spawn(
 *   "MyServer",
 *   "/opt/unturned/ServerHelper.sh",
 *   ["+InternetServer/MyServer", "-ThreadedConsole"],
 *   { cwd: "/opt/unturned", cols: 120, rows: 30 },
 * );
 * ptyManager.onData("MyServer", (line) => console.log("[PTY]", line));
 * ```
 */
export interface IPtyManager {
  /**
   * 启动 PTY 进程。
   *
   * @param serverId - PTY key（ServerId 或 jobId）
   * @param file - 可执行文件路径
   * @param args - 命令行参数
   * @param options - spawn 选项（cols/rows/env/cwd/term）
   * @returns PTY 进程 PID
   * @throws {AppError} code=pty-spawn-failed, status=500 spawn 失败时
   */
  spawn(
    serverId: PtyKey,
    file: string,
    args: string[],
    options?: PtySpawnOptions,
  ): Promise<number>;

  /**
   * 向 PTY stdin 写入数据（前端 xterm.js terminal_input 经 WS 转发过来）。
   *
   * @param serverId - PTY key
   * @param data - 原始字符串（不自动加 \r——node-pty 会原样写入）
   */
  write(serverId: PtyKey, data: string): void;

  /**
   * 调整 PTY 终端尺寸（前端 xterm.js resize 事件经 WS 转发）。
   *
   * @param serverId - PTY key
   * @param cols - 列数
   * @param rows - 行数
   */
  resize(serverId: PtyKey, cols: number, rows: number): void;

  /**
   * 优雅停止 PTY 进程（SIGTERM → 等 5s → SIGKILL 兜底）。
   *
   * @param serverId - PTY key
   */
  kill(serverId: PtyKey): Promise<void>;

  /**
   * 强制停止 PTY 进程（SIGKILL，立即）。
   *
   * @param serverId - PTY key
   */
  forceKill(serverId: PtyKey): void;

  /**
   * 判断 PTY 进程是否仍在运行。
   *
   * @param serverId - PTY key
   * @returns true=在跑；false=未启动或已退出
   */
  isRunning(serverId: PtyKey): boolean;

  /**
   * 订阅 PTY 数据流（按 \n 切分后的单行回调）。
   *
   * @param serverId - PTY key
   * @param callback - 数据回调
   */
  onData(serverId: PtyKey, callback: PtyDataCallback): void;

  /**
   * 订阅 PTY 退出事件（spawn 时自动注册一次）。
   *
   * @param serverId - PTY key
   * @param callback - 退出回调
   */
  onExit(serverId: PtyKey, callback: PtyExitCallback): void;

  /**
   * 销毁所有 PTY 进程（应用关闭时调用）。
   */
  destroy(): Promise<void>;
}
