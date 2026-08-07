import { Router } from 'express';
import type { IServerManager } from '@unturned-manager/shared';
import { authenticateToken } from '../middleware/auth.js';

export function createServersRouter(serverManager: IServerManager): Router {
  const router = Router();
  router.use(authenticateToken);

  router.get('/', async (_req, res) => {
    try {
      const servers = await serverManager.listServers();
      res.json({ data: servers });
    } catch {
      res.status(500).json({ error: { code: 'server_error', message: '获取服务端列表失败' } });
    }
  });

  router.post('/', async (req, res) => {
    try {
      await serverManager.createServer(req.body);
      res.status(201).json({ data: { message: '服务端创建成功' } });
    } catch (err) {
      const msg = err instanceof Error ? err.message : '创建服务端失败';
      res.status(500).json({ error: { code: 'server_error', message: msg } });
    }
  });

  router.patch('/:id', async (req, res) => {
    try {
      await serverManager.configureServer(req.params.id as never, req.body);
      res.json({ data: { message: '配置已更新' } });
    } catch {
      res.status(500).json({ error: { code: 'server_error', message: '配置服务端失败' } });
    }
  });

  router.post('/:id/start', async (req, res) => {
    try {
      await serverManager.start(req.params.id as never);
      res.status(202).json({ data: { message: '服务端正在启动' } });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '启动失败';
      res.status(409).json({ error: { code: 'operation_conflict', message: msg } });
    }
  });

  router.post('/:id/stop', async (req, res) => {
    try {
      await serverManager.stop(req.params.id as never, '用户手动停止');
      res.status(202).json({ data: { message: '服务端正在停止' } });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '停止失败';
      res.status(409).json({ error: { code: 'operation_conflict', message: msg } });
    }
  });

  router.post('/:id/restart', async (req, res) => {
    try {
      await serverManager.restart(req.params.id as never, '用户手动重启');
      res.status(202).json({ data: { message: '服务端正在重启' } });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '重启失败';
      res.status(409).json({ error: { code: 'operation_conflict', message: msg } });
    }
  });

  return router;
}
