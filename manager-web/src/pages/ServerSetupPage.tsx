import { useState, useEffect, useCallback } from 'react';
import { Rocket, Plus, Server, Trash2, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import { useParams, useNavigate } from 'react-router-dom';
import { Button } from '../components/ui/button.js';
import { Card } from '../components/shared/Card.js';
import { ConfirmDialog } from '../components/shared/ConfirmDialog.js';
import { PageState } from '../components/shared/PageState.js';
import { apiClient } from '../api/client.js';
import { useServer } from '../hooks/useServer.js';
import { stateColor, stateLabel } from '../lib/utils.js';
import { SteamCmdCard } from '../components/server-setup/SteamCmdCard.js';
import { U3dsCard } from '../components/server-setup/U3dsCard.js';
import { ServerControlCard } from '../components/server-setup/ServerControlCard.js';
import { ScheduledTasksCard } from '../components/server-setup/ScheduledTasksCard.js';
import { CreateServerDialog } from '../components/server-setup/CreateServerDialog.js';

interface SteamCmdStatus {
  isInstalled: boolean;
  installPath?: string;
  version?: string;
  lastChecked?: string;
}

interface ServerCommands {
  commands: string;
}

const TIPS: never[] = [];

/**
 * 服务器设置页面——Figma 🎨 Server Setup 1:1 复刻 + 侧栏丰富化。
 *
 * 布局:
 * ┌─ Header (icon + 标题) ──────────────────────────────────────┐
 * ├─ 实例库侧栏(280px) ──┬─ 4 卡片 2×2 网格(主区域) ──────────┤
 * │  [+ 创建新实例]      │  [SteamCMD]   [U3DS]                │
 * │  ─ MyServer (●运行中)│  [Server Ctl] [Scheduled Tasks]    │
 * │  ─ Server2 (●已停止)│  ──────────────────────────────       │
 * │  ─ Server3 (...)    │  [操作提示] 3 条卡片(底部)         │
 * └────────────────────┴─────────────────────────────────────┘
 *
 * 数据来源:Gateway 已有 endpoints(servers / steamcmd/status / config/commands / scheduled-tasks)。
 */
export function ServerSetupPage() {
  const { serverId: routeServerId } = useParams<{ serverId: string }>();
  const { servers, loading, error, refresh, addServer, removeServer } = useServer();

  // 路由 serverId 优先;否则选第一个真实服务器
  const currentId = (routeServerId && routeServerId !== '_default')
    ? routeServerId
    : servers[0]?.id ?? '';
  const currentServer = servers.find((s) => s.id === currentId);

  // ── SteamCMD 状态(由 SteamCmdCard 通过 onStatusChange 回流) ──
  const [steamCmd, setSteamCmd] = useState<SteamCmdStatus | null>(null);

  // 创建实例 Dialog
  const [createOpen, setCreateOpen] = useState(false);

  // 删除实例 Dialog
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const navigate = useNavigate();

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      // 真实删除:DELETE /servers/:id + 内部 refresh(ADR-0003 B2 目录扫描真源)
      await removeServer(deleteTarget);
      toast.success(`实例「${deleteTarget}」已删除`);
      // 若删除当前选中实例,跳转到首个剩余实例
      if (deleteTarget === currentId) {
        const next = servers.filter((s) => s.id !== deleteTarget)[0];
        navigate(next ? `/${next.id}/server-setup` : '/_default/server-setup');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '删除实例失败');
    } finally {
      setDeleteTarget(null);
      setDeleting(false);
    }
  };

  // ── 当前 ServerID 的启动命令 ──
  const [commands, setCommands] = useState('');

  const fetchSteamCmd = useCallback(async () => {
    try {
      const res = await apiClient.get<{ data: SteamCmdStatus }>('/steamcmd/status');
      setSteamCmd(res.data.data);
    } catch {
      setSteamCmd({ isInstalled: false });
    }
  }, []);

  const fetchCommands = useCallback(async (id: string) => {
    try {
      const res = await apiClient.get<{ data: ServerCommands }>(`/servers/${id}/config/commands`);
      setCommands(res.data.data?.commands ?? '');
    } catch {
      setCommands('');
    }
  }, []);

  useEffect(() => { fetchSteamCmd(); }, [fetchSteamCmd]);
  useEffect(() => {
    if (currentId) fetchCommands(currentId);
  }, [currentId, fetchCommands]);

  return (
    <PageState loading={loading} error={error} empty={false} errorText="无法加载服务器">
      <div className="flex flex-col h-full overflow-hidden">
        {/* Header — Figma 9:15539 */}
        <div className="shrink-0 flex items-center gap-2 px-4 md:px-6 h-16">
          <Rocket size={24} className="text-emerald-500" />
          <h1 className="text-base font-medium text-slate-100">服务器部署与管理</h1>
          <span className="ml-auto text-sm text-slate-500">
            共 {servers.length} 个实例 · 当前:<span className="text-slate-300 ml-1">{currentServer?.name || currentServer?.id || '未选择'}</span>
          </span>
        </div>

        <div className="flex-1 flex gap-4 px-4 md:px-6 pb-4 overflow-hidden">
          {/* 实例库侧栏(280px) */}
          <aside className="w-[260px] shrink-0 flex flex-col rounded-lg border border-slate-700 bg-slate-800 overflow-hidden">
            <div className="px-3 py-3 border-b border-slate-700 flex items-center justify-between">
              <span className="text-sm font-medium text-slate-300">实例库</span>
              <Button size="sm" onClick={() => setCreateOpen(true)} className="h-7 text-sm gap-1 bg-emerald-500 text-white hover:bg-emerald-600">
                <Plus size={12} /> 新建
              </Button>
            </div>
            <div className="flex-1 overflow-auto divide-y divide-slate-700">
              {servers.length === 0 ? (
                <div className="px-3 py-6 text-center text-sm text-slate-500">
                  暂无实例,点击「新建」开始
                </div>
              ) : (
                servers.map((s) => (
                  <div
                    key={s.id}
                    className={`group flex items-center gap-2 px-3 py-2.5 text-sm hover:bg-slate-700/40 transition-colors ${
                      s.id === currentId ? 'bg-slate-700/30' : ''
                    }`}
                  >
                    <a
                      href={`/${s.id}/server-setup`}
                      className="flex items-center gap-2 flex-1 min-w-0"
                    >
                      <span
                        className="inline-block h-2 w-2 rounded-full shrink-0"
                        style={{ backgroundColor: stateColor(s.state ?? 'STOPPED') }}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="text-slate-100 truncate font-medium">{s.name || s.id}</div>
                        <div className="text-slate-500 text-[11px]">{stateLabel(s.state ?? 'STOPPED')}</div>
                      </div>
                      {s.id === currentId && <Server size={12} className="text-emerald-500 shrink-0" />}
                    </a>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      onClick={(e) => { e.preventDefault(); setDeleteTarget(s.id); }}
                      className="opacity-0 group-hover:opacity-100 text-red-500 hover:text-red-400 hover:bg-red-500/10"
                      aria-label={`删除实例 ${s.id}`}
                    >
                      <Trash2 size={12} />
                    </Button>
                  </div>
                ))
              )}
            </div>
          </aside>

          {/* 主区域:4 卡片 2×2 */}
          <div className="flex-1 grid grid-cols-1 lg:grid-cols-2 gap-4 overflow-auto">
            {/* Card - SteamCMD(左上) */}
            <SteamCmdCard status={steamCmd} onStatusChange={setSteamCmd} />

            {/* Card - U3DS(右上) */}
            <U3dsCard status={null} />

            {/* Card - Server Control(左下) */}
            {currentServer ? (
              <ServerControlCard
                serverId={currentServer.id}
                serverName={currentServer.name || currentServer.id}
                serverState={currentServer.state ?? 'STOPPED'}
                gamePort={currentServer.gamePort}
                queryPort={currentServer.gamePort + 1}
                commands={commands}
                onCommandsSaved={setCommands}
              />
            ) : (
              <Card icon={Rocket} title="服务器控制">
                <div className="flex flex-col items-center justify-center py-8 text-center text-xs text-slate-500 gap-3">
                  <Server size={28} className="text-slate-700" />
                  <span>尚未选择服务器实例</span>
                  <span className="text-[11px] text-slate-600">在左侧「实例库」选择一个,或点击「新建」</span>
                </div>
              </Card>
            )}

            {/* Card - Scheduled Tasks(右下) */}
            {currentId ? (
              <ScheduledTasksCard serverId={currentId} />
            ) : (
              <Card icon={Rocket} title="计划任务">
                <div className="flex items-center justify-center py-6 text-xs text-slate-500">
                  需要先选择服务器实例
                </div>
              </Card>
            )}
          </div>
        </div>

        {/* 创建实例 Dialog — 全页根级挂载 */}
        <CreateServerDialog
          open={createOpen}
          onClose={() => setCreateOpen(false)}
          onCreated={addServer}
        />

        {/* 删除实例 ConfirmDialog */}
        <ConfirmDialog
          open={!!deleteTarget}
          title="删除实例"
          message={`确定删除实例「${deleteTarget}」吗?将同时删除其 Servers/<id> 目录与所有配置(不可恢复)。`}
          confirmLabel="删除"
          variant="danger"
          icon={AlertCircle}
          loading={deleting}
          onConfirm={handleDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      </div>
    </PageState>
  );
}