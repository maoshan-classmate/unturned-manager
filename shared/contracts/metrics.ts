/**
 * 系统指标采集与查询——Dashboard 资源图支撑。
 *
 * 边界说明：
 * - **多实例共装下不分 ServerID**：同一 U3DS 进程承载多 ServerID，
 *   进程级 CPU/内存无法拆分到 ServerID 粒度。接口签名带 serverId 仅用于响应回传，
 *   底层数据是全进程一份。UI 文案「系统资源（多实例）」明示这一边界。
 * - **容器/宿主总资源**：选 systeminformation 路线，不绑定具体进程。
 * - **网络指标暂不暴露**：容器内 + 多实例无法精确拆分。
 *
 * 采样策略：
 * - 后端启动时 `start()` 启动定时采样（默认 5s 一次）
 * - 内存环形缓冲保留最近 200 个样本（≈ 16min @ 5s，覆盖 1m/5m/15m 三档窗口）
 * - `getMetrics(serverId, window)` 按窗口截取环形缓冲 + 当前实时值
 */

/** 指标时间窗（前端可选 1m / 5m / 15m） */
export type MetricsWindow = "1m" | "5m" | "15m";

/** 单个采样点 */
export interface MetricsSample {
  /** Unix ms 时间戳 */
  timestamp: number;
  /** CPU 总体使用率 0–100（多核平均） */
  cpuPercent: number;
  /** 内存已用量（MB） */
  memUsedMB: number;
  /** 全网卡累计接收字节数（首次采样存基线） */
  networkRxBytes: number | null;
  /** 全网卡累计发送字节数 */
  networkTxBytes: number | null;
  /** 接收速率（字节/秒）；首次采样为空 */
  networkRxRateBps: number | null;
  /** 发送速率（字节/秒）；首次采样为空 */
  networkTxRateBps: number | null;
}

/** 当前实时值（最近一次采样 + 内存总量） */
export interface MetricsCurrent {
  /** CPU 总体使用率 0–100 */
  cpuPercent: number;
  /** 内存已用量（MB） */
  memUsedMB: number;
  /** 系统总内存（MB）—— 容器/宿主视角 */
  memTotalMB: number;
  /** 磁盘已用字节数（启动时一次性读取） */
  diskUsedBytes: number | null;
  /** 磁盘总字节数 */
  diskTotalBytes: number | null;
  /** 网络累计字节数（基线） */
  networkRxBytes: number | null;
  networkTxBytes: number | null;
  /** 网络瞬时速率（字节/秒）；首次采样为空 */
  networkRxRateBps: number | null;
  networkTxRateBps: number | null;
}

/** 指标响应 */
export interface MetricsResponse {
  serverId: string;
  window: MetricsWindow;
  samples: MetricsSample[];
  current: MetricsCurrent;
}

/**
 * 系统指标采集服务——单进程单实例。
 *
 * @example
 * ```typescript
 * const metrics = new MetricsService(logger);
 * metrics.start();
 * // ... 业务运行中
 * const snapshot = await metrics.getMetrics("MyServer", "5m");
 * ```
 */
export interface IMetricsService {
  /**
   * 启动定时采样器——后端启动时调用一次。
   * 已启动时幂等（不会启动第二个定时器）。
   */
  start(): void;

  /**
   * 停止采样器——后端优雅关闭时调用。停止后 `getMetrics` 仍可查询已积累的样本。
   */
  stop(): void;

  /**
   * 查询指定时间窗的样本。
   *
   * @param serverId - 实例标识（响应回传用，底层数据不区分 ServerID）
   * @param window - 时间窗长度（1m / 5m / 15m）
   * @returns 窗口内样本（按时间升序）+ 当前实时值
   */
  getMetrics(serverId: string, window: MetricsWindow): Promise<MetricsResponse>;
}