import { Router } from 'express';
import type { IFilesService } from '@unturned-manager/shared';
import { authenticateToken } from '../middleware/auth.js';

export function createFilesRouter(filesService: IFilesService): Router {
  const router = Router();
  router.use(authenticateToken);

  router.get('/:id', async (req, res) => {
    try {
      const relativePath = (req.query.path as string) || '';
      const entries = await filesService.listDirectory(req.params.id as never, relativePath);
      res.json({ data: entries });
    } catch {
      res.status(500).json({ error: { code: 'server_error', message: '读取目录失败' } });
    }
  });

  router.post('/:id/upload', async (_req, res) => {
    // Sprint 2: 实现分块上传
    res.status(501).json({ error: { code: 'not_implemented', message: '文件上传将在 Sprint 2 实现' } });
  });

  return router;
}
