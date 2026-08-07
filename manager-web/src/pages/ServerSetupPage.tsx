import { useState, useCallback, useEffect } from 'react';
import { Server, Play, Square, RefreshCw, Download, AlertCircle, Loader2, Wrench, Monitor, Plus } from 'lucide-react';
import { useServer, useServerActions } from '../hooks/useServer.js';
import { apiClient } from '../api/client.js';
import { Button } from '../components/ui/button.js';
import { Input } from '../components/ui/input.js';
import { TabBar } from '../components/shared/TabBar.js';
import { Card } from '../components/shared/Card.js';
import { PageState } from '../components/shared/PageState.js';
import { stateColor, stateLabel } from '@/lib/utils';

type SetupTab = 'servers' | 'steamcmd' | 'update';

export function ServerSetupPage() {
  const { servers, loading: serverLoading, error: serverError, refresh } = useServer();
  const { start, stop, restart, pendingId } = useServerActions();
  const [tab, setTab] = useState<SetupTab>('servers');
  const [steamCmd, setSteamCmd] = useState<{ isInstalled: boolean; installPath?: string; version?: string; lastChecked?: string } | null>(null);
  const [scLoading, setScLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [form, setForm] = useState({ id: '', name: '', port: '27015', owner: '', installDir: '', password: '' });
  const [updateLogs, setUpdateLogs] = useState<string[]>([]);

  const fetchSteamCmd = useCallback(async () => {
    setScLoading(true);
    try { const res = await apiClient.get('/steamcmd/status'); setSteamCmd(res.data.data); }
    catch { setSteamCmd({ isInstalled: false }); }
    finally { setScLoading(false); }
  }, []);

  useEffect(() => { fetchSteamCmd(); }, [fetchSteamCmd]);

  const handleAction = async (action: 'start' | 'stop' | 'restart', serverId: string) => {
    setActionError(null);
    try {
      if (action === 'start') await start(serverId);
      else if (action === 'stop') await stop(serverId);
      else await restart(serverId);
      refresh();
    } catch (err) { setActionError(err instanceof Error ? err.message : '操作失败'); }
  };

  const handleCreate = async () => {
    if (!form.id || !form.installDir) return;
    try {
      await apiClient.post('/servers', { id: form.id, name: form.name || form.id, gamePort: parseInt(form.port, 10), ownerSteamId: form.owner || '76561198000000000', installDir: form.installDir, rconPassword: form.password || undefined });
      setForm({ id: '', name: '', port: '27015', owner: '', installDir: '', password: '' }); refresh();
    } catch (err) { setActionError(err instanceof Error ? err.message : '创建失败'); }
  };

  const handleUpdate = async () => {
    if (!servers[0]) return;
    setActionError(null); setUpdateLogs(prev => [...prev, '开始更新...']);
    try {
      await apiClient.post('/steamcmd/update', { installDir: servers[0].installDir });
      setUpdateLogs(prev => [...prev, '更新请求已提交']);
      refresh();
    } catch (err) { setActionError(err instanceof Error ? err.message : '更新失败'); setUpdateLogs(prev => [...prev, '更新失败: ' + (err instanceof Error ? err.message : '')]); }
  };

  return (
    <PageState loading={serverLoading} error={serverError} empty={false} errorText="无法加载服务器">
      <div className="flex flex-col h-full gap-4">
        <h1 className="text-2xl font-semibold text-slate-100">Server Setup</h1>

        {actionError && <div className="flex items-center gap-2 p-3 rounded-lg text-xs" style={{ backgroundColor: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#EF4444' }}><AlertCircle size={14} />{actionError}<button onClick={() => setActionError(null)} className="ml-auto text-slate-400">×</button></div>}

        <TabBar tabs={[{ key: 'servers', label: '实例管理', icon: Monitor }, { key: 'steamcmd', label: 'SteamCMD', icon: Wrench }, { key: 'update', label: '更新', icon: Download }]} active={tab} onChange={(k) => setTab(k as SetupTab)} />

        {tab === 'servers' && (
          <div className="flex-1 overflow-auto space-y-4">
            <Card title="创建新实例">
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {([['id','ServerID'],['name','名称'],['port','端口'],['owner','Owner SteamID64'],['installDir','安装目录'],['password','RCON 密码']] as Array<[keyof typeof form, string]>).map(([k,l]) => (
                  <label key={k} className="block"><span className="text-xs text-slate-500">{l}</span>
                    <Input value={form[k]} onChange={e => setForm(p => ({...p, [k]: e.target.value}))} className="mt-1 h-7 text-xs" type={k === 'password' ? 'password' : 'text'} />
                  </label>
                ))}
              </div>
              <Button onClick={handleCreate} className="h-7 text-xs gap-1 mt-3" style={{ backgroundColor: '#22C55E', color: '#fff' }}><Plus size={14} />创建</Button>
            </Card>

            {servers.length === 0 ? (
              <div className="text-center py-8"><Server size={24} className="text-slate-500 mx-auto mb-2" /><p className="text-sm text-slate-500">暂无服务器实例</p></div>
            ) : servers.map(s => (
              <div key={s.id} className="p-4 rounded-lg" style={{ backgroundColor: '#1E293B', border: '1px solid #334059' }}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-2 h-2 rounded-full" style={{ backgroundColor: stateColor(s.state ?? 'STOPPED') }} />
                    <div>
                      <h3 className="text-sm font-medium text-slate-100">{s.name || s.id}</h3>
                      <p className="text-xs text-slate-500">{s.id} · 端口 {s.gamePort} · {stateLabel(s.state ?? 'STOPPED')}</p>
                      {s.installDir && <p className="text-xs text-slate-600 mt-0.5">路径: {s.installDir}</p>}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {s.state === 'STOPPED' && <Button onClick={() => handleAction('start', s.id)} disabled={pendingId === s.id} className="h-7 text-xs gap-1" style={{ backgroundColor: '#22C55E', color: '#fff' }}><Play size={12} />启动</Button>}
                    {(s.state === 'RUNNING' || s.state === 'DEGRADED') && (<><Button onClick={() => handleAction('stop', s.id)} disabled={pendingId === s.id} className="h-7 text-xs gap-1" style={{ backgroundColor: '#EF4444', color: '#fff' }}><Square size={12} />停止</Button><Button onClick={() => handleAction('restart', s.id)} disabled={pendingId === s.id} className="h-7 text-xs gap-1" style={{ backgroundColor: '#F59E0B', color: '#fff' }}><RefreshCw size={12} />重启</Button></>)}
                    {pendingId === s.id && <Loader2 size={14} className="animate-spin text-emerald-500" />}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {tab === 'steamcmd' && (
          <Card title="SteamCMD 状态" icon={Wrench}>
            {scLoading ? <Loader2 size={16} className="animate-spin text-emerald-500" /> : (
              <div className="space-y-2">
                {[['安装状态', steamCmd?.isInstalled ? '已安装' : '未安装', steamCmd?.isInstalled ? '#22C55E' : '#EF4444'],['安装路径', steamCmd?.installPath || '—'],['版本', steamCmd?.version || '—'],['最后检查', steamCmd?.lastChecked ? new Date(steamCmd.lastChecked).toLocaleString() : '—']].map(([l,v,c]) => (
                  <div key={l as string} className="flex items-center text-sm"><span className="w-24 text-slate-500 flex-shrink-0">{l}</span><span style={{ color: (c as string) || '#94A3B8' }}>{v}</span></div>
                ))}
              </div>
            )}
          </Card>
        )}

        {tab === 'update' && (
          <div className="flex-1 space-y-4">
            <Card title="更新 U3DS 二进制" icon={Download}>
              <p className="text-xs text-slate-500 mb-3">通过 SteamCMD 更新 U3DS 服务端。更新前请确保所有实例已停止。</p>
              <Button onClick={handleUpdate} disabled={!servers[0]} className="h-8 text-xs gap-1.5" style={{ backgroundColor: '#22C55E', color: '#fff' }}><Download size={14} />执行 app_update 1110390</Button>
            </Card>
            {updateLogs.length > 0 && (
              <div className="rounded-lg p-3 font-mono text-xs leading-relaxed" style={{ backgroundColor: '#0F172A', border: '1px solid #334059', maxHeight: 300, overflow: 'auto' }}>
                {updateLogs.map((l, i) => <div key={i} className="text-slate-400">{l}</div>)}
              </div>
            )}
          </div>
        )}
      </div>
    </PageState>
  );
}
