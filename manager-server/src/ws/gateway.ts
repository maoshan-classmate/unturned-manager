import { WebSocketServer, WebSocket } from "ws";
import { Server } from "http";
import type {
  IBroadcaster,
  ServerEvent,
  ServerId,
  ClientWsMessage,
  ClientWsRequestMessage,
  WsRequestResult,
  WsRequestHandler,
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
  // ★ ws-wrapper-design §2.4：请求-应答处理器注册表（消息 type → 业务处理器）。
  // 组合根启动时一次性注册；运行期收到未注册类型 → 回 unsupported_request ack。
  private requestHandlers = new Map<string, WsRequestHandler>();

  /**
   * 注册请求-应答处理器（ws-wrapper-design §2.4）。
   * 同一 type 重复注册会覆盖——组合根启动时一次性注册，运行期不改。
   */
  registerRequestHandler(type: string, handler: WsRequestHandler): void {
    this.requestHandlers.set(type, handler);
  }

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
          if ((msg as { type: string }).type === "ping") {
            // ★ S2 修复：应用层 ping/pong——前端每 25s 发 ping 防反向代理空闲切断。
            // 直接回 pong，不进 broadcast / 不进 request handler。
            // type-narrow 绕过：ping 不在 ClientWsMessage 契约里，gateway 显式路由
            ws.send(JSON.stringify({ type: "pong" }));
            return;
          } else if (msg.type === "subscribe") {
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
          } else if (
            msg.type === "terminal_close" ||
            msg.type === "save" ||
            msg.type === "shutdown"
          ) {
            // ★ ws-wrapper-design §2.4：请求-应答模式——异步处理后回 ack。
            // fire-and-forget 调起（handleRequest 内部全 try/catch，异常只转 ack 不抛回 ws 层）。
            void this.handleRequest(ws, msg);
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

  /**
   * 请求-应答路由（ws-wrapper-design §2.4）。
   * 校验 → 查注册表 → 调业务处理器 → 回 ack；业务异常兜底成 internal_error ack，
   * 绝不抛回 ws 层拖垮连接。
   */
  private async handleRequest(
    ws: WebSocket,
    msg: ClientWsRequestMessage,
  ): Promise<void> {
    if (typeof msg.requestId !== "string" || !msg.requestId) {
      ws.send(
        JSON.stringify({
          type: "error",
          code: "invalid_message",
          message: `${msg.type} 缺少 requestId`,
        }),
      );
      return;
    }
    if (typeof msg.serverId !== "string" || !msg.serverId) {
      this.sendAck(ws, msg.requestId, {
        ok: false,
        error: {
          code: "invalid_message",
          message: `${msg.type} 缺少 serverId`,
        },
      });
      return;
    }
    const handler = this.requestHandlers.get(msg.type);
    if (!handler) {
      this.sendAck(ws, msg.requestId, {
        ok: false,
        error: {
          code: "unsupported_request",
          message: `服务端未实现 ${msg.type} 请求`,
        },
      });
      return;
    }
    try {
      const result = await handler(msg);
      this.sendAck(ws, msg.requestId, result);
    } catch (err) {
      logger.error(
        { err, type: msg.type, serverId: msg.serverId },
        "WS 请求处理器异常",
      );
      this.sendAck(ws, msg.requestId, {
        ok: false,
        error: {
          code: "internal_error",
          message: err instanceof Error ? err.message : "未知错误",
        },
      });
    }
  }

  /**
   * 回答应 ack（ws-wrapper-design §2.2）——直接回给发起请求的连接，不走 broadcast。
   * 连接已关闭时静默丢弃（前端本地超时已兜底，服务端不强制送达）。
   */
  private sendAck(
    ws: WebSocket,
    requestId: string,
    result: WsRequestResult,
  ): void {
    if (ws.readyState !== WebSocket.OPEN) return;
    ws.send(
      JSON.stringify({
        type: "ack",
        requestId,
        ok: result.ok,
        ...(result.payload !== undefined ? { payload: result.payload } : {}),
        ...(result.error ? { error: result.error } : {}),
      }),
    );
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
    this.requestHandlers.clear();
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
