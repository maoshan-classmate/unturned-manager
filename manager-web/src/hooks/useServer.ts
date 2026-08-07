import { useState, useEffect, useCallback, useRef } from 'react';
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
}

const POLL_INTERVAL = 5_000;

export function useServer(): UseServerReturn {
  const [servers, setServers] = useState<ServerInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval>>();

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

  useEffect(() => {
    fetchServers();
    timerRef.current = setInterval(fetchServers, POLL_INTERVAL);
    return () => clearInterval(timerRef.current);
  }, [fetchServers]);

  return { servers, loading, error, refresh: fetchServers };
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
