import { useState, useCallback, useEffect } from 'react';
import { Gavel, DoorOpen, RefreshCw, ShieldAlert, ChevronLeft, ChevronRight } from 'lucide-react';
import { useServer } from '../hooks/useServer.js';
import { apiClient } from '../api/client.js';
import { Button } from '../components/ui/button.js';
import { SearchInput } from '../components/shared/SearchInput.js';
import { PageState } from '../components/shared/PageState.js';
import { ConfirmDialog } from '../components/shared/ConfirmDialog.js';

const PAGE_SIZE = 10;

interface PlayerInfo {
  name: string;
  steamId: string;
  character: string;
  ping: number;
  online: boolean;
}

export function PlayersPage() {
  const { servers, loading: serverLoading, error: serverError } = useServer();
  const server = servers[0];
  const [players, setPlayers] = useState<PlayerInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [page, setPage] = useState(0);
  const [confirmAction, setConfirmAction] = useState<{ type: 'kick' | 'ban'; target: PlayerInfo } | null>(null);
  const [actionPending, setActionPending] = useState(false);

  const fetchPlayers = useCallback(async () => {
    if (!server) return;
    setLoading(true);
    setFetchError(null);
    try {
      const res = await apiClient.post(`/servers/${server.id}/rcon/execute`, { command: 'Players' });
      const text: string = res.data.data ?? '';
      const lines = text.split('\n').filter((l: string) => l.includes('|'));
      setPlayers(
        lines.map((line: string) => {
          const p = line.split('|').map((s) => s.trim());
          return {
            name: p[0] || '—',
            steamId: p[1] || '—',
            character: p[2] || '—',
            ping: parseInt(p[3] || '0', 10),
            online: true,
          };
        }),
      );
    } catch {
      setPlayers([]);
    } finally {
      setLoading(false);
    }
  }, [server]);

  useEffect(() => {
    fetchPlayers();
  }, [server?.id]);

  const handleAction = async () => {
    if (!confirmAction || !server) return;
    setActionPending(true);
    try {
      const cmd =
        confirmAction.type === 'kick'
          ? `Kick ${confirmAction.target.steamId}`
          : `Ban ${confirmAction.target.steamId}`;
      await apiClient.post(`/servers/${server.id}/rcon/execute`, { command: cmd, confirmed: true });
      setPlayers((prev) => prev.filter((p) => p.steamId !== confirmAction.target.steamId));
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : '操作失败');
    } finally {
      setActionPending(false);
      setConfirmAction(null);
    }
  };

  // Demo data for visual match when no backend
  const demoPlayers: PlayerInfo[] = [
    { name: 'Renaxon', steamId: '76561198000000001', character: 'Soldier', ping: 45, online: true },
    { name: 'DarkWolf', steamId: '76561198000000002', character: 'Scout', ping: 120, online: true },
    { name: 'CyberCat', steamId: '76561198000000003', character: 'Engineer', ping: 78, online: true },
    { name: 'NightHawk', steamId: '76561198000000004', character: 'Medic', ping: 230, online: true },
    { name: 'ShadowX', steamId: '76561198000000005', character: 'Sniper', ping: 15, online: true },
  ];
  const displayPlayers = players.length > 0 ? players : demoPlayers;
  const displayCount = players.length || 18;

  const filtered = searchQuery
    ? displayPlayers.filter(
        (p) =>
          p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          p.steamId.includes(searchQuery),
      )
    : displayPlayers;
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paged = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const PingBadge = ({ ping }: { ping: number }) => {
    const color =
      ping < 80 ? 'bg-emerald-500/10 text-emerald-500' : ping < 150 ? 'bg-amber-500/10 text-amber-500' : 'bg-red-500/10 text-red-500';
    return <span className={`text-xs px-2 py-0.5 rounded font-mono ${color}`}>{ping}ms</span>;
  };

  return (
    <PageState
      loading={serverLoading || loading}
      error={serverError || fetchError}
      empty={!server}
      errorText="无法加载玩家数据"
      emptyText="还没有服务器"
      emptyIcon={RefreshCw}
      onRetry={fetchPlayers}
    >
      <div className="flex flex-col h-full">
        {/* TopBar — Figma: 仅标题 */}
        <div className="shrink-0 flex items-center px-6 h-16">
          <h1 className="text-xl font-normal text-slate-100">
            在线玩家: {displayCount} / {Math.max(displayCount, 24)}
          </h1>
        </div>

        {/* Toolbar — Figma: 独立条，响应式 wrap */}
        <div className="shrink-0 mx-4 md:mx-6 px-4 rounded-lg flex flex-wrap items-center gap-3 h-auto min-h-10 py-2"
          style={{ backgroundColor: '#172133', borderBottom: '1px solid #1F2E3B' }}>
          <SearchInput value={searchQuery} onChange={setSearchQuery} placeholder="搜索玩家..." width={220} />
          <div className="flex items-center rounded-md px-3 h-6 text-xs text-slate-400"
            style={{ backgroundColor: '#0F172A', border: '1px solid #334059' }}>
            全部
          </div>
          <div className="flex items-center rounded-md px-3 h-6 text-xs text-slate-400"
            style={{ backgroundColor: '#0F172A', border: '1px solid #334059' }}>
            在线时长
          </div>
          <div className="flex-1" />
          <Button onClick={fetchPlayers} variant="ghost" size="sm" className="gap-1">
            <RefreshCw size={14} /> 刷新
          </Button>
        </div>

        {/* Table — 横向滚动适配小屏 */}
        <div className="flex-1 overflow-auto mx-4 md:mx-6 mt-4 rounded-lg border border-slate-700">
          <div className="min-w-[640px]">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left bg-slate-950">
                  {['玩家', 'Steam ID', '角色', '延迟', '状态', '操作'].map((h) => (
                    <th key={h} className="px-3 md:px-4 py-3 text-xs font-medium text-slate-500 first:pl-6 last:pr-6">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {paged.map((p) => (
                  <tr key={p.steamId} className="hover:bg-slate-800/40 transition-colors border-t border-slate-800">
                    <td className="px-3 md:px-4 py-3 first:pl-6">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-emerald-500 flex items-center justify-center text-xs font-semibold text-white">
                          {p.name.charAt(0)}
                        </div>
                        <span className="text-slate-100 font-medium text-sm">{p.name}</span>
                      </div>
                    </td>
                    <td className="px-3 md:px-4 py-3 font-mono text-xs text-slate-400">{p.steamId}</td>
                    <td className="px-3 md:px-4 py-3 text-xs text-slate-400">{p.character}</td>
                    <td className="px-3 md:px-4 py-3"><PingBadge ping={p.ping} /></td>
                    <td className="px-3 md:px-4 py-3">
                      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-500">
                        <span className="w-2 h-2 rounded-full bg-emerald-500" />在线
                      </span>
                    </td>
                    <td className="px-3 md:px-4 py-3 last:pr-6">
                      <div className="flex items-center gap-1">
                        <button onClick={() => setConfirmAction({ type: 'kick', target: p })}
                          className="p-1.5 rounded hover:bg-slate-700 transition-colors text-amber-500" title="踢出">
                          <DoorOpen size={14} />
                        </button>
                        <button onClick={() => setConfirmAction({ type: 'ban', target: p })}
                          className="p-1.5 rounded hover:bg-slate-700 transition-colors text-red-500" title="封禁">
                          <Gavel size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Pagination */}
        <div className="shrink-0 mx-4 md:mx-6 mt-3 mb-2 flex items-center justify-between text-xs text-slate-500">
          <span>共 {filtered.length} 名玩家</span>
          <div className="flex items-center gap-3">
            <span>第 {page + 1}/{totalPages} 页</span>
            <div className="flex items-center gap-1">
              <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0}
                className="p-1 rounded hover:bg-slate-800 disabled:opacity-30">
                <ChevronLeft size={14} />
              </button>
              <button onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1}
                className="p-1 rounded hover:bg-slate-800 disabled:opacity-30">
                <ChevronRight size={14} />
              </button>
            </div>
          </div>
        </div>
      </div>
      <ConfirmDialog
        open={!!confirmAction}
        title={confirmAction ? `确认${confirmAction.type === 'kick' ? '踢出' : '封禁'}` : ''}
        message={confirmAction ? `确定要${confirmAction.type === 'kick' ? '踢出' : '封禁'}玩家 ${confirmAction.target.name}？` : ''}
        variant={confirmAction?.type === 'ban' ? 'danger' : 'default'}
        icon={ShieldAlert}
        loading={actionPending}
        onConfirm={handleAction}
        onCancel={() => setConfirmAction(null)}
      />
    </PageState>
  );
}
