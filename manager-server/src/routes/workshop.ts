import { Router } from 'express';
import type {
  IWorkshopMetadataService,
  BrowseSort,
  BrowseTimeRange,
  BrowseSearchType,
} from '@unturned-manager/shared';
import { authenticateToken } from '../middleware/auth.js';

const SORT_VALUES: BrowseSort[] = ['popular', 'rated', 'published', 'updated', 'subscribed', 'relevance'];
const RANGE_VALUES: BrowseTimeRange[] = ['day', 'week', 'month', 'months3', 'months6', 'year', 'all'];
const SEARCH_TYPE_VALUES: BrowseSearchType[] = ['text', 'id'];

export function createWorkshopRouter(workshopMeta: IWorkshopMetadataService): Router {
  const router = Router();
  router.use(authenticateToken);

  /** 获取单个 Mod 详情（by Workshop File ID） */
  router.get('/mods/:fileId', async (req, res, next) => {
    try {
      const mod = await workshopMeta.getModDetails(req.params.fileId as never);
      if (!mod) {
        res.status(404).json({ error: { code: 'not_found', message: 'Mod 未找到' } });
        return;
      }
      res.json({ data: mod });
    } catch (err) {
      next(err);
    }
  });

  /** 浏览/搜索 Steam 创意工坊 Mod
   * @param q - 搜索关键词（按名称/描述）或 fileId（按搜索类型）
   * @param sort - 排序：popular|rated|published|updated|subscribed
   * @param range - 时间范围：day|week|month|months3|months6|year|all
   * @param type - 搜索类型：text（按名称）或 id（按 fileId）
   * @param page - 页码（1-based）
   */
  router.get('/browse', async (req, res, next) => {
    try {
      const query = typeof req.query.q === 'string' ? req.query.q : '';
      const sortRaw = typeof req.query.sort === 'string' ? req.query.sort : 'popular';
      const sort: BrowseSort = (SORT_VALUES as string[]).includes(sortRaw) ? (sortRaw as BrowseSort) : 'popular';
      const rangeRaw = typeof req.query.range === 'string' ? req.query.range : 'week';
      const timeRange: BrowseTimeRange = (RANGE_VALUES as string[]).includes(rangeRaw) ? (rangeRaw as BrowseTimeRange) : 'week';
      const typeRaw = typeof req.query.type === 'string' ? req.query.type : 'text';
      const searchType: BrowseSearchType = (SEARCH_TYPE_VALUES as string[]).includes(typeRaw) ? (typeRaw as BrowseSearchType) : 'text';
      const page = Math.max(1, parseInt(String(req.query.page ?? '1'), 10) || 1);
      // 每页条数：前端可选 10/15/30/50，默认 10，钳制到 [1, 100]
      const pageSize = Math.min(100, Math.max(1, parseInt(String(req.query.pageSize ?? '10'), 10) || 10));
      const mods = await workshopMeta.browseMods(query, sort, timeRange, searchType, page, pageSize);
      res.json({ data: mods });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
