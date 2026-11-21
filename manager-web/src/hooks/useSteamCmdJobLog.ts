import { useCallback, useEffect, useRef, useState } from "react";
import { useWebSocket } from "../contexts/WebSocketContext.js";
import { apiClient } from "../api/client.js";
import type { SteamCmdJobLogLine } from "@unturned-manager/shared";

/** 面板最多保留的输出行数（超出丢弃最早的） */
const MAX_LINES = 500;

/** 单个任务的输出记录 */
interface JobRecord {
  /** 输出行（按序号排序） */
  lines: SteamCmdJobLogLine[];
  /** 最新阶段标识 */
  stage?: string;
  /** 最新进度百分比 */
  percent?: number;
  /** 任务是否已结束 */
  finished: boolean;
  /** 失败原因 */
  errorMessage?: string;
  /** 任务开始时间（多个任务并存时用它判断哪个更新） */
  startedAt: string;
}

/** 任务输出状态 */
export interface SteamCmdJobLogState {
  /** 输出文本（按发生顺序） */
  lines: string[];
  /** 最新阶段标识 */
  stage?: string;
  /** 最新进度百分比 */
  percent?: number;
  /** 任务是否已结束 */
  finished: boolean;
  /** 失败原因 */
  errorMessage?: string;
  /** 清空当前显示的输出 */
  clear: () => void;
}

/**
 * 订阅安装 / 更新 / 重装任务的实时输出。
 *
 * 数据来自两处：
 * - 实时：WebSocket 推送的每行输出（安装过程中逐行到达）
 * - 历史：面板刷新后向服务端要回之前的输出，避免刷新一次就丢掉全部记录
 *
 * 两者靠「行序号」对齐——行序号在任务内从 0 递增，合并时按序号去重，
 * 因此不会出现重复行或错序。
 *
 * @param jobIds - 要监听的任务标识列表（如 `steamcmd-install-/opt/unturned`）
 * @returns 当前任务的输出状态——输出行、阶段、进度、是否结束、清空方法
 *
 * @example
 * ```tsx
 * const { lines, stage, finished } = useSteamCmdJobLog([
 *   `steamcmd-install-${installPath}`,
 * ]);
 * ```
 */
export function useSteamCmdJobLog(jobIds: string[]): SteamCmdJobLogState {
  const { subscribe } = useWebSocket();
  const [records, setRecords] = useState<Record<string, JobRecord>>({});
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  // 任务标识列表用 ref 保存——避免每次父组件渲染都重建订阅
  const jobIdsKey = jobIds.join("|");
  const jobIdsRef = useRef<string[]>(jobIds);
  jobIdsRef.current = jobIds;

  // 拉取历史输出（刷新页面后回看）
  useEffect(() => {
    const ids = jobIdsKey ? jobIdsKey.split("|") : [];
    if (ids.length === 0) return;
    let cancelled = false;

    void (async () => {
      for (const id of ids) {
        try {
          const res = await apiClient.get<{
            data: {
              lines: SteamCmdJobLogLine[];
              stage?: string;
              percent?: number;
              finished: boolean;
              errorMessage?: string;
              startedAt: string;
            };
          }>("/steamcmd/jobs/log", { params: { jobId: id } });
          if (cancelled) return;
          const log = res.data.data;
          if (!log || log.lines.length === 0) continue;
          setRecords((prev) => {
            const current = prev[id] ?? {
              lines: [],
              finished: false,
              startedAt: log.startedAt,
            };
            return {
              ...prev,
              [id]: {
                ...current,
                // 历史与实时按序号合并——历史快照可能不含刚收到的行，不能直接覆盖
                lines: mergeLines(current.lines, log.lines),
                stage: log.stage ?? current.stage,
                percent: log.percent ?? current.percent,
                finished: log.finished || current.finished,
                errorMessage: log.errorMessage ?? current.errorMessage,
              },
            };
          });
          setActiveJobId((prev) =>
            prev === null ? id : prev,
          );
        } catch {
          // 取不到历史就只显示实时输出——不打扰用户
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [jobIdsKey]);

  // 订阅实时输出
  useEffect(() => {
    return subscribe("steamcmd_progress", (msg) => {
      const jobId = typeof msg.jobId === "string" ? msg.jobId : "";
      if (!jobId || !jobIdsRef.current.includes(jobId)) return;

      setRecords((prev) => {
        const current = prev[jobId] ?? {
          lines: [],
          finished: false,
          startedAt: new Date().toISOString(),
        };
        const lines =
          typeof msg.line === "string"
            ? appendLine(current.lines, {
                seq: typeof msg.lineSeq === "number" ? msg.lineSeq : current.lines.length,
                text: msg.line,
              })
            : current.lines;
        const stage = typeof msg.stage === "string" ? msg.stage : current.stage;
        const finished =
          stage === "completed" || stage === "failed" ? true : current.finished;
        return {
          ...prev,
          [jobId]: {
            ...current,
            lines,
            stage,
            percent:
              typeof msg.percent === "number" ? msg.percent : current.percent,
            finished,
            errorMessage:
              typeof msg.errorMessage === "string"
                ? msg.errorMessage
                : current.errorMessage,
          },
        };
      });
      setActiveJobId(jobId);
    });
  }, [subscribe]);

  const clear = useCallback(() => {
    if (!activeJobId) return;
    setRecords((prev) => {
      const current = prev[activeJobId];
      if (!current) return prev;
      return { ...prev, [activeJobId]: { ...current, lines: [] } };
    });
  }, [activeJobId]);

  const active = activeJobId ? records[activeJobId] : undefined;

  return {
    lines: active ? active.lines.map((line) => line.text) : [],
    stage: active?.stage,
    percent: active?.percent,
    finished: active?.finished ?? false,
    errorMessage: active?.errorMessage,
    clear,
  };
}

/**
 * 追加一行输出——按序号去重（同一序号只保留一条）。
 * 行数超上限时丢弃最早的行。
 */
function appendLine(
  lines: SteamCmdJobLogLine[],
  next: SteamCmdJobLogLine,
): SteamCmdJobLogLine[] {
  return mergeLines(lines, [next]);
}

/**
 * 合并两份输出行——按序号去重后按序号排序。
 * 行数超上限时丢弃最早的行。
 */
function mergeLines(
  base: SteamCmdJobLogLine[],
  incoming: SteamCmdJobLogLine[],
): SteamCmdJobLogLine[] {
  const bySeq = new Map<number, SteamCmdJobLogLine>();
  for (const line of base) bySeq.set(line.seq, line);
  for (const line of incoming) bySeq.set(line.seq, line);
  const merged = [...bySeq.values()].sort((a, b) => a.seq - b.seq);
  return merged.length > MAX_LINES
    ? merged.slice(merged.length - MAX_LINES)
    : merged;
}
