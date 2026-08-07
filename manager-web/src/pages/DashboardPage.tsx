import { useState } from 'react';
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
} from 'lucide-react';
import { useServer, useServerActions } from '../hooks/useServer.js';
import { StatCard } from '../components/stats/StatCard.js';
import { Button } from '../components/ui/button.js';

/**
 * Dashboard 页面——Figma 2:2 🎨 Dashboard。
 *
 * 四张 StatCard + 快速操作按钮 + 图表占位。
 */
export function DashboardPage() {
  const { servers, loading, error, refresh } = useServer();
  const { start, stop, restart, pendingId } = useServerActions();
  const [actionError, setActionError] = useState<string | null>(null);

  // 取第一个服务器作为主显示（v1 单服或首服）
  const server = servers[0];

  const handleAction = async (
    action: 'start' | 'stop' | 'restart',
    serverId: string,
  ) => {
    setActionError(null);
    try {
      if (action === 'start') await start(serverId);
      else if (action === 'stop') await stop(serverId);
      else await restart(serverId);
      refresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : '操作失败');
    }
  };

  // ── Loading ──
  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin" style={{ color: '#22C55E' }} />
          <span className="text-sm" style={{ color: '#94A3B8' }}>
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
          <AlertCircle size={32} style={{ color: '#EF4444' }} />
          <span className="text-sm" style={{ color: '#F1F5FB' }}>
            无法加载服务器数据
          </span>
          <span className="text-xs" style={{ color: '#64748B' }}>
            {error}
          </span>
          <Button
            onClick={refresh}
            className="h-8 text-xs"
            style={{ backgroundColor: '#1E293B', color: '#94A3B8' }}
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
          <Server size={32} style={{ color: '#64748B' }} />
          <span className="text-sm" style={{ color: '#F1F5FB' }}>
            还没有服务器
          </span>
          <span className="text-xs" style={{ color: '#64748B' }}>
            在「服务器设置」中创建第一个 Unturned 服务端实例
          </span>
        </div>
      </div>
    );
  }

  // ── Server state helpers ──
  const state = server.state ?? 'STOPPED';
  const isRunning = state === 'RUNNING';
  const isDegraded = state === 'DEGRADED';
  const isTransitioning = state === 'STARTING' || state === 'STOPPING';
  const stateLabel: Record<string, string> = {
    STOPPED: '已停止',
    STARTING: '启动中',
    RUNNING: '运行中',
    DEGRADED: '降级运行',
    STOPPING: '停止中',
  };
  const stateColor: Record<string, string> = {
    STOPPED: '#64748B',
    STARTING: '#F59E0B',
    RUNNING: '#22C55E',
    DEGRADED: '#F59E0B',
    STOPPING: '#F59E0B',
  };

  return (
    <div className="flex flex-col gap-6">
      {/* ── 页面标题 ── */}
      <div className="flex items-center justify-between">
        <div>
          <h1
            className="text-2xl font-semibold m-0"
            style={{ color: '#F1F5FB' }}
          >
            {server.name || 'Dashboard'}
          </h1>
          <div className="flex items-center gap-2 mt-1">
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{ backgroundColor: stateColor[state] }}
            />
            <span className="text-sm" style={{ color: stateColor[state] }}>
              {stateLabel[state] ?? state}
            </span>
            <span className="text-xs" style={{ color: '#64748B' }}>
              {server.id} · 端口 {server.gamePort}
            </span>
          </div>
        </div>

        {/* ── Quick Actions ── */}
        <div className="flex items-center gap-2">
          {actionError && (
            <span className="text-xs" style={{ color: '#EF4444' }}>
              {actionError}
            </span>
          )}
          {!isRunning ? (
            <Button
              onClick={() => handleAction('start', server.id)}
              disabled={isTransitioning || pendingId !== null}
              className="h-8 gap-1.5 text-xs"
              style={{ backgroundColor: '#22C55E', color: '#F1F5FB' }}
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
                onClick={() => handleAction('restart', server.id)}
                disabled={pendingId !== null}
                className="h-8 gap-1.5 text-xs"
                style={{ backgroundColor: '#1E293B', color: '#94A3B8', border: '1px solid #334155' }}
              >
                <RefreshCw size={14} />
                重启
              </Button>
              <Button
                onClick={() => handleAction('stop', server.id)}
                disabled={pendingId !== null}
                className="h-8 gap-1.5 text-xs"
                style={{ backgroundColor: '#EF4444', color: '#F1F5FB' }}
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
          status={isRunning ? 'online' : isDegraded ? 'warning' : 'neutral'}
        />
        <StatCard
          icon={Users}
          label="在线玩家"
          value="—"
          subtext="A2S 查询待实现"
          status="neutral"
        />
        <StatCard
          icon={Cpu}
          label="CPU 使用"
          value="—"
          subtext="系统监控待实现"
          status="neutral"
        />
        <StatCard
          icon={Package}
          label="已装 Mod"
          value="—"
          subtext="Workshop 待实现"
          status="neutral"
        />
      </div>

      {/* ── Charts (占位) ── */}
      <div className="grid grid-cols-2 gap-4">
        <div
          className="flex flex-col items-center justify-center rounded-lg h-48"
          style={{ backgroundColor: '#1E293B', border: '1px solid #334155' }}
        >
          <span className="text-sm" style={{ color: '#64748B' }}>
            24h 玩家趋势图（Sprint 3）
          </span>
        </div>
        <div
          className="flex flex-col items-center justify-center rounded-lg h-48"
          style={{ backgroundColor: '#1E293B', border: '1px solid #334155' }}
        >
          <span className="text-sm" style={{ color: '#64748B' }}>
            资源使用图（Sprint 3）
          </span>
        </div>
      </div>
    </div>
  );
}
