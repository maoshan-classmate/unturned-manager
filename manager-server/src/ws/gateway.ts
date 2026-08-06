import { WebSocketServer, WebSocket } from 'ws';
import { Server } from 'http';
import type { IBroadcaster, ServerEvent, ServerId } from '@unturned-manager/shared';
import type { AuthService } from '../modules/auth/AuthService.js';
import { logger } from '../utils/logger.js';

// 每个 ws 连接订阅的 serverId 集合
const wsSubscriptions = new Map<WebSocket, Set<string>>();

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

      wsSubscriptions.set(ws, new Set());

      ws.on('close', () => {
        wsSubscriptions.delete(ws);
        logger.info('WebSocket 客户端已断开');
      });

      ws.on('error', (err) => {
        logger.error({ err }, 'WebSocket 错误');
      });
    });
  }

  broadcast(event: ServerEvent): void {
    const serverId = 'serverId' in event ? (event as { serverId: string }).serverId : null;
    const data = JSON.stringify(event);

    for (const [ws, subscriptions] of wsSubscriptions) {
      if (ws.readyState !== WebSocket.OPEN) continue;
      // 如果事件有 serverId，只推送给订阅了该 serverId 的连接
      if (serverId && !subscriptions.has(serverId)) continue;
      ws.send(data);
    }
  }

  register(ws: WebSocket, serverIds: ServerId[]): void {
    const subs = wsSubscriptions.get(ws);
    if (subs) {
      for (const id of serverIds) subs.add(id);
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
