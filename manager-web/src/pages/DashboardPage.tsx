import { useState, useEffect, useCallback } from "react";
import {
  Server,
  Users,
  Cpu,
  Package,
  Play,
  Square,
  RefreshCw,
  AlertCircle,
  Loader2,
} from "lucide-react";
import { useServer, useServerActions } from "../hooks/useServer.js";
import { apiClient } from "../api/client.js";
import { StatCard } from "../components/stats/StatCard.js";
import { Button } from "../components/ui/button.js";
import { ConfirmDialog } from "../components/shared/ConfirmDialog.js";

/**
 * Dashboard 页面——Figma 2:2 🎨 Dashboard。
 *
 * 四张 StatCard + 快速操作按钮。
 */
export function DashboardPage() {
  const { servers, loading, error, refresh } = useServer();
  const { start, stop, restart, pendingId } = useServerActions();
  const [actionError, setActionError] = useState<string | null>(null);
  const [modCount, setModCount] = useState<number | null>(null);

  // ConfirmDialog 状态
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmAction, setConfirmAction] = useState<
    "start" | "stop" | "restart"
  >("start");

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

  /** 触发确认弹窗 */
  const requestAction = (action: "start" | "stop" | "restart") => {
    setConfirmAction(action);
    setConfirmOpen(true);
  };

  /** 确认执行 */
  const handleAction = async () => {
    if (!server) return;
    setConfirmOpen(false);
    setActionError(null);
    try {
      if (confirmAction === "start") await start(server.id);
      else if (confirmAction === "stop") await stop(server.id);
      else await restart(server.id);
      // ★ ADR-0004 Phase 5：状态实时变化由 WS state_change 推送，无需手动 refresh()
      // 保留 refresh 仅作为兜底（WS 异常断开时仍能拉到最新状态）
      // 这里省一次 refresh 避免 setServers 覆盖 WS 已更新的 state
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "操作失败");
    }
  };

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
      {/* ── 页面标题 ── */}
      <div className="flex items-center justify-between">
        <div>
          <h1
            className="text-2xl font-semibold m-0"
            style={{ color: "#F1F5FB" }}
          >
            {server.name || "Dashboard"}
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

        {/* ── Quick Actions ── */}
        <div className="flex items-center gap-2">
          {actionError && (
            <span className="text-xs" style={{ color: "#EF4444" }}>
              {actionError}
            </span>
          )}
          {!isRunning ? (
            <Button
              onClick={() => requestAction("start")}
              disabled={isTransitioning || pendingId !== null}
              className="h-8 gap-1.5 text-xs"
              style={{ backgroundColor: "#22C55E", color: "#F1F5FB" }}
              aria-busy={pendingId === server.id}
            >
              {pendingId === server.id ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Play size={14} />
              )}
              启动
            </Button>
          ) : (
            <>
              <Button
                onClick={() => requestAction("restart")}
                disabled={pendingId !== null}
                className="h-8 gap-1.5 text-xs"
                style={{
                  backgroundColor: "#1E293B",
                  color: "#94A3B8",
                  border: "1px solid #334155",
                }}
              >
                <RefreshCw size={14} />
                重启
              </Button>
              <Button
                onClick={() => requestAction("stop")}
                disabled={pendingId !== null}
                className="h-8 gap-1.5 text-xs"
                style={{ backgroundColor: "#EF4444", color: "#F1F5FB" }}
              >
                <Square size={14} />
                停止
              </Button>
            </>
          )}
        </div>
      </div>

      {/* ── StatCards (Figma 5:34) ── */}
      <div className="grid grid-cols-4 gap-4">
        <StatCard
          icon={Server}
          label="服务器状态"
          value={stateLabel[state] ?? state}
          status={
            isRunning ? "online" : isTransitioning ? "warning" : "neutral"
          }
        />
        <StatCard
          icon={Users}
          label="在线玩家"
          value="—"
          subtext="需在「控制台」输入 Players 命令查看"
          status="neutral"
        />
        <StatCard
          icon={Cpu}
          label="CPU 使用"
          value="—"
          subtext="需部署后启用系统监控"
          status="neutral"
        />
        <StatCard
          icon={Package}
          label="已装 Mod"
          value={modCount != null ? String(modCount) : "—"}
          subtext={
            modCount != null && modCount > 0
              ? `${modCount} 个已启用`
              : "暂无已启用 Mod"
          }
          status="neutral"
        />
      </div>

      {/* ── Charts（需 U3DS 运行 + 历史数据积累后启用）── */}
      <div className="grid grid-cols-2 gap-4">
        <div
          className="flex flex-col items-center justify-center rounded-lg h-48"
          style={{ backgroundColor: "#1E293B", border: "1px solid #334155" }}
        >
          <span className="text-sm" style={{ color: "#64748B" }}>
            24h 玩家趋势图
          </span>
          <span className="text-xs mt-1" style={{ color: "#475569" }}>
            服务器运行后自动采集
          </span>
        </div>
        <div
          className="flex flex-col items-center justify-center rounded-lg h-48"
          style={{ backgroundColor: "#1E293B", border: "1px solid #334155" }}
        >
          <span className="text-sm" style={{ color: "#64748B" }}>
            资源使用图
          </span>
          <span className="text-xs mt-1" style={{ color: "#475569" }}>
            服务器运行后自动采集
          </span>
        </div>
      </div>

      {/* ConfirmDialog — Figma 12:16436 */}
      <ConfirmDialog
        open={confirmOpen}
        title={
          confirmAction === "start"
            ? "启动服务器"
            : confirmAction === "stop"
              ? "停止服务器"
              : "重启服务器"
        }
        message={
          confirmAction === "start"
            ? `确认启动服务器 ${server.name || server.id}？`
            : confirmAction === "stop"
              ? `确认停止服务器 ${server.name || server.id}？运行中的玩家将被断开连接。`
              : `确认重启服务器 ${server.name || server.id}？服务器将短暂不可用。`
        }
        confirmLabel={
          confirmAction === "start"
            ? "启动"
            : confirmAction === "stop"
              ? "停止"
              : "重启"
        }
        variant={confirmAction === "stop" ? "danger" : "default"}
        onConfirm={handleAction}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}
