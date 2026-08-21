import { z } from 'zod';

// ─── Response schemas ───────────────────────────────────

/** 单个采样点——Zod 校验运行时类型安全 */
export const MetricsSampleSchema = z.object({
  timestamp: z.number().int().nonnegative(),
  cpuPercent: z.number().min(0).max(100),
  memUsedMB: z.number().nonnegative(),
  /** 全网卡累计接收字节数（首次采样存基线，速率字段此时为空） */
  networkRxBytes: z.number().nonnegative().nullable(),
  /** 全网卡累计发送字节数 */
  networkTxBytes: z.number().nonnegative().nullable(),
  /** 接收速率（字节/秒）；首次采样空，后续两次采样之间差值除以间隔 */
  networkRxRateBps: z.number().nonnegative().nullable(),
  /** 发送速率（字节/秒） */
  networkTxRateBps: z.number().nonnegative().nullable(),
});

/** 当前实时值 */
export const MetricsCurrentSchema = z.object({
  cpuPercent: z.number().min(0).max(100),
  memUsedMB: z.number().nonnegative(),
  memTotalMB: z.number().nonnegative(),
  /** 磁盘已用字节数（启动时一次性读取） */
  diskUsedBytes: z.number().nonnegative().nullable(),
  /** 磁盘总字节数 */
  diskTotalBytes: z.number().nonnegative().nullable(),
  /** 网络累计字节数（用于前端计算速率的基线值） */
  networkRxBytes: z.number().nonnegative().nullable(),
  networkTxBytes: z.number().nonnegative().nullable(),
  /** 网络瞬时速率（字节/秒）；首次采样空 */
  networkRxRateBps: z.number().nonnegative().nullable(),
  networkTxRateBps: z.number().nonnegative().nullable(),
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