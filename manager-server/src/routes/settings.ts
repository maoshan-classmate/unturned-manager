import { Router } from 'express';
import { z } from 'zod';
import Database from 'better-sqlite3';
import { authenticateToken } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import {
  setSteamWebApiKey,
  deleteSteamWebApiKey,
  hasSteamWebApiKey,
} from '../modules/settings/settingsStorage.js';

const SetKeySchema = z.object({
  apiKey: z.string().min(32, 'WebAPI Key 至少 32 字符'),
});

/**
 * 卡 C：WebAPI Key 加密存储端点（HTTP I/O 层）。
 * 业务侧走 `../modules/settings/settingsStorage.ts`，本路由只负责参数校验 + 调用。
 */

const maskKey = (k: string) => {
  if (k.length <= 8) return '****';
  return `${k.slice(0, 4)}...${k.slice(-4)} (len=${k.length})`;
};

export function createSettingsRouter(db: Database.Database): Router {
  const router = Router();
  router.use(authenticateToken);

  router.post(
    '/webapi-key',
    validate(SetKeySchema),
    asyncHandler(async (req, res) => {
      const { apiKey } = req.body as { apiKey: string };
      setSteamWebApiKey(db, apiKey);
      res.json({ data: { message: '已保存', masked: maskKey(apiKey) } });
    }),
  );

  router.get(
    '/webapi-key',
    asyncHandler(async (_req, res) => {
      if (!hasSteamWebApiKey(db)) {
        res.json({ data: { exists: false } });
        return;
      }
      res.json({ data: { exists: true, masked: '****（已配置）' } });
    }),
  );

  router.delete(
    '/webapi-key',
    asyncHandler(async (_req, res) => {
      deleteSteamWebApiKey(db);
      res.json({ data: { message: '已删除' } });
    }),
  );

  return router;
}
