import { Router } from 'express';
import type { IWorkshopMetadataService } from '@unturned-manager/shared';
import { authenticateToken } from '../middleware/auth.js';

export function createWorkshopRouter(workshopMeta: IWorkshopMetadataService): Router {
  const router = Router();
  router.use(authenticateToken);

  router.get('/mods/:fileId', async (req, res) => {
    try {
      const mod = await workshopMeta.getModDetails(req.params.fileId as never);
      if (!mod) {
        res.status(404).json({ error: { code: 'not_found', message: 'Mod 未找到' } });
        return;
      }
      res.json({ data: mod });
    } catch {
      res.status(500).json({ error: { code: 'server_error', message: '获取 Mod 详情失败' } });
    }
  });

  return router;
}
