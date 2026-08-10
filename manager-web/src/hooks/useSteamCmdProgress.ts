import { useState, useEffect, useRef } from "react";
import { ensureAccessToken } from "../api/client.js";

/**
 * SteamCMD 进度事件（来自 WS server 广播）
 * @property stage - 阶段标识：'downloading' | 'validating' | 'installed' | 'update complete' | 'failed' | 'completed' | 'spawned' | install/update 的阶段
 * @property percent - 进度 0-100（可选）
 * @property jobId - 任务 ID（区分多任务并发：'steamcmd-install-<dir>' | 'steamcmd-update-<dir>' | 'steamcmd-download-<dir>' | 'steamcmd-reinstall-<dir>' | 'steamcmd-check-<dir>'）
 * @property latestVersion - check-update 完成时携带的 U3DS 版本号（仅 check-update 的 completed 事件）
 * @property timestamp - 接收时间
 */
export interface SteamCmdProgress {
  stage: string;
  percent?: number;
  jobId?: string;
  latestVersion?: string;
  timestamp: string;
}

interface UseSteamCmdProgressOptions {
  /** 可选：只监听特定 jobId（不传 = 监听全部） */
  jobId?: string;
  /** WebSocket 路径，默认 '/ws' */
  wsPath?: string;
}

/**
 * 订阅 SteamCMD 安装/更新/下载进度。
 * 抄 useConsole.ts:38-104 同款建连模式（独立 ws + 退避重连）。
 * **不**复用 WebSocketContext（后者只暴露 connected: boolean，不分发事件，详见 WebSocketContext.tsx:7-8）。
 *
 * @param options - jobId 单任务订阅；不传订阅全部
 * @returns 最新一条进度事件；未启动返回 null
 *
 * @example
 * ```tsx
 * // 监听特定任务的进度（推荐——多任务并发时隔离）
 * const progress = useSteamCmdProgress({ jobId: `steamcmd-install-${installDir}` });
 *
 * // 监听全部 SteamCMD 进度
 * const progress = useSteamCmdProgress();
 * ```
 */
export function useSteamCmdProgress(
  options: UseSteamCmdProgressOptions = {},
): SteamCmdProgress | null {
  const { jobId, wsPath = "/ws" } = options;
  const [progress, setProgress] = useState<SteamCmdProgress | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryDelay = useRef(1000);
  const cancelledRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;

    async function connect() {
      // 卡 B 安全：WS 必须用 accessToken（短期 15min）；同 useConsole.ts:43-46
      const token = await ensureAccessToken();
      if (!token || cancelledRef.current) return;

      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const ws = new WebSocket(
        `${protocol}//${window.location.host}${wsPath}?token=${token}`,
      );
      wsRef.current = ws;

      ws.onopen = () => {
        retryDelay.current = 1000;
        // 订阅所有事件（gateway 默认 null = 接收所有类型，gateway.ts:67-69）
        ws.send(
          JSON.stringify({
            type: "subscribe",
            serverIds: [],
            eventTypes: null,
          }),
        );
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type !== "steamcmd_progress") return;
          // jobId 过滤（可选）
          if (jobId && msg.jobId !== jobId) return;

          setProgress({
            stage: msg.stage,
            percent: msg.percent,
            jobId: msg.jobId,
            ...(msg.latestVersion ? { latestVersion: msg.latestVersion } : {}),
            timestamp: new Date().toISOString(),
          });
        } catch {
          // 忽略非 JSON 消息
        }
      };

      ws.onclose = () => {
        if (cancelledRef.current) return;
        // 退避重连：同 useConsole.ts 模式
        retryTimer.current = setTimeout(() => {
          retryDelay.current = Math.min(retryDelay.current * 2, 30_000);
          connect();
        }, retryDelay.current);
      };

      ws.onerror = () => ws.close();
    }
    connect();

    return () => {
      cancelledRef.current = true;
      if (retryTimer.current) clearTimeout(retryTimer.current);
      wsRef.current?.close();
    };
  }, [jobId, wsPath]);

  return progress;
}
