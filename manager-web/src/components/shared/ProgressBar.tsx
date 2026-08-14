import { Loader2, AlertCircle, CheckCircle2 } from "lucide-react";
import { cn } from "../../lib/utils.js";

/**
 * 共享进度条组件（★ 2026-08-14 新增）。
 *
 * 用于 mod 下载 / U3DS 安装更新 / SteamCMD 重装等所有 SteamCMD 长任务。
 * 三态视觉：
 *  - indeterminate: percent 缺失时（解压 / validate 中间态）→ 琥珀色动画条纹
 *  - active: percent ≥ 0 时 → emerald 进度条
 *  - failed: stage === "failed" → 红色 + AlertCircle
 *  - completed: stage === "completed" → 绿色 + CheckCircle2
 *
 * @param props - 组件属性
 * @param props.stage - 当前阶段（queued/downloading/verifying/completed/failed 等）
 * @param props.percent - 0-100 进度；undefined → indeterminate
 * @param props.queuePos - ★ 2026-08-14 队列位置（≥2 显示「排队中」）
 * @param props.queueTotal - 排队总长度
 * @param props.errorMessage - 失败时的真实根因
 * @param props.className - 额外样式（容器）
 * @returns 进度条 React 元素
 *
 * @example
 * ```tsx
 * <ProgressBar stage="downloading" percent={45} />
 * <ProgressBar stage="queued" queuePos={2} queueTotal={3} />
 * <ProgressBar stage="failed" errorMessage="steamcmd-busy" />
 * ```
 */
export interface ProgressBarProps {
  stage: string;
  percent?: number;
  queuePos?: number;
  queueTotal?: number;
  errorMessage?: string;
  className?: string;
}

const HEIGHT_PX = 6;

export function ProgressBar({
  stage,
  percent,
  queuePos,
  queueTotal,
  errorMessage,
  className,
}: ProgressBarProps) {
  const isFailed = stage === "failed";
  const isCompleted = stage === "completed";
  const isQueued =
    stage === "queued" || (queuePos != null && queuePos > 1 && !isFailed && !isCompleted);

  // 颜色
  const barColor = isFailed
    ? "#EF4444" // red
    : isCompleted
      ? "#22C55E" // emerald
      : isQueued
        ? "#94A3B8" // slate（次级）
        : "#F59E0B"; // amber（活跃下载中）

  // 文案
  const label = isFailed
    ? `失败${errorMessage ? `: ${errorMessage}` : ""}`
    : isCompleted
      ? "已完成"
      : isQueued
        ? `排队中（前 ${(queuePos ?? 1) - 1} 个）`
        : percent != null
          ? `${stageLabel(stage)} ${percent}%`
          : stageLabel(stage);

  const safePercent = percent != null ? Math.min(100, Math.max(0, percent)) : 0;

  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <div className="flex items-center gap-2 text-xs" style={{ color: "#94A3B8" }}>
        {isFailed ? (
          <AlertCircle size={12} style={{ color: "#EF4444" }} />
        ) : isCompleted ? (
          <CheckCircle2 size={12} style={{ color: "#22C55E" }} />
        ) : isQueued ? null : (
          <Loader2
            size={12}
            className="animate-spin"
            style={{ color: barColor }}
          />
        )}
        <span>{label}</span>
        {queueTotal != null && queueTotal > 1 && (
          <span style={{ color: "#64748B" }}>
            · 共 {queueTotal} 个
          </span>
        )}
      </div>
      <div
        className="relative w-full overflow-hidden rounded"
        style={{
          height: HEIGHT_PX,
          backgroundColor: "#1E293B",
          border: "1px solid #334059",
        }}
        role="progressbar"
        aria-valuenow={isFailed || isCompleted ? 100 : safePercent}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        {percent == null && !isFailed && !isCompleted ? (
          // indeterminate 动画（条纹从左往右滑动）
          <div
            className="absolute inset-y-0 w-1/3"
            style={{
              backgroundColor: barColor,
              animation: "progressbar-indeterminate 1.4s ease-in-out infinite",
            }}
          />
        ) : (
          <div
            className="h-full transition-all duration-300"
            style={{
              width: `${safePercent}%`,
              backgroundColor: barColor,
            }}
          />
        )}
      </div>
    </div>
  );
}

function stageLabel(stage: string): string {
  switch (stage) {
    case "downloading":
      return "下载中";
    case "validating":
      return "校验中";
    case "verifying":
      return "校验中";
    case "installed":
      return "已安装";
    case "installing":
      return "安装中";
    case "updating":
      return "更新中";
    case "updated":
      return "已更新";
    case "spawned":
      return "准备中";
    case "preallocating":
      return "预分配";
    case "checking":
      return "检查中";
    default:
      return stage;
  }
}

// indeterminate 动画 keyframes（注入到全局 stylesheet 一次）
if (typeof document !== "undefined") {
  const STYLE_ID = "progressbar-indeterminate-keyframes";
  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      @keyframes progressbar-indeterminate {
        0% { left: -33%; }
        100% { left: 100%; }
      }
    `;
    document.head.appendChild(style);
  }
}