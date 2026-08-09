import type Database from 'better-sqlite3';
import type {
  WorkshopFileId,
  IWorkshopMetadataService,
  WorkshopModMeta,
  BrowseResult,
  ModSort,
  ModTimeRange,
  ModSearchType,
} from '@unturned-manager/shared';
import { logger } from '../../utils/logger.js';
import { AppError } from '../../utils/AppError.js';
import { getSteamWebApiKey } from '../settings/settingsStorage.js';

// ─── 常量 ────────────────────────────────────────────────

/** Steam WebAPI 端点 */
const STEAM_API_BASE = 'https://api.steampowered.com';
const API_GET_DETAILS = `${STEAM_API_BASE}/IPublishedFileService/GetDetails/v1/`;
const API_QUERY_FILES = `${STEAM_API_BASE}/IPublishedFileService/QueryFiles/v1/`;

/** 所有 Steam API 调用的客户端 timeout（30s = 冷启动 QueryFiles 留足余量） */
const FETCH_TIMEOUT_MS = 30_000;

/** U3DS AppID = 1110390（服务端） */
const U3DS_APPID = '1110390';
/** Unturned 客户端 AppID = 304930（Workshop 搜索用此 ID） */
const UNTURNED_CLIENT_APPID = '304930';

// ─── 实现 ────────────────────────────────────────────────

export class WorkshopMetadataService implements IWorkshopMetadataService {
  /**
   * @param db - SQLite 数据库实例（用于读 WebAPI Key，不存任何缓存）
   */
  constructor(private db: Database.Database) {}

  /**
   * 单个 Mod 详情——实时调 Steam GetDetails/v1，**0 缓存**（v2.0 决策）
   *
   * @param modId - Workshop File ID
   * @returns Mod 元数据；未配置 Key 时抛 503
   * @throws {AppError} code: workshop-key-missing | workshop-upstream-error | workshop-timeout
   */
  async getModDetails(modId: WorkshopFileId): Promise<WorkshopModMeta | null> {
    const apiKey = getSteamWebApiKey(this.db);
    if (!apiKey) {
      throw new AppError('workshop-key-missing', '未配置 Steam WebAPI Key，请在系统设置中配置后重试', 503);
    }

    const url = new URL(API_GET_DETAILS);
    url.searchParams.set('key', apiKey);
    // 必须带索引（publishedfileids[0]=）——[] 无索引格式 Steam 连接异常（实测 10.7s 超时 vs [0] 1.6s）
    url.searchParams.append('publishedfileids[0]', modId);
    url.searchParams.set('strip_description_bbcode', 'true');

    try {
      const res = await fetch(url.toString(), {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!res.ok) {
        throw new AppError('workshop-upstream-error', `Steam GetDetails 返回异常（HTTP ${res.status}）`, 502);
      }

      const json = (await res.json()) as {
        response: { publishedfiledetails: Array<RawModDetail> };
      };
      const detail = json.response.publishedfiledetails[0];
      if (!detail || detail.result !== 1 || !detail.title) {
        return null;
      }
      return this.toModMeta(detail, new Map());
    } catch (err) {
      throw mapFetchError(err);
    }
  }

  /**
   * 浏览/搜索 Steam 工坊——单次 QueryFiles 实时调用，0 缓存
   * QueryFiles 一次返回全字段（title/creator/description/preview/vote_data），无需二次调用
   *
   * @param query - 搜索关键词或 fileId
   * @param sort - 排序方式（映射 Steam query_type）
   * @param timeRange - 时间范围（仅 popular 生效）
   * @param searchType - 'text' 按名称/描述；'id' 按 fileId 精确
   * @param page - 页码（1-based）
   * @param pageSize - 每页条数（默认 10，前端可选 10/15/30/50）
   */
  async browseMods(
    query: string,
    sort: ModSort = 'popular',
    timeRange: ModTimeRange = 'day',
    _searchType: ModSearchType = 'text',
    page: number = 1,
    pageSize: number = 10,
  ): Promise<BrowseResult> {
    const apiKey = getSteamWebApiKey(this.db);
    if (!apiKey) {
      throw new AppError('workshop-key-missing', '未配置 Steam WebAPI Key，请在系统设置中配置后重试', 503);
    }

    // 排序 → Steam query_type 映射
    const sortToQueryType: Record<ModSort, string> = {
      popular: '3',      // RankedByTrend
      rated: '0',        // RankedByVote
      published: '1',    // RankedByPublicationDate
      updated: '21',     // RankedByLastUpdatedDate
      subscribed: '9',   // RankedByTotalUniqueSubscriptions
      relevance: '12',   // RankedByTextSearch
    };

    // 时间范围 → QueryFiles days 参数（0 = 不传 days）
    const rangeToDays: Record<ModTimeRange, number> = {
      day: 1, week: 7, month: 30, months3: 90, months6: 180, year: 365, all: 0,
    };

    try {
      // ── 阶段 1: QueryFiles 获取 ID ──
      const qfUrl = new URL(API_QUERY_FILES);
      qfUrl.searchParams.set('key', apiKey);
      qfUrl.searchParams.set('appid', UNTURNED_CLIENT_APPID);
      qfUrl.searchParams.set('numperpage', String(pageSize));
      qfUrl.searchParams.set('page', String(page));
      qfUrl.searchParams.set('return_vote_data', 'true');
      qfUrl.searchParams.set('return_tags', 'true');
      qfUrl.searchParams.set('return_children', 'false');
      qfUrl.searchParams.set('query_type', sortToQueryType[sort] ?? '9');
      if (query) qfUrl.searchParams.set('search_text', query);
      const days = rangeToDays[timeRange] ?? 0;
      if (days > 0) qfUrl.searchParams.set('days', String(days));

      const qfRes = await fetch(qfUrl.toString(), {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!qfRes.ok) {
        throw new AppError('workshop-upstream-error', `Steam QueryFiles 返回异常（HTTP ${qfRes.status}）`, 502);
      }
      const qfJson = (await qfRes.json()) as {
        response: {
          total?: number;
          publishedfiledetails: Array<QueryFileDetail>;
        };
      };
      const qfDetails = qfJson.response.publishedfiledetails ?? [];
      const total = qfJson.response.total ?? 0;

      if (qfDetails.length === 0) {
        return { mods: [], total, page, pageSize };
      }

      // QueryFiles 单次返回全字段（title/creator/description/preview/vote_data），
      // 不二次调 GetDetails——避免两阶段叠加超时。
      const mods: WorkshopModMeta[] = qfDetails.map((d) => {
        const v = d.vote_data;
        return {
          fileId: d.publishedfileid as WorkshopFileId,
          title: d.title ?? '',
          author: d.creator ?? '',
          description: d.file_description ?? '',
          previewUrl: d.preview_url,
          fileSize: d.file_size,
          updatedAt: d.time_updated ? new Date(d.time_updated * 1000).toISOString() : undefined,
          // 评分：Steam score 是 0-1，转 0-5
          voteScore: v?.score != null ? v.score * 5 : undefined,
        };
      });

      return { mods, total, page, pageSize };
    } catch (err) {
      throw mapFetchError(err);
    }
  }

  /**
   * 批量 GetDetails——已下载列表显示用
   *
   * @param fileIds - Workshop File ID 列表（最多 100 个）
   * @returns Mod 元数据列表（过滤 result !== 1 的）
   */
  async batchGetDetails(fileIds: WorkshopFileId[]): Promise<WorkshopModMeta[]> {
    if (fileIds.length === 0) return [];
    const apiKey = getSteamWebApiKey(this.db);
    if (!apiKey) {
      throw new AppError('workshop-key-missing', '未配置 Steam WebAPI Key，请在系统设置中配置后重试', 503);
    }

    try {
      const url = new URL(API_GET_DETAILS);
      url.searchParams.set('key', apiKey);
      url.searchParams.set('strip_description_bbcode', 'true');
      fileIds.forEach((id, i) => url.searchParams.append(`publishedfileids[${i}]`, id));

      const res = await fetch(url.toString(), {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!res.ok) {
        throw new AppError('workshop-upstream-error', `Steam GetDetails 返回异常（HTTP ${res.status}）`, 502);
      }

      const json = (await res.json()) as {
        response: { publishedfiledetails: Array<RawModDetail> };
      };
      const valid = (json.response.publishedfiledetails ?? []).filter(
        (d) => d.result === 1 && d.title,
      );
      // 批量场景只返回主数据，不查作者名（避免额外调用叠加耗时）
      return valid.map((d) => this.toModMeta(d, new Map()));
    } catch (err) {
      throw mapFetchError(err);
    }
  }

  // ── 私有 ──────────────────────────────────────────────

  /**
   * 单个 raw mod detail → WorkshopModMeta（作者名从预查的 nameMap 取）
   */
  private toModMeta(d: RawModDetail, nameMap: Map<string, string>): WorkshopModMeta {
    return {
      fileId: d.publishedfileid as WorkshopFileId,
      title: d.title ?? '',
      author: d.creator ?? '',
      authorName: nameMap.get(d.creator ?? '') ?? d.creator ?? '',
      description: d.file_description ?? '',
      previewUrl: d.preview_url,
      fileSize: d.file_size,
      updatedAt: d.time_updated ? new Date(d.time_updated * 1000).toISOString() : undefined,
      // 评分——Steam vote_data.score 是 0-1 的小数，转 0-5 星级
      voteScore: d.vote_data?.score != null ? d.vote_data.score * 5 : undefined,
    };
  }
}

// ─── 内部类型 ────────────────────────────────────────────

/** Steam GetDetails 响应的 raw 字段（按需扩展） */
interface RawModDetail {
  publishedfileid: string;
  result: number;
  title?: string;
  creator?: string;
  file_description?: string;
  preview_url?: string;
  file_size?: number;
  time_updated?: number;
  time_created?: number;
  subscriptions?: number;
  vote_data?: { score?: number; votes_up?: number; votes_down?: number };
  tags?: Array<{ tag: string; display_name: string }>;
}

/** QueryFiles 返回的单条（QueryFiles 一次返回全字段，无需二次 GetDetails） */
interface QueryFileDetail {
  publishedfileid: string;
  title?: string;
  creator?: string;
  file_description?: string;
  preview_url?: string;
  file_size?: number;
  time_updated?: number;
  vote_data?: { score?: number; votes_up?: number; votes_down?: number };
}

// ─── 错误映射 ────────────────────────────────────────────

function mapFetchError(err: unknown): AppError {
  if (err instanceof AppError) return err;
  const isTimeout =
    err instanceof Error &&
    /timeout|timed out|aborted/i.test(`${err.name} ${err.message}`);
  return new AppError(
    isTimeout ? 'workshop-timeout' : 'workshop-upstream-error',
    isTimeout
      ? '请求 Steam 创意工坊超时，请稍后重试'
      : `无法访问 Steam 创意工坊：${err instanceof Error ? err.message : '未知错误'}`,
    isTimeout ? 504 : 502,
  );
}
