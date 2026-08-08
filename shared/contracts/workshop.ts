import type { WorkshopFileId } from '../types/branded.js';
import type { WorkshopModMeta } from '../types/domain.js';

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
  browseMods(query: string, page: number): Promise<BrowseResult>;
  refreshCache(modId: WorkshopFileId): Promise<void>;
}
