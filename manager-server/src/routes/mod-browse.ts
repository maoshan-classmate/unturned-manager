import { Router } from 'express';
import {
  ModSearchQuerySchema,
  ModBatchDetailsRequestSchema,
  type IWorkshopMetadataService,
  type WorkshopFileId,
} from '@unturned-manager/shared';
import { authenticateToken } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../middleware/asyncHandler.js';

/**
 * 全局 Mod 浏览路由（v2.3 — 拆分自 mods.ts）
 *
 * Steam 创意工坊浏览是**全局操作**（只需 WebAPI Key + AppID，不依赖服务器实例）。
 * 挂载：/api/mods
 * - GET  /search        浏览/搜索 Steam 工坊（QueryFiles + GetDetails + GetPlayerSummaries）
 * - GET  /:fileId       单个 Mod 详情（GetDetails）
 * - POST /batch-details 批量补元数据（GetDetails 批量）
 */
export function createModBrowseRouter(workshopMeta: IWorkshopMetadataService): Router {
  const router = Router();
  router.use(authenticateToken);

  // ── 1. GET /search ───────────────────────────────────
  router.get(
    '/search',
    validate(ModSearchQuerySchema, 'query'),
    asyncHandler(async (req, res) => {
      const { q, page, pageSize, sort, range, type } = req.query as unknown as {
        q: string; page: number; pageSize: number;
        sort: 'popular' | 'rated' | 'published' | 'updated' | 'subscribed' | 'relevance';
        range: 'day' | 'week' | 'month' | 'months3' | 'months6' | 'year' | 'all';
        type: 'text' | 'id';
      };
      const result = await workshopMeta.browseMods(q, sort, range, type, page, pageSize);
      res.json({
        data: {
          total: result.total,
          page: result.page,
          pageSize: result.pageSize,
          rows: result.mods,
        },
      });
    }),
  );

  // ── 2. GET /:fileId ──────────────────────────────────
  router.get(
    '/:fileId(\\d+)',
    asyncHandler(async (req, res) => {
      const fileId = req.params.fileId as WorkshopFileId;
      const mod = await workshopMeta.getModDetails(fileId);
      if (!mod) {
        res.status(404).json({ error: { code: 'not_found', message: 'Mod 未找到' } });
        return;
      }
      res.json({ data: mod });
    }),
  );

  // ── 3. POST /batch-details ───────────────────────────
  router.post(
    '/batch-details',
    validate(ModBatchDetailsRequestSchema),
    asyncHandler(async (req, res) => {
      const { fileIds } = req.body as { fileIds: WorkshopFileId[] };
      const mods = await workshopMeta.batchGetDetails(fileIds);
      res.json({ data: mods });
    }),
  );

  return router;
}
