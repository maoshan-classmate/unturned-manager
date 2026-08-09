import type { WorkshopFileId, ServerId } from '../types/branded.js';
import type { WorkshopModMeta, WorkshopAcf, WorkshopAcfItem } from '../types/domain.js';

// ─── 枚举（提前定义供 v1 向后兼容别名使用） ──────────────

/** 排序方式——Steam 客户端创意工坊官方 5 项 + 搜索相关度，映射 EPublishedFileQueryType */
export type ModSort =
  | 'popular' // 最热门（RankedByTrend）
  | 'rated' // 最受好评（发布至今）（RankedByVote）
  | 'published' // 最近发行（RankedByPublicationDate）
  | 'updated' // 最新更新（RankedByLastUpdatedDate）
  | 'subscribed' // 不重复订阅者总计（RankedByTotalUniqueSubscriptions）
  | 'relevance'; // 搜索相关度（RankedByTextSearch，搜索时自动切换）

/** 时间范围——Steam 客户端官方 7 档，映射 QueryFiles days 参数（仅最热门排序生效） */
export type ModTimeRange =
  | 'day' // 今天
  | 'week' // 1 周
  | 'month' // 30 天
  | 'months3' // 3 个月
  | 'months6' // 6 个月
  | 'year' // 1 年
  | 'all'; // 发布至今

/** 搜索类型 */
export type ModSearchType = 'text' | 'id';

// ─── v1 向后兼容别名（routes/workshop.ts 旧版仍引用） ────

/** @deprecated use ModSort */
export type BrowseSort = ModSort;
/** @deprecated use ModTimeRange */
export type BrowseTimeRange = ModTimeRange;
/** @deprecated use ModSearchType */
export type BrowseSearchType = ModSearchType;

/** 浏览结果——带分页 */
export interface BrowseResult {
  mods: WorkshopModMeta[];
  total: number;
  page: number;
  pageSize: number;
}

// ─── 核心域服务接口 ─────────────────────────────────────

/** 单个 Mod 下载结果（同步等待 SteamCMD 退出后回传） */
export interface ModDownloadResult {
  success: boolean;
  fileId: WorkshopFileId;
  modTitle?: string;
  acfItem?: WorkshopAcfItem;
  error?: string;
}

/** Mod 删除结果 */
export interface ModDeleteResult {
  success: boolean;
  fileId: WorkshopFileId;
  removedFrom: Array<'acf' | 'content' | 'file_ids'>;
}

// ─── 核心域服务接口 ─────────────────────────────────────

/**
 * Mod 元数据服务——对齐 Steam WebAPI（IPublishedFileService）
 * v2.2 决策：0 缓存（单用户系统 + DST 哲学：真源唯一）
 */
export interface IWorkshopMetadataService {
  /** 单个 Mod 详情——实时调 GetDetails/v1，0 缓存 */
  getModDetails(modId: WorkshopFileId): Promise<WorkshopModMeta | null>;

  /** 浏览/搜索 Steam 工坊——实时两阶段（QueryFiles→GetDetails）+ 8s timeout */
  browseMods(
    query: string,
    sort: ModSort,
    timeRange: ModTimeRange,
    searchType: ModSearchType,
    page: number,
    pageSize: number,
  ): Promise<BrowseResult>;

  /** 批量 GetDetails——已下载列表显示用 */
  batchGetDetails(fileIds: WorkshopFileId[]): Promise<WorkshopModMeta[]>;

  /** 批量查作者昵称（GetPlayerSummaries/v2） */
  getAuthorNames(steamIds: string[]): Promise<Map<string, string>>;
}

/**
 * acf 真源维护服务——对齐 DST utils/acf.go
 * v2.2 决策：每次实时读盘解析，0 缓存
 */
export interface IWorkshopAcfService {
  /** 读盘 + 解析 acf 文件——每次都重新读，0 缓存 */
  parse(serverId: ServerId): Promise<WorkshopAcf>;

  /** 原子写 acf + 自动备份 */
  write(serverId: ServerId, acf: WorkshopAcf): Promise<void>;

  /** 列出全部已下载 mod（read → parse） */
  listItems(serverId: ServerId): Promise<WorkshopAcfItem[]>;

  /** 读 staging 目录的 acf，提取单个 mod 的元数据（下载完成后调） */
  parseStagingItem(serverId: ServerId, fileId: WorkshopFileId): Promise<WorkshopAcfItem | null>;

  /** 添加 mod 到 acf（apply 流水线内调用） */
  addItem(serverId: ServerId, fileId: WorkshopFileId, meta: WorkshopAcfItem): Promise<void>;

  /** 从 acf 删除项（delete 端点调用） */
  removeItem(serverId: ServerId, fileId: WorkshopFileId): Promise<void>;

  /** 手动备份 acf（apply 流水线前置） */
  backup(serverId: ServerId): Promise<string>;

  /** 失败回滚 */
  rollback(serverId: ServerId, backupPath: string): Promise<void>;
}

/**
 * apply 流水线服务——staging → content 移动 + acf 合并
 * v2.2 决策：在 ServerManager.applyModChanges 流水线内、U3DS STOPPED 后调用
 */
export interface IWorkshopApplyService {
  /** 移动 staging 内容 + acf 合并 + File_IDs 同步；任一失败全回滚 */
  applyStaged(serverId: ServerId): Promise<void>;
}

/**
 * Mod 删除服务——acf + content + File_IDs 三处同步
 */
export interface IWorkshopDeleteService {
  /** 删除单个 Mod（acf 删项 + content 目录删 + File_IDs 同步） */
  deleteMod(serverId: ServerId, fileId: WorkshopFileId): Promise<ModDeleteResult>;
}
