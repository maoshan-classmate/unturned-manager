import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  ensureAccessToken,
  getAccessToken,
  getAccessTokenExpMs,
} from "../api/client.js";
import { useAuth } from "./AuthContext.js";
import { generateUUID } from "../lib/utils.js";

/**
 * 服务端推送的 WS 事件（契约真源在 shared/contracts/broadcast.ts）。
 * 前端宽松接收——订阅者按 type 字段收窄到自己关心的字段。
 */
export interface ServerEventMessage {
  type: string;
  serverId?: string;
  [key: string]: unknown;
}

/**
 * 请求-应答上行消息（ws-wrapper-design §2.2）。
 * requestId 由 request() 自动生成并注入，调用方不传。
 */
export interface WsRequestMessage {
  type: "terminal_close" | "save" | "shutdown";
  serverId: string;
  /** 仅 shutdown：关服倒计时秒数（服务端钳制 0–600） */
  delaySeconds?: number;
  /** 仅 shutdown：关服原因（广播给在线玩家） */
  reason?: string;
}

/**
 * 请求-应答结果。业务错误走 ok:false + error（Promise 正常 resolve）；
 * Promise 只在本地超时 / 连接断开时 reject。
 */
export interface WsRequestResult<T = unknown> {
  ok: boolean;
  payload?: T;
  error?: { code: string; message: string };
}

/** fire-and-forget 上行消息（当前仅终端原始输入；subscribe 由 Provider 自己管理） */
export interface WsSendMessage {
  type: "terminal_input";
  serverId: string;
  /** 原始输入字节（xterm onData 给的字符 / 回车 / 控制序列） */
  data: string;
}

interface WebSocketContextValue {
  /** 全局唯一 WS 连接状态（ADR-0004 Phase 5 起所有 hook 共享这一条连接） */
  connected: boolean;
  /**
   * 按事件类型订阅服务端推送——返回 unsubscribe（组件卸载时必须调）。
   * ref 模式实现：回调永远 latest 引用，不触发 React 重渲注册。
   */
  subscribe: (
    eventType: string,
    handler: (msg: ServerEventMessage) => void,
  ) => () => void;
  /**
   * fire-and-forget 上行发送（无应答语义——终端输入等高频尽力而为场景）。
   *
   * @returns true=已写入 socket；false=连接未就绪（调用方自行决定提示或丢弃）
   */
  send: (msg: WsSendMessage) => boolean;
  /**
   * 请求-应答（ws-wrapper-design §2.5）：注入 requestId 发出请求，
   * 等服务端 ack 后 resolve（业务错误也 resolve，看 ok 字段）；
   * 本地超时（默认 30s）或连接断开时 reject。
   */
  request: <T = unknown>(
    msg: WsRequestMessage,
    opts?: { timeoutMs?: number },
  ) => Promise<WsRequestResult<T>>;
}

const WebSocketContext = createContext<WebSocketContextValue>({
  connected: false,
  subscribe: () => () => {},
  send: () => false,
  request: () => Promise.reject(new Error("WS Provider 未挂载")),
});

/** WS 断线退避重连下限（1s 起步指数翻倍） */
const MIN_RETRY_DELAY_MS = 1_000;
/** WS 断线退避重连上限（指数退避封顶，防止雪崩） */
const MAX_RETRY_DELAY_MS = 30_000;
/** request() 默认本地超时（服务端不强制响应时限，超时由前端兜底） */
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
/** accessToken 主动 refresh 提前量——过期前 3min 刷新，留缓冲给 WS 重连 */
const REFRESH_BEFORE_EXPIRY_MS = 3 * 60 * 1000;
/** refresh 调度允许的最小间隔（防止 setTimeout drift 触发紧循环） */
const MIN_REFRESH_INTERVAL_MS = 30 * 1000;
/** 应用层 ping 间隔——10s 远小于任何反向代理默认 idle 超时（nginx 60s / caddy 5min），
 * 加快心跳可缩小「底层连接已重置但前端 readyState 还显示打开」的竞争窗口。
 * 仍保留服务端 30s 心跳超时容差。 */
const PING_INTERVAL_MS = 10_000;

interface PendingRequest {
  resolve: (result: WsRequestResult<unknown>) => void;
  reject: (err: Error) => void;
}

/**
 * 全局 WS Provider——单连接事件订阅总线（ws-wrapper-design §3）。
 *
 * 职责：建连（JWT 鉴权）→ 自动 subscribe → 指数退避重连；消息按 type 分发
 * 给订阅者；ack 按 requestId 匹配 pending request。3 处独立连接（控制台 /
 * SteamCMD 进度 / 实例状态）已合并到这一条连接上。
 */
export function WebSocketProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useAuth();
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const retryTimer = useRef<ReturnType<typeof setTimeout>>();
  const retryDelay = useRef(MIN_RETRY_DELAY_MS);
  const intentionalClose = useRef(false);
  // accessToken 主动 refresh 定时器——过期前 3min 调 ensureAccessToken
  // 让 accessToken 永远新鲜，WS 重连不串行等 refresh
  const refreshTimer = useRef<ReturnType<typeof setTimeout>>();
  // 应用层 ping 定时器——25s 间隔保活防反向代理空闲切断
  const pingTimer = useRef<ReturnType<typeof setInterval>>();
  // 事件订阅表：eventType → handler 集合（ref 模式：永远 latest，避免重渲注册）
  const listenersRef = useRef<
    Map<string, Set<(msg: ServerEventMessage) => void>>
  >(new Map());
  // 在飞请求表：requestId → pending（重连时整体 reject——不持久化在飞请求）
  const pendingRef = useRef<Map<string, PendingRequest>>(new Map());

  // 三个 API 都用 ref 稳定引用——消费方 useEffect 依赖它们不会反复重订
  const subscribe = useRef<WebSocketContextValue["subscribe"]>(
    (eventType, handler) => {
      let set = listenersRef.current.get(eventType);
      if (!set) {
        set = new Set();
        listenersRef.current.set(eventType, set);
      }
      set.add(handler);
      return () => {
        set.delete(handler);
      };
    },
  ).current;

  const send = useRef<WebSocketContextValue["send"]>((msg) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    ws.send(JSON.stringify(msg));
    return true;
  }).current;

  const request = useRef<WebSocketContextValue["request"]>(
    <T = unknown,>(
      msg: WsRequestMessage,
      opts?: { timeoutMs?: number },
    ): Promise<WsRequestResult<T>> => {
      return new Promise<WsRequestResult<T>>((resolve, reject) => {
        const ws = wsRef.current;
        if (!ws || ws.readyState !== WebSocket.OPEN) {
          reject(new Error("连接未就绪，请稍后重试"));
          return;
        }
        // HTTP 非安全上下文下 crypto.randomUUID 不可用（TypeError）——
        // 用 generateUUID fallback（getRandomValues 在 HTTP/HTTPS 均可用）
        const requestId = generateUUID();
        const timeoutMs = opts?.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
        const timer = setTimeout(() => {
          pendingRef.current.delete(requestId);
          reject(new Error("请求超时——服务端没有在预期时间内应答"));
        }, timeoutMs);
        pendingRef.current.set(requestId, {
          resolve: (result) => {
            clearTimeout(timer);
            resolve(result as WsRequestResult<T>);
          },
          reject: (err) => {
            clearTimeout(timer);
            reject(err);
          },
        });
        ws.send(JSON.stringify({ ...msg, requestId }));
      });
    },
  ).current;

  /**
   * 主动 refresh 调度器：根据当前 accessToken 的 exp 计算到「过期前 3min」
   * 的毫秒数，setTimeout 到点调 ensureAccessToken；refresh 完递归排下一次。
   *
   * 好处：
   * - accessToken 永远新鲜，WS 重连拿到永远有效的 token → 0 抖动
   * - 不依赖 HTTP 401 拦截器被动刷新（拦截器只在请求时才触发）
   * - 不依赖 WS 重连时串行 refresh
   *
   * 边界：解码失败 → 立即 refresh 兜底；token 缺失 → no-op；间隔 < 30s 强制拉长
   * 防 setTimeout drift 触发紧循环。
   */
  const scheduleRefresh = useRef<() => void>(undefined);
  scheduleRefresh.current = () => {
    if (refreshTimer.current) {
      clearTimeout(refreshTimer.current);
      refreshTimer.current = undefined;
    }
    const token = getAccessToken();
    if (!token) return; // 未登录，AuthContext 会兜底
    const expMs = getAccessTokenExpMs(token);
    if (expMs === null) {
      // 解码失败 → 立即 refresh 兜底
      void ensureAccessToken().then(() => scheduleRefresh.current?.());
      return;
    }
    const delay = Math.max(expMs - Date.now() - REFRESH_BEFORE_EXPIRY_MS, 0);
    const safeDelay = Math.max(delay, MIN_REFRESH_INTERVAL_MS);
    refreshTimer.current = setTimeout(() => {
      void ensureAccessToken().then(() => scheduleRefresh.current?.());
    }, safeDelay);
  };

  useEffect(() => {
    if (!isAuthenticated) {
      wsRef.current?.close();
      return;
    }

    /** 断线时 reject 全部在飞请求——ack 不可能再到达，挂着只会等满超时 */
    function rejectAllPending(err: Error) {
      for (const pending of pendingRef.current.values()) {
        pending.reject(err);
      }
      pendingRef.current.clear();
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
        retryDelay.current = MIN_RETRY_DELAY_MS;
        // 卡 B：建连后发 subscribe（修复 C8）。Phase 0 默认订阅所有 serverId + 所有事件；
        // 事件过滤由前端订阅表按 type 分发承担（ws-wrapper-design §3.4）。
        ws.send(
          JSON.stringify({
            type: "subscribe",
            serverIds: [],
            eventTypes: null,
          }),
        );
        // ★ S2 修复：建连后启动应用层 ping——25s 间隔远小于任何反向代理 idle 超时，
        // 防止 nginx/caddy 把 WS 误判为空闲切断。
        pingTimer.current = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "ping" }));
          }
        }, PING_INTERVAL_MS);
      };

      ws.onmessage = (event) => {
        let msg: ServerEventMessage;
        try {
          msg = JSON.parse(event.data as string) as ServerEventMessage;
        } catch {
          return; // 忽略非 JSON 消息
        }

        // ① ack：按 requestId 匹配在飞请求（无 pending = 已本地超时，静默丢弃——§2.3）
        if (msg.type === "ack" && typeof msg.requestId === "string") {
          const pending = pendingRef.current.get(msg.requestId);
          if (pending) {
            pendingRef.current.delete(msg.requestId);
            pending.resolve({
              ok: msg.ok === true,
              ...(msg.payload !== undefined ? { payload: msg.payload } : {}),
              ...(msg.error !== undefined
                ? { error: msg.error as { code: string; message: string } }
                : {}),
            });
          }
          return;
        }

        // ② 普通事件：按 type 分发给订阅者（单个 listener 抛错不影响其他）
        const handlers = listenersRef.current.get(msg.type);
        if (!handlers) return;
        for (const handler of handlers) {
          try {
            handler(msg);
          } catch {
            /* 单个 listener 抛错不影响其他 */
          }
        }
      };

      ws.onclose = () => {
        setConnected(false);
        rejectAllPending(new Error("连接已断开，请求未完成"));
        // ★ S2 修复：连接关闭时清掉 ping 定时器，避免泄漏；下次 connect 时 onopen 重建
        if (pingTimer.current) {
          clearInterval(pingTimer.current);
          pingTimer.current = undefined;
        }
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
    // ★ S5 修复：挂载即排好 refresh 调度——accessToken 过期前 3min 自动刷新
    scheduleRefresh.current?.();

    return () => {
      intentionalClose.current = true;
      clearTimeout(retryTimer.current);
      clearTimeout(refreshTimer.current);
      refreshTimer.current = undefined;
      if (pingTimer.current) {
        clearInterval(pingTimer.current);
        pingTimer.current = undefined;
      }
      rejectAllPending(new Error("连接已断开，请求未完成"));
      wsRef.current?.close();
    };
  }, [isAuthenticated, scheduleRefresh]);

  return (
    <WebSocketContext.Provider value={{ connected, subscribe, send, request }}>
      {children}
    </WebSocketContext.Provider>
  );
}

/**
 * 消费全局 WS 事件总线。
 *
 * @returns connected 连接状态 + subscribe 事件订阅 + send 无应答上行 + request 请求-应答
 *
 * @example
 * ```tsx
 * const ws = useWebSocket();
 * useEffect(() => ws.subscribe("console_line", (msg) => {
 *   if (msg.serverId === serverId) appendLine(msg.line);
 * }), [ws, serverId]);
 * const result = await ws.request({ type: "save", serverId });
 * ```
 */
export function useWebSocket(): WebSocketContextValue {
  return useContext(WebSocketContext);
}
