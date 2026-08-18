import { useMemo } from "react";
import { Activity, Cpu, MemoryStick } from "lucide-react";
import NumberFlow from "@number-flow/react";
import {
  useMetrics,
  type MetricsSample,
  type MetricsWindow,
} from "../../hooks/useMetrics.js";

interface SystemMonitorCardProps {
  /** 实例标识（响应回传用，底层数据不区分 ServerID） */
  serverId: string;
}

const WINDOWS: MetricsWindow[] = ["1m", "5m", "15m"];

/** CPU 颜色阈值——>80% 视为高负载切 amber */
const CPU_HIGH_THRESHOLD = 80;

/**
 * 系统资源监控卡片（Dashboard 资源图后端支撑）。
 *
 * 边界（metrics.contract.ts + P3 设计稿 §2.2）：
 * - **多实例共装下不分 ServerID**：标题明示「系统资源（多实例）」
 * - **网络指标暂不暴露**：后端未实现，前端不画饼
 *
 * sparkline 手写 SVG `<polyline>`——不引入新库；
 * 数字滚动用 @number-flow/react（P1 已引入）。
 */
export function SystemMonitorCard({ serverId }: SystemMonitorCardProps) {
  const { data, loading, error, window, setWindow } = useMetrics(serverId);

  const samples = data?.samples ?? [];
  const current = data?.current;

  const cpuColor =
    current && current.cpuPercent > CPU_HIGH_THRESHOLD
      ? "text-amber-500"
      : "text-emerald-500";

  return (
    <div
      data-testid="system-monitor-card"
      className="flex flex-col h-full gap-4 rounded-lg p-5 bg-slate-800 border border-slate-700"
    >
      {/* ── 标题 + 时间窗切换 ── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Activity size={16} style={{ color: "#22C55E" }} />
          <span className="text-sm text-slate-400">系统资源（多实例）</span>
        </div>
        <div
          className="flex items-center gap-1 rounded p-0.5"
          style={{ backgroundColor: "#0F172A" }}
        >
          {WINDOWS.map((w) => (
            <button
              key={w}
              onClick={() => setWindow(w)}
              data-testid={`metrics-window-${w}`}
              className="px-2 py-0.5 rounded text-xs transition-colors"
              style={{
                backgroundColor: window === w ? "#1E293B" : "transparent",
                color: window === w ? "#F1F5FB" : "#64748B",
              }}
            >
              {w}
            </button>
          ))}
        </div>
      </div>

      {/* ── 状态分支：loading / error / data ── */}
      {loading && !data ? (
        <div className="flex-1 flex items-center justify-center text-sm text-slate-500">
          加载中...
        </div>
      ) : error ? (
        <div className="flex-1 flex items-center justify-center text-sm text-red-500">
          {error}
        </div>
      ) : (
        <>
          {/* ── CPU 行 ── */}
          <div className="flex items-center gap-4">
            <Cpu size={20} style={{ color: "#22C55E" }} />
            <span className="text-xs text-slate-500 w-10 shrink-0">CPU</span>
            <div className="flex items-baseline gap-1">
              {typeof current?.cpuPercent === "number" ? (
                <NumberFlow
                  value={current.cpuPercent}
                  format={{
                    minimumFractionDigits: 1,
                    maximumFractionDigits: 1,
                  }}
                  className={`text-2xl font-semibold tabular-nums ${cpuColor}`}
                />
              ) : (
                <span className="text-2xl font-semibold text-slate-500">—</span>
              )}
              <span className="text-xs text-slate-500">%</span>
            </div>
            <div className="flex-1 min-w-0">
              <Sparkline
                samples={samples}
                valueKey="cpuPercent"
                color={cpuColor === "text-amber-500" ? "#F59E0B" : "#22C55E"}
              />
            </div>
          </div>

          {/* ── 内存行 ── */}
          <div className="flex items-center gap-4">
            <MemoryStick size={20} style={{ color: "#3B82F6" }} />
            <span className="text-xs text-slate-500 w-10 shrink-0">内存</span>
            <div className="flex items-baseline gap-1">
              {typeof current?.memUsedMB === "number" ? (
                <>
                  <NumberFlow
                    value={current.memUsedMB}
                    format={{ maximumFractionDigits: 1 }}
                    className="text-2xl font-semibold tabular-nums text-slate-100"
                  />
                  <span className="text-xs text-slate-500">
                    / {Math.round(current.memTotalMB)} MB
                  </span>
                </>
              ) : (
                <span className="text-2xl font-semibold text-slate-500">—</span>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <Sparkline
                samples={samples}
                valueKey="memUsedMB"
                color="#3B82F6"
              />
            </div>
          </div>

          {/* ── 数据点统计 + 网络留白说明 ── */}
          <div className="flex items-center justify-between text-xs text-slate-500 mt-auto pt-2 border-t border-slate-700">
            <span>
              样本数 {samples.length} · 时间窗 {window}
            </span>
            <span title="后端未暴露网络指标（容器 + 多实例共装无法精确拆分）">
              网络 — 暂未启用
            </span>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Sparkline（手写 SVG polyline）────────────────────────

interface SparklineProps {
  samples: MetricsSample[];
  valueKey: "cpuPercent" | "memUsedMB";
  color: string;
  width?: number;
  height?: number;
}

/**
 * 折线图——samples 沿 x 轴均匀分布；y 按值范围映射。
 *
 * 边界：
 * - 仅渲染；不引入 recharts 等图表库（自写 SVG 避免 100kb+ 依赖）
 * - 1 个样本时回退为水平线，2 个样本时两点连线
 * - 0 样本时不渲染（不画坐标轴）
 */
function Sparkline({
  samples,
  valueKey,
  color,
  width = 200,
  height = 32,
}: SparklineProps) {
  const path = useMemo(() => {
    if (samples.length < 2) return null;

    const values = samples.map((s) => s[valueKey]);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;

    const stepX = width / (samples.length - 1);
    const points = samples
      .map((s, i) => {
        const x = i * stepX;
        const y =
          height - ((s[valueKey] - min) / range) * (height - 4) - 2; // 留 2px padding
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");

    return points;
  }, [samples, valueKey, width, height]);

  if (!path) return <div style={{ height }} data-testid="sparkline-empty" />;

  return (
    <svg
      data-testid="sparkline"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className="block"
      aria-hidden="true"
    >
      <polyline
        points={path}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}