import { useState, useEffect, useCallback } from "react";
import { apiClient } from "../api/client.js";

/** 单个采样点 */
export interface MetricsSample {
  timestamp: number;
  cpuPercent: number;
  memUsedMB: number;
  networkRxBytes: number | null;
  networkTxBytes: number | null;
  networkRxRateBps: number | null;
  networkTxRateBps: number | null;
}

/** 当前实时值 */
export interface MetricsCurrent {
  cpuPercent: number;
  memUsedMB: number;
  memTotalMB: number;
  diskUsedBytes: number | null;
  diskTotalBytes: number | null;
  networkRxBytes: number | null;
  networkTxBytes: number | null;
  networkRxRateBps: number | null;
  networkTxRateBps: number | null;
}

/** 指标响应 */
export interface MetricsResponse {
  serverId: string;
  samples: MetricsSample[];
  current: MetricsCurrent;
}

interface UseMetricsReturn {
  data: MetricsResponse | null;
  loading: boolean;
  error: string | null;
  /** 手动重拉（停服/启服切换时调用） */
  refresh: () => Promise<void>;
}

/**
 * 系统指标采集 hook——Dashboard 资源图后端支撑。
 *
 * 挂载时拉一次 + 5s 间隔轮询；指标响应字段对齐后端契约层。
 *
 * @param serverId - 实例标识（响应回传用，底层数据不区分 ServerID）
 * @returns { data, loading, error, refresh }
 *
 * @example
 * ```tsx
 * const { data, refresh } = useMetrics("MyServer");
 * ```
 */
export function useMetrics(serverId: string): UseMetricsReturn {
  const [data, setData] = useState<MetricsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchMetrics = useCallback(async () => {
    try {
      const res = await apiClient.get<{ data: MetricsResponse }>(
        "/system/metrics",
        { params: { serverId } },
      );
      setData(res.data.data);
      setError(null);
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "获取系统资源失败";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [serverId]);

  // 挂载时拉一次
  useEffect(() => {
    setLoading(true);
    void fetchMetrics();
  }, [fetchMetrics]);

  // 5s 轮询
  useEffect(() => {
    const timer = setInterval(() => {
      void fetchMetrics();
    }, 5_000);
    return () => clearInterval(timer);
  }, [fetchMetrics]);

  return { data, loading, error, refresh: fetchMetrics };
}