import { z } from 'zod';

// ─── ServerConfig ──────────────────────────────────────

export const ServerConfigSchema = z.object({
  id: z.string().min(1, 'ServerID 不能为空'),
  name: z.string().min(1, '服务器名称不能为空'),
  gamePort: z.number().int().min(1024).max(65535),
  ownerSteamId: z.string().regex(/^7656119\d{10}$/, '无效的 SteamID64'),
  installDir: z.string().min(1, '安装路径不能为空'),
  rconPassword: z.string().optional(),
  openModCredential: z.string().optional(),
});

export const CreateServerSchema = ServerConfigSchema;

export const ConfigureServerSchema = z.object({
  name: z.string().min(1).optional(),
  gamePort: z.number().int().min(1024).max(65535).optional(),
  ownerSteamId: z.string().regex(/^7656119\d{10}$/).optional(),
  installDir: z.string().min(1).optional(),
  rconPassword: z.string().optional(),
  openModCredential: z.string().optional(),
});

// ─── RCON ───────────────────────────────────────────────

export const RconExecuteSchema = z.object({
  command: z.string().min(1, '命令不能为空'),
  confirmed: z.boolean().optional(),
});

// ─── Server lifecycle ──────────────────────────────────

export const DeleteServerSchema = z.object({
  id: z.string().min(1, 'ServerID 不能为空'),
});

export const StopServerSchema = z.object({
  reason: z.string().optional(),
});

export const RestartServerSchema = z.object({
  reason: z.string().optional(),
});

export const ApplyModsSchema = z.object({
  fileIds: z.array(z.string()).min(1),
});

// ─── SteamCMD ──────────────────────────────────────────

export const SteamCmdUpdateSchema = z.object({
  installDir: z.string().min(1, '安装路径不能为空'),
});
