import { useState, useCallback, useEffect } from 'react';
import { Gavel, DoorOpen, RefreshCw, ShieldAlert } from 'lucide-react';
import { useServer } from '../hooks/useServer.js';
import { apiClient } from '../api/client.js';
import { Button } from '../components/ui/button.js';
import { SearchInput } from '../components/shared/SearchInput.js';
import { PageState } from '../components/shared/PageState.js';
import { ConfirmDialog } from '../components/shared/ConfirmDialog.js';
import { DataTable, type DataTableColumn } from '../components/shared/DataTable.js';

const PAGE_SIZE = 10;

interface PlayerInfo {
  name: string; steamId: string; character: string; ping: number; online: boolean;
}

const COLUMNS: DataTableColumn[] = [
  { key: 'name', label: '玩家' },
  { key: 'steamId', label: 'Steam ID' },
  { key: 'character', label: '角色' },
  { key: 'ping', label: '延迟' },
  { key: 'status', label: '状态' },
  { key: 'actions', label: '操作' },
];

function PingBadge({ ping }: { ping: number }) {
  const color = ping < 80 ? 'bg-emerald-500/10 text-emerald-500' : ping < 150 ? 'bg-amber-500/10 text-amber-500' : 'bg-red-500/10 text-red-500';
  return <span className={`text-xs px-2 py-0.5 rounded font-mono ${color}`}>{ping}ms</span>;
}

export function PlayersPage() {
  const { servers, loading: serverLoading, error: serverError } = useServer();
  const server = servers[0];
  const [players, setPlayers] = useState<PlayerInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [page, setPage] = useState(1);
  const [confirmAction, setConfirmAction] = useState<{ type: 'kick' | 'ban'; target: PlayerInfo } | null>(null);
  const [actionPending, setActionPending] = useState(false);

  const fetchPlayers = useCallback(async () => {
    if (!server) return;
    setLoading(true); setFetchError(null);
    try {
      const res = await apiClient.get(`/servers/${server.id}/players`);
      const data = res.data.data;
      if (data?.players) {
        setPlayers(data.players.map((p: { name: string; steamId: string; character: string; ping: number; timeOnline: string }) => ({
          ...p,
          online: true,
        })));
      } else {
        setPlayers([]);
      }
    } catch { setPlayers([]); } finally { setLoading(false); }
  }, [server]);

  useEffect(() => { fetchPlayers(); }, [server?.id]);

  const handleAction = async () => {
    if (!confirmAction || !server) return;
    setActionPending(true);
    try {
      const cmd = confirmAction.type === 'kick' ? `Kick ${confirmAction.target.steamId}` : `Ban ${confirmAction.target.steamId}`;
      await apiClient.post(`/servers/${server.id}/rcon/execute`, { command: cmd, confirmed: true });
      setPlayers((prev) => prev.filter((p) => p.steamId !== confirmAction.target.steamId));
    } catch (err) { setFetchError(err instanceof Error ? err.message : '操作失败'); }
    finally { setActionPending(false); setConfirmAction(null); }
  };

  const displayPlayers = players;
  const displayCount = players.length;

  const filtered = searchQuery
    ? displayPlayers.filter((p) => p.name.toLowerCase().includes(searchQuery.toLowerCase()) || p.steamId.includes(searchQuery))
    : displayPlayers;
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  // Convert player rows to DataTable format
  const rowData = paged.map((p) => ({
    _key: p.steamId,
    name: (
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-full bg-emerald-500 flex items-center justify-center text-xs font-semibold text-white">{p.name.charAt(0)}</div>
        <span className="text-slate-100 font-medium text-sm">{p.name}</span>
      </div>
    ),
    steamId: <span className="font-mono text-xs text-slate-400">{p.steamId}</span>,
    character: <span className="text-xs text-slate-400">{p.character}</span>,
    ping: <PingBadge ping={p.ping} />,
    status: (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-500">
        <span className="w-2 h-2 rounded-full bg-emerald-500" />在线
      </span>
    ),
    actions: (
      <div className="flex items-center gap-1">
        <button onClick={() => setConfirmAction({ type: 'kick', target: p })} className="p-1.5 rounded hover:bg-slate-700 transition-colors text-amber-500" title="踢出"><DoorOpen size={14} /></button>
        <button onClick={() => setConfirmAction({ type: 'ban', target: p })} className="p-1.5 rounded hover:bg-slate-700 transition-colors text-red-500" title="封禁"><Gavel size={14} /></button>
      </div>
    ),
  }));

  return (
    <PageState loading={serverLoading || loading} error={serverError || fetchError} empty={false}
      errorText="无法加载玩家数据" emptyText="" onRetry={fetchPlayers}>
      <div className="flex flex-col h-full">
        <div className="shrink-0 flex items-center px-6 h-16">
          <h1 className="text-xl font-normal text-slate-100">在线玩家: {displayCount} / {Math.max(displayCount, 24)}</h1>
        </div>
        <div className="shrink-0 mx-4 md:mx-6 px-4 rounded-lg flex flex-wrap items-center gap-3 h-auto min-h-10 py-2"
          style={{ backgroundColor: '#172133', borderBottom: '1px solid #1F2E3B' }}>
          <SearchInput value={searchQuery} onChange={setSearchQuery} placeholder="搜索玩家..." width={220} />
          <div className="flex items-center rounded-md px-3 h-6 text-xs text-slate-400"
            style={{ backgroundColor: '#0F172A', border: '1px solid #334059' }}>全部</div>
          <div className="flex items-center rounded-md px-3 h-6 text-xs text-slate-400"
            style={{ backgroundColor: '#0F172A', border: '1px solid #334059' }}>在线时长</div>
          <div className="flex-1" />
          <Button onClick={fetchPlayers} variant="ghost" size="sm" className="gap-1"><RefreshCw size={14} /> 刷新</Button>
        </div>
        <div className="flex flex-col flex-1 mx-4 md:mx-6 mt-4">
          <DataTable columns={COLUMNS} data={rowData} keyField="_key" emptyText="暂无在线玩家"
            pagination={{ page, pageSize: PAGE_SIZE, total: filtered.length, onPageChange: setPage }} />
        </div>
      </div>
      <ConfirmDialog open={!!confirmAction}
        title={confirmAction ? `确认${confirmAction.type === 'kick' ? '踢出' : '封禁'}` : ''}
        message={confirmAction ? `确定要${confirmAction.type === 'kick' ? '踢出' : '封禁'}玩家 ${confirmAction.target.name}？` : ''}
        variant={confirmAction?.type === 'ban' ? 'danger' : 'default'} icon={ShieldAlert}
        loading={actionPending} onConfirm={handleAction} onCancel={() => setConfirmAction(null)} />
    </PageState>
  );
}
