import type Database from 'better-sqlite3';
import type {
  WorkshopFileId,
  IWorkshopMetadataService,
  WorkshopModMeta,
  BrowseResult,
} from '@unturned-manager/shared';
import { logger } from '../../utils/logger.js';
import { AppError } from '../../utils/AppError.js';
import { getSteamWebApiKey } from '../settings/settingsStorage.js';

// ─── 常量 ────────────────────────────────────────────────

/** Steam WebAPI 端点（卡 C 修复 C6：`?xml=1` 已废弃——见 research_dst_mod_reference_2026-08-08.md §5.1） */
const STEAM_API_BASE = 'https://api.steampowered.com';
const API_GET_DETAILS = `${STEAM_API_BASE}/IPublishedFileService/GetDetails/v1/`;
const API_QUERY_FILES = `${STEAM_API_BASE}/IPublishedFileService/QueryFiles/v1/`;

/** 缓存 TTL：600s 内直接返回，600-3600s stale-while-revalidate */
const CACHE_FRESH_MS = 600_000;
const CACHE_STALE_MS = 3_600_000;

const FETCH_TIMEOUT_MS = 30_000;

const U3DS_APPID = '1110390';
/** Unturned 客户端 AppID——创意工坊 API 用此 ID 而非服务端 AppID */
const UNTURNED_CLIENT_APPID = '304930';

// ─── 实现 ────────────────────────────────────────────────

export class WorkshopMetadataService implements IWorkshopMetadataService {
  constructor(private db: Database.Database) {}

  async getModDetails(modId: WorkshopFileId): Promise<WorkshopModMeta | null> {
    // 1. 查缓存
    const cached = this.dbGet(modId);
    const now = Date.now();

    if (cached) {
      const cachedAt = (cached as CachedMod & { cached_at?: string }).cached_at
        ?? (cached as CachedMod).cachedAt;
      const age = now - new Date(cachedAt).getTime();
      if (age < CACHE_FRESH_MS) return this.toModMeta(cached);
      if (age < CACHE_STALE_MS) {
        this.refreshInBackground(modId);
        return this.toModMeta(cached);
      }
    }

    // 2. 缓存不可用：拉新数据
    return this.fetchAndCache(modId);
  }

  async searchMods(query: string): Promise<WorkshopModMeta[]> {
    const rows = this.db
      .prepare(
        `SELECT file_id, title, author, description, preview_url, file_size, updated_at_steam, cached_at
         FROM workshop_mods
         WHERE title LIKE ? OR author LIKE ?
         ORDER BY cached_at DESC
         LIMIT 20`,
      )
      .all('%' + query + '%', '%' + query + '%') as CachedMod[];
    return rows.map((r) => this.toModMeta(r));
  }

  /**
   * 浏览 Steam 创意工坊。
   * 空 query = 热门 Mod（按订阅数排序）；传 query = 关键词搜索。
   *
   * @param query - 搜索关键词，空字符串返回热门
   * @param page - 页码，从 1 开始
   * @returns 分页浏览结果
   */
  /**
   * 浏览 Steam 创意工坊——两阶段查询：
   * 1. QueryFiles：获取 ID 列表 + 总数（QueryFiles 不返回 title/creator 等元数据）
   * 2. GetDetails：批量拉取完整元数据
   *
   * @param query - 搜索关键词或 fileId
   * @param sort - 排序：'popular'|'rated'|'published'|'updated'|'subscribed'|'relevance'（映射 Steam query_type）
   * @param timeRange - 时间范围：'day'|'week'|'month'|'months3'|'months6'|'year'|'all'
   *   （映射 QueryFiles days 参数。注意：Steam 官方 days 仅对 RankedByTrend 生效，其余排序 Steam 忽略时间参数）
   * @param searchType - 'text' 按名称/描述；'id' 按 fileId 精确
   * @param page - 页码（1-based）
   * @param pageSize - 每页条数（默认 10，前端可选 10/15/30/50）
   */
  async browseMods(
    query: string,
    sort: 'popular' | 'rated' | 'published' | 'updated' | 'subscribed' | 'relevance' = 'popular',
    timeRange: 'day' | 'week' | 'month' | 'months3' | 'months6' | 'year' | 'all' = 'day',
    searchType: 'text' | 'id' = 'text',
    page: number = 1,
    pageSize: number = 10,
  ): Promise<BrowseResult> {
    const apiKey = getSteamWebApiKey(this.db);
    if (!apiKey) {
      // 不降级缓存——明确告知用户配置缺失
      throw new AppError('workshop-key-missing', '未配置 Steam WebAPI Key，请在系统设置中配置后重试', 503);
    }
    // Steam 官方 EPublishedFileQueryType 枚举（IPublishedFileService/QueryFiles）
    // 依据：https://partner.steamgames.com/doc/webapi/IPublishedFileService
    const sortToQueryType: Record<string, string> = {
      popular: '3', // RankedByTrend 最热门
      rated: '0', // RankedByVote 最受好评（发布至今）
      published: '1', // RankedByPublicationDate 最近发行
      updated: '21', // RankedByLastUpdatedDate 最新更新
      subscribed: '9', // RankedByTotalUniqueSubscriptions 不重复订阅者总计
      relevance: '12', // RankedByTextSearch 搜索相关度（需配合 search_text）
    };

    // 时间范围 → QueryFiles days 参数。
    // Steam 官方文档：days 仅对 RankedByTrend 生效，范围 [1,7]；
    // 其余排序 Steam 自动忽略 days（等效"发布至今"），此为 Steam 原生行为。
    const rangeToDays: Record<string, number> = {
      day: 1, // 今天
      week: 7, // 1 周
      month: 30, // 30 天
      months3: 90, // 3 个月
      months6: 180, // 6 个月
      year: 365, // 1 年
      all: 0, // 发布至今（不传 days）
    };

    try {
      // ── 阶段 1: QueryFiles 获取 ID ──
      const qfParams = new URLSearchParams({
        key: apiKey,
        appid: UNTURNED_CLIENT_APPID,
        numperpage: String(pageSize),
        page: String(page),
        return_vote_data: 'true',
        return_tags: 'false',
        return_children: 'false',
      });

      // query_type 与 sort 绑定：搜索模式下也用 sort 对应的排序字段（用户期望搜过的结果也按选中排序）
      qfParams.set('query_type', sortToQueryType[sort] ?? '9');
      if (query) qfParams.set('search_text', query);
      // 时间范围：仅"最热门"排序 Steam 实际生效（其余排序忽略 days）
      const days = rangeToDays[timeRange] ?? 0;
      if (days > 0) qfParams.set('days', String(days));

      const qfUrl = `${API_QUERY_FILES}?${qfParams.toString()}`;
      const qfRes = await fetch(qfUrl, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });

      if (!qfRes.ok) {
        logger.warn({ status: qfRes.status }, 'QueryFiles 失败');
        throw new AppError('workshop-upstream-error', `Steam QueryFiles 返回异常（HTTP ${qfRes.status}）`, 502);
      }

      const qfJson = (await qfRes.json()) as {
        response: { total?: number; publishedfiledetails: Array<{ publishedfileid: string }> };
      };

      const fileIds = (qfJson.response.publishedfiledetails ?? [])
        .map((d) => d.publishedfileid)
        .filter(Boolean);
      const total = qfJson.response.total ?? 0;

      if (fileIds.length === 0) {
        return { mods: [], total, page, pageSize };
      }

      // ── 阶段 2: GetDetails 批量获取元数据 ──
      const gdParams = new URLSearchParams({ key: apiKey });
      fileIds.forEach((id, i) => gdParams.append(`publishedfileids[${i}]`, id));

      const gdUrl = `${API_GET_DETAILS}?${gdParams.toString()}`;
      const gdRes = await fetch(gdUrl, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });

      if (!gdRes.ok) {
        logger.warn({ status: gdRes.status }, 'GetDetails 批量查询失败');
        throw new AppError('workshop-upstream-error', `Steam GetDetails 返回异常（HTTP ${gdRes.status}）`, 502);
      }

      const gdJson = (await gdRes.json()) as {
        response: {
          publishedfiledetails: Array<{
            publishedfileid: string; result: number;
            title?: string; creator?: string; file_description?: string;
            preview_url?: string; file_size?: number; time_updated?: number;
            subscriptions?: number;
          }>;
        };
      };

      const mods: WorkshopModMeta[] = (gdJson.response.publishedfiledetails ?? [])
        .filter((d) => d.result === 1 && d.title) // result=1 表示成功
        .map((d) => {
          const meta: WorkshopModMeta = {
            fileId: d.publishedfileid as WorkshopFileId,
            title: d.title!,
            author: d.creator ?? 'Unknown',
            description: d.file_description ?? '',
            previewUrl: d.preview_url,
            fileSize: d.file_size,
            updatedAt: d.time_updated ? new Date(d.time_updated * 1000).toISOString() : undefined,
          };
          this.dbUpsert(meta);
          return meta;
        });

      return { mods, total, page, pageSize };
    } catch (err) {
      logger.warn({ query, page, err }, 'Steam API 浏览失败');
      // 明确区分超时与其他网络错误，前端据此展示"请求超时"
      if (err instanceof AppError) throw err;
      const isTimeout =
        err instanceof Error &&
        /timeout|timed out|aborted/i.test(`${err.name} ${err.message}`);
      throw new AppError(
        isTimeout ? 'workshop-timeout' : 'workshop-upstream-error',
        isTimeout ? '请求 Steam 创意工坊超时，请稍后重试' : `无法访问 Steam 创意工坊：${err instanceof Error ? err.message : '未知错误'}`,
        isTimeout ? 504 : 502,
      );
    }
  }

  async refreshCache(modId: WorkshopFileId): Promise<void> {
    await this.fetchAndCache(modId);
  }

  // ── 私有 ──────────────────────────────────────────────

  private dbGet(modId: WorkshopFileId): CachedMod | null {
    const row = this.db
      .prepare('SELECT * FROM workshop_mods WHERE file_id = ?')
      .get(modId) as CachedMod | undefined;
    return row ?? null;
  }

  private dbUpsert(meta: WorkshopModMeta): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO workshop_mods
         (file_id, title, author, description, preview_url, file_size, updated_at_steam, cached_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      )
      .run(
        meta.fileId,
        meta.title,
        meta.author,
        meta.description,
        meta.previewUrl ?? null,
        meta.fileSize ?? null,
        meta.updatedAt ?? null,
      );
  }

  private toModMeta(row: CachedMod): WorkshopModMeta {
    return {
      fileId: row.file_id as WorkshopFileId,
      title: row.title,
      author: row.author,
      description: row.description,
      previewUrl: row.preview_url ?? undefined,
      fileSize: row.file_size ?? undefined,
      updatedAt: row.updated_at_steam ?? undefined,
    };
  }

  /**
   * 卡 C：WebAPI Key 优先；无则降级零凭证（仅保留 try，参考 research 报告）
   *
   * IPublishedFileService/GetDetails/v1（key required）
   * 返回结构：response.publishedfiledetails = Array<{
   *   publishedfileid, title, creator, file_description, preview_url,
   *   file_size, time_updated, ...
   * }>
   */
  private async fetchAndCache(modId: WorkshopFileId): Promise<WorkshopModMeta | null> {
    const apiKey = getSteamWebApiKey(this.db);
    if (!apiKey) {
      logger.warn({ modId }, 'WebAPI Key 未配置，getModDetails 走 DB 缓存（不命中则返 null）');
      return null;
    }
    const url = `${API_GET_DETAILS}?key=${encodeURIComponent(apiKey)}&publishedfileids[]=${encodeURIComponent(modId)}`;
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!res.ok) {
        logger.warn({ modId, status: res.status }, 'IPublishedFileService/GetDetails 失败');
        return null;
      }
      const json = (await res.json()) as {
        response: { publishedfiledetails: Array<{
          publishedfileid: string;
          title?: string;
          creator?: string;
          file_description?: string;
          preview_url?: string;
          file_size?: number;
          time_updated?: number;
        }> };
      };
      const detail = json.response.publishedfiledetails[0];
      if (!detail || !detail.title) {
        return null;
      }
      const meta: WorkshopModMeta = {
        fileId: modId,
        title: detail.title,
        author: detail.creator ?? 'Unknown',
        description: detail.file_description ?? '',
        previewUrl: detail.preview_url,
        fileSize: detail.file_size,
        updatedAt: detail.time_updated
          ? new Date(detail.time_updated * 1000).toISOString()
          : undefined,
      };
      this.dbUpsert(meta);
      return meta;
    } catch (err) {
      logger.warn({ modId, err }, 'IPublishedFileService 网络错误');
      return null;
    }
  }

  private refreshInBackground(modId: WorkshopFileId): void {
    this.fetchAndCache(modId).catch((err) => {
      logger.warn({ modId, err }, '后台刷新 Mod 元数据失败');
    });
  }
}

// ─── 内部类型 ────────────────────────────────────────────

interface CachedMod {
  file_id: string;
  title: string;
  author: string;
  description: string;
  preview_url: string | null;
  file_size: number | null;
  updated_at_steam: string | null;
  cachedAt: string;
  cached_at?: string;
}
