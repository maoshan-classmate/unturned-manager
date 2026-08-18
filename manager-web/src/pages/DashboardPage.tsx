import { useState, useEffect, useCallback } from "react";
import {
  Server,
  Users,
  Cpu,
  Package,
  ArrowRight,
  AlertCircle,
  Loader2,
} from "lucide-react";
import { useServer } from "../hooks/useServer.js";
import { apiClient } from "../api/client.js";
import { StatCard } from "../components/stats/StatCard.js";
import { Button, buttonVariants } from "../components/ui/button.js";
import { cn } from "../lib/utils.js";

/**
 * Dashboard 页面——Figma 2:2 🎨 Dashboard。
 *
 * 只读概览：4 张 StatCard + 当前实例状态徽章 + 「前往控制台」跳转。
 * 服务器控制类操作（启动/停止/重启/保存命令）只出现在「服务器设置」页的
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
    fetchModCount();
  }, [fetchModCount]);

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

  // ── Server state helpers（ADR-0004 Phase 6：4 态，去 DEGRADED） ──
  const state = server.state ?? "STOPPED";
  const isRunning = state === "RUNNING";
  const isTransitioning = state === "STARTING" || state === "STOPPING";
  const stateLabel: Record<string, string> = {
    STOPPED: "已停止",
    STARTING: "启动中",
    RUNNING: "运行中",
    STOPPING: "停止中",
  };
  const stateColor: Record<string, string> = {
    STOPPED: "#64748B",
    STARTING: "#F59E0B",
    RUNNING: "#22C55E",
    STOPPING: "#F59E0B",
  };

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
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{ backgroundColor: stateColor[state] }}
            />
            <span className="text-sm" style={{ color: stateColor[state] }}>
              {stateLabel[state] ?? state}
            </span>
            <span className="text-xs" style={{ color: "#64748B" }}>
              {server.id} · 端口 {server.gamePort}
            </span>
          </div>
        </div>

        {/* ── 跳转入口 ── */}
        <div className="flex items-center gap-2">
          {/*
           * 复用 buttonVariants 样式——保留 a 链接语义（路由跳转、Cmd+Click 新标签页开），
           * 不强行用 Button 渲染（base-ui 官方不推荐把 Button render 成 a：链接有独立语义）。
           * 同一按钮视觉 = 全站视觉一致性闭环。
           */}
          <a
            href={`/${server.id}/server-setup`}
            className={cn(buttonVariants({ variant: "secondary", size: "default" }))}
          >
            <ArrowRight size={14} />
            前往服务器设置
          </a>
        </div>
      </div>

      {/* ── StatCards (Figma 5:34) ── */}
      <div className="grid grid-cols-4 gap-4">
        <StatCard
          icon={Server}
          label="服务器状态"
          value={stateLabel[state] ?? state}
          status={
            isRunning ? "online" : isTransitioning ? "transitioning" : "neutral"
          }
          enableStatusIndicator
        />
        <StatCard
          icon={Users}
          label="在线玩家"
          value="—"
          status="neutral"
        />
        <StatCard
          icon={Cpu}
          label="CPU 使用"
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
      </div>

      {/* ── 资源使用图占位 ── */}
      <div className="flex-1 rounded-lg border border-dashed flex flex-col items-center justify-center min-h-[200px]"
        style={{ borderColor: "#334059" }}
      >
        <span className="text-sm" style={{ color: "#64748B" }}>
          资源使用图
        </span>
        <span className="text-xs mt-1" style={{ color: "#475569" }}>
          服务器运行后自动采集
        </span>
      </div>
    </div>
  );
}