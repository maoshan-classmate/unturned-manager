import { useState, useCallback, useEffect } from 'react';
import { Package, Plus, Search, Trash2, AlertCircle, Loader2, RefreshCw } from 'lucide-react';
import { useServer } from '../hooks/useServer.js';
import { apiClient } from '../api/client.js';
import { Button } from '../components/ui/button.js';
import { Input } from '../components/ui/input.js';

interface ModInfo {
  fileId: string;
  title: string;
  author: string;
  description: string;
  previewUrl?: string;
  fileSize?: number;
}

/**
 * Mods 页面——Figma 2:4 🎨 Mods。
 *
 * Mod 卡片网格 + 添加/搜索 + 待应用变更栏。
 */
export function ModsPage() {
  const { servers, loading: serverLoading, error: serverError } = useServer();
  const server = servers[0];

  const [mods, setMods] = useState<ModInfo[]>([]);
  const [modsLoading, setModsLoading] = useState(false);
  const [modsError, setModsError] = useState<string | null>(null);
  const [pendingIds, setPendingIds] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [addFileId, setAddFileId] = useState('');
  const [addingMod, setAddingMod] = useState(false);

  const fetchMods = useCallback(async () => {
    if (!server) return;
    setModsLoading(true);
    setModsError(null);
    try {
      // 1. 立即读取 Workshop 配置（本地 API，快速）
      const configRes = await apiClient.get(`/servers/${server.id}/config/workshop`);
      const fileIds: string[] = configRes.data.data?.File_IDs ?? [];

      // 2. 先显示占位卡片
      const placeholders: ModInfo[] = fileIds.map((fid) => ({
        fileId: fid,
        title: fid,
        author: '加载中...',
        description: '',
      }));
      setMods(placeholders);
      setModsLoading(false);
      setPendingIds([]);

      // 3. 后台异步拉元数据（并行，不阻塞 UI，使用 apiClient 确保 JWT 认证）
      for (const fid of fileIds) {
        apiClient.get(`/workshop/mods/${fid}`, { timeout: 3000 })
          .then((res) => {
            if (res.data?.data) {
              setMods((prev) => prev.map((m) => (m.fileId === fid ? res.data.data : m)));
            }
          })
          .catch(() => {
            setMods((prev) =>
              prev.map((m) => (m.fileId === fid ? { ...m, author: '元数据暂不可用' } : m)),
            );
          });
      }
    } catch (err) {
      setModsError(err instanceof Error ? err.message : '加载 Mod 配置失败');
      setModsLoading(false);
    }
  }, [server?.id]);

  // 首次加载
  useEffect(() => { fetchMods(); }, [server?.id]);

  const handleAddMod = async () => {
    if (!addFileId.trim() || !server) return;
    setAddingMod(true);
    try {
      const res = await apiClient.get(`/workshop/mods/${addFileId.trim()}`);
      if (res.data.data) {
        setMods((prev) => [...prev, res.data.data]);
        setPendingIds((prev) => [...prev, addFileId.trim()]);
      }
      setAddFileId('');
      setShowAdd(false);
    } catch {
      // 即使元数据拉不到也加入列表
      setMods((prev) => [...prev, { fileId: addFileId.trim(), title: addFileId.trim(), author: '—', description: '' }]);
      setPendingIds((prev) => [...prev, addFileId.trim()]);
      setAddFileId('');
      setShowAdd(false);
    } finally {
      setAddingMod(false);
    }
  };

  const handleRemoveMod = (fileId: string) => {
    setMods((prev) => prev.filter((m) => m.fileId !== fileId));
    setPendingIds((prev) => prev.filter((id) => id !== fileId));
  };

  const handleApplyChanges = async () => {
    if (!server || pendingIds.length === 0) return;
    try {
      await apiClient.put(`/servers/${server.id}/config/workshop`, {
        fileIds: mods.map((m) => m.fileId),
      });
      setPendingIds([]);
    } catch (err) {
      setModsError(err instanceof Error ? err.message : '应用变更失败');
    }
  };

  const filtered = searchQuery
    ? mods.filter((m) =>
        m.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        m.fileId.includes(searchQuery),
      )
    : mods;

  // ── Loading ──
  if (serverLoading || modsLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin" style={{ color: '#22C55E' }} />
          <span className="text-sm" style={{ color: '#94A3B8' }}>加载中...</span>
        </div>
      </div>
    );
  }

  // ── Error ──
  if (serverError || modsError) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="flex flex-col items-center gap-3 max-w-md text-center">
          <AlertCircle size={32} style={{ color: '#EF4444' }} />
          <span className="text-sm" style={{ color: '#F1F5FB' }}>无法加载 Mod 数据</span>
          <span className="text-xs" style={{ color: '#64748B' }}>{serverError || modsError}</span>
          <Button onClick={() => { if (server) fetchMods(); }} className="h-8 text-xs"
            style={{ backgroundColor: '#1E293B', color: '#94A3B8' }}>重试</Button>
        </div>
      </div>
    );
  }

  // ── Empty ──
  if (!server) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="flex flex-col items-center gap-3 max-w-md text-center">
          <Package size={32} style={{ color: '#64748B' }} />
          <span className="text-sm" style={{ color: '#F1F5FB' }}>还没有服务器</span>
          <span className="text-xs" style={{ color: '#64748B' }}>请先在 Server Setup 中创建服务器实例</span>
        </div>
      </div>
    );
  }

  const formatSize = (bytes?: number) => {
    if (!bytes) return '—';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  return (
    <div className="flex flex-col h-full gap-4">
      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold" style={{ color: '#F1F5FB' }}>Mods</h1>
          <span className="text-xs px-2 py-0.5 rounded" style={{ backgroundColor: '#1E293B', color: '#64748B' }}>
            {mods.length} 个 Mod
          </span>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: '#64748B' }} />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜索 Mod..."
              className="pl-8 h-8 text-xs w-48"
            />
          </div>
          <Button onClick={() => setShowAdd(true)} className="h-8 text-xs gap-1.5"
            style={{ backgroundColor: '#22C55E', color: '#fff' }}>
            <Plus size={14} /> 添加 Mod
          </Button>
        </div>
      </div>

      {/* Add Mod Dialog */}
      {showAdd && (
        <div className="p-4 rounded-lg" style={{ backgroundColor: '#1E293B', border: '1px solid #334155' }}>
          <div className="flex items-center gap-3">
            <Input
              value={addFileId}
              onChange={(e) => setAddFileId(e.target.value)}
              placeholder="输入 Steam Workshop File ID..."
              className="flex-1 h-8 text-sm"
              onKeyDown={(e) => e.key === 'Enter' && handleAddMod()}
            />
            <Button onClick={handleAddMod} disabled={addingMod || !addFileId.trim()}
              className="h-8 text-xs" style={{ backgroundColor: '#22C55E', color: '#fff' }}>
              {addingMod ? '查询中...' : '确认'}
            </Button>
            <Button onClick={() => setShowAdd(false)} className="h-8 text-xs"
              style={{ backgroundColor: '#1E293B', color: '#94A3B8' }}>取消</Button>
          </div>
        </div>
      )}

      {/* Mod Grid */}
      {filtered.length === 0 ? (
        <div className="flex items-center justify-center flex-1">
          <div className="flex flex-col items-center gap-2">
            <Package size={24} style={{ color: '#64748B' }} />
            <span className="text-sm" style={{ color: '#64748B' }}>
              {searchQuery ? '没有匹配的 Mod' : '暂无 Mod，点击"添加 Mod"开始'}
            </span>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 flex-1 content-start">
          {filtered.map((mod) => (
            <div key={mod.fileId} className="rounded-lg overflow-hidden"
              style={{ backgroundColor: '#1E293B', border: '1px solid #334155' }}>
              {/* Preview */}
              {mod.previewUrl ? (
                <img src={mod.previewUrl} alt={mod.title} className="w-full h-32 object-cover" />
              ) : (
                <div className="w-full h-32 flex items-center justify-center" style={{ backgroundColor: '#0F172A' }}>
                  <Package size={32} style={{ color: '#334155' }} />
                </div>
              )}
              {/* Info */}
              <div className="p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <h3 className="text-sm font-medium truncate" style={{ color: '#F1F5FB' }}>{mod.title}</h3>
                    <p className="text-xs mt-0.5" style={{ color: '#64748B' }}>{mod.author}</p>
                  </div>
                  <button onClick={() => handleRemoveMod(mod.fileId)}
                    className="p-1 rounded hover:bg-slate-700/50 flex-shrink-0"
                    style={{ color: '#EF4444' }}>
                    <Trash2 size={14} />
                  </button>
                </div>
                <div className="flex items-center justify-between mt-2">
                  <span className="text-xs font-mono" style={{ color: '#64748B' }}>{mod.fileId}</span>
                  <span className="text-xs" style={{ color: '#64748B' }}>{formatSize(mod.fileSize)}</span>
                </div>
                {pendingIds.includes(mod.fileId) && (
                  <span className="inline-block mt-2 text-xs px-2 py-0.5 rounded"
                    style={{ backgroundColor: 'rgba(245,158,11,0.15)', color: '#F59E0B' }}>
                    待应用
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Pending Bar */}
      {pendingIds.length > 0 && (
        <div className="flex items-center justify-between p-3 rounded-lg sticky bottom-0"
          style={{ backgroundColor: '#1E293B', border: '1px solid #F59E0B' }}>
          <span className="text-sm" style={{ color: '#F59E0B' }}>
            {pendingIds.length} 个变更待应用
          </span>
          <div className="flex items-center gap-2">
            <Button onClick={() => { setPendingIds([]); fetchMods(); }}
              className="h-7 text-xs" style={{ backgroundColor: '#1E293B', color: '#94A3B8' }}>
              <RefreshCw size={12} className="mr-1" /> 撤销
            </Button>
            <Button onClick={handleApplyChanges} className="h-7 text-xs"
              style={{ backgroundColor: '#22C55E', color: '#fff' }}>
              应用并重启
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
