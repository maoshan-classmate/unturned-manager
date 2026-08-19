import { cn } from "../../lib/utils.js";

/**
 * ServerState 状态徽章。
 *
 * 圆点 pulse + STARTING 文字 spin：
 * - **圆点**：RUNNING 时持续呼吸（pulse 1.5s）；其他状态静态
 * - **文字**：STARTING/STOPPING 时旋转环（spin）；其他状态静态
 * - **颜色**：沿用 stateColor（emerald-500/amber-500/slate-500）
 *
 * 4 处复用：DashboardPage / ServerSetupPage（实例列表）/ ServerControlCard / U3dsCard。
 */
export type ServerStateName = "STOPPED" | "STARTING" | "RUNNING" | "STOPPING";

interface StatusBadgeProps {
  /** ServerState 枚举（4 状态机） */
  state: ServerStateName | string;
  /** 尺寸：sm=实例列表 / md=页面头部 */
  size?: "sm" | "md";
  /** 是否显示文字标签（false=仅圆点） */
  showLabel?: boolean;
  /** 自定义文字（缺省按中文字典） */
  label?: string;
  /** 自定义颜色（覆盖 stateColor 默认） */
  color?: string;
}

const STATE_COLOR: Record<string, string> = {
  STOPPED: "#64748B",
  STARTING: "#F59E0B",
  RUNNING: "#22C55E",
  STOPPING: "#F59E0B",
};

const STATE_LABEL: Record<string, string> = {
  STOPPED: "已停止",
  STARTING: "启动中",
  RUNNING: "运行中",
  STOPPING: "停止中",
};

/**
 * 状态徽章——圆点 + 文字 + 动效三件套。
 *
 * @param props - 组件属性
 * @param props.state - ServerState 状态
 * @param props.size - 尺寸档位（默认 md）
 * @param props.showLabel - 是否显示文字（默认 true）
 * @param props.label - 自定义文字（缺省按中文字典）
 * @param props.color - 自定义颜色（缺省按状态字典）
 * @returns 状态徽章 React 元素
 *
 * @example
 * ```tsx
 * <StatusBadge state="RUNNING" />
 * <StatusBadge state="STARTING" size="sm" />
 * <StatusBadge state="STOPPED" showLabel={false} />
 * ```
 */
export function StatusBadge({
  state,
  size = "md",
  showLabel = true,
  label,
  color,
}: StatusBadgeProps) {
  const isRunning = state === "RUNNING";
  const isTransitioning = state === "STARTING" || state === "STOPPING";
  const dotColor = color ?? STATE_COLOR[state] ?? "#64748B";
  const textLabel = label ?? STATE_LABEL[state] ?? state;

  const dotSize = size === "sm" ? "h-2 w-2" : "h-2.5 w-2.5";
  const textSize = size === "sm" ? "text-[10px]" : "text-xs";

  return (
    <span
      data-testid="status-badge"
      data-state={state}
      className="inline-flex items-center gap-2"
    >
      <span
        aria-hidden="true"
        className={cn(
          dotSize,
          "inline-block rounded-full shrink-0",
          isRunning && "animate-pulse",
        )}
        style={{ backgroundColor: dotColor }}
      />
      {showLabel && (
        <span
          className={cn(
            textSize,
            "font-medium tracking-wider",
            isTransitioning && "inline-flex items-center gap-1",
          )}
          style={{ color: dotColor }}
        >
          {isTransitioning && (
            <span
              aria-hidden="true"
              className="inline-block h-2.5 w-2.5 rounded-full border-2 border-current border-t-transparent animate-spin"
            />
          )}
          {textLabel}
        </span>
      )}
    </span>
  );
}
