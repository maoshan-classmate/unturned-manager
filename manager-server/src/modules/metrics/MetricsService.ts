import type { Logger } from "pino";
import si from "systeminformation";
import type {
  IMetricsService,
  MetricsSample,
  MetricsCurrent,
  MetricsResponse,
  MetricsWindow,
} from "@unturned-manager/shared";

// ─── 常量 ────────────────────────────────────────────────

/** 默认采样间隔（ms）——D3 默认 5s 一次 */
const DEFAULT_INTERVAL_MS = 5_000;

/** 环形缓冲最大样本数（≈ 16min @ 5s，覆盖 1m/5m/15m 三档窗口） */
const MAX_SAMPLES = 200;

/** 时间窗映射到毫秒数（路由层做白名单校验，service 层做兜底） */
const WINDOW_MS: Readonly<Record<MetricsWindow, number>> = {
  "1m": 60_000,
  "5m": 300_000,
  "15m": 900_000,
};

// ─── 实现 ────────────────────────────────────────────────

/**
 * 系统指标采集器——CPU + 内存，单进程全局一份（PR-2a / P3A）。
 *
 * 设计边界（metrics.contract.ts + P3 设计稿 §2.2）：
 * - **多实例共装下不分 ServerID**：数据是全进程一份
 * - **容器/宿主总资源**：systeminformation 路线（D2 选项 B）
 * - **网络指标暂不暴露**：容器内 + 多实例无法精确拆分，留后续
 *
 * 后端启动时调 `start()` 启动定时采样；关闭时调 `stop()` 释放定时器。
 * 采样失败不抛错，仅 warn 日志——指标丢失不该影响主链路。
 */
export class MetricsService implements IMetricsService {
  private readonly logger: Logger;
  private readonly intervalMs: number;
  private readonly samples: MetricsSample[] = [];
  /** 最近一次采样的内存总量（缓存避免每次 getMetrics 都查一遍 si.mem()） */
  private lastMemTotalMB: number = 0;
  /** 最近一次采样的 CPU 值（缓存避免每次 getMetrics 都查一遍 si.currentLoad()） */
  private lastCpuPercent: number = 0;
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(logger: Logger, intervalMs: number = DEFAULT_INTERVAL_MS) {
    this.logger = logger;
    this.intervalMs = intervalMs;
  }

  /**
   * 启动定时采样。幂等——已启动时再次调用无副作用。
   */
  start(): void {
    if (this.running) return;
    this.running = true;
    // 立即采一次，避免 getMetrics 在刚启动时拿不到任何样本
    void this.collect();
    this.timer = setInterval(() => {
      void this.collect();
    }, this.intervalMs);
    this.timer.unref?.();
  }

  /**
   * 停止采样器。已停止时幂等。
   */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.running = false;
  }

  /**
   * 查询指定时间窗的样本 + 当前实时值。
   *
   * @param serverId - 实例标识（响应回传用，底层数据不区分 ServerID）
   * @param window - 时间窗长度
   */
  async getMetrics(serverId: string, window: MetricsWindow): Promise<MetricsResponse> {
    const windowMs = WINDOW_MS[window] ?? WINDOW_MS["5m"];
    const cutoff = Date.now() - windowMs;
    const filtered = this.samples.filter((s) => s.timestamp >= cutoff);

    const last = this.samples[this.samples.length - 1];
    const current: MetricsCurrent = {
      cpuPercent: last?.cpuPercent ?? this.lastCpuPercent,
      memUsedMB: last?.memUsedMB ?? 0,
      memTotalMB: this.lastMemTotalMB,
    };

    return {
      serverId,
      window,
      samples: filtered,
      current,
    };
  }

  // ─── 私有 ──────────────────────────────────────────────

  /**
   * 单次采样。失败不抛错——指标丢失不应阻塞主流程；warn 日志便于排查。
   */
  private async collect(): Promise<void> {
    try {
      const [load, mem] = await Promise.all([si.currentLoad(), si.mem()]);
      const cpuPercent = Math.round(load.currentLoad * 10) / 10;
      const memUsedMB = Math.round((mem.used / 1024 / 1024) * 10) / 10;
      const memTotalMB = Math.round((mem.total / 1024 / 1024) * 10) / 10;

      this.lastCpuPercent = cpuPercent;
      this.lastMemTotalMB = memTotalMB;
      this.samples.push({
        timestamp: Date.now(),
        cpuPercent,
        memUsedMB,
      });
      // 环形缓冲 trim——超过上限丢弃最早样本
      if (this.samples.length > MAX_SAMPLES) {
        this.samples.splice(0, this.samples.length - MAX_SAMPLES);
      }
    } catch (err) {
      this.logger.warn({ err }, "指标采样失败");
    }
  }
}