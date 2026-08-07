import { useState, useCallback, useEffect } from 'react';
import { Users, Gavel, DoorOpen, RefreshCw, ShieldAlert, ChevronLeft, ChevronRight } from 'lucide-react';
import { useServer } from '../hooks/useServer.js';
import { apiClient } from '../api/client.js';
import { Button } from '../components/ui/button.js';
import { SearchInput } from '../components/shared/SearchInput.js';
import { PageState } from '../components/shared/PageState.js';
import { ConfirmDialog } from '../components/shared/ConfirmDialog.js';

const PAGE_SIZE = 10;

interface PlayerInfo { name: string; steamId: string; character: string; ping: number; online: boolean; }

export function PlayersPage() {
  const { servers, loading: serverLoading, error: serverError } = useServer();
  const server = servers[0];
  const [players, setPlayers] = useState<PlayerInfo[]>([]);
  const [playersLoading, setPlayersLoading] = useState(false);
  const [playersError, setPlayersError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [page, setPage] = useState(0);
  const [confirmAction, setConfirmAction] = useState<{ type: 'kick' | 'ban'; target: PlayerInfo } | null>(null);
  const [actionPending, setActionPending] = useState(false);

  const fetchPlayers = useCallback(async () => {
    if (!server) return;
    setPlayersLoading(true); setPlayersError(null);
    try {
      const res = await apiClient.post(`/servers/${server.id}/rcon/execute`, { command: 'Players' });
      const text: string = res.data.data ?? '';
      const lines = text.split('\n').filter((l: string) => l.includes('|'));
      setPlayers(lines.map((line: string) => {
        const parts = line.split('|').map(s => s.trim());
        return { name: parts[0] || '—', steamId: parts[1] || '—', character: parts[2] || '—', ping: parseInt(parts[3] || '0', 10), online: true };
      }));
      setPage(0);
    } catch { setPlayers([]); }
    finally { setPlayersLoading(false); }
  }, [server]);

  useEffect(() => { fetchPlayers(); }, [server?.id]);

  const handleAction = async () => {
    if (!confirmAction || !server) return;
    setActionPending(true);
    try {
      const cmd = confirmAction.type === 'kick' ? `Kick ${confirmAction.target.steamId}` : `Ban ${confirmAction.target.steamId}`;
      await apiClient.post(`/servers/${server.id}/rcon/execute`, { command: cmd, confirmed: true });
      setPlayers(prev => prev.filter(p => p.steamId !== confirmAction.target.steamId));
    } catch (err) { setPlayersError(err instanceof Error ? err.message : '操作失败'); }
    finally { setActionPending(false); setConfirmAction(null); }
  };

  const filtered = searchQuery
    ? players.filter(p => p.name.toLowerCase().includes(searchQuery.toLowerCase()) || p.steamId.includes(searchQuery))
    : players;

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paged = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const pingBadge = (ping: number) => {
    let bg = 'rgba(34,197,94,0.15)', color = '#22C55E';
    if (ping >= 150) { bg = 'rgba(239,68,68,0.15)'; color = '#EF4444'; }
    else if (ping >= 80) { bg = 'rgba(245,158,11,0.15)'; color = '#F59E0B'; }
    return <span className="text-xs px-2 py-0.5 rounded font-mono" style={{ backgroundColor: bg, color }}>{ping}ms</span>;
  };

  return (
    <PageState loading={serverLoading || playersLoading} error={serverError || playersError} empty={!server} errorText="无法加载玩家数据" emptyText="还没有服务器" emptyIcon={Users} onRetry={fetchPlayers}>
      <div className="flex flex-col h-full gap-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold text-slate-100">Players</h1>
            <span className="text-xs px-2 py-0.5 rounded" style={{ backgroundColor: '#22C55E20', color: '#22C55E' }}>{players.length} 在线</span>
          </div>
          <div className="flex items-center gap-2">
            <SearchInput value={searchQuery} onChange={setSearchQuery} placeholder="搜索玩家..." />
            <Button onClick={fetchPlayers} variant="ghost" size="sm"><RefreshCw size={14} /> 刷新</Button>
          </div>
        </div>

        <div className="flex-1 overflow-auto rounded-lg" style={{ border: '1px solid #334059' }}>
          {paged.length === 0 ? (
            <div className="flex items-center justify-center h-32"><span className="text-sm text-slate-500">{searchQuery ? '没有匹配的玩家' : '暂无在线玩家'}</span></div>
          ) : (
            <table className="w-full text-sm">
              <thead><tr style={{ borderBottom: '1px solid #334059' }}>
                {['玩家', 'Steam ID', '角色', '延迟', '状态', '操作'].map(h => <th key={h} className="text-left px-3 py-2 text-xs font-medium text-slate-500">{h}</th>)}
              </tr></thead>
              <tbody>
                {paged.map(p => (
                  <tr key={p.steamId} className="hover:bg-slate-800/30" style={{ borderBottom: '1px solid #1E293B' }}>
                    <td className="px-3 py-2 flex items-center gap-2">
                      <div className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium" style={{ backgroundColor: '#22C55E', color: '#fff' }}>{p.name.charAt(0).toUpperCase()}</div>
                      <span className="text-slate-100" style={{ fontSize: 13 }}>{p.name}</span>
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-slate-400">{p.steamId}</td>
                    <td className="px-3 py-2 text-xs text-slate-400">{p.character}</td>
                    <td className="px-3 py-2">{pingBadge(p.ping)}</td>
                    <td className="px-3 py-2"><span className="inline-flex items-center gap-1 text-xs text-emerald-500"><span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500" />在线</span></td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1">
                        <button onClick={() => setConfirmAction({ type: 'kick', target: p })} className="p-1 rounded hover:bg-slate-700" title="踢出" style={{ color: '#F59E0B' }}><DoorOpen size={14} /></button>
                        <button onClick={() => setConfirmAction({ type: 'ban', target: p })} className="p-1 rounded hover:bg-slate-700" title="封禁" style={{ color: '#EF4444' }}><Gavel size={14} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {totalPages > 1 && (
          <div className="flex items-center justify-between text-xs text-slate-500 shrink-0">
            <span>共 {filtered.length} 名玩家 · 第 {page + 1}/{totalPages} 页</span>
            <div className="flex items-center gap-1">
              <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0} className="p-1 rounded hover:bg-slate-800 disabled:opacity-30"><ChevronLeft size={14} /></button>
              <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1} className="p-1 rounded hover:bg-slate-800 disabled:opacity-30"><ChevronRight size={14} /></button>
            </div>
          </div>
        )}
      </div>

      <ConfirmDialog open={!!confirmAction} title={confirmAction ? `确认${confirmAction.type === 'kick' ? '踢出' : '封禁'}` : ''} message={confirmAction ? `确定要${confirmAction.type === 'kick' ? '踢出' : '封禁'}玩家 ${confirmAction.target.name}？` : ''} variant={confirmAction?.type === 'ban' ? 'danger' : 'default'} icon={ShieldAlert} loading={actionPending} onConfirm={handleAction} onCancel={() => setConfirmAction(null)} />
    </PageState>
  );
}
