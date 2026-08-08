import { Router } from 'express';
import type { IWorkshopMetadataService } from '@unturned-manager/shared';
import { authenticateToken } from '../middleware/auth.js';

export function createWorkshopRouter(workshopMeta: IWorkshopMetadataService): Router {
  const router = Router();
  router.use(authenticateToken);

  /** 获取单个 Mod 详情（by Workshop File ID） */
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

  /** 浏览/搜索 Steam 创意工坊 Mod（Unturned AppID 1110390） */
  router.get('/browse', async (req, res) => {
    try {
      const query = typeof req.query.q === 'string' ? req.query.q : '';
      const page = Math.max(1, parseInt(String(req.query.page ?? '1'), 10) || 1);
      const mods = await workshopMeta.browseMods(query, page);
      res.json({ data: mods });
    } catch {
      res.status(500).json({ error: { code: 'server_error', message: '浏览创意工坊失败' } });
    }
  });

  return router;
}
