import { WebSocketServer, WebSocket } from 'ws';
import { Server } from 'http';
import type { IBroadcaster, ServerEvent, ServerId } from '@unturned-manager/shared';
import type { AuthService } from '../modules/auth/AuthService.js';
import { logger } from '../utils/logger.js';

interface WsSubscription {
  serverIds: Set<string>;
  eventTypes: Set<string> | null;  // null = 接收所有事件
}

const SUBSCRIBE_TIMEOUT_MS = 5_000;

// 每个 ws 连接订阅的 serverId 集合（Phase 0 升级：含事件类型过滤）
const wsSubscriptions = new Map<WebSocket, WsSubscription>();

class WsBroadcaster implements IBroadcaster {
  private wss: WebSocketServer | null = null;

  init(server: Server, authService: AuthService): void {
    this.wss = new WebSocketServer({
      server,
      verifyClient: (info, cb) => {
        const url = new URL(info.req.url ?? '/', `http://${info.req.headers.host}`);
        const token = url.searchParams.get('token');

        if (!token) {
          logger.warn('WebSocket 连接被拒绝：缺少 token');
          cb(false, 401, 'Unauthorized');
          return;
        }

        const payload = authService.validateAccessToken(token);
        if (!payload) {
          logger.warn('WebSocket 连接被拒绝：无效 token');
          cb(false, 401, 'Unauthorized');
          return;
        }

        cb(true);
      },
    });

    this.wss.on('connection', (ws, req) => {
      logger.info('WebSocket 客户端已连接');

      // 初始空订阅，必须 5s 内发 subscribe 消息（修复 C8）
      wsSubscriptions.set(ws, { serverIds: new Set(), eventTypes: null });
      let subscribed = false;

      const subscribeTimer = setTimeout(() => {
        if (!subscribed) {
          logger.warn('WebSocket 客户端 5 秒内未发 subscribe，关闭连接');
          ws.close(1008, 'Subscribe timeout');
        }
      }, SUBSCRIBE_TIMEOUT_MS);

      ws.on('message', (raw) => {
        try {
          const msg = JSON.parse(raw.toString());
          if (msg.type === 'subscribe') {
            const subs = wsSubscriptions.get(ws);
            if (subs) {
              // serverIds 接受 string[]，空数组 = 不订阅任何 serverId 的事件
              subs.serverIds = new Set(Array.isArray(msg.serverIds) ? msg.serverIds : []);
              // eventTypes 可选；不传或 null = 接收所有类型
              subs.eventTypes = Array.isArray(msg.eventTypes)
                ? new Set(msg.eventTypes)
                : null;
              subscribed = true;
              clearTimeout(subscribeTimer);
              ws.send(
                JSON.stringify({
                  type: 'subscribed',
                  serverIds: Array.from(subs.serverIds),
                  eventTypes: msg.eventTypes ?? null,
                }),
              );
              logger.info(
                {
                  serverIds: Array.from(subs.serverIds),
                  eventTypes: subs.eventTypes ? Array.from(subs.eventTypes) : '(all)',
                },
                'WS 客户端已订阅',
              );
            }
          } else {
            ws.send(
              JSON.stringify({ type: 'error', code: 'invalid_message', message: '未知消息类型' }),
            );
          }
        } catch {
          ws.send(
            JSON.stringify({ type: 'error', code: 'invalid_json', message: '消息非合法 JSON' }),
          );
        }
      });

      ws.on('close', () => {
        clearTimeout(subscribeTimer);
        wsSubscriptions.delete(ws);
        logger.info('WebSocket 客户端已断开');
      });

      ws.on('error', (err) => {
        logger.error({ err }, 'WebSocket 错误');
      });
    });
  }

  broadcast(event: ServerEvent): void {
    const data = JSON.stringify(event);

    for (const [ws, subs] of wsSubscriptions) {
      if (ws.readyState !== WebSocket.OPEN) continue;

      // serverIds 过滤
      if (subs.serverIds.size > 0) {
        if (!('serverId' in event) || !event.serverId) continue;
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
