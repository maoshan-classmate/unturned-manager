import { useState, useCallback, useEffect } from 'react';
import { Package, Plus, Trash2, RefreshCw } from 'lucide-react';
import { useServer } from '../hooks/useServer.js';
import { apiClient } from '../api/client.js';
import { Button } from '../components/ui/button.js';
import { SearchInput } from '../components/shared/SearchInput.js';
import { PageState } from '../components/shared/PageState.js';
import { formatSize } from '@/lib/utils';

interface ModInfo { fileId: string; title: string; author: string; description: string; previewUrl?: string; fileSize?: number; }

export function ModsPage() {
  const { servers, loading: serverLoading, error: serverError } = useServer();
  const server = servers[0];
  const [mods, setMods] = useState<ModInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [addFileId, setAddFileId] = useState('');
  const [addingMod, setAddingMod] = useState(false);

  const fetchMods = useCallback(async () => {
    if (!server) return;
    setLoading(true); setFetchError(null);
    try {
      const configRes = await apiClient.get(`/servers/${server.id}/config/workshop`);
      const fileIds: string[] = configRes.data.data?.File_IDs ?? [];
      const placeholders: ModInfo[] = fileIds.map(fid => ({ fileId: fid, title: fid, author: '加载中...', description: '' }));
      setMods(placeholders);
      setLoading(false);
      fileIds.forEach(fid => {
        apiClient.get(`/workshop/mods/${fid}`, { timeout: 3000 })
          .then(res => { if (res.data?.data) setMods(prev => prev.map(m => m.fileId === fid ? res.data.data : m)); })
          .catch(() => setMods(prev => prev.map(m => m.fileId === fid ? { ...m, author: 'Steam 不可达' } : m)));
      });
    } catch (err) { setFetchError(err instanceof Error ? err.message : '加载 Mod 配置失败'); setLoading(false); }
  }, [server?.id]);

  useEffect(() => { fetchMods(); }, [server?.id]);

  const handleAdd = async () => {
    if (!addFileId.trim() || !server) return;
    setAddingMod(true);
    try {
      const res = await apiClient.get(`/workshop/mods/${addFileId.trim()}`, { timeout: 3000 });
      if (res.data?.data) { setMods(prev => [...prev, res.data.data]); }
      else { setMods(prev => [...prev, { fileId: addFileId.trim(), title: addFileId.trim(), author: '—', description: '' }]); }
      setAddFileId(''); setShowAdd(false);
    } catch { setMods(prev => [...prev, { fileId: addFileId.trim(), title: addFileId.trim(), author: '—', description: '' }]); setAddFileId(''); setShowAdd(false); }
    finally { setAddingMod(false); }
  };

  const handleRemove = (fileId: string) => setMods(prev => prev.filter(m => m.fileId !== fileId));

  const applyChanges = async () => {
    if (!server) return;
    try { await apiClient.put(`/servers/${server.id}/config/workshop`, { fileIds: mods.map(m => m.fileId) }); }
    catch (err) { setFetchError(err instanceof Error ? err.message : '应用变更失败'); }
  };

  const filtered = searchQuery ? mods.filter(m => m.title.toLowerCase().includes(searchQuery.toLowerCase()) || m.fileId.includes(searchQuery)) : mods;

  return (
    <PageState loading={serverLoading || loading} error={serverError || fetchError} empty={!server} errorText="无法加载 Mod" emptyText="还没有服务器" emptyIcon={Package} onRetry={fetchMods}>
      <div className="flex flex-col h-full gap-4">
        <div className="flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold text-slate-100">Mods</h1>
            <span className="text-xs px-2.5 py-1 rounded font-medium" style={{ background:'#1E293B', color:'#64748B' }}>{mods.length} 个 Mod</span>
          </div>
          <div className="flex items-center gap-2">
            <SearchInput value={searchQuery} onChange={setSearchQuery} placeholder="搜索 Mod..." />
            <Button onClick={() => setShowAdd(true)} size="sm" style={{ background:'#22C55E', color:'#fff' }}><Plus size={14} /> 添加 Mod</Button>
          </div>
        </div>

        {showAdd && (
          <div className="p-4 rounded-lg" style={{ background:'#1E293B', border:'1px solid #334059' }}>
            <div className="flex items-center gap-3">
              <input value={addFileId} onChange={e => setAddFileId(e.target.value)} placeholder="输入 Steam Workshop File ID..." className="flex-1 h-8 text-sm px-3 rounded outline-none" style={{ background:'#0F172A', border:'1px solid #334059', color:'#F1F5FB' }} onKeyDown={e => e.key==='Enter' && handleAdd()} />
              <Button onClick={handleAdd} disabled={addingMod || !addFileId.trim()} size="sm" style={{ background:'#22C55E', color:'#fff' }}>{addingMod ? '查询中...' : '确认'}</Button>
              <Button onClick={() => setShowAdd(false)} variant="ghost" size="sm">取消</Button>
            </div>
          </div>
        )}

        <div className="flex-1 overflow-auto">
          {filtered.length === 0 ? (
            <div className="flex items-center justify-center h-64 text-slate-500"><Package size={32} /><span className="ml-3 text-sm">{searchQuery ? '没有匹配的 Mod' : '暂无 Mod，点击"添加 Mod"开始'}</span></div>
          ) : (
            <div className="grid grid-cols-3 gap-4">
              {filtered.map(mod => (
                <div key={mod.fileId} className="rounded-lg overflow-hidden transition-colors hover:ring-1 hover:ring-slate-600" style={{ background:'#1E293B', border:'1px solid #334059' }}>
                  {mod.previewUrl ? <img src={mod.previewUrl} alt={mod.title} className="w-full h-36 object-cover" /> : <div className="w-full h-36 flex items-center justify-center" style={{ background:'#0F172A' }}><Package size={32} style={{ color:'#334059' }} /></div>}
                  <div className="p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <h3 className="text-sm font-medium text-slate-100 truncate">{mod.title}</h3>
                        <p className="text-xs text-slate-500 mt-0.5">{mod.author}</p>
                      </div>
                      <button onClick={() => handleRemove(mod.fileId)} className="p-1 rounded hover:bg-red-500/10 flex-shrink-0" style={{ color:'#EF4444' }}><Trash2 size={14} /></button>
                    </div>
                    <div className="flex items-center justify-between mt-2 pt-2" style={{ borderTop:'1px solid #1E293B' }}>
                      <span className="text-xs font-mono text-slate-600">{mod.fileId}</span>
                      <span className="text-xs text-slate-600">{formatSize(mod.fileSize)}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </PageState>
  );
}
