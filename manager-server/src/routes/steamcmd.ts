import { Router } from 'express';
import type { ISteamCmdManager } from '@unturned-manager/shared';
import { authenticateToken } from '../middleware/auth.js';

export function createSteamCmdRouter(steamCmdManager: ISteamCmdManager): Router {
  const router = Router();
  router.use(authenticateToken);

  router.get('/status', async (_req, res) => {
    try {
      const status = await steamCmdManager.getStatus();
      res.json({ data: status });
    } catch {
      res.status(500).json({ error: { code: 'server_error', message: '获取 SteamCMD 状态失败' } });
    }
  });

  router.post('/update', async (req, res) => {
    try {
      const { installDir } = req.body;
      if (!installDir || typeof installDir !== 'string') {
        res.status(400).json({ error: { code: 'invalid_request', message: '请提供安装路径' } });
        return;
      }
      await steamCmdManager.updateU3DS(installDir);
      res.status(202).json({ data: { message: 'U3DS 更新已启动' } });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '更新失败';
      res.status(409).json({ error: { code: 'operation_conflict', message: msg } });
    }
  });

  return router;
}
