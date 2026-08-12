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
