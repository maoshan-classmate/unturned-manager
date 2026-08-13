import { useState, useCallback, useRef, useEffect } from "react";
import {
  useWebSocket,
  type WsRequestResult,
} from "../contexts/WebSocketContext.js";

export interface ConsoleLine {
  id: number;
  text: string;
  source: "stdout" | "file" | "input";
  timestamp: number;
}

interface UseConsoleReturn {
  lines: ConsoleLine[];
  sendCommand: (command: string, confirmed?: boolean) => Promise<string | null>;
  clearLines: () => void;
  connected: boolean;
  /**
   * ★ ADR-0004 Phase 3：往对应 serverId 的 PTY stdin 写原始输入（WS terminal_input）。
   * xterm.js onData 的原始字节直接透传，不做命令解析（owner-trust，PTY 自回显）。
   */
  sendTerminalInput: (data: string) => void;
  /**
   * 存档（ACK 语义）——写 Save 到控制台，等服务端确认看到「保存完成」信号。
   * 业务失败也 resolve（ok:false + error.message）；只在超时/断线时 reject。
   */
  save: () => Promise<WsRequestResult>;
  /**
   * 优雅关服（ACK 语义）——等服务端确认进程已退出。
   * 本地超时窗口 = delaySeconds + 45s（服务端等 delaySeconds + 30s，留 15s 富余）。
   */
  shutdown: (delaySeconds: number, reason?: string) => Promise<WsRequestResult>;
  /**
   * 关闭控制台进程（ACK 语义）——服务端进程会被终止且不自动存档，
   * 是控制台卡死时的核选项（前端按钮有确认弹窗拦截）。
   */
  closeTerminal: () => Promise<WsRequestResult>;
}

const MAX_LINES = 500;
const COMMAND_HISTORY_MAX = 50;

let nextId = 1;

/**
 * 控制台 hook —— 管理输出缓冲、命令发送、命令历史。
 *
 * 输出经全局 WS 事件总线订阅（console_line 事件），命令经 send() 写入 PTY stdin。
 * ★ ADR-0004 Phase 6：RCON 通道已删除——所有命令都走 PTY 终端 owner-trust 模型。
 * ★ ws-wrapper-design §3.6：独立连接已删——与其他 hook 共享全局单连接；
 * 存档/关服/关控制台三个操作走 request() ACK 语义，用户能拿到明确成功/失败反馈。
 *
 * @param serverId - 服务器实例 ID，空字符串时不订阅
 * @returns 控制台状态 + 发送/ACK 操作方法
 *
 * @example
 * ```tsx
 * const { lines, sendCommand, save, connected } = useConsole(serverId);
 * const result = await save();
 * if (result.ok) toast.success('存档完成');
 * ```
 */
export function useConsole(serverId: string): UseConsoleReturn {
  const { subscribe, send, request, connected } = useWebSocket();
  const [lines, setLines] = useState<ConsoleLine[]>([]);
  const historyRef = useRef<string[]>([]);

  // 订阅全局事件总线的 console_line——按 serverId 过滤（多实例共线隔离）
  useEffect(() => {
    if (!serverId) return;
    return subscribe("console_line", (msg) => {
      if (msg.serverId !== serverId) return;
      setLines((prev) => {
        const next = [
          ...prev,
          {
            id: nextId++,
            text: typeof msg.line === "string" ? msg.line : "",
            source:
              msg.source === "file" ? ("file" as const) : ("stdout" as const),
            timestamp: Date.now(),
          },
        ];
        // 限制最大行数
        return next.length > MAX_LINES
          ? next.slice(next.length - MAX_LINES)
          : next;
      });
    });
  }, [serverId, subscribe]);

  const sendCommand = useCallback(
    async (command: string, _confirmed = false): Promise<string | null> => {
      // ★ ADR-0004 Phase 6：RCON 通道已删除——命令经 PTY 终端 owner-trust 模型执行。
      // 走 WS terminal_input（与按键输入同链路），不再 round-trip REST。
      // 危险指令门控由前端 ConsolePage 的 ConfirmDialog 拦截（confirmed 参数保留兼容）。
      historyRef.current.push(command);
      if (historyRef.current.length > COMMAND_HISTORY_MAX) {
        historyRef.current.shift();
      }

      // 在输出中显示输入的命令
      setLines((prev) => [
        ...prev,
        {
          id: nextId++,
          text: `> ${command}`,
          source: "input",
          timestamp: Date.now(),
        },
      ]);

      // PTY 终端：拼入 \n 让 U3DS bash 解析（U3-SDK -ThreadedConsole 的 Console.ReadLine()
      // 以 LF 为行终止符；bash 中转 + 终端模式变化时 \r 不触发行结束导致 ReadLine 阻塞。
      // ★ 2026-08-14 实机根因：原 \r 在早期 ICRNL 生效时能执行（Players 日志 16:52:35），
      // 后续终端模式改变后 \r 失效 → 命令到 U3DS 但不执行 → 游戏内不生效）。
      // send 返回 false = 连接未就绪
      const sent = send({
        type: "terminal_input",
        serverId,
        data: `${command}\n`,
      });
      if (!sent) {
        setLines((prev) => [
          ...prev,
          {
            id: nextId++,
            text: "[错误] 控制台未连接",
            source: "stdout",
            timestamp: Date.now(),
          },
        ]);
      }
      return null; // PTY 模式下不返回响应文本（响应通过 console_line 异步回显）
    },
    [serverId, send],
  );

  const clearLines = useCallback(() => {
    setLines([]);
  }, []);

  // ★ ADR-0004 Phase 3：xterm.js onData 原始输入 → WS terminal_input → 后端 PTY stdin。
  // 连接未就绪时静默丢弃（终端输入本身尽力而为，PTY 自回显，丢一个字符不可恢复）。
  // ★ 2026-08-14：xterm 的 Enter 键发送单个 CR（\r），但 U3DS Console.ReadLine() 以 LF 为
  // 行终止符——把单独的回车转 LF，保证手动按键也能触发命令（与 sendCommand 的 \n 对齐）。
  const sendTerminalInput = useCallback(
    (data: string) => {
      const normalized = data === "\r" ? "\n" : data;
      send({ type: "terminal_input", serverId, data: normalized });
    },
    [serverId, send],
  );

  // ── ACK 语义操作（ws-wrapper-design §2.5）──────────────────────────

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
    lines,
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
