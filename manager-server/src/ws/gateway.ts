import { WebSocketServer, WebSocket } from "ws";
import { Server } from "http";
import type {
  IBroadcaster,
  ServerEvent,
  ServerId,
  ClientWsMessage,
  IPtyManager,
} from "@unturned-manager/shared";
import type { AuthService } from "../modules/auth/AuthService.js";
import { logger } from "../utils/logger.js";

interface WsSubscription {
  serverIds: Set<string>;
  eventTypes: Set<string> | null; // null = 接收所有事件
}

const SUBSCRIBE_TIMEOUT_MS = 5_000;

// ★ BUG-FIX（2026-08-10）：WS 心跳保活。gateway 原先无 ping/pong——空闲连接在
//   反向代理 idle 超时 / 中间链路静默下被切断，用户反馈「WS 客户端经常断」→
//   steamcmd_progress 进度事件全部丢失（BUG-2/5 无进度提示的伴随根因）。
//   标准 ws 库保活：服务端每 HEARTBEAT_INTERVAL_MS 发 ping，浏览器自动回 pong；
//   间隔内未回 pong（isAlive 仍 false）视为死连接 terminate 清理。
const HEARTBEAT_INTERVAL_MS = 30_000;

// 每个 ws 连接订阅的 serverId 集合（Phase 0 升级：含事件类型过滤）
const wsSubscriptions = new Map<WebSocket, WsSubscription>();

/** WebSocket + 心跳存活标记 */
type HeartbeatWebSocket = WebSocket & { isAlive?: boolean };

class WsBroadcaster implements IBroadcaster {
  private wss: WebSocketServer | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;

  init(
    server: Server,
    authService: AuthService,
    ptyManager?: IPtyManager,
  ): void {
    this.wss = new WebSocketServer({
      server,
      verifyClient: (info, cb) => {
        const url = new URL(
          info.req.url ?? "/",
          `http://${info.req.headers.host}`,
        );
        const token = url.searchParams.get("token");

        if (!token) {
          logger.warn("WebSocket 连接被拒绝：缺少 token");
          cb(false, 401, "Unauthorized");
          return;
        }

        const payload = authService.validateAccessToken(token);
        if (!payload) {
          logger.warn("WebSocket 连接被拒绝：无效 token");
          cb(false, 401, "Unauthorized");
          return;
        }

        cb(true);
      },
    });

    // 心跳定时器：每 30s 遍历所有连接 ping；上次 ping 未回 pong（isAlive=false）→ terminate。
    // 浏览器 WebSocket 协议层自动回 pong，无需前端配合。
    this.heartbeatTimer = setInterval(() => {
      const clients = this.wss?.clients ?? [];
      for (const client of clients) {
        const ws = client as HeartbeatWebSocket;
        if (ws.isAlive === false) {
          logger.warn("WS 心跳超时，terminate 死连接");
          ws.terminate();
          continue;
        }
        ws.isAlive = false;
        ws.ping();
      }
    }, HEARTBEAT_INTERVAL_MS);

    this.wss.on("connection", (ws, req) => {
      logger.info("WebSocket 客户端已连接");

      // 心跳存活标记：pong 恢复
      const heartbeatWs = ws as HeartbeatWebSocket;
      heartbeatWs.isAlive = true;
      ws.on("pong", () => {
        heartbeatWs.isAlive = true;
      });

      // 初始空订阅，必须 5s 内发 subscribe 消息（修复 C8）
      wsSubscriptions.set(ws, { serverIds: new Set(), eventTypes: null });
      let subscribed = false;

      const subscribeTimer = setTimeout(() => {
        if (!subscribed) {
          logger.warn("WebSocket 客户端 5 秒内未发 subscribe，关闭连接");
          ws.close(1008, "Subscribe timeout");
        }
      }, SUBSCRIBE_TIMEOUT_MS);

      ws.on("message", (raw) => {
        try {
          const msg = JSON.parse(raw.toString()) as ClientWsMessage;
          if (msg.type === "subscribe") {
            const subs = wsSubscriptions.get(ws);
            if (subs) {
              // serverIds 接受 string[]，空数组 = 不订阅任何 serverId 的事件
              subs.serverIds = new Set(
                Array.isArray(msg.serverIds) ? msg.serverIds : [],
              );
              // eventTypes 可选；不传或 null = 接收所有类型
              subs.eventTypes = Array.isArray(msg.eventTypes)
                ? new Set(msg.eventTypes)
                : null;
              subscribed = true;
              clearTimeout(subscribeTimer);
              ws.send(
                JSON.stringify({
                  type: "subscribed",
                  serverIds: Array.from(subs.serverIds),
                  eventTypes: msg.eventTypes ?? null,
                }),
              );
              logger.info(
                {
                  serverIds: Array.from(subs.serverIds),
                  eventTypes: subs.eventTypes
                    ? Array.from(subs.eventTypes)
                    : "(all)",
                },
                "WS 客户端已订阅",
              );
            }
          } else if (msg.type === "terminal_input") {
            // ★ ADR-0004 Phase 3：xterm.js onData 的原始输入 → 写入对应 serverId 的 PTY stdin。
            // owner-trust 模型（§3.4）：WS verifyClient 已校验 JWT，终端是 owner 自己用，
            // 不做命令解析/危险指令门控——前端 ConsolePage 的 ConfirmDialog 负责拦截。
            if (!ptyManager) {
              ws.send(
                JSON.stringify({
                  type: "error",
                  code: "pty_unavailable",
                  message: "控制台未就绪，请稍后重试",
                }),
              );
              return;
            }
            const serverId = msg.serverId as ServerId;
            const data = typeof msg.data === "string" ? msg.data : "";
            if (!serverId) {
              ws.send(
                JSON.stringify({
                  type: "error",
                  code: "invalid_message",
                  message: "terminal_input 缺少 serverId",
                }),
              );
              return;
            }
            // 契约合法即受理（isRunning=false 时 write 幂等丢弃 + PtyManager 打 warn 日志）
            ptyManager.write(serverId, data);
          } else {
            ws.send(
              JSON.stringify({
                type: "error",
                code: "invalid_message",
                message: "未知消息类型",
              }),
            );
          }
        } catch {
          ws.send(
            JSON.stringify({
              type: "error",
              code: "invalid_json",
              message: "消息非合法 JSON",
            }),
          );
        }
      });

      ws.on("close", () => {
        clearTimeout(subscribeTimer);
        wsSubscriptions.delete(ws);
        logger.info("WebSocket 客户端已断开");
      });

      ws.on("error", (err) => {
        logger.error({ err }, "WebSocket 错误");
      });
    });
  }

  broadcast(event: ServerEvent): void {
    const data = JSON.stringify(event);

    for (const [ws, subs] of wsSubscriptions) {
      if (ws.readyState !== WebSocket.OPEN) continue;

      // serverIds 过滤
      if (subs.serverIds.size > 0) {
        if (!("serverId" in event) || !event.serverId) continue;
        if (!subs.serverIds.has(event.serverId)) continue;
      }

      // eventTypes 过滤
      if (subs.eventTypes && !subs.eventTypes.has(event.type)) continue;

      ws.send(data);
    }
  }

  register(ws: WebSocket, serverIds: ServerId[]): void {
    const subs = wsSubscriptions.get(ws);
    if (subs) {
      for (const id of serverIds) subs.serverIds.add(id);
    }
  }

  unregister(ws: WebSocket): void {
    wsSubscriptions.delete(ws);
  }

  async destroy(): Promise<void> {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    for (const ws of wsSubscriptions.keys()) {
      ws.close();
    }
    wsSubscriptions.clear();

    if (this.wss) {
      return new Promise((resolve) => {
        this.wss!.close(() => resolve());
      });
    }
  }
}

// 单例
export const wsBroadcaster = new WsBroadcaster();
