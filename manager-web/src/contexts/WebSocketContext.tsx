import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { ensureAccessToken } from '../api/client.js';
import { useAuth } from './AuthContext.js';

interface WebSocketContextValue {
  connected: boolean;
}

const WebSocketContext = createContext<WebSocketContextValue>({ connected: false });

/** WS 401 后退避重连上限(指数退避封顶,防止雪崩) */
const MAX_RETRY_DELAY_MS = 30_000;

export function WebSocketProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useAuth();
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const retryTimer = useRef<ReturnType<typeof setTimeout>>();
  const retryDelay = useRef(1000);
  const intentionalClose = useRef(false);

  useEffect(() => {
    if (!isAuthenticated) {
      wsRef.current?.close();
      return;
    }

    async function connect() {
      // C安全缺陷修复:WS 必须用 accessToken(短期 15min),
      // 而非 refreshToken(语义错误 + refreshToken 一旦泄漏 = 长期 WS 控制权)
      const token = await ensureAccessToken();
      if (!token || intentionalClose.current) return;

      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${protocol}//${window.location.host}/ws?token=${token}`);

      ws.onopen = () => {
        setConnected(true);
        retryDelay.current = 1000;
        // 卡 B：建连后发 subscribe（修复 C8）。Phase 0 默认订阅所有 serverId + 所有事件；
        // 后续可在 useServer/useConsole 提供更精细的 serverIds/eventTypes。
        ws.send(JSON.stringify({ type: 'subscribe', serverIds: [], eventTypes: null }));
      };

      ws.onclose = () => {
        setConnected(false);
        if (intentionalClose.current) return;
        // accessToken 过期(15min)后服务端会 401 → WS 断开。
        // 退避重连:重连前 ensureAccessToken() 会自动 /auth/refresh 拿新 token。
        retryTimer.current = setTimeout(() => {
          retryDelay.current = Math.min(retryDelay.current * 2, MAX_RETRY_DELAY_MS);
          connect();
        }, retryDelay.current);
      };

      ws.onerror = () => {
        ws.close();
      };

      wsRef.current = ws;
    }

    intentionalClose.current = false;
    connect();

    return () => {
      intentionalClose.current = true;
      clearTimeout(retryTimer.current);
      wsRef.current?.close();
    };
  }, [isAuthenticated]);

  return (
    <WebSocketContext.Provider value={{ connected }}>
      {children}
    </WebSocketContext.Provider>
  );
}

export function useWebSocket(): WebSocketContextValue {
  return useContext(WebSocketContext);
}