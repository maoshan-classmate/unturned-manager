import { useState, useEffect, useCallback } from "react";
import { apiClient } from "../api/client.js";

/** 时间窗——与后端 MetricsWindowSchema 对齐 */
export type MetricsWindow = "1m" | "5m" | "15m";

/** 单个采样点 */
export interface MetricsSample {
  timestamp: number;
  cpuPercent: number;
  memUsedMB: number;
}

/** 当前实时值 */
export interface MetricsCurrent {
  cpuPercent: number;
  memUsedMB: number;
  memTotalMB: number;
}

/** 指标响应 */
export interface MetricsResponse {
  serverId: string;
  window: MetricsWindow;
  samples: MetricsSample[];
  current: MetricsCurrent;
}

interface UseMetricsReturn {
  data: MetricsResponse | null;
  loading: boolean;
  error: string | null;
  /** 当前时间窗 */
  window: MetricsWindow;
  /** 切换时间窗（异步刷新数据） */
  setWindow: (w: MetricsWindow) => void;
}

/**
 * 系统指标采集 hook——Dashboard 资源图后端支撑。
 *
 * 挂载时拉一次 + 5s 间隔轮询；时间窗切换时刷新数据。
 *
 * @param serverId - 实例标识（响应回传用，底层数据不区分 ServerID）
 * @returns { data, loading, error, window, setWindow }
 *
 * @example
 * ```tsx
 * const { data, window, setWindow } = useMetrics("MyServer");
 * ```
 */
export function useMetrics(serverId: string): UseMetricsReturn {
  const [data, setData] = useState<MetricsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [window, setWindow] = useState<MetricsWindow>("5m");

  const fetchMetrics = useCallback(
    async (win: MetricsWindow) => {
      try {
        const res = await apiClient.get<{ data: MetricsResponse }>(
          "/system/metrics",
          { params: { serverId, window: win } },
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
    },
    [serverId],
  );

  // 挂载时拉一次 + window 切换时刷新
  useEffect(() => {
    setLoading(true);
    void fetchMetrics(window);
  }, [fetchMetrics, window]);

  // 5s 轮询（仅在 window 不变时持续）
  useEffect(() => {
    const timer = setInterval(() => {
      void fetchMetrics(window);
    }, 5_000);
    return () => clearInterval(timer);
  }, [fetchMetrics, window]);

  return { data, loading, error, window, setWindow };
}

/** 从 axios 错误提取后端中文 message */
function extractApiError(err: unknown, fallback: string): string {
  const msg = (
    err as { response?: { data?: { error?: { message?: string } } } }
  )?.response?.data?.error?.message;
  return msg ?? (err instanceof Error ? err.message : fallback);
}