import { z } from 'zod';

// ─── LDM（Legally-Distinct-Missile）Mod 框架 Phase 1 契约 ─────────────
// 命名约定：Phase 1 6 个 schema，加 `// @phase1` 标记供后续 Phase 复用时识别。

/**
 * @phase1 GET /api/servers/:id/ldm/installed 响应中的单条插件
 */
export const InstalledPluginSchema = z.object({
  name: z.string().regex(/^[A-Za-z0-9._-]+$/, '插件名只能含字母数字 . _ -'),
  version: z.string().nullable(),
  sizeBytes: z.number().int().nonnegative(),
  hasConfig: z.boolean(),
  modifiedAtIso: z.string().datetime(),
  runtimeStatus: z.enum(['loaded', 'unloaded', 'failure', 'cancelled', 'unknown']),
});
export type InstalledPluginDto = z.infer<typeof InstalledPluginSchema>;

/**
 * @phase1 GET /api/servers/:id/ldm/installed 响应包装
 */
export const InstalledPluginsResponseSchema = z.object({
  serverId: z.string(),
  plugins: z.array(InstalledPluginSchema),
  /** LDM 主框架未装 / Rocket/ 目录缺失时 = true；UI 引导 5 步 SOP */
  ldmNotDetected: z.boolean(),
  /** LDM 状态检测时间（ISO）—— UI 显示「3 分钟前检测」 */
  detectedAtIso: z.string().datetime(),
});
export type InstalledPluginsResponse = z.infer<typeof InstalledPluginsResponseSchema>;

/**
 * @phase1 POST /api/servers/:id/ldm/load-plugin 与 unload-plugin 请求
 */
export const PluginCommandRequestSchema = z.object({
  pluginName: z.string().regex(/^[A-Za-z0-9._-]+$/, '插件名只能含字母数字 . _ -'),
});
export type PluginCommandRequest = z.infer<typeof PluginCommandRequestSchema>;

/**
 * @phase1 load-plugin / unload-plugin 响应（仅 status 变化不算"重启"）
 */
export const PluginCommandResponseSchema = z.object({
  serverId: z.string(),
  pluginName: z.string(),
  /**
   * 终态：success = **LDM 命令已接受，加载/卸载已触发**（非加载最终成功——加载成功零日志，需 /rocket plugins 复核）；
   * failure = LDM 拒绝（插件不存在 `Plugin X not found` / 加载执行失败 `Failed to load plugin X` / 已是目标态 `already loaded`/`not loaded`）
   */
  outcome: z.enum(['success', 'failure']),
  /** LDM stdout 末尾 ≤ 256 字（失败时给前端 toast 显示原文） */
  ldmOutput: z.string().max(256),
});
export type PluginCommandResponse = z.infer<typeof PluginCommandResponseSchema>;

/**
 * @phase1 GET /api/ldm/community-plugins 响应中的单条插件
 */
export const CommunityPluginSchema = z.object({
  slug: z.string(),
  name: z.string(),
  author: z.string(),
  description: z.string(),
  repoUrl: z.string().url(),
  latestVersion: z.string(),
  updatedAtIso: z.string().datetime(),
});
export type CommunityPluginDto = z.infer<typeof CommunityPluginSchema>;

/**
 * @phase1 GET /api/ldm/community-plugins 响应包装
 */
export const CommunityPluginsResponseSchema = z.object({
  plugins: z.array(CommunityPluginSchema),
  /** 缓存元数据：前端「刷新」按钮 hover 显示「N 分钟前更新」 */
  fetchedAtIso: z.string().datetime(),
  /** fetch 失败但用 stale 缓存兜底时 = true；UI 提示「LDM-Community 不可达，正在展示缓存」 */
  stale: z.boolean(),
});
export type CommunityPluginsResponse = z.infer<typeof CommunityPluginsResponseSchema>;

/**
 * @phase1 POST /api/ldm/community-plugins/test-pat 请求
 */
export const TestPatRequestSchema = z.object({
  pat: z.string().optional().default(''),
});
export type TestPatRequest = z.infer<typeof TestPatRequestSchema>;

// ─── LDM Phase 2a 契约 ─────────────────────────────────

/**
 * @phase2a Rocket.config.xml 16 字段结构化写请求
 * 字段真源：LDM 仓 Rocket.Core/Serialization/RocketSettings.cs
 * 范围：RCON 节点不暴露（UI 隐藏，ADR-0004 Phase 6 已删 RCON 通道）
 */
export const RocketConfigWriteSchema = z.object({
  languageCode: z.string().min(1).default('en'),
  maxFrames: z.number().int().min(60).default(60),
  automaticShutdownEnabled: z.boolean().default(false),
  automaticShutdownInterval: z.number().int().min(60).default(86400),
  webPermissionsEnabled: z.boolean().default(false),
  webPermissionsUrl: z.string().default(''),
  webPermissionsInterval: z.number().int().min(1).default(180),
  webConfigurationsEnabled: z.boolean().default(false),
  webConfigurationsUrl: z.string().default(''),
});
export type RocketConfigWriteRequest = z.infer<typeof RocketConfigWriteSchema>;

/**
 * @phase2a Rocket.Unturned.config.xml 9 字段结构化写请求
 * 字段真源：LDM 仓 Rocket.Unturned/Serialisation/UnturnedSettings.cs
 */
export const RocketUnturnedConfigWriteSchema = z.object({
  automaticSaveEnabled: z.boolean().default(true),
  automaticSaveInterval: z.number().int().min(60).default(1800),
  characterNameValidation: z.boolean().default(false),
  characterNameValidationRule: z.string().default('([\\x00-\\AA]|[\\w_\\ \\.\\+\\-])+'),
  logSuspiciousPlayerMovement: z.boolean().default(true),
  enableItemBlacklist: z.boolean().default(false),
  enableItemSpawnLimit: z.boolean().default(false),
  maxSpawnAmount: z.number().int().min(1).default(10),
  enableVehicleBlacklist: z.boolean().default(false),
});
export type RocketUnturnedConfigWriteRequest = z.infer<typeof RocketUnturnedConfigWriteSchema>;

/**
 * @phase2a Permissions.config.xml 树形写请求
 * Color 枚举（black/blue/clear/cyan/gray/green/grey/magenta/red/white/yellow/rocket）+ hex #RRGGBB
 * Members SteamID64 17 位数字
 */
const PERMISSIONS_COLOR_RE = /^(black|blue|clear|cyan|gray|green|grey|magenta|red|white|yellow|rocket|#[0-9A-Fa-f]{6})$/;
const STEAMID64_RE = /^7656119\d{10}$/;

export const PermissionsConfigWriteSchema = z.object({
  defaultGroup: z.string().min(1).default('default'),
  groups: z.array(
    z.object({
      id: z.string().regex(/^[A-Za-z0-9._-]+$/, '组 ID 只能含字母数字 . _ -'),
      displayName: z.string().min(1),
      color: z.string().regex(PERMISSIONS_COLOR_RE, '颜色必须是 LDM Color 枚举或 #RRGGBB').default('white'),
      members: z.array(z.string().regex(STEAMID64_RE, '成员必须是 17 位 SteamID64')).default([]),
      parentGroup: z.string().regex(/^[A-Za-z0-9._-]+$/).optional(),
      priority: z.number().int().default(100),
      permissions: z.array(z.string()).default([]),
    }),
  ),
});
export type PermissionsConfigWriteRequest = z.infer<typeof PermissionsConfigWriteSchema>;

/**
 * @phase2a 插件 Configuration.xml 原文写请求（通用 XML，不强解 schema）
 */
export const PluginConfigWriteSchema = z.object({
  raw: z.string().min(1),
});
export type PluginConfigWriteRequest = z.infer<typeof PluginConfigWriteSchema>;
