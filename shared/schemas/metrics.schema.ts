import { z } from 'zod';

// ─── Response schemas ───────────────────────────────────

/** 单个采样点——Zod 校验运行时类型安全 */
export const MetricsSampleSchema = z.object({
  timestamp: z.number().int().nonnegative(),
  cpuPercent: z.number().min(0).max(100),
  memUsedMB: z.number().nonnegative(),
});

/** 当前实时值 */
export const MetricsCurrentSchema = z.object({
  cpuPercent: z.number().min(0).max(100),
  memUsedMB: z.number().nonnegative(),
  memTotalMB: z.number().nonnegative(),
});

/** 时间窗枚举 */
export const MetricsWindowSchema = z.enum(['1m', '5m', '15m']);

/** 指标响应——路由出口与前端共用 */
export const MetricsResponseSchema = z.object({
  serverId: z.string().min(1),
  window: MetricsWindowSchema,
  samples: z.array(MetricsSampleSchema),
  current: MetricsCurrentSchema,
});

// ─── Request schemas ────────────────────────────────────

/** GET /api/system/metrics 查询参数 */
export const MetricsQuerySchema = z.object({
  /** 实例标识——可选，仅响应回传用（指标本身全进程一份，不分 ServerID） */
  serverId: z.string().optional(),
  window: MetricsWindowSchema.default('5m'),
});