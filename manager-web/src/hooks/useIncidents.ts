import { useState, useEffect, useCallback } from "react";
import { apiClient } from "../api/client.js";
import { useWebSocket } from "../contexts/WebSocketContext.js";

/** 事件类型（与后端共享 contracts/incidents.ts 对齐） */
export type IncidentType =
  | "start"
  | "stop"
  | "restart"
  | "mod_apply"
  | "ldm_apply"
  | "crash";

/** 严重程度 */
export type IncidentSeverity = "info" | "warning" | "error";

/** 事件详情 */
export interface IncidentDetails {
  reason?: string;
  durationMs?: number;
  itemCount?: number;
}

/** 单条事件 */
export interface Incident {
  id: string;
  serverId: string;
  type: IncidentType;
  severity: IncidentSeverity;
  message: string;
  timestamp: number;
  details?: IncidentDetails;
}

/** 事件接口响应 */
export interface IncidentsResponse {
  serverId: string;
  total: number;
  incidents: Incident[];
}

interface UseIncidentsReturn {
  data: Incident[];
  loading: boolean;
  error: string | null;
  /** 手动刷新（拉取最新历史） */
  refresh: () => Promise<void>;
}

/**
 * ServerID 事件流 hook——Dashboard Status Block 支撑。
 *
 * 流程：挂载时拉历史 + 订阅 WS `incident_created` 实时追加。
 * 倒序展示由 StatusBlock 组件负责（hook 维护按时间正序缓存）。
 *
 * @param serverId - 实例标识；空字符串时跳过拉取与订阅
 * @returns { data, loading, error, refresh }
 *
 * @example
 * ```tsx
 * const { data, loading } = useIncidents("MyServer");
 * ```
 */
export function useIncidents(serverId: string): UseIncidentsReturn {
  const { subscribe } = useWebSocket();
  const [data, setData] = useState<Incident[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchHistory = useCallback(async () => {
    if (!serverId) {
      setData([]);
      setLoading(false);
      return;
    }
    try {
      const res = await apiClient.get<{ data: IncidentsResponse }>(
        `/servers/${serverId}/incidents`,
        { params: { limit: 50 } },
      );
      setData(res.data.data.incidents);
      setError(null);
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "加载事件流失败";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [serverId]);

  // 初始拉取 + serverId 切换时刷新
  useEffect(() => {
    setLoading(true);
    void fetchHistory();
  }, [fetchHistory]);

  // 订阅 WS 实时事件——前置去重（id 相同则忽略，避免重复）
  useEffect(() => {
    if (!serverId) return;
    const unsubscribe = subscribe("incident_created", (msg) => {
      if (msg.serverId !== serverId) return;
      const incident = msg.incident as Incident | undefined;
      if (!incident || typeof incident.id !== "string") return;
      setData((prev) => {
        if (prev.some((i) => i.id === incident.id)) return prev;
        // 前置插入（保持倒序——新事件在前）
        return [incident, ...prev].slice(0, 100);
      });
    });
    return unsubscribe;
  }, [serverId, subscribe]);

  return { data, loading, error, refresh: fetchHistory };
}
