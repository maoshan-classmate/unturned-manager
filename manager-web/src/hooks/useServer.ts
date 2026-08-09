import { useState, useEffect, useCallback } from 'react';
import { apiClient } from '../api/client.js';

export interface ServerInfo {
  id: string;
  name: string;
  gamePort: number;
  ownerSteamId: string;
  installDir: string;
  state?: string;
}

interface UseServerReturn {
  servers: ServerInfo[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
  /** 纯前端本地新增——后端创建实例目录接口尚未实现,先做 UI 效果闭环 */
  addServer: (server: ServerInfo) => void;
  /** 纯前端本地移除——后端 DELETE /servers/:id 尚未实现,用于删除 UI 效果闭环 */
  removeServer: (id: string) => void;
}

export function useServer(): UseServerReturn {
  const [servers, setServers] = useState<ServerInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchServers = useCallback(async () => {
    try {
      const { data } = await apiClient.get<{ data: ServerInfo[] }>('/servers');
      setServers(data.data);
      setError(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '获取服务器列表失败';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  // 实例列表只挂载时拉取一次 + 手动 refresh——不轮询。
  // 理由:本地增删(纯前端效果)不该被轮询的"后端真相"覆盖;
  // 状态(state)实时变化将来由 WebSocket 推送(后端 ServerManager.onStateChange),不走轮询。
  useEffect(() => {
    fetchServers();
  }, [fetchServers]);

  const addServer = useCallback((server: ServerInfo) => {
    setServers((prev) => [server, ...prev]);
  }, []);

  const removeServer = useCallback((id: string) => {
    setServers((prev) => prev.filter((s) => s.id !== id));
  }, []);

  return { servers, loading, error, refresh: fetchServers, addServer, removeServer };
}

/**
 * 服务端操作 hook（start / stop / restart）。
 */
export function useServerActions() {
  const [pendingId, setPendingId] = useState<string | null>(null);

  const start = useCallback(async (serverId: string) => {
    setPendingId(serverId);
    try {
      await apiClient.post(`/servers/${serverId}/start`);
    } finally {
      setPendingId(null);
    }
  }, []);

  const stop = useCallback(async (serverId: string) => {
    setPendingId(serverId);
    try {
      await apiClient.post(`/servers/${serverId}/stop`);
    } finally {
      setPendingId(null);
    }
  }, []);

  const restart = useCallback(async (serverId: string) => {
    setPendingId(serverId);
    try {
      await apiClient.post(`/servers/${serverId}/restart`);
    } finally {
      setPendingId(null);
    }
  }, []);

  return { start, stop, restart, pendingId };
}
