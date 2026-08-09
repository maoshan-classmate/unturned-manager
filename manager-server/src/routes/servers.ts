import { Router } from 'express';
import type { IServerManager } from '@unturned-manager/shared';
import { CreateServerSchema, ConfigureServerSchema } from '@unturned-manager/shared';
import { authenticateToken } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../middleware/asyncHandler.js';

export function createServersRouter(serverManager: IServerManager): Router {
  const router = Router();
  router.use(authenticateToken);

  router.get(
    '/',
    asyncHandler(async (_req, res) => {
      const servers = await serverManager.listServers();
      res.json({ data: servers });
    }),
  );

  router.post(
    '/',
    validate(CreateServerSchema),
    asyncHandler(async (req, res) => {
      await serverManager.createServer(req.body);
      res.status(201).json({ data: { message: '服务端创建成功' } });
    }),
  );

  router.patch(
    '/:id',
    validate(ConfigureServerSchema),
    asyncHandler(async (req, res) => {
      await serverManager.configureServer(req.params.id as never, req.body);
      res.json({ data: { message: '配置已更新' } });
    }),
  );

  router.post(
    '/:id/start',
    asyncHandler(async (req, res) => {
      await serverManager.start(req.params.id as never);
      res.status(202).json({ data: { message: '服务端正在启动' } });
    }),
  );

  router.post(
    '/:id/stop',
    asyncHandler(async (req, res) => {
      await serverManager.stop(req.params.id as never, '用户手动停止');
      res.status(202).json({ data: { message: '服务端正在停止' } });
    }),
  );

  router.post(
    '/:id/restart',
    asyncHandler(async (req, res) => {
      await serverManager.restart(req.params.id as never, '用户手动重启');
      res.status(202).json({ data: { message: '服务端正在重启' } });
    }),
  );

  router.delete(
    '/:id',
    asyncHandler(async (req, res) => {
      await serverManager.removeServer(req.params.id as never);
      res.json({ data: { message: '服务端已删除' } });
    }),
  );

  return router;
}
