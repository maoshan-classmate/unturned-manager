import { useState, useEffect, useCallback } from "react";
import { apiClient } from "../api/client.js";
import type { SystemInfo } from "@unturned-manager/shared";

interface UseSystemInfoReturn {
  data: SystemInfo | null;
  loading: boolean;
  error: string | null;
  /** 手动重拉（端口变更后调用） */
  refresh: () => Promise<void>;
}

/**
 * 主机信息 hook——Dashboard 主机信息卡后端支撑。
 *
 * 挂载时拉一次 + 30s 间隔低频轮询；主机信息变化慢，避免高频请求。
 *
 * @param serverId - 实例标识（可选；传入时附加该实例端口）
 * @returns { data, loading, error, refresh }
 *
 * @example
 * ```tsx
 * const { data, refresh } = useSystemInfo("MyServer");
 * ```
 */
export function useSystemInfo(serverId?: string): UseSystemInfoReturn {
  const [data, setData] = useState<SystemInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchInfo = useCallback(async () => {
    try {
      const res = await apiClient.get<{ data: SystemInfo }>(
        "/system/info",
        { params: serverId ? { serverId } : {} },
      );
      setData(res.data.data);
      setError(null);
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "获取主机信息失败";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [serverId]);

  useEffect(() => {
    setLoading(true);
    void fetchInfo();
  }, [fetchInfo]);

  // 30s 低频轮询——主机信息变化慢
  useEffect(() => {
    const timer = setInterval(() => {
      void fetchInfo();
    }, 30_000);
    return () => clearInterval(timer);
  }, [fetchInfo]);

  return { data, loading, error, refresh: fetchInfo };
}