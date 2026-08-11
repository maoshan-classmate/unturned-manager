import { useState, useEffect, useCallback } from "react";
import { apiClient } from "../api/client.js";
import type { ServerId } from "@unturned-manager/shared";

/**
 * 已保存的终端会话记录（1:1 对齐后端 `PersistedTerminalSession`）。
 *
 * @property id - 会话 ID（= serverId，本项目 1 实例 1 PTY）
 * @property name - 用户可命名（默认 `终端 - <id>`）
 * @property workingDirectory - PTY cwd
 * @property createdAt - 创建时间 ISO 8601
 * @property lastActivity - 最后活跃时间 ISO 8601
 * @property isActive - PTY 进程是否在跑
 */
export interface PersistedTerminalSession {
  id: ServerId;
  name: string;
  workingDirectory: string;
  createdAt: string;
  lastActivity: string;
  isActive: boolean;
}

/**
 * 终端会话列表 hook——拉一次 `/api/sessions` → 返回 `{ active, saved }`。
 *
 * ADR-0005 Phase 7.2：面板启动后用户能再次访问已开过的终端（saved 列表）。
 * active = PTY 当前在跑；saved = PTY 已退出但 JSON 仍有记录。
 *
 * @returns 活跃与已存会话列表 + 重新拉取方法
 *
 * @example
 * ```tsx
 * const { active, saved, refresh } = useSessionManager();
 * // saved 中点击某个会话 → toast「这个终端已经断开，点启动重新打开」
 * ```
 */
export function useSessionManager(): {
  active: PersistedTerminalSession[];
  saved: PersistedTerminalSession[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
} {
  const [active, setActive] = useState<PersistedTerminalSession[]>([]);
  const [saved, setSaved] = useState<PersistedTerminalSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const { data } = await apiClient.get<{
        data: { active: PersistedTerminalSession[]; saved: PersistedTerminalSession[] };
      }>("/sessions");
      setActive(data.data.active);
      setSaved(data.data.saved);
      setError(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "获取终端会话列表失败";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { active, saved, loading, error, refresh };
}