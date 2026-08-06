import { Router } from 'express';
import type { IServerManager } from '@unturned-manager/shared';
import { authenticateToken } from '../middleware/auth.js';

export function createModsRouter(serverManager: IServerManager): Router {
  const router = Router();
  router.use(authenticateToken);

  router.post('/:id/apply', async (req, res) => {
    try {
      const { fileIds } = req.body;
      if (!Array.isArray(fileIds)) {
        res.status(400).json({ error: { code: 'invalid_request', message: '请提供 Mod ID 列表' } });
        return;
      }
      await serverManager.applyModChanges(req.params.id as never, fileIds);
      res.status(202).json({ data: { message: 'Mod 变更正在应用' } });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Mod 变更失败';
      res.status(409).json({ error: { code: 'operation_conflict', message: msg } });
    }
  });

  return router;
}
