import { z } from 'zod';

// ─── Commands.dat ──────────────────────────────────────

/** 已知的 Commands.dat 字段名集合（来源：reference_config_files.md §1） */
export const KNOWN_COMMAND_KEYS = [
  'Name', 'Port', 'MaxPlayers', 'Map', 'Mode', 'Owner',
  'Perspective', 'Chatrate', 'Cycle', 'Timeout', 'Queue_Size',
  'Filter', 'Whitelisted', 'Gold', 'Hide_Admins', 'Sync',
  'Cheats', 'GSLT', 'Log', 'Votify', 'Password', 'PvE', 'Bind',
  'Loadout',
] as const;

/** 纯开关型字段（无 value，出现即启用） */
export const FLAG_ONLY_KEYS = new Set([
  'Filter', 'Whitelisted', 'Gold', 'Hide_Admins', 'Sync', 'Cheats', 'PvE',
]);

/** 允许重复出现的已知键（每条独立写一行） */
export const REPEATABLE_KEYS = new Set(['Loadout']);

/**
 * 单条 Loadout 行结构（CommandLoadout.cs:13-49 / PlayerSkills.cs:43-97）。
 * 权威约束：SkillsetID ∈ {0,1,2,3,4,5,6,7,8,9,10,255}（255 = 所有技能组），
 *           ItemID ∈ [0, 65535] ushort。同一 SkillsetID 多行 = 后写覆盖前写。
 */
export const LoadoutEntrySchema = z.object({
  /** 0–10 = 11 个技能组，255 = 所有技能组 */
  skillsetId: z.number().int().min(0).max(255),
  /** 该技能组开局携带的物品 ID 列表；空数组表示该技能组无物品加成 */
  itemIds: z.array(z.number().int().min(0).max(65535)),
});

export const CommandsDatRecordSchema = z.object({
  known: z.record(z.string(), z.string()),
  unknown: z.record(z.string(), z.string()),
  comments: z.array(z.string()),
  /** Loadout 重复行结构化结果——格式：Loadout <SkillsetID>/<itemID>/<itemID>... */
  loadouts: z.array(LoadoutEntrySchema).optional(),
});

// ─── Config.txt ────────────────────────────────────────

export const ConfigEntrySchema = z.object({
  key: z.string(),
  value: z.string().nullable(),
  comment: z.string().nullable(),
  known: z.boolean(),
  type: z.enum(['string', 'bool', 'int']).optional(),
});

export const ConfigSectionSchema = z.object({
  name: z.string(),
  entries: z.array(ConfigEntrySchema),
  /** U3DS 原生未知结构（[ ] 列表 / 嵌套 { } 块）原始文本块——面板只读保留，round-trip 不丢 */
  rawBlocks: z.array(z.string()).optional(),
});

export const ConfigTxtRecordSchema = z.object({
  sections: z.record(z.string(), ConfigSectionSchema),
});

// ─── WorkshopDownloadConfig.json ───────────────────────

/**
 * 单个 File_ID 的 schema 元素。
 *
 * ★ 2026-08-14 实机根因：U3-SDK `WorkshopDownloadConfig.cs:30` 用 `List<ulong>`，
 * Unity JsonUtility 把 ulong 序列化为 JSON number（非字符串）。
 * 面板 acf 解析走 VDF 文本 `Object.entries` 永远返回 string keys。
 * 跨语言类型不对齐是必然，必须在 schema 层归一。
 */
const FileIdSchema = z.union([z.string(), z.number()]).transform((v) =>
  String(v),
);

export const WorkshopConfigSchema = z.object({
  File_IDs: z.array(FileIdSchema),
  Should_Monitor_Updates: z.boolean(),
  Query_Cache_Max_Age_Seconds: z.number().int().positive(),
  Max_Query_Retries: z.number().int().nonnegative(),
  Use_Cached_Downloads: z.boolean(),
  Shutdown_Update_Detected_Timer: z.number().int().nonnegative(),
  Shutdown_Update_Detected_Message: z.string(),
  Shutdown_Kick_Message: z.string(),
});

export const WriteWorkshopFileIdsSchema = z.object({
  fileIds: z.array(z.string()).min(1, '至少需要一个 Mod ID'),
  /** 文件 mtime（Unix ms），客户端读时拿到、服务端写时比对 */
  expectedMtime: z.number().nonnegative().optional(),
});

// ─── Write payloads ─────────────────────────────────────

export const WriteCommandsDatSchema = z.object({
  known: z.record(z.string(), z.string()),
  unknown: z.record(z.string(), z.string()),
  comments: z.array(z.string()),
  /** Loadout 重复行结构化结果——格式：Loadout <SkillsetID>/<itemID>/<itemID>... */
  loadouts: z.array(LoadoutEntrySchema).optional(),
  /** 文件 mtime（Unix ms），客户端读时拿到、服务端写时比对 */
  expectedMtime: z.number().nonnegative().optional(),
});

export const WriteConfigTxtSchema = z.object({
  sections: z.record(z.string(), ConfigSectionSchema),
  /** 文件 mtime（Unix ms），客户端读时拿到、服务端写时比对 */
  expectedMtime: z.number().nonnegative().optional(),
});
