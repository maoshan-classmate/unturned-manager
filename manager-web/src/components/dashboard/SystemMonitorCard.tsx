import { Activity, Cpu, MemoryStick, HardDrive, Network } from "lucide-react";
import { useMetrics } from "../../hooks/useMetrics.js";
import { ResourceMetricCard } from "./ResourceMetricCard.js";
import { formatBytes, formatRate } from "../../lib/utils.js";

interface SystemMonitorCardProps {
  /** 实例标识（响应回传用，底层数据不区分 ServerID） */
  serverId: string;
}

/**
 * 系统资源监控卡——Dashboard 资源区后端支撑。
 *
 * 形态：2×2 网格 4 张资源指标卡（CPU/内存/磁盘/网络）。
 * - CPU/内存：来自实时采样
 * - 磁盘：启动时一次性快照，使用率 = 已用 / 总计
 * - 网络：全网卡累计字节数 + 差值速率
 *
 * @param props - 组件属性
 * @param props.serverId - 实例标识
 * @returns 资源监控卡 React 元素（loading/error/data 三态）
 *
 * @example
 * ```tsx
 * <SystemMonitorCard serverId="MyServer" />
 * ```
 */
export function SystemMonitorCard({ serverId }: SystemMonitorCardProps) {
  const { data, loading, error } = useMetrics(serverId);
  const current = data?.current;

  // 错误态：占满卡片显示
  if (error && !data) {
    return (
      <div
        data-testid="system-monitor-error"
        className="flex items-center justify-center h-full rounded-lg p-4 bg-slate-800 border border-slate-700 text-sm text-red-500"
      >
        {error}
      </div>
    );
  }

  const cpuPercent = current?.cpuPercent ?? null;
  const memPercent =
    current && current.memTotalMB > 0
      ? (current.memUsedMB / current.memTotalMB) * 100
      : null;
  const diskPercent =
    current?.diskUsedBytes !== null &&
    current?.diskUsedBytes !== undefined &&
    current?.diskTotalBytes !== null &&
    current?.diskTotalBytes !== undefined &&
    current.diskTotalBytes > 0
      ? (current.diskUsedBytes / current.diskTotalBytes) * 100
      : null;

  return (
    <div
      data-testid="system-monitor-card"
      className="grid grid-cols-2 gap-4 h-full"
    >
      <ResourceMetricCard
        icon={Cpu}
        title="CPU"
        percent={cpuPercent}
        subtext={
          current && typeof cpuPercent === "number"
            ? `${cpuPercent.toFixed(1)}% / 100%`
            : ""
        }
      />
      <ResourceMetricCard
        icon={MemoryStick}
        title="内存"
        percent={memPercent}
        subtext={
          current
            ? `${formatBytes(current.memUsedMB * 1024 * 1024)} / ${formatBytes(
                current.memTotalMB * 1024 * 1024,
              )}`
            : ""
        }
      />
      <ResourceMetricCard
        icon={HardDrive}
        title="磁盘"
        percent={diskPercent}
        subtext={
          current?.diskUsedBytes !== null && current?.diskUsedBytes !== undefined
            ? `${formatBytes(current.diskUsedBytes)} / ${formatBytes(
                current.diskTotalBytes ?? 0,
              )}`
            : ""
        }
      />
      <ResourceMetricCard
        icon={Network}
        title="网络"
        percent={null}
        subtext={
          current
            ? `↓ ${formatRate(current.networkRxRateBps)} · ↑ ${formatRate(current.networkTxRateBps)}`
            : ""
        }
      />
    </div>
  );
}