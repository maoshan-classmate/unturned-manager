import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useAuth } from './AuthContext.js';

interface WebSocketContextValue {
  connected: boolean;
}

const WebSocketContext = createContext<WebSocketContextValue>({ connected: false });

export function WebSocketProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useAuth();
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const retryTimer = useRef<ReturnType<typeof setTimeout>>();
  const retryDelay = useRef(1000);

  useEffect(() => {
    if (!isAuthenticated) {
      wsRef.current?.close();
      return;
    }

    const token = localStorage.getItem('refreshToken');
    if (!token) return;

    function connect() {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${protocol}//${window.location.host}/ws?token=${token}`);

      ws.onopen = () => {
        setConnected(true);
        retryDelay.current = 1000;
      };

      ws.onclose = () => {
        setConnected(false);
        // 指数退避重连
        retryTimer.current = setTimeout(() => {
          retryDelay.current = Math.min(retryDelay.current * 2, 30000);
          connect();
        }, retryDelay.current);
      };

      ws.onerror = () => {
        ws.close();
      };

      wsRef.current = ws;
    }

    connect();

    return () => {
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
