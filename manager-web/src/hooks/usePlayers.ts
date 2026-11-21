import { useCallback, useEffect, useState } from "react";
import { apiClient } from "../api/client.js";
import type {
  PlayerAction,
  PlayersResponse,
} from "@unturned-manager/shared";

/** 轮询间隔（毫秒）——玩家在线状态变化频繁，5 秒拉一次 */
const POLL_INTERVAL_MS = 5_000;

/** 玩家数据 hook 返回值 */
export interface UsePlayersReturn {
  /** 玩家数据；未加载时为 null */
  data: PlayersResponse | null;
  /** 首次加载中 */
  loading: boolean;
  /** 最近一次错误信息 */
  error: string | null;
  /** 手动重新拉取 */
  refresh: () => Promise<void>;
  /** 执行玩家管理命令 */
  act: (
    steamId: string,
    action: PlayerAction,
    opts?: { reason?: string; durationMinutes?: number },
  ) => Promise<string>;
  /** 命令执行中 */
  acting: boolean;
}

/**
 * 玩家列表数据与管理操作。
 *
 * 数据来自服务端日志解析，5 秒轮询一次；实例未运行时返回空列表。
 * 管理操作走 REST，由服务端把 Unturned 原生命令写入终端。
 *
 * @param serverId - 实例 ID，空字符串时不拉取
 * @returns 玩家数据、加载状态与操作方法
 *
 * @example
 * ```tsx
 * const { data, act } = usePlayers(serverId);
 * await act("76561198...", "kick");
 * ```
 */
export function usePlayers(serverId: string): UsePlayersReturn {
  const [data, setData] = useState<PlayersResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [acting, setActing] = useState(false);

  const refresh = useCallback(async () => {
    if (!serverId) {
      setData(null);
      setLoading(false);
      return;
    }
    try {
      const { data: body } = await apiClient.get<{ data: PlayersResponse }>(
        `/servers/${serverId}/players`,
      );
      setData(body.data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "获取玩家列表失败");
    } finally {
      setLoading(false);
    }
  }, [serverId]);

  useEffect(() => {
    setLoading(true);
    void refresh();
    if (!serverId) return;
    const timer = setInterval(() => void refresh(), POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [refresh, serverId]);

  const act = useCallback(
    async (
      steamId: string,
      action: PlayerAction,
      opts?: { reason?: string; durationMinutes?: number },
    ): Promise<string> => {
      setActing(true);
      try {
        const { data: body } = await apiClient.post<{
          data: { ok: boolean; message: string };
        }>(`/servers/${serverId}/players/action`, {
          steamId,
          action,
          ...(opts?.reason ? { reason: opts.reason } : {}),
          ...(opts?.durationMinutes != null
            ? { durationMinutes: opts.durationMinutes }
            : {}),
        });
        await refresh();
        return body.data.message;
      } catch (err) {
        const msg =
          (err as { response?: { data?: { error?: { message?: string } } } })
            ?.response?.data?.error?.message ??
          (err instanceof Error ? err.message : "操作失败");
        throw new Error(msg);
      } finally {
        setActing(false);
      }
    },
    [serverId, refresh],
  );

  return { data, loading, error, refresh, act, acting };
}
