import { useState, useCallback, useRef, useEffect } from 'react';
import { apiClient } from '../api/client.js';

interface ConsoleLine {
  id: number;
  text: string;
  source: 'stdout' | 'file' | 'input';
  timestamp: number;
}

interface UseConsoleReturn {
  lines: ConsoleLine[];
  sendCommand: (command: string, confirmed?: boolean) => Promise<string | null>;
  clearLines: () => void;
  connected: boolean;
}

const MAX_LINES = 500;
const COMMAND_HISTORY_MAX = 50;

let nextId = 1;

/**
 * 控制台 hook —— 管理输出缓冲、命令发送、命令历史。
 *
 * 输出通过 WebSocket 接收（console_line 事件），命令通过 REST POST 发送。
 */
export function useConsole(serverId: string): UseConsoleReturn {
  const [lines, setLines] = useState<ConsoleLine[]>([]);
  const [connected, setConnected] = useState(false);
  const historyRef = useRef<string[]>([]);
  const wsRef = useRef<WebSocket | null>(null);

  // WebSocket 连接控制台输出流
  useEffect(() => {
    if (!serverId) return;

    const token = localStorage.getItem('refreshToken');
    if (!token) return;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(
      `${protocol}//${window.location.host}/ws?token=${token}`,
    );

    ws.onopen = () => setConnected(true);
    ws.onclose = () => setConnected(false);

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'console_line' && msg.serverId === serverId) {
          setLines((prev) => {
            const next = [
              ...prev,
              {
                id: nextId++,
                text: msg.line,
                source: msg.source ?? 'stdout',
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

    return () => {
      ws.close();
    };
  }, [serverId]);

  const sendCommand = useCallback(
    async (command: string, confirmed = false): Promise<string | null> => {
      // 添加到命令历史
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
          source: 'input',
          timestamp: Date.now(),
        },
      ]);

      try {
        const { data } = await apiClient.post<{ data: { output: string } }>(
          `/servers/${serverId}/execute`,
          { command, confirmed },
        );

        if (data.data.output) {
          setLines((prev) => [
            ...prev,
            {
              id: nextId++,
              text: data.data.output,
              source: 'stdout',
              timestamp: Date.now(),
            },
          ]);
        }
        return data.data.output;
      } catch (err: unknown) {
        const errorResponse = err as {
          response?: { data?: { error?: { code: string; message: string } } };
        };
        const errorMsg =
          errorResponse.response?.data?.error?.message ?? '命令执行失败';
        setLines((prev) => [
          ...prev,
          {
            id: nextId++,
            text: `[错误] ${errorMsg}`,
            source: 'stdout',
            timestamp: Date.now(),
          },
        ]);
        return null;
      }
    },
    [serverId],
  );

  const clearLines = useCallback(() => {
    setLines([]);
  }, []);

  return { lines, sendCommand, clearLines, connected };
}

/** 获取命令历史（用于 ↑↓ 翻页） */
export function useConsoleHistory(): {
  history: React.MutableRefObject<string[]>;
} {
  return { history: { current: [] } as React.MutableRefObject<string[]> };
}
