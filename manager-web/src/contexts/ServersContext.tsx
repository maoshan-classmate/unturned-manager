import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { apiClient } from "../api/client.js";
import { useWebSocket } from "./WebSocketContext.js";

/** 服务器实例信息——GET /servers 响应形状 */
export interface ServerInfo {
  /** ServerID，对应 Servers/<ServerID> 目录名 */
  id: string;
  /** 显示名称 */
  name: string;
  /** 游戏端口（Unturned 用 gamePort，监听端口 = gamePort） */
  gamePort: number;
  /** 服务器 Owner 的 SteamID64 */
  ownerSteamId: string;
  /** U3DS 安装根目录 */
  installDir: string;
  /**
   * 当前运行态（内存态，非持久化）——
   *   - 初始挂载：GET /servers 注入
   *   - 实时变化：WS state_change 推送更新
   *   - 缺失回落：默认 STOPPED
   */
  state?: string;
  /** U3DS 启动命令——用户编辑后 PATCH /servers/:id 持久化；空 = 后端兜底模板 */
  startCommand?: string;
}

/** 创建实例请求体——POST /servers 契约 */
export type CreateServerPayload = Omit<ServerInfo, "state">;

/**
 * 全局实例列表共享层。
 *
 * 接口语义：
 *   - 实例列表由 Provider 在 AppLayout 顶层挂载一次，挂载时拉取一次 + WS state_change 实时增量
 *   - 操作（增删改）由 actions 内部调 refresh，保证全 UI 数据一致
 *
 * Provider 树位置：CurrentServerProvider 内、WebSocketProvider 内（WS 订阅依赖 Provider 数据）。
 */
export interface ServersContextValue {
  /** 实例列表——Provider 化后切路由无 loading 闪烁 */
  servers: ServerInfo[];
  /** Provider 初次加载中；WS state_change 推送不触发此状态 */
  loading: boolean;
  /** 加载失败——API 错误信息 */
  error: string | null;
  /** 重拉实例列表（返回 Promise，调用方可 await） */
  refresh: () => Promise<void>;
  /** 调 POST /servers 创建实例，成功后重拉列表（真源=后端目录扫描） */
  addServer: (server: CreateServerPayload) => Promise<void>;
  /** 调 DELETE /servers/:id 删除实例，成功后重拉列表 */
  removeServer: (id: string) => Promise<void>;
  /** PATCH /servers/:id 局部更新实例配置 */
  updateServer: (id: string, patch: Partial<ServerInfo>) => Promise<void>;
}

const ServersContext = createContext<ServersContextValue | null>(null);

/**
 * 全局实例列表 Provider 组件。
 * 沿用 AuthContext / CurrentServerContext 的 null-guard 模式。
 *
 * @param props - 组件属性
 * @param props.children - 子树
 * @returns 实例列表共享层包裹的 React 元素
 *
 * @example
 * ```tsx
 * <AuthProvider>
 *   <CurrentServerProvider>
 *     <ServersProvider>
 *       <App />
 *     </ServersProvider>
 *   </CurrentServerProvider>
 * </AuthProvider>
 * ```
 */
export function ServersProvider({ children }: { children: ReactNode }) {
  const [servers, setServers] = useState<ServerInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { subscribe, connected } = useWebSocket();

  const refresh = useCallback(async () => {
    try {
      const { data } = await apiClient.get<{ data: ServerInfo[] }>("/servers");
      setServers(data.data);
      setError(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "获取服务器列表失败";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const unsubscribe = subscribe("state_change", (msg) => {
      const serverId = msg.serverId;
      if (typeof serverId !== "string") return;
      const to = msg.to;
      if (typeof to !== "string") return;
      setServers((prev) =>
        prev.map((s) => (s.id === serverId ? { ...s, state: to } : s)),
      );
    });
    return unsubscribe;
  }, [subscribe]);

  // WS 重连后强制重拉——断开期间的状态变更丢失（gateway 没有 state_change 缓冲），
  // 重连瞬间拉一次 GET /servers 与内存态对齐。
  // connected 初值=false（WebSocketContext 等待 useAuth=true 才 connect），首次连上 false→true 也走一次，
  // 与挂载时的 refresh() 重复但幂等。
  useEffect(() => {
    if (connected) {
      void refresh();
    }
  }, [connected, refresh]);

  const addServer = useCallback(
    async (server: CreateServerPayload) => {
      await apiClient.post("/servers", server);
      await refresh();
    },
    [refresh],
  );

  const removeServer = useCallback(
    async (id: string) => {
      await apiClient.delete(`/servers/${id}`);
      await refresh();
    },
    [refresh],
  );

  const updateServer = useCallback(
    async (id: string, patch: Partial<ServerInfo>) => {
      await apiClient.patch(`/servers/${id}`, patch);
      await refresh();
    },
    [refresh],
  );

  const value = useMemo(
    () => ({
      servers,
      loading,
      error,
      refresh,
      addServer,
      removeServer,
      updateServer,
    }),
    [servers, loading, error, refresh, addServer, removeServer, updateServer],
  );

  return (
    <ServersContext.Provider value={value}>{children}</ServersContext.Provider>
  );
}

/**
 * 消费全局实例列表共享层。
 * 必须在 ServersProvider 内调用——Provider 外抛错（null-guard）。
 *
 * @returns 实例列表状态 + 增删改操作
 * @throws 在 Provider 外调用时抛错（null-guard 模式）
 *
 * @example
 * ```tsx
 * function DashboardPage() {
 *   const { servers, loading } = useServers();
 *   if (loading) return <Loading />;
 *   // ...
 * }
 * ```
 */
export function useServers(): ServersContextValue {
  const ctx = useContext(ServersContext);
  if (!ctx) {
    throw new Error(
      "useServers 必须在 ServersProvider 内调用——请检查组件树",
    );
  }
  return ctx;
}