import { useState, useCallback, useEffect } from 'react';
import { Users, Gavel, DoorOpen, RefreshCw, ShieldAlert } from 'lucide-react';
import { useServer } from '../hooks/useServer.js';
import { apiClient } from '../api/client.js';
import { Button } from '../components/ui/button.js';
import { SearchInput } from '../components/shared/SearchInput.js';
import { PageState } from '../components/shared/PageState.js';
import { ConfirmDialog } from '../components/shared/ConfirmDialog.js';
import { errorMessage } from '@/lib/utils';

interface PlayerInfo {
  name: string;
  steamId: string;
  character: string;
  ping: number;
  online: boolean;
}

/**
 * Players 页面——Figma 2:5 🎨 Players。
 *
 * 玩家列表表格 + Kick/Ban 操作。
 */
export function PlayersPage() {
  const { servers, loading: serverLoading, error: serverError } = useServer();
  const server = servers[0];

  const [players, setPlayers] = useState<PlayerInfo[]>([]);
  const [playersLoading, setPlayersLoading] = useState(false);
  const [playersError, setPlayersError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [confirmAction, setConfirmAction] = useState<{ type: 'kick' | 'ban'; target: PlayerInfo } | null>(null);
  const [actionPending, setActionPending] = useState(false);

  const fetchPlayers = useCallback(async () => {
    if (!server) return;
    setPlayersLoading(true);
    setPlayersError(null);
    try {
      // 通过 A2S + RCON 获取玩家列表
      const res = await apiClient.post(`/servers/${server.id}/rcon/execute`, { command: 'Players' });
      // RCON 返回的文本解析：每行 "Name | SteamID | Character | Ping"
      const text: string = res.data.data ?? '';
      const lines = text.split('\n').filter((l: string) => l.includes('|'));
      const list: PlayerInfo[] = lines.map((line: string) => {
        const parts = line.split('|').map((s) => s.trim());
        return {
          name: parts[0] || '—',
          steamId: parts[1] || '—',
          character: parts[2] || '—',
          ping: parseInt(parts[3] || '0', 10),
          online: true,
        };
      });
      setPlayers(list);
    } catch {
      // 服务器未运行时 A2S/RCON 不可用，显示空列表
      setPlayers([]);
    } finally {
      setPlayersLoading(false);
    }
  }, [server]);

  useEffect(() => { fetchPlayers(); }, [server?.id]);

  const handleAction = async () => {
    if (!confirmAction || !server) return;
    setActionPending(true);
    try {
      const cmd = confirmAction.type === 'kick'
        ? `Kick ${confirmAction.target.steamId}`
        : `Ban ${confirmAction.target.steamId}`;
      await apiClient.post(`/servers/${server.id}/rcon/execute`, { command: cmd, confirmed: true });
      setPlayers((prev) => prev.filter((p) => p.steamId !== confirmAction.target.steamId));
    } catch (err) {
      setPlayersError(err instanceof Error ? err.message : '操作失败');
    } finally {
      setActionPending(false);
      setConfirmAction(null);
    }
  };

  const filtered = searchQuery
    ? players.filter((p) =>
        p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        p.steamId.includes(searchQuery),
      )
    : players;

  return (
    <PageState
      loading={serverLoading || playersLoading}
      error={serverError || playersError}
      empty={!server}
      errorText="无法加载玩家数据"
      emptyText="还没有服务器"
      emptyIcon={Users}
      onRetry={fetchPlayers}
    >
      <div className="flex flex-col h-full gap-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold" style={{ color: '#F1F5FB' }}>Players</h1>
          <span className="text-xs px-2 py-0.5 rounded" style={{ backgroundColor: '#1E293B', color: '#64748B' }}>
            {players.length} 在线
          </span>
        </div>
        <div className="flex items-center gap-2">
          <SearchInput value={searchQuery} onChange={setSearchQuery} placeholder="搜索玩家..." />
          <Button onClick={fetchPlayers} className="h-8 text-xs gap-1"
            style={{ backgroundColor: '#1E293B', color: '#94A3B8' }}>
            <RefreshCw size={14} /> 刷新
          </Button>
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto rounded-lg" style={{ border: '1px solid #334155' }}>
        {filtered.length === 0 ? (
          <div className="flex items-center justify-center h-32">
            <span className="text-sm" style={{ color: '#64748B' }}>
              {searchQuery ? '没有匹配的玩家' : '暂无在线玩家'}
            </span>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr style={{ borderBottom: '1px solid #334155' }}>
                {['Player', 'Steam ID', 'Character', 'Ping', 'Online', 'Actions'].map((h) => (
                  <th key={h} className="text-left px-3 py-2 text-xs font-medium" style={{ color: '#64748B' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => (
                <tr key={p.steamId} style={{ borderBottom: '1px solid #1E293B' }} className="hover:bg-slate-800/30">
                  <td className="px-3 py-2 flex items-center gap-2">
                    <div className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium"
                      style={{ backgroundColor: '#22C55E', color: '#fff' }}>
                      {p.name.charAt(0).toUpperCase()}
                    </div>
                    <span style={{ color: '#F1F5FB', fontSize: 13 }}>{p.name}</span>
                  </td>
                  <td className="px-3 py-2 font-mono text-xs" style={{ color: '#94A3B8' }}>{p.steamId}</td>
                  <td className="px-3 py-2 text-xs" style={{ color: '#94A3B8' }}>{p.character}</td>
                  <td className="px-3 py-2">
                    {(() => {
                      let bg = 'rgba(34,197,94,0.15)', color = '#22C55E';
                      if (p.ping >= 150) { bg = 'rgba(239,68,68,0.15)'; color = '#EF4444'; }
                      else if (p.ping >= 80) { bg = 'rgba(245,158,11,0.15)'; color = '#F59E0B'; }
                      return <span className="text-xs px-2 py-0.5 rounded font-mono" style={{ backgroundColor: bg, color }}>{p.ping}ms</span>;
                    })()}
                  </td>
                  <td className="px-3 py-2">
                    <span className="inline-flex items-center gap-1 text-xs" style={{ color: '#22C55E' }}>
                      <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ backgroundColor: '#22C55E' }} />
                      在线
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1">
                      <button onClick={() => setConfirmAction({ type: 'kick', target: p })}
                        className="p-1 rounded hover:bg-slate-700 transition-colors" title="踢出" style={{ color: '#F59E0B' }}>
                        <DoorOpen size={14} />
                      </button>
                      <button onClick={() => setConfirmAction({ type: 'ban', target: p })}
                        className="p-1 rounded hover:bg-slate-700 transition-colors" title="封禁" style={{ color: '#EF4444' }}>
                        <Gavel size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <ConfirmDialog
        open={!!confirmAction}
        title={confirmAction ? `确认${confirmAction.type === 'kick' ? '踢出' : '封禁'}` : ''}
        message={confirmAction ? `确定要${confirmAction.type === 'kick' ? '踢出' : '封禁'}玩家 ${confirmAction.target.name} (${confirmAction.target.steamId})？` : ''}
        confirmLabel="确认"
        variant={confirmAction?.type === 'ban' ? 'danger' : 'default'}
        icon={ShieldAlert}
        loading={actionPending}
        onConfirm={handleAction}
        onCancel={() => setConfirmAction(null)}
      />
    </div>
    </PageState>
  );
}
