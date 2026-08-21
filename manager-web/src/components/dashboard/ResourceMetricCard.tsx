import type { LucideIcon } from "lucide-react";
import { Card } from "../shared/Card.js";

/** 阈值常量——超过该百分比进度条变红 */
const DANGER_THRESHOLD = 90;

interface ResourceMetricCardProps {
  /** 指标图标 */
  icon: LucideIcon;
  /** 卡片标题 */
  title: string;
  /** 使用率百分比 0–100；null = 首次采样未就绪 */
  percent: number | null;
  /** 副信息文本（如「已用 4.2 GB / 总计 16 GB」） */
  subtext?: string;
}

/**
 * 资源指标卡——Dashboard 系统资源区 2×2 网格单卡。
 *
 * 形态：复用 `Card` 容器 + 自实现纯色横向进度条。不引入 ProgressBar
 * （ProgressBar 的 stage 字段会输出英文标签，与本场景不符）。
 *
 * @param props - 组件属性
 * @param props.icon - 指标图标
 * @param props.title - 卡片标题
 * @param props.percent - 0–100；null = 首次采样未就绪
 * @param props.subtext - 副信息文本
 * @returns 资源指标卡 React 元素
 *
 * @example
 * ```tsx
 * <ResourceMetricCard icon={Cpu} title="CPU" percent={42.3} subtext="4 核" />
 * ```
 */
export function ResourceMetricCard({
  icon: Icon,
  title,
  percent,
  subtext,
}: ResourceMetricCardProps) {
  const safePercent = percent !== null ? Math.min(100, Math.max(0, percent)) : 0;
  const danger = percent !== null && percent >= DANGER_THRESHOLD;

  return (
    <Card icon={Icon} title={title}>
      <div className="flex flex-col gap-2">
        <div className="flex items-baseline gap-2">
          {percent === null ? (
            <span className="text-2xl font-semibold tabular-nums text-slate-500">
              —
            </span>
          ) : (
            <span
              data-testid="metric-percent"
              className={
                danger
                  ? "text-2xl font-semibold tabular-nums text-red-500"
                  : "text-2xl font-semibold tabular-nums text-slate-100"
              }
            >
              {safePercent.toFixed(1)}
              <span className="text-sm text-slate-500 ml-0.5">%</span>
            </span>
          )}
          {subtext && (
            <span className="text-xs text-slate-500 truncate" title={subtext}>
              {subtext}
            </span>
          )}
        </div>
        {/* 简洁进度条——纯色，无 stage 文字 */}
        <div
          role="progressbar"
          aria-valuenow={percent === null ? 0 : Math.round(safePercent)}
          aria-valuemin={0}
          aria-valuemax={100}
          data-testid="metric-progress"
          className="h-1.5 w-full rounded bg-slate-700 overflow-hidden"
        >
          <div
            className="h-full transition-all duration-300"
            style={{
              width: `${safePercent}%`,
              backgroundColor: danger ? "#EF4444" : "#22C55E",
            }}
          />
        </div>
      </div>
    </Card>
  );
}