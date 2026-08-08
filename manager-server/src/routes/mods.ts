import { Router } from 'express';
import type { IServerManager } from '@unturned-manager/shared';
import { ApplyModsSchema } from '@unturned-manager/shared';
import { authenticateToken } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../middleware/asyncHandler.js';

export function createModsRouter(serverManager: IServerManager): Router {
  const router = Router();
  router.use(authenticateToken);

  router.post(
    '/:id/apply',
    validate(ApplyModsSchema),
    asyncHandler(async (req, res) => {
      const body = req.body as { fileIds: string[] };
      await serverManager.applyModChanges(
        req.params.id as never,
        body.fileIds as never,
      );
      res.status(202).json({ data: { message: 'Mod 变更正在应用，进度由 WS mod_apply_progress 推送' } });
    }),
  );

  return router;
}
