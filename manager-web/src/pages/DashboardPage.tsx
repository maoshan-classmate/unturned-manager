import { useState, useEffect, useCallback } from "react";
import {
  Server,
  Users,
  Package,
  ArrowRight,
  AlertCircle,
  Loader2,
} from "lucide-react";
import { useServer } from "../hooks/useServer.js";
import { useSystemInfo } from "../hooks/useSystemInfo.js";
import { apiClient } from "../api/client.js";
import { StatCard } from "../components/stats/StatCard.js";
import { StaggerContainer } from "../components/shared/StaggerContainer.js";
import { SystemMonitorCard } from "../components/dashboard/SystemMonitorCard.js";
import { SystemInfoCard } from "../components/dashboard/SystemInfoCard.js";
import { StatusBlock } from "../components/dashboard/StatusBlock.js";
import { StatusBadge } from "../components/shared/StatusBadge.js";
import { Button, buttonVariants } from "../components/ui/button.js";
import { cn, formatStateBadge } from "../lib/utils.js";

/**
 * Dashboard 页面——Figma 2:2 🎨 Dashboard。
 *
 * 只读概览：4 张 StatCard + 当前实例状态徽章 + 「前往服务器设置」跳转 + 实时事件流 + 2×2 资源指标网格 + 主机信息卡。
 *
 * 服务端控制类操作（启动/停止/重启/保存命令）只出现在「服务器设置」页的
 * 服务器控制卡片——Dashboard 不重复入口，避免多页面状态不一致。
 */
export function DashboardPage() {
  const { servers, loading, error, refresh } = useServer();
  const [modCount, setModCount] = useState<number | null>(null);

  // 取第一个服务器作为主显示（v1 单服或首服）
  const server = servers[0];

  // 加载 Mod 数量
  const fetchModCount = useCallback(async () => {
    if (!server) {
      setModCount(null);
      return;
    }
    try {
      const res = await apiClient.get(`/servers/${server.id}/config/workshop`);
      setModCount(res.data.data?.File_IDs?.length ?? 0);
    } catch {
      setModCount(null);
    }
  }, [server?.id]);

  useEffect(() => {
    void fetchModCount();
  }, [fetchModCount]);

  // 主机信息——挂当前实例 serverId
  const { data: systemInfo, loading: systemInfoLoading } = useSystemInfo(
    server?.id,
  );

  // ── Loading ──
  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="flex flex-col items-center gap-3">
          <Loader2
            className="h-8 w-8 animate-spin"
            style={{ color: "#22C55E" }}
          />
          <span className="text-sm" style={{ color: "#94A3B8" }}>
            加载中...
          </span>
        </div>
      </div>
    );
  }

  // ── Error ──
  if (error) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="flex flex-col items-center gap-3 max-w-md text-center">
          <AlertCircle size={32} style={{ color: "#EF4444" }} />
          <span className="text-sm" style={{ color: "#F1F5FB" }}>
            无法加载服务器数据
          </span>
          <span className="text-xs" style={{ color: "#64748B" }}>
            {error}
          </span>
          <Button
            onClick={refresh}
            className="h-8 text-xs"
            style={{ backgroundColor: "#1E293B", color: "#94A3B8" }}
          >
            重试
          </Button>
        </div>
      </div>
    );
  }

  // ── Empty state ──
  if (!server) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="flex flex-col items-center gap-3 max-w-md text-center">
          <Server size={32} style={{ color: "#64748B" }} />
          <span className="text-sm" style={{ color: "#F1F5FB" }}>
            还没有服务器
          </span>
          <span className="text-xs" style={{ color: "#64748B" }}>
            在「服务器设置」中创建第一个 Unturned 服务端实例
          </span>
        </div>
      </div>
    );
  }

  // ── Server state helpers ──
  const state = server.state ?? "STOPPED";
  const isRunning = state === "RUNNING";
  const isTransitioning = state === "STARTING" || state === "STOPPING";

  return (
    <div className="flex flex-col gap-6">
      {/* ── 页面标题 + 状态徽章 + 跳转入口 ── */}
      <div className="flex items-center justify-between">
        <div>
          <h1
            className="text-2xl font-semibold m-0"
            style={{ color: "#F1F5FB" }}
          >
            {server.name || "仪表盘"}
          </h1>
          <div className="flex items-center gap-2 mt-1">
            <StatusBadge state={state} size="sm" />
            <span className="text-xs" style={{ color: "#64748B" }}>
              {server.id} · 端口{" "}
              <span className="font-mono tabular-nums">{server.gamePort}</span>
            </span>
          </div>
        </div>

        {/* ── 跳转入口 ── */}
        <div className="flex items-center gap-2">
          <a
            href={`/${server.id}/server-setup`}
            className={cn(buttonVariants({ variant: "secondary", size: "default" }))}
          >
            <ArrowRight size={14} />
            前往服务器设置
          </a>
        </div>
      </div>

      {/* ── Status Block — 实时事件流 ── */}
      <StatusBlock serverId={server.id} />

      {/* ── StatCards (Figma 5:34) 3 张横排 ——
          CPU 实时数据由下方 SystemMonitorCard 承载，避免主题重复 */}
      <StaggerContainer className="grid grid-cols-3 gap-4">
        <StatCard
          icon={Server}
          label="服务器状态"
          value={formatStateBadge(state)}
          status={
            isRunning ? "online" : isTransitioning ? "transitioning" : "neutral"
          }
        />
        <StatCard
          icon={Users}
          label="在线玩家"
          value="—"
          status="neutral"
        />
        <StatCard
          icon={Package}
          label="Mod 数"
          value={modCount === null ? "—" : modCount}
          status="neutral"
          enableNumberTicker
        />
      </StaggerContainer>

      {/* ── 资源指标 2×2 网格 — 自适应高度，不撑父级 ── */}
      <SystemMonitorCard serverId={server.id} />

      {/* ── 主机信息卡 ── */}
      <SystemInfoCard
        data={systemInfo}
        loading={systemInfoLoading}
      />
    </div>
  );
}