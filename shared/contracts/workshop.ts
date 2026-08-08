import type { WorkshopFileId } from '../types/branded.js';
import type { WorkshopModMeta } from '../types/domain.js';

/** 排序方式——Steam 客户端创意工坊官方 5 项 + 搜索相关度，映射 EPublishedFileQueryType */
export type BrowseSort =
  | 'popular' // 最热门（RankedByTrend）
  | 'rated' // 最受好评（发布至今）（RankedByVote）
  | 'published' // 最近发行（RankedByPublicationDate）
  | 'updated' // 最新更新（RankedByLastUpdatedDate）
  | 'subscribed' // 不重复订阅者总计（RankedByTotalUniqueSubscriptions）
  | 'relevance'; // 搜索相关度（RankedByTextSearch，搜索时自动切换）

/** 时间范围——Steam 客户端官方 7 档，映射 QueryFiles days 参数（仅最热门排序生效） */
export type BrowseTimeRange =
  | 'day' // 今天
  | 'week' // 1 周
  | 'month' // 30 天
  | 'months3' // 3 个月
  | 'months6' // 6 个月
  | 'year' // 1 年
  | 'all'; // 发布至今

/** 搜索类型 */
export type BrowseSearchType = 'text' | 'id';

/** 浏览结果——带分页 */
export interface BrowseResult {
  mods: WorkshopModMeta[];
  total: number;
  page: number;
  pageSize: number;
}

export interface IWorkshopMetadataService {
  getModDetails(modId: WorkshopFileId): Promise<WorkshopModMeta | null>;
  searchMods(query: string): Promise<WorkshopModMeta[]>;
  /** 浏览创意工坊——空 query = 热门 Mod；传 query = 搜索 */
  browseMods(
    query: string,
    sort: BrowseSort,
    timeRange: BrowseTimeRange,
    searchType: BrowseSearchType,
    page: number,
    pageSize: number,
  ): Promise<BrowseResult>;
  refreshCache(modId: WorkshopFileId): Promise<void>;
}
