import { useState, useEffect } from "react";
import { useWebSocket } from "../contexts/WebSocketContext.js";

/**
 * SteamCMD 进度事件（来自 WS server 广播）
 * @property stage - 阶段标识：'downloading' | 'validating' | 'installed' | 'update complete' | 'failed' | 'completed' | 'spawned' | install/update 的阶段
 * @property percent - 进度 0-100（可选）
 * @property jobId - 任务 ID（区分多任务并发：'steamcmd-install-<dir>' | 'steamcmd-update-<dir>' | 'steamcmd-download-<dir>' | 'steamcmd-reinstall-<dir>' | 'steamcmd-check-<dir>'）
 * @property latestVersion - check-update 完成时携带的 U3DS 版本号（仅 check-update 的 completed 事件）
 * @property timestamp - 接收时间
 * @property queuePos - 队列位置（≥2 表示前面还有任务）。仅 stage==='queued' 携带。
 * @property queueTotal - 排队总长度（含当前正在跑的）
 * @property currentFileId - 当前正在下载的 mod 的 fileId（仅 mod 下载任务携带，stdout 解析）
 */
export interface SteamCmdProgress {
  stage: string;
  percent?: number;
  jobId?: string;
  latestVersion?: string;
  /**
   * 失败时的真实根因描述（仅 stage === "failed" 携带）。
   * 对应后端 install-script-missing 等后台诊断信息——前端 toast 用此替代硬编码通用文案。
   */
  errorMessage?: string;
  timestamp: string;
  /**
   * 队列位置。≥2 表示「前面还有 N 个任务在跑」。
   * 下载请求全部进队串行执行，避免并发冲突。
   */
  queuePos?: number;
  queueTotal?: number;
  /**
   * 当前正在下载的 mod 的 fileId。SteamCMD 输出「Downloading item <id>...」时携带——
   * 前端按 fileId 各自渲染进度条。
   */
  currentFileId?: string;
}

interface UseSteamCmdProgressOptions {
  /** 可选：只监听特定 jobId（不传 = 监听全部） */
  jobId?: string;
}

/**
 * 订阅 SteamCMD 安装/更新/下载进度。
 * 改用全局 WS 事件总线的 `subscribe('steamcmd_progress')`，
 * 与其他 hook 共享单连接、共享重连。
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
  const { jobId } = options;
  const { subscribe } = useWebSocket();
  const [progress, setProgress] = useState<SteamCmdProgress | null>(null);

  useEffect(() => {
    return subscribe("steamcmd_progress", (msg) => {
      // jobId 过滤（可选）
      if (jobId && msg.jobId !== jobId) return;
      if (typeof msg.stage !== "string") return;

      setProgress({
        stage: msg.stage,
        ...(typeof msg.percent === "number" ? { percent: msg.percent } : {}),
        ...(typeof msg.jobId === "string" ? { jobId: msg.jobId } : {}),
        ...(typeof msg.latestVersion === "string"
          ? { latestVersion: msg.latestVersion }
          : {}),
        ...(typeof msg.errorMessage === "string"
          ? { errorMessage: msg.errorMessage }
          : {}),
        ...(typeof msg.queuePos === "number" ? { queuePos: msg.queuePos } : {}),
        ...(typeof msg.queueTotal === "number"
          ? { queueTotal: msg.queueTotal }
          : {}),
        ...(typeof msg.currentFileId === "string"
          ? { currentFileId: msg.currentFileId }
          : {}),
        timestamp: new Date().toISOString(),
      });
    });
  }, [jobId, subscribe]);

  return progress;
}
