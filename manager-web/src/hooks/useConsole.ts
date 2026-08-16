import { useCallback, useEffect } from "react";
import {
  useWebSocket,
  type WsRequestResult,
} from "../contexts/WebSocketContext.js";

/**
 * useConsole 写入回调——把服务端实时输出推到 xterm。
 *
 * 双通道：
 * - onChunk：PTY 原始字节流（不做行切分），由 xterm 内部 ANSI 状态机自处理
 *   跨 chunk 的不完整转义序列
 * - onLine：单行文本（LogStreamer 文件 tail），按 \n 终止
 */
export interface UseConsoleSinks {
  /** 接收 50ms 内累积的 PTY 原始 chunks 拼接成的字符串 */
  onChunk?: (chunk: string) => void;
  /** 接收文件 tail 的单行（已含 \n） */
  onLine?: (line: string) => void;
  /** 清空屏幕内容 */
  onClear?: () => void;
}

interface UseConsoleReturn {
  sendCommand: (command: string, confirmed?: boolean) => Promise<string | null>;
  clearLines: () => void;
  connected: boolean;
  /**
   * xterm 原始按键透传——xterm.js onData 来的字节直写 PTY stdin（owner-trust，
   * PTY 自回显），不做命令解析。
   */
  sendTerminalInput: (data: string) => void;
  /** 存档（ACK 语义）——写 Save 到 PTY，等服务端确认看到保存完成信号。 */
  save: () => Promise<WsRequestResult>;
  /** 优雅关服（ACK 语义）——等服务端确认进程退出。 */
  shutdown: (delaySeconds: number, reason?: string) => Promise<WsRequestResult>;
  /** 关闭控制台进程（ACK 语义）——服务端进程被终止且不自动存档。 */
  closeTerminal: () => Promise<WsRequestResult>;
}

const COMMAND_HISTORY_MAX = 50;

/**
 * 控制台 hook —— 管理命令发送、命令历史、ACK 操作。
 *
 * 输出经全局 WS 事件总线订阅：console_output 喂给 xterm（PTY raw chunks），
 * console_line 喂给 xterm（文件 tail 单行）。命令经 send() 写入 PTY stdin。
 * RCON 通道已删除——所有命令都走 PTY 终端 owner-trust 模型。
 * 独立连接已删——与其他 hook 共享全局单连接；
 * 存档/关服/关控制台三个操作走 request() ACK 语义。
 *
 * @param serverId - 服务器实例 ID，空字符串时不订阅
 * @param sinks - 写入回调（xterm 实例由 Terminal 组件通过 onReady 暴露给 ConsolePage，
 *   ConsolePage 再把 term.write/term.clear 包成回调传进来）
 * @returns 控制台状态 + 发送/ACK 操作方法
 *
 * @example
 * ```tsx
 * const termRef = useRef<XTerm | null>(null);
 * <Terminal onReady={(t) => { termRef.current = t; }} onInput={sendTerminalInput} />
 * const { sendCommand, clearLines, save } = useConsole(serverId, {
 *   onChunk: (c) => termRef.current?.write(c),
 *   onLine: (l) => termRef.current?.write(l),
 *   onClear: () => termRef.current?.clear(),
 * });
 * ```
 */
export function useConsole(
  serverId: string,
  sinks: UseConsoleSinks = {},
): UseConsoleReturn {
  const { subscribe, send, request, connected } = useWebSocket();
  // 命令历史仅在内存保留最近 N 条（不持久化到 localStorage——重启重置）
  // 实际翻页由 Terminal 组件内部维护，hook 这里只暴露 historyRef 给需要方
  const historyRef: { current: string[] } = { current: [] };

  useEffect(() => {
    if (!serverId) return;
    // PTY 原始 chunks——不做行切分，由 xterm 内部 ANSI 状态机自处理跨 chunk 序列
    const offOutput = subscribe("console_output", (msg) => {
      if (msg.serverId !== serverId) return;
      const chunk = typeof msg.chunk === "string" ? msg.chunk : "";
      if (chunk) sinks.onChunk?.(chunk);
    });
    // LogStreamer 文件 tail 单行——仍以 \n 结尾，writeln 等价
    const offLine = subscribe("console_line", (msg) => {
      if (msg.serverId !== serverId) return;
      const line = typeof msg.line === "string" ? msg.line : "";
      if (line) sinks.onLine?.(line);
    });
    return () => {
      offOutput();
      offLine();
    };
  }, [serverId, subscribe, sinks.onChunk, sinks.onLine]);

  const sendCommand = useCallback(
    async (command: string, _confirmed = false): Promise<string | null> => {
      // RCON 通道已删除——命令经 PTY 终端 owner-trust 模型执行。
      // 走 WS terminal_input（与按键输入同链路），不再 round-trip REST。
      // 危险指令门控由前端 ConsolePage 的 ConfirmDialog 拦截（confirmed 参数保留兼容）。

      // 照搬 MCSManager useTerminal.ts sendCommand 的 socket?.connected 检查：
      // 连接状态为 false 时直接拒绝发送，避免重连竞争窗口内的 silent fail。
      if (!connected) {
        sinks.onChunk?.("[错误] 控制台未连接，无法发送命令\n");
        return null;
      }

      historyRef.current.push(command);
      if (historyRef.current.length > COMMAND_HISTORY_MAX) {
        historyRef.current.shift();
      }

      // 命令末尾拼换行符——服务端控制台读取线程以 LF 为行终止符（Console.ReadLine()）。
      // 回车符（\r）在终端模式改变后不再触发 ICRNL 映射、不触发行结束，命令会送达
      // 服务端但 ReadLine 阻塞不返回，表现为「只有首条命令生效」。换行符与启动命令
      // 同终止符，任何终端模式下都能触发行结束。
      // send 返回 false = 底层连接未就绪（兜底一层）
      const sent = send({
        type: "terminal_input",
        serverId,
        data: `${command}\n`,
      });
      if (!sent) {
        sinks.onChunk?.("[错误] 控制台未连接，无法发送命令\n");
      }
      return null;
    },
    [serverId, send, sinks.onChunk, connected],
  );

  const clearLines = useCallback(() => {
    sinks.onClear?.();
  }, [sinks.onClear]);

  // 终端按键输入透传服务端标准输入——xterm 的回车键发出单个 \r，而服务端控制台以
  // LF 为行终止符，把单独的回车转成换行，保证手动按键与命令栏一致触发命令。
  // 连接未就绪时静默丢弃（终端输入尽力而为，服务端自回显，丢一个字符不可恢复）。
  const sendTerminalInput = useCallback(
    (data: string) => {
      const normalized = data === "\r" ? "\n" : data;
      send({ type: "terminal_input", serverId, data: normalized });
    },
    [serverId, send],
  );

  // ACK 语义操作（ws-wrapper-design §2.5）

  const save = useCallback(
    () => request({ type: "save", serverId }),
    [serverId, request],
  );

  const shutdown = useCallback(
    (delaySeconds: number, reason?: string) =>
      request(
        { type: "shutdown", serverId, delaySeconds, reason },
        // 服务端等「倒计时 + 30s」进程退出，本地超时再加 15s 富余
        { timeoutMs: (delaySeconds + 45) * 1000 },
      ),
    [serverId, request],
  );

  const closeTerminal = useCallback(
    () => request({ type: "terminal_close", serverId }),
    [serverId, request],
  );

  return {
    sendCommand,
    clearLines,
    connected,
    sendTerminalInput,
    save,
    shutdown,
    closeTerminal,
  };
}

/** 获取命令历史（用于 ↑↓ 翻页） */
export function useConsoleHistory(): {
  history: React.MutableRefObject<string[]>;
} {
  return { history: { current: [] } as React.MutableRefObject<string[]> };
}