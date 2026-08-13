import { z } from 'zod';

// ─── 枚举（对齐 Steam 官方 EPublishedFileQueryType） ─────────

/** 排序：Steam 官方 5 项 + 搜索相关度 */
export const ModSortSchema = z.enum([
  'popular',     // RankedByTrend (3)
  'rated',       // RankedByVote (0)
  'published',   // RankedByPublicationDate (1)
  'updated',     // RankedByLastUpdatedDate (21)
  'subscribed',  // RankedByTotalUniqueSubscriptions (9)
  'relevance',   // RankedByTextSearch (12) — 搜索时自动切换
]);

/** 时间范围：Steam QueryFiles days 参数（仅 popular 生效） */
export const ModTimeRangeSchema = z.enum([
  'day', 'week', 'month', 'months3', 'months6', 'year', 'all',
]);

/** 搜索类型 */
export const ModSearchTypeSchema = z.enum(['text', 'id']);

// ─── 核心数据对象 ─────────────────────────────────────────

/** 单个 Mod 元数据（WebAPI GetDetails/QueryFiles 响应统一格式） */
export const ModInfoSchema = z.object({
  fileId: z.string().regex(/^\d{1,19}$/, 'Workshop File ID 必须为 1-19 位数字'),
  title: z.string().min(1).max(200),
  author: z.string().describe('SteamID64 数字串'),
  authorName: z.string().optional().describe('作者昵称（GetPlayerSummaries 补全）'),
  description: z.string().default('').describe('已 strip BBCode 的纯文本'),
  previewUrl: z.string().url().optional(),
  fileSize: z.number().int().nonnegative().optional(),
  subscriptions: z.number().int().nonnegative().optional(),
  voteScore: z.number().min(0).max(5).optional(),
  votesUp: z.number().int().nonnegative().optional(),
  votesDown: z.number().int().nonnegative().optional(),
  tags: z.array(z.object({ tag: z.string(), displayName: z.string() })).default([]),
  timeCreated: z.number().int().optional(),
  timeUpdated: z.number().int().optional(),
});

/** acf 中已下载 Mod 的本地状态（VDF 解析 + content 目录扫描合并） */
export const DownloadedModSchema = z.object({
  fileId: z.string(),
  localSize: z.number().int().nonnegative().default(0),
  timeupdated: z.number().int().optional(),
  manifest: z.string().optional(),
});

/** acf 真源条目（VDF 解析结果） */
export const WorkshopAcfItemSchema = z.object({
  fileId: z.string(),
  timeupdated: z.number().int(),
  size: z.number().int().nonnegative(),
  manifest: z.string().optional(),
});

// ─── API 请求 schema ─────────────────────────────────────

/** 搜索请求 query 参数 */
export const ModSearchQuerySchema = z.object({
  q: z.string().default(''),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(10),
  sort: ModSortSchema.default('popular'),
  range: ModTimeRangeSchema.default('week'),
  type: ModSearchTypeSchema.default('text'),
});

/** 下载请求 body */
export const ModDownloadRequestSchema = z.object({
  fileId: z.string().regex(/^\d{1,19}$/),
});

/** 批量元数据请求 body */
export const ModBatchDetailsRequestSchema = z.object({
  fileIds: z.array(z.string().regex(/^\d{1,19}$/)).min(1).max(100),
});

// v2.6：ModApplyRequestSchema 已删除——写 File_IDs 走 WriteWorkshopFileIdsSchema
// （config.ts），见 schema/config.schema.ts。

// ─── API 响应 schema ──────────────────────────────────────

/** 搜索响应 */
export const ModSearchResultSchema = z.object({
  total: z.number().int().nonnegative(),
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1),
  rows: z.array(ModInfoSchema),
});

/** 下载响应（同步等待 steamcmd 退出） */
export const ModDownloadResultSchema = z.object({
  success: z.boolean(),
  fileId: z.string(),
  modTitle: z.string().optional(),
  acfItem: WorkshopAcfItemSchema.optional(),
  error: z.string().optional(),
});

/** 删除响应 */
export const ModDeleteResponseSchema = z.object({
  success: z.boolean(),
  fileId: z.string(),
  removedFrom: z.array(z.enum(['acf', 'content', 'file_ids'])),
});

/** acf 列表响应 */
export const ModAcfListResponseSchema = z.object({
  items: z.array(WorkshopAcfItemSchema),
  acfPath: z.string(),
  parsedAt: z.string().datetime(),
});

// ─── WebSocket 事件 schema ───────────────────────────────

export const ModDownloadProgressEventSchema = z.object({
  type: z.literal('mod_download_progress'),
  serverId: z.string(),
  fileId: z.string(),
  stage: z.enum(['spawned', 'downloading', 'verifying', 'completed', 'failed']),
  percent: z.number().min(0).max(100).optional(),
});

export const ModDownloadCompletedEventSchema = z.object({
  type: z.literal('mod_download_completed'),
  serverId: z.string(),
  fileId: z.string(),
  success: z.boolean(),
  acfItem: WorkshopAcfItemSchema.optional(),
  error: z.string().optional(),
});

// v2.6：ModApplyProgressEventSchema 保留但语义收敛——现在仅表示
// 「staging → content 移动进度」，stage 由枚举重新精化为：'ready' / 'failed'。
// 旧的 6 个 stage（broadcasting/saving/stopping/moving/starting 等）已随 applyModChanges
// 删除。详见 docs/architecture/mod-management-design.md §3。
export const ModApplyProgressEventSchema = z.object({
  type: z.literal('mod_apply_progress'),
  serverId: z.string(),
  stage: z.enum(['ready', 'failed']),
  message: z.string().optional(),
});
