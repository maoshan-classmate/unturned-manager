import { useState, useEffect, useCallback } from 'react';
import { apiClient } from '../api/client.js';

/** 服务器实例信息——GET /servers 响应形状（后端 ServerConfig，state 在服务端内存不返回） */
export interface ServerInfo {
  /** ServerID，对应 Servers/<ServerID> 目录名 */
  id: string;
  /** 显示名称 */
  name: string;
  /** 游戏端口（A2S 查询端口 = gamePort + 1） */
  gamePort: number;
  /** 服务器 Owner 的 SteamID64 */
  ownerSteamId: string;
  /** U3DS 安装根目录 */
  installDir: string;
  /** 运行时状态（面板本地维护，非后端持久化字段） */
  state?: string;
}

/** 创建实例请求体——POST /servers 契约（RCON 凭证走后端 K-V 加密存储） */
export interface CreateServerPayload extends Omit<ServerInfo, 'state'> {
  /** RocketMod Telnet RCON 裸密码（可选，留空后端自动生成） */
  rconPassword?: string;
  /** OpenMod RCON 凭证（ADR-17 双协议分离）：格式 "SteamID:密码" */
  openModCredential?: string;
}

interface UseServerReturn {
  servers: ServerInfo[];
  loading: boolean;
  error: string | null;
  /** 重拉实例列表（返回 Promise，调用方可 await） */
  refresh: () => Promise<void>;
  /** 调 POST /servers 创建实例，成功后重拉列表（真源=后端目录扫描） */
  addServer: (server: CreateServerPayload) => Promise<void>;
  /** 调 DELETE /servers/:id 删除实例，成功后重拉列表 */
  removeServer: (id: string) => Promise<void>;
}

/**
 * 服务器实例列表 hook。
 * 挂载时拉取一次 + 手动 refresh——不轮询；增删走真实后端 API（ADR-0003 B2）。
 *
 * @returns 实例列表状态 + { refresh, addServer, removeServer }
 *
 * @example
 * ```tsx
 * const { servers, refresh, addServer, removeServer } = useServer();
 * await addServer({ id: 'MyServer', name: '...', gamePort: 27015, ... });
 * ```
 */
export function useServer(): UseServerReturn {
  const [servers, setServers] = useState<ServerInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
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

  // 实例列表只挂载时拉取一次——增删后由 addServer/removeServer 内部 refresh，
  // 避免轮询覆盖本地操作；状态实时变化将来由 WebSocket 推送（后端 onStateChange）。
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const addServer = useCallback(async (server: CreateServerPayload) => {
    await apiClient.post('/servers', server);
    await refresh();
  }, [refresh]);

  const removeServer = useCallback(async (id: string) => {
    await apiClient.delete(`/servers/${id}`);
    await refresh();
  }, [refresh]);

  return { servers, loading, error, refresh, addServer, removeServer };
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
