import { useQuery } from "@tanstack/react-query";
import { Package, Folder, Hash, Calendar } from "lucide-react";
import { apiClient } from "../../api/client.js";
import { Card } from "../shared/Card.js";
import { formatDate } from "../../lib/utils.js";

/** LDM 统一状态响应（GET /api/servers/:id/ldm/status） */
interface LdmStatus {
  serverId: string;
  ldmInstalled: boolean;
  rocketDirExists: boolean;
  pluginCount: number;
  detectedAtIso: string;
}

/**
 * LDM 状态卡片——展示主框架是否安装 + Rocket/ 目录存在性 + 插件总数 + 检测时间。
 * 安装在「已装插件」Tab 顶部，作为页面进入后的第一眼状态总览。
 *
 * 数据源：`GET /api/servers/:id/ldm/status`。
 *
 * @param props - 组件属性
 * @param props.serverId - 实例标识
 * @returns 状态卡片 React 元素；loading/error/empty 时展示对应文案
 *
 * @example
 * ```tsx
 * <LdmStatusCard serverId="MyServer" />
 * ```
 */
export function LdmStatusCard({ serverId }: { serverId: string }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["ldm", "status", serverId],
    queryFn: async () => {
      const res = await apiClient.get<{ data: LdmStatus }>(
        `/servers/${serverId}/ldm/status`,
      );
      return res.data.data;
    },
    enabled: !!serverId,
    staleTime: 60_000,
  });

  if (isLoading) {
    return (
      <Card title="Mod 框架状态">
        <div className="text-xs" style={{ color: "#94A3B8" }}>
          加载中…
        </div>
      </Card>
    );
  }
  if (error || !data) {
    return (
      <Card title="Mod 框架状态">
        <div className="text-xs" style={{ color: "#EF4444" }}>
          状态读取失败
        </div>
      </Card>
    );
  }

  return (
    <Card title="Mod 框架状态">
      <div className="grid grid-cols-3 gap-3">
        <StatusItem
          icon={Package}
          label="主框架"
          ok={data.ldmInstalled}
          okText="已安装"
          failText="未安装"
        />
        <StatusItem
          icon={Folder}
          label="配置目录"
          ok={data.rocketDirExists}
          okText="已生成"
          failText="未生成"
        />
        <div
          className="rounded p-2 flex flex-col gap-1"
          style={{ backgroundColor: "#0F172A" }}
        >
          <div className="flex items-center gap-1 text-xs" style={{ color: "#94A3B8" }}>
            <Hash size={12} />
            插件总数
          </div>
          <div className="text-base font-medium" style={{ color: "#F1F5FB" }}>
            {data.pluginCount}
          </div>
        </div>
      </div>
      <div
        className="flex items-center gap-1 text-xs mt-2"
        style={{ color: "#64748B" }}
      >
        <Calendar size={11} />
        检测于 {formatDate(data.detectedAtIso)}
      </div>
    </Card>
  );
}

/** 单个状态项——绿/灰徽章 + 文字 */
function StatusItem({
  icon: Icon,
  label,
  ok,
  okText,
  failText,
}: {
  icon: typeof Package;
  label: string;
  ok: boolean;
  okText: string;
  failText: string;
}) {
  return (
    <div
      className="rounded p-2 flex flex-col gap-1"
      style={{ backgroundColor: "#0F172A" }}
    >
      <div className="flex items-center gap-1 text-xs" style={{ color: "#94A3B8" }}>
        <Icon size={12} />
        {label}
      </div>
      <div
        className="flex items-center gap-1 text-xs"
        style={{ color: ok ? "#22C55E" : "#94A3B8" }}
      >
        <span
          className="inline-block w-1.5 h-1.5 rounded-full"
          style={{ backgroundColor: ok ? "#22C55E" : "#64748B" }}
        />
        {ok ? okText : failText}
      </div>
    </div>
  );
}