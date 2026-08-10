import { z } from "zod";

// ─── ServerConfig ──────────────────────────────────────

// ServerId 严格限定 [A-Za-z0-9_-]（review 风险-3 修复）：
// id 会拼进 `+InternetServer/<id>` 写入 PTY bash（防命令注入/参数错乱），
// 也用于 resolveServerPath 拼文件路径（防 ../ 路径穿越）。
export const serverIdPattern = /^[A-Za-z0-9_-]+$/;

export const ServerConfigSchema = z.object({
  id: z
    .string()
    .regex(serverIdPattern, "ServerID 仅允许字母/数字/短横线/下划线"),
  name: z.string().min(1, "服务器名称不能为空"),
  gamePort: z.number().int().min(1024).max(65535),
  ownerSteamId: z.string().regex(/^7656119\d{10}$/, "无效的 SteamID64"),
  installDir: z.string().min(1, "安装路径不能为空"),
  rconPassword: z.string().optional(),
  openModCredential: z.string().optional(),
});

export const CreateServerSchema = ServerConfigSchema;

export const ConfigureServerSchema = z.object({
  name: z.string().min(1).optional(),
  gamePort: z.number().int().min(1024).max(65535).optional(),
  ownerSteamId: z
    .string()
    .regex(/^7656119\d{10}$/)
    .optional(),
  installDir: z.string().min(1).optional(),
  rconPassword: z.string().optional(),
  openModCredential: z.string().optional(),
  // ADR-0004 Phase 4：startCommand 走明文持久化；min(1) 防空串覆盖兜底模板，max(2048) 防恶意巨串
  startCommand: z
    .string()
    .min(1, "启动命令不能为空")
    .max(2048, "启动命令过长(>2KB)")
    .optional(),
});

// ─── RCON ───────────────────────────────────────────────

export const RconExecuteSchema = z.object({
  command: z.string().min(1, "命令不能为空"),
  confirmed: z.boolean().optional(),
});

// ─── Server lifecycle ──────────────────────────────────

export const DeleteServerSchema = z.object({
  id: z
    .string()
    .regex(serverIdPattern, "ServerID 仅允许字母/数字/短横线/下划线"),
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
  installDir: z.string().min(1, "安装路径不能为空"),
});
