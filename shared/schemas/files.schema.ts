import { z } from 'zod';

// ─── File entry ─────────────────────────────────────────

export const FileEntrySchema = z.object({
  name: z.string(),
  path: z.string(),
  isDirectory: z.boolean(),
  size: z.number().nonnegative(),
  modifiedAt: z.string(),
});

export const FilePermissionsSchema = z.object({
  owner: z.enum(['read', 'write', 'none']),
  group: z.enum(['read', 'write', 'none']),
  other: z.enum(['read', 'write', 'none']),
});

// ─── Request schemas ────────────────────────────────────

export const ListDirectorySchema = z.object({
  path: z.string().default(''),
});

export const ReadFileSchema = z.object({
  path: z.string().min(1, '文件路径不能为空'),
});

export const WriteFileSchema = z.object({
  path: z.string().min(1, '文件路径不能为空'),
  content: z.string(),
});

export const DeleteEntrySchema = z.object({
  path: z.string().min(1, '路径不能为空'),
});

export const CreateDirectorySchema = z.object({
  path: z.string().min(1, '路径不能为空'),
});

export const RenameEntrySchema = z.object({
  path: z.string().min(1, '原路径不能为空'),
  newName: z.string().min(1, '新名称不能为空'),
});
