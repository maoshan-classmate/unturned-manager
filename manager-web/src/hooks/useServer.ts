import { useCallback, useState } from "react";
import { apiClient } from "../api/client.js";

// ─── 类型 re-export —— 真源在 ServersContext.tsx ───

/** 服务器实例信息——GET /servers 响应形状 */
export type { ServerInfo } from "../contexts/ServersContext.js";

/** 创建实例请求体——POST /servers 契约 */
export type { CreateServerPayload } from "../contexts/ServersContext.js";

// ─── 共享层 hook ───
//
// useServer 是 useServers 的别名（向下兼容）。
// 数据来源：全局 ServersProvider；切路由不会重 mount，无 loading 闪烁。
// 详见 src/contexts/ServersContext.tsx。
export { useServers as useServer } from "../contexts/ServersContext.js";

// ─── 独立的操作 hook（与共享数据解耦）───

/** 从 axios 错误提取后端中文 message（否则 e.message 是 axios 通用英文） */
function extractApiError(err: unknown, fallback: string): string {
  const msg = (
    err as { response?: { data?: { error?: { message?: string } } } }
  )?.response?.data?.error?.message;
  return msg ?? (err instanceof Error ? err.message : fallback);
}

/**
 * 服务端操作 hook（start / stop / restart）。
 * 错误统一抛后端中文 message（如 start-script-not-found 的安装引导），
 * 调用方 `e.message` 直接可展示。
 */
export function useServerActions() {
  const [pendingId, setPendingId] = useState<string | null>(null);

  const start = useCallback(async (serverId: string) => {
    setPendingId(serverId);
    try {
      await apiClient.post(`/servers/${serverId}/start`);
    } catch (err) {
      throw new Error(extractApiError(err, "启动失败"));
    } finally {
      setPendingId(null);
    }
  }, []);

  const stop = useCallback(async (serverId: string) => {
    setPendingId(serverId);
    try {
      await apiClient.post(`/servers/${serverId}/stop`);
    } catch (err) {
      throw new Error(extractApiError(err, "停止失败"));
    } finally {
      setPendingId(null);
    }
  }, []);

  const restart = useCallback(async (serverId: string) => {
    setPendingId(serverId);
    try {
      await apiClient.post(`/servers/${serverId}/restart`);
    } catch (err) {
      throw new Error(extractApiError(err, "重启失败"));
    } finally {
      setPendingId(null);
    }
  }, []);

  return { start, stop, restart, pendingId };
}