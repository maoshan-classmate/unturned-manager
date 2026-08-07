import { z } from 'zod';

// ─── Commands.dat ──────────────────────────────────────

/** 已知的 Commands.dat 字段名集合（来源：reference_config_files.md §1） */
export const KNOWN_COMMAND_KEYS = [
  'Name', 'Port', 'MaxPlayers', 'Map', 'Mode', 'Owner',
  'Perspective', 'Chatrate', 'Cycle', 'Timeout', 'Queue_Size',
  'Filter', 'Whitelisted', 'Gold', 'Hide_Admins', 'Sync',
  'Cheats', 'GSLT', 'Log', 'Votify', 'Password',
] as const;

/** 纯开关型字段（无 value，出现即启用） */
export const FLAG_ONLY_KEYS = new Set([
  'Filter', 'Whitelisted', 'Gold', 'Hide_Admins', 'Sync', 'Cheats',
]);

export const CommandsDatRecordSchema = z.object({
  known: z.map(z.string(), z.string()),
  unknown: z.map(z.string(), z.string()),
  comments: z.array(z.string()),
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
});

export const ConfigTxtRecordSchema = z.object({
  sections: z.array(ConfigSectionSchema),
});

// ─── WorkshopDownloadConfig.json ───────────────────────

export const WorkshopConfigSchema = z.object({
  File_IDs: z.array(z.string()),
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
  expectedVersion: z.number().int().positive().optional(),
});

// ─── Write payloads ─────────────────────────────────────

export const WriteCommandsDatSchema = z.object({
  known: z.map(z.string(), z.string()),
  unknown: z.map(z.string(), z.string()),
  comments: z.array(z.string()),
  expectedVersion: z.number().int().positive().optional(),
});

export const WriteConfigTxtSchema = z.object({
  sections: z.array(ConfigSectionSchema),
  expectedVersion: z.number().int().positive().optional(),
});
