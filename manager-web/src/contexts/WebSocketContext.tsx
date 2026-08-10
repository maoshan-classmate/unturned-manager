import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ensureAccessToken } from "../api/client.js";
import { useAuth } from "./AuthContext.js";

export interface ServerEventMessage {
  type: string;
  serverId?: string;
  [key: string]: unknown;
}

interface WebSocketContextValue {
  connected: boolean;
  /**
   * 订阅 WS 广播事件——返回 unsubscribe 函数。
   * 回调收到 raw JSON 消息（类型 unknown，由订阅者按 type 字段断言）。
   * 用 ref 模式：避免 React 重渲，useServer 已在内部按 useState 同步状态。
   * ★ ADR-0004 Phase 5：useServer 用此订阅 state_change 事件实时更新 server.state。
   */
  subscribe: (listener: (msg: ServerEventMessage) => void) => () => void;
}

const WebSocketContext = createContext<WebSocketContextValue>({
  connected: false,
  subscribe: () => () => {},
});

/** WS 401 后退避重连上限(指数退避封顶,防止雪崩) */
const MAX_RETRY_DELAY_MS = 30_000;

export function WebSocketProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useAuth();
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const retryTimer = useRef<ReturnType<typeof setTimeout>>();
  const retryDelay = useRef(1000);
  const intentionalClose = useRef(false);
  // 复用 useRef 存 listeners（永远 latest，避免重渲注册）——订阅者拿 unsubscribe 函数控制生命周期
  const listenersRef = useRef<Set<(msg: ServerEventMessage) => void>>(
    new Set(),
  );

  // 暴露稳定 subscribe 引用（setState 同一函数，listener 用 ref 模式订阅）
  const subscribe = useRef<
    (listener: (msg: ServerEventMessage) => void) => () => void
  >((listener) => {
    listenersRef.current.add(listener);
    return () => {
      listenersRef.current.delete(listener);
    };
  }).current;

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

      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const ws = new WebSocket(
        `${protocol}//${window.location.host}/ws?token=${token}`,
      );

      ws.onopen = () => {
        setConnected(true);
        retryDelay.current = 1000;
        // 卡 B：建连后发 subscribe（修复 C8）。Phase 0 默认订阅所有 serverId + 所有事件；
        // 后续可在 useServer/useConsole 提供更精细的 serverIds/eventTypes。
        ws.send(
          JSON.stringify({
            type: "subscribe",
            serverIds: [],
            eventTypes: null,
          }),
        );
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data) as ServerEventMessage;
          // 广播给所有 listener（failed parse 静默吞）
          for (const l of listenersRef.current) {
            try {
              l(msg);
            } catch {
              /* 单个 listener 抛错不影响其他 */
            }
          }
        } catch {
          /* 忽略非 JSON 消息 */
        }
      };

      ws.onclose = () => {
        setConnected(false);
        if (intentionalClose.current) return;
        // accessToken 过期(15min)后服务端会 401 → WS 断开。
        // 退避重连:重连前 ensureAccessToken() 会自动 /auth/refresh 拿新 token。
        retryTimer.current = setTimeout(() => {
          retryDelay.current = Math.min(
            retryDelay.current * 2,
            MAX_RETRY_DELAY_MS,
          );
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
    <WebSocketContext.Provider value={{ connected, subscribe }}>
      {children}
    </WebSocketContext.Provider>
  );
}

export function useWebSocket(): WebSocketContextValue {
  return useContext(WebSocketContext);
}
