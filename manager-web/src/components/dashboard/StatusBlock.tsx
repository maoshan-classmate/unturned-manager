import { useMemo } from "react";
import {
  Activity,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Power,
  RotateCw,
  Package,
  Plug,
  Loader2,
} from "lucide-react";
import { useIncidents, type Incident, type IncidentSeverity, type IncidentType } from "../../hooks/useIncidents.js";

interface StatusBlockProps {
  /** 实例标识 */
  serverId: string;
  /** 最多展示条数（默认 5） */
  maxItems?: number;
}

/** 事件类型 → 图标和中文标签 */
const TYPE_META: Record<
  IncidentType,
  { icon: typeof Activity; label: string }
> = {
  start: { icon: Power, label: "启动" },
  stop: { icon: Power, label: "停止" },
  restart: { icon: RotateCw, label: "重启" },
  mod_apply: { icon: Package, label: "Mod 应用" },
  ldm_apply: { icon: Plug, label: "插件框架" },
  crash: { icon: AlertTriangle, label: "异常退出" },
};

/** 严重程度 → 图标和颜色 */
const SEVERITY_META: Record<
  IncidentSeverity,
  { icon: typeof CheckCircle2; color: string; label: string }
> = {
  info: { icon: CheckCircle2, color: "text-emerald-500", label: "正常" },
  warning: { icon: AlertTriangle, color: "text-amber-500", label: "提示" },
  error: { icon: XCircle, color: "text-red-500", label: "错误" },
};

/** 时间格式化——同日内显示 HH:mm，否则 MM-DD HH:mm */
function formatTime(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) {
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  }
  return `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/**
 * Status Block 组件——Dashboard 顶置实时事件流。
 *
 * 边界：
 * - 仅展示最近 N 条（默认 5）；process 缓冲 100 条
 * - 严重程度三档：info/warning/error（绿/黄/红圆点）
 * - 中文消息 + 类型图标——符合界面文案规范
 * - 实时订阅 WS `incident_created`，无须轮询
 */
export function StatusBlock({ serverId, maxItems = 5 }: StatusBlockProps) {
  const { data, loading, error } = useIncidents(serverId);

  const items = useMemo(() => data.slice(0, maxItems), [data, maxItems]);

  return (
    <div
      data-testid="status-block"
      className="flex flex-col gap-3 rounded-lg p-4 bg-slate-800 border border-slate-700"
    >
      {/* ── 标题 ── */}
      <div className="flex items-center gap-2">
        <Activity size={16} style={{ color: "#22C55E" }} />
        <span className="text-sm text-slate-400">近期事件</span>
        <span className="text-xs text-slate-600 ml-auto">
          {data.length > 0 ? `共 ${data.length} 条` : ""}
        </span>
      </div>

      {/* ── 状态分支 ── */}
      {loading && data.length === 0 ? (
        <div className="flex items-center justify-center py-4 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin mr-2" />
          加载中...
        </div>
      ) : error ? (
        <div className="flex items-center justify-center py-4 text-sm text-red-500">
          {error}
        </div>
      ) : items.length === 0 ? (
        <div className="flex items-center justify-center py-4 text-sm text-slate-500">
          暂无事件
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((incident) => (
            <IncidentRow key={incident.id} incident={incident} />
          ))}
        </ul>
      )}
    </div>
 );
}

/** 单行事件展示 */
function IncidentRow({ incident }: { incident: Incident }) {
  const typeMeta = TYPE_META[incident.type];
  const severityMeta = SEVERITY_META[incident.severity];
  const SeverityIcon = severityMeta.icon;
  const TypeIcon = typeMeta.icon;

  return (
    <li
      data-testid={`incident-row-${incident.type}`}
      data-severity={incident.severity}
      className="flex items-center gap-3 text-xs"
    >
      <SeverityIcon
        size={14}
        className={severityMeta.color}
        aria-label={severityMeta.label}
      />
      <span className="text-slate-500 tabular-nums w-12 shrink-0">
        {formatTime(incident.timestamp)}
      </span>
      <span className="flex items-center gap-1 text-slate-400 w-16 shrink-0">
        <TypeIcon size={12} />
        {typeMeta.label}
      </span>
      <span className="text-slate-200 flex-1 truncate" title={incident.message}>
        {incident.message}
      </span>
      {incident.details?.durationMs !== undefined && (
        <span className="text-slate-600 tabular-nums shrink-0">
          {(incident.details.durationMs / 1000).toFixed(1)}s
        </span>
      )}
    </li>
  );
}
