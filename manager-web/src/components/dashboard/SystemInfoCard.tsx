import { Server, Loader2 } from "lucide-react";
import type { SystemInfo } from "@unturned-manager/shared";
import { Card } from "../shared/Card.js";

interface SystemInfoCardProps {
  /** 主机信息数据；undefined 表示首次采样未就绪 */
  data?: SystemInfo | null;
  /** 加载中态——true 时显示「加载中」而非「未知」 */
  loading?: boolean;
}

/** 单条键值对渲染——字段缺失时显示「未知」 */
function InfoRow({ label, value }: { label: string; value?: string | null }) {
  const display = !value ? "未知" : value;
  return (
    <div className="flex items-baseline gap-3">
      <dt className="text-xs text-slate-500 w-14 shrink-0">{label}</dt>
      <dd
        className={
          !value
            ? "text-sm text-slate-600"
            : "text-sm text-slate-100 font-mono"
        }
      >
        {display}
      </dd>
    </div>
  );
}

/**
 * 主机信息卡——Dashboard 系统资源区下方独立卡。
 *
 * 字段：操作系统 / 架构 / 内核 / 主机名 / CPU / 内存 / 监听 / 平台。
 * 数据来自 `useSystemInfo` hook。
 *
 * @param props - 组件属性
 * @param props.data - 主机信息响应；null/undefined 视为加载中
 * @param props.loading - 加载中态；true 时显示「加载中」而非「未知」
 * @returns 主机信息卡 React 元素
 *
 * @example
 * ```tsx
 * <SystemInfoCard data={info} />
 * <SystemInfoCard loading />
 * ```
 */
export function SystemInfoCard({ data, loading }: SystemInfoCardProps) {
  let portsDisplay = "未配置";
  if (data?.gamePort !== null && data?.gamePort !== undefined) {
    portsDisplay = `游戏 ${data.gamePort}`;
    if (data?.queryPort !== null && data?.queryPort !== undefined) {
      portsDisplay += ` / 查询 ${data.queryPort}`;
    }
  }

  if (loading && !data) {
    return (
      <Card icon={Server} title="主机信息">
        <div className="flex items-center gap-2 text-sm text-slate-500 py-3">
          <Loader2 className="h-4 w-4 animate-spin" style={{ color: "#22C55E" }} />
          加载中...
        </div>
      </Card>
    );
  }

  return (
    <Card icon={Server} title="主机信息">
      <dl className="grid grid-cols-2 gap-x-6 gap-y-2.5">
        <InfoRow label="操作系统" value={data?.distro ? `${data.distro} ${data.release}` : ""} />
        <InfoRow label="架构" value={data?.arch} />
        <InfoRow label="内核" value={data?.kernel} />
        <InfoRow label="主机名" value={data?.hostname} />
        <InfoRow label="CPU" value={data?.cpu?.brand} />
        <InfoRow label="内存" value={data?.memTotalMB !== undefined ? `${data.memTotalMB} MB` : ""} />
        <InfoRow label="监听" value={portsDisplay} />
        <InfoRow label="平台" value={data?.platform} />
      </dl>
    </Card>
  );
}