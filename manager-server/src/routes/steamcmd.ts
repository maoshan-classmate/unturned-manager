import { Router } from 'express';
import { z } from 'zod';
import type { ISteamCmdManager } from '@unturned-manager/shared';
import { authenticateToken } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { AppError } from '../utils/AppError.js';

const UpdateSchema = z.object({
  installDir: z.string().min(1, '安装路径不能为空'),
});

const DownloadSchema = z.object({
  installDir: z.string().min(1),
  itemIds: z.array(z.string()).min(1),
});

export function createSteamCmdRouter(steamCmdManager: ISteamCmdManager): Router {
  const router = Router();
  router.use(authenticateToken);

  router.get(
    '/status',
    asyncHandler(async (_req, res) => {
      const status = await steamCmdManager.getStatus();
      res.json({ data: status });
    }),
  );

  router.post(
    '/update',
    validate(UpdateSchema),
    asyncHandler(async (req, res) => {
      const { installDir } = req.body as { installDir: string };
      try {
        await steamCmdManager.updateU3DS(installDir);
        res.status(202).json({ data: { message: 'U3DS 更新已启动，进度由 WS steamcmd_progress 推送' } });
      } catch (err) {
        if (err instanceof Error && err.message.includes('运行')) {
          throw new AppError('operation_conflict', err.message, 409);
        }
        throw err;
      }
    }),
  );

  // 卡 C #6：Workshop 内容下载（下载到 staging，可不停服；应用由卡 B 流水线）
  router.post(
    '/download-workshop',
    validate(DownloadSchema),
    asyncHandler(async (req, res) => {
      const { installDir, itemIds } = req.body as { installDir: string; itemIds: string[] };
      await steamCmdManager.downloadWorkshopItem(installDir, itemIds);
      res.status(202).json({ data: { message: 'Mod 下载已启动' } });
    }),
  );

  return router;
}
