import { useState, useCallback, useEffect } from 'react';
import {
  Server, Play, Square, RefreshCw, Download,
  AlertCircle, Loader2, Wrench, Monitor, Plus,
} from 'lucide-react';
import { TabBar } from '../components/shared/TabBar.js';
import { stateColor, stateLabel } from '@/lib/utils';
import { useServer, useServerActions } from '../hooks/useServer.js';
import { apiClient } from '../api/client.js';
import { Button } from '../components/ui/button.js';
import { Input } from '../components/ui/input.js';

type SetupTab = 'servers' | 'steamcmd' | 'update';

/**
 * Server Setup 页面——Figma 3:117 🎨 Server Setup。
 *
 * 服务端安装 + 实例管理 + 更新。
 */
export function ServerSetupPage() {
  const { servers, loading: serverLoading, error: serverError, refresh } = useServer();
  const { start, stop, restart, pendingId } = useServerActions();

  const [tab, setTab] = useState<SetupTab>('servers');
  const [steamCmdStatus, setSteamCmdStatus] = useState<{ isInstalled: boolean; installPath?: string } | null>(null);
  const [scLoading, setScLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [createForm, setCreateForm] = useState({ id: '', name: '', port: '27015', owner: '', installDir: '', password: '' });

  const fetchSteamCmd = useCallback(async () => {
    setScLoading(true);
    try {
      const res = await apiClient.get('/steamcmd/status');
      setSteamCmdStatus(res.data.data);
    } catch {
      setSteamCmdStatus({ isInstalled: false });
    } finally {
      setScLoading(false);
    }
  }, []);

  useEffect(() => { fetchSteamCmd(); }, []);

  const handleServerAction = async (action: 'start' | 'stop' | 'restart', serverId: string) => {
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

  const handleCreateServer = async () => {
    if (!createForm.id || !createForm.installDir) return;
    try {
      await apiClient.post('/servers', {
        id: createForm.id,
        name: createForm.name || createForm.id,
        gamePort: parseInt(createForm.port, 10),
        ownerSteamId: createForm.owner || '76561198000000000',
        installDir: createForm.installDir,
        rconPassword: createForm.password || undefined,
      });
      setCreateForm({ id: '', name: '', port: '27015', owner: '', installDir: '', password: '' });
      refresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : '创建失败');
    }
  };

  const handleUpdateU3DS = async () => {
    if (!servers[0]) return;
    setActionError(null);
    try {
      await apiClient.post('/steamcmd/update', { installDir: servers[0].installDir });
      refresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : '更新失败');
    }
  };

  // ── Loading ──
  if (serverLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin" style={{ color: '#22C55E' }} />
          <span className="text-sm" style={{ color: '#94A3B8' }}>加载中...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full gap-4">
      <h1 className="text-2xl font-semibold" style={{ color: '#F1F5FB' }}>Server Setup</h1>

      {actionError && (
        <div className="flex items-center gap-2 p-3 rounded-lg text-xs"
          style={{ backgroundColor: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#EF4444' }}>
          <AlertCircle size={14} /> {actionError}
          <button onClick={() => setActionError(null)} className="ml-auto" style={{ color: '#94A3B8' }}>×</button>
        </div>
      )}

      {/* Tabs */}
      <TabBar
        tabs={[
          { key: 'servers', label: '实例管理', icon: Monitor },
          { key: 'steamcmd', label: 'SteamCMD', icon: Wrench },
          { key: 'update', label: '更新', icon: Download },
        ]}
        active={tab}
        onChange={(k) => setTab(k as SetupTab)}
      />

      {/* Tab: 实例管理 */}
      {tab === 'servers' && (
        <div className="flex-1 overflow-auto space-y-4">
          {/* 创建新实例 */}
          <div className="p-4 rounded-lg" style={{ backgroundColor: '#1E293B', border: '1px solid #334155' }}>
            <h3 className="text-sm font-medium mb-3" style={{ color: '#F1F5FB' }}>创建新实例</h3>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {[
                ['id', 'ServerID', 'text'],
                ['name', '名称', 'text'],
                ['port', '端口', 'number'],
                ['owner', 'Owner SteamID64', 'text'],
                ['installDir', '安装目录', 'text'],
                ['password', 'RCON 密码', 'password'],
              ].map(([key, label, type]) => (
                <label key={key as string} className="block">
                  <span className="text-xs" style={{ color: '#64748B' }}>{label as string}</span>
                  <Input value={String(createForm[key as keyof typeof createForm] ?? '')}
                    onChange={(e) => setCreateForm((prev) => ({ ...prev, [key as string]: e.target.value }))}
                    className="mt-1 h-7 text-xs" type={type as string} />
                </label>
              ))}
            </div>
            <Button onClick={handleCreateServer} className="h-7 text-xs mt-3"
              style={{ backgroundColor: '#22C55E', color: '#fff' }}>
              <Plus /> 创建
            </Button>
          </div>

          {/* 实例列表 */}
          {servers.length === 0 ? (
            <div className="text-center py-8">
              <Server size={24} style={{ color: '#64748B' }} />
              <p className="text-sm mt-2" style={{ color: '#64748B' }}>暂无服务器实例</p>
            </div>
          ) : (
            servers.map((s) => (
              <div key={s.id} className="p-4 rounded-lg" style={{ backgroundColor: '#1E293B', border: '1px solid #334155' }}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-2 h-2 rounded-full" style={{ backgroundColor: stateColor(s.state ?? 'STOPPED') }} />
                    <div>
                      <h3 className="text-sm font-medium" style={{ color: '#F1F5FB' }}>{s.name || s.id}</h3>
                      <p className="text-xs" style={{ color: '#64748B' }}>
                        {s.id} · 端口 {s.gamePort} · {stateLabel(s.state ?? 'STOPPED')}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {s.state === 'STOPPED' && (
                      <Button onClick={() => handleServerAction('start', s.id)} disabled={pendingId === s.id}
                        className="h-7 text-xs gap-1" style={{ backgroundColor: '#22C55E', color: '#fff' }}>
                        <Play size={12} /> 启动
                      </Button>
                    )}
                    {(s.state === 'RUNNING' || s.state === 'DEGRADED') && (
                      <>
                        <Button onClick={() => handleServerAction('stop', s.id)} disabled={pendingId === s.id}
                          className="h-7 text-xs gap-1" style={{ backgroundColor: '#EF4444', color: '#fff' }}>
                          <Square size={12} /> 停止
                        </Button>
                        <Button onClick={() => handleServerAction('restart', s.id)} disabled={pendingId === s.id}
                          className="h-7 text-xs gap-1" style={{ backgroundColor: '#F59E0B', color: '#fff' }}>
                          <RefreshCw size={12} /> 重启
                        </Button>
                      </>
                    )}
                    {pendingId === s.id && (
                      <Loader2 size={14} className="animate-spin" style={{ color: '#22C55E' }} />
                    )}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Tab: SteamCMD */}
      {tab === 'steamcmd' && (
        <div className="p-4 rounded-lg" style={{ backgroundColor: '#1E293B', border: '1px solid #334155' }}>
          <h3 className="text-sm font-medium mb-3" style={{ color: '#F1F5FB' }}>SteamCMD 状态</h3>
          {scLoading ? (
            <Loader2 size={16} className="animate-spin" style={{ color: '#22C55E' }} />
          ) : (
            <div className="space-y-2 text-sm" style={{ color: '#94A3B8' }}>
              <p>安装状态：{steamCmdStatus?.isInstalled ? '✅ 已安装' : '❌ 未安装'}</p>
              {steamCmdStatus?.installPath && <p>安装路径：{steamCmdStatus.installPath}</p>}
            </div>
          )}
        </div>
      )}

      {/* Tab: 更新 */}
      {tab === 'update' && (
        <div className="p-4 rounded-lg" style={{ backgroundColor: '#1E293B', border: '1px solid #334155' }}>
          <h3 className="text-sm font-medium mb-3" style={{ color: '#F1F5FB' }}>更新 U3DS 二进制</h3>
          <p className="text-xs mb-3" style={{ color: '#64748B' }}>
            通过 SteamCMD 更新 U3DS 服务端。更新前请确保所有实例已停止。
          </p>
          <Button onClick={handleUpdateU3DS} disabled={!servers[0]}
            className="h-8 text-xs gap-1.5" style={{ backgroundColor: '#22C55E', color: '#fff' }}>
            <Download size={14} /> 执行 app_update 1110390
          </Button>
        </div>
      )}
    </div>
  );
}

