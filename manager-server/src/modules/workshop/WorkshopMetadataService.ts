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
const API_GET_PLAYER_SUMMARIES = `${STEAM_API_BASE}/ISteamUser/GetPlayerSummaries/v2/`;

/** 所有 Steam API 调用的客户端 timeout（20s = Steam 冷启动 QueryFiles 实测需 10-20s） */
const FETCH_TIMEOUT_MS = 20_000;

/** GetPlayerSummaries 作者名查询短超时——辅助信息，失败快速降级，不拖垮主流程 */
const AUTHOR_TIMEOUT_MS = 3_000;

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
      // 单 mod 详情——单独查一次作者名
      const nameMap = await this.getAuthorNames(detail.creator ? [detail.creator] : []);
      return this.toModMeta(detail, nameMap);
    } catch (err) {
      throw mapFetchError(err);
    }
  }

  /**
   * 浏览/搜索 Steam 工坊——两阶段实时调用，0 缓存
   * 1. QueryFiles：获取 ID 列表 + 总数
   * 2. GetDetails：批量拉取元数据
   * 3. GetPlayerSummaries：补全作者昵称
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
        response: { total?: number; publishedfiledetails: Array<{ publishedfileid: string }> };
      };
      const fileIds = (qfJson.response.publishedfiledetails ?? [])
        .map((d) => d.publishedfileid)
        .filter(Boolean);
      const total = qfJson.response.total ?? 0;

      if (fileIds.length === 0) {
        return { mods: [], total, page, pageSize };
      }

      // ── 阶段 2 + 3: 批量 GetDetails + GetPlayerSummaries 补作者 ──
      const mods = await this.batchGetDetails(fileIds as WorkshopFileId[]);
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
      // 优化：一次批量查所有 creator 的昵称（避免每个 mod 单独调 GetPlayerSummaries → 冷启动 N 次超时）
      const creators = [...new Set(valid.map((d) => d.creator).filter((c): c is string => Boolean(c)))];
      const nameMap = await this.getAuthorNames(creators);
      return valid.map((d) => this.toModMeta(d, nameMap));
    } catch (err) {
      throw mapFetchError(err);
    }
  }

  /**
   * 批量查作者昵称（GetPlayerSummaries/v2）
   * 单次最多 100 个 steamids
   *
   * @param steamIds - SteamID64 列表
   * @returns Map<SteamID64, personaName>，查不到时不包含
   */
  async getAuthorNames(steamIds: string[]): Promise<Map<string, string>> {
    const uniqueIds = [...new Set(steamIds.filter(Boolean))];
    if (uniqueIds.length === 0) return new Map();

    const apiKey = getSteamWebApiKey(this.db);
    if (!apiKey) {
      // 无 Key 时降级：所有作者回退到 SteamID64 本身
      return new Map(uniqueIds.map((id) => [id, id]));
    }

    try {
      const url = new URL(API_GET_PLAYER_SUMMARIES);
      url.searchParams.set('key', apiKey);
      uniqueIds.forEach((id) => url.searchParams.append('steamids', id));

      const res = await fetch(url.toString(), {
        // 作者名是辅助信息——短超时(3s)，失败立即降级返回 SteamID，绝不让主流程(browse/detail)超时
        signal: AbortSignal.timeout(AUTHOR_TIMEOUT_MS),
      });
      if (!res.ok) {
        logger.warn({ status: res.status }, 'GetPlayerSummaries 失败，返回 SteamID 作为回退');
        return new Map(uniqueIds.map((id) => [id, id]));
      }

      const json = (await res.json()) as {
        response: { players: Array<{ steamid: string; personaname: string }> };
      };
      const nameMap = new Map<string, string>();
      for (const p of json.response.players ?? []) {
        if (p.steamid && p.personaname) {
          nameMap.set(p.steamid, p.personaname);
        }
      }
      // 缺漏的 id 用 SteamID 本身兜底
      for (const id of uniqueIds) {
        if (!nameMap.has(id)) {
          nameMap.set(id, id);
        }
      }
      return nameMap;
    } catch (err) {
      logger.warn({ err }, 'GetPlayerSummaries 网络错误，返回 SteamID 作为回退');
      return new Map(uniqueIds.map((id) => [id, id]));
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
