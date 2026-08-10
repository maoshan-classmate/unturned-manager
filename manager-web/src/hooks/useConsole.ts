import { useState, useCallback, useRef, useEffect } from "react";
import { apiClient, ensureAccessToken } from "../api/client.js";

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
}

const MAX_LINES = 500;
const COMMAND_HISTORY_MAX = 50;

let nextId = 1;

/**
 * 控制台 hook —— 管理输出缓冲、命令发送、命令历史。
 *
 * 输出通过 WebSocket 接收（console_line 事件），命令通过 WS terminal_input 写入 PTY stdin。
 * ★ ADR-0004 Phase 6：RCON 通道已删除——所有命令都走 PTY 终端 owner-trust 模型。
 */
export function useConsole(serverId: string): UseConsoleReturn {
  const [lines, setLines] = useState<ConsoleLine[]>([]);
  const [connected, setConnected] = useState(false);
  const historyRef = useRef<string[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const retryTimer = useRef<ReturnType<typeof setTimeout>>();
  const retryDelay = useRef(1000);
  const intentionalClose = useRef(false);

  // WebSocket 连接控制台输出流
  useEffect(() => {
    if (!serverId) return;

    let cancelled = false;

    async function connect() {
      // C安全缺陷修复:WS 必须用 accessToken,过期后 ensureAccessToken() 自动 refresh
      const token = await ensureAccessToken();
      if (!token || cancelled) return;

      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const ws = new WebSocket(
        `${protocol}//${window.location.host}/ws?token=${token}`,
      );

      ws.onopen = () => {
        setConnected(true);
        retryDelay.current = 1000;
      };
      ws.onclose = () => {
        setConnected(false);
        if (cancelled) return;
        // accessToken 过期后服务端 401 → WS 断开 → 退避重连
        // 重连时 ensureAccessToken() 会自动用 refreshToken 拿新 accessToken
        retryTimer.current = setTimeout(() => {
          retryDelay.current = Math.min(retryDelay.current * 2, 30_000);
          connect();
        }, retryDelay.current);
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === "console_line" && msg.serverId === serverId) {
            setLines((prev) => {
              const next = [
                ...prev,
                {
                  id: nextId++,
                  text: msg.line,
                  source: msg.source ?? "stdout",
                  timestamp: Date.now(),
                },
              ];
              // 限制最大行数
              return next.length > MAX_LINES
                ? next.slice(next.length - MAX_LINES)
                : next;
            });
          }
        } catch {
          // 忽略非 JSON 消息
        }
      };

      wsRef.current = ws;
    }

    intentionalClose.current = false;
    connect();

    return () => {
      cancelled = true;
      clearTimeout(retryTimer.current);
      wsRef.current?.close();
    };
  }, [serverId]);

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

      // PTY 终端：拼入 \r 让 U3DS bash 解析
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN || !serverId) {
        setLines((prev) => [
          ...prev,
          {
            id: nextId++,
            text: "[错误] WebSocket 未连接",
            source: "stdout",
            timestamp: Date.now(),
          },
        ]);
        return null;
      }
      ws.send(
        JSON.stringify({
          type: "terminal_input",
          serverId,
          data: `${command}\r`,
        }),
      );
      return null; // PTY 模式下不返回响应文本（响应通过 console_line 异步回显）
    },
    [serverId],
  );

  const clearLines = useCallback(() => {
    setLines([]);
  }, []);

  // ★ ADR-0004 Phase 3：xterm.js onData 原始输入 → WS terminal_input → 后端 PTY stdin。
  // WS 未连上/未 OPEN 时静默丢弃（终端输入本身尽力而为，PTY 自回显，丢一个字符不可恢复）。
  const sendTerminalInput = useCallback(
    (data: string) => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN || !serverId) return;
      ws.send(JSON.stringify({ type: "terminal_input", serverId, data }));
    },
    [serverId],
  );

  return { lines, sendCommand, clearLines, connected, sendTerminalInput };
}

/** 获取命令历史（用于 ↑↓ 翻页） */
export function useConsoleHistory(): {
  history: React.MutableRefObject<string[]>;
} {
  return { history: { current: [] } as React.MutableRefObject<string[]> };
}
