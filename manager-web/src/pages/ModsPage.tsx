import { useState, useCallback, useEffect } from 'react';
import { Package, Loader2, AlertCircle } from 'lucide-react';
import { useServer } from '../hooks/useServer.js';
import { apiClient } from '../api/client.js';
import { SearchInput } from '../components/shared/SearchInput.js';
import { ModCard } from '../components/mods/ModCard.js';
import { PaginationBar } from '../components/shared/PaginationBar.js';
import { Button } from '../components/ui/button.js';

interface ModInfo {
  fileId: string;
  title: string;
  author: string;
  description: string;
  previewUrl?: string;
  fileSize?: number;
  subscriptions?: string;
}

/** Mods 页面——Figma 2:4 🎨 Mods。
 *  浏览 Steam 创意工坊，订阅/移除 Mod。 */
export function ModsPage() {
  const { servers, loading: serverLoading, error: serverError } = useServer();
  const server = servers[0];

  // Workshop 浏览
  const [browseMods, setBrowseMods] = useState<ModInfo[]>([]);
  const [browseTotal, setBrowseTotal] = useState(0);
  const [browsePage, setBrowsePage] = useState(1);
  const [browseLoading, setBrowseLoading] = useState(false);

  // 已安装 Mod（来自服务器配置）
  const [installedIds, setInstalledIds] = useState<Set<string>>(new Set());
  const [installedLoading, setInstalledLoading] = useState(false);

  // 搜索 & 错误
  const [searchQuery, setSearchQuery] = useState('');
  const [fetchError, setFetchError] = useState<string | null>(null);

  // 待移除
  const [pendingRemovals, setPendingRemovals] = useState<Set<string>>(new Set());

  // 操作状态: { fileId: 'subscribing' | 'removing' }
  const [actionLoading, setActionLoading] = useState<Record<string, string>>({});

  const pageSize = 12;
  const totalPages = Math.max(1, Math.ceil(browseTotal / pageSize));

  /** 加载 Workshop 浏览数据 */
  const fetchBrowse = useCallback(async (query: string, page: number) => {
    setBrowseLoading(true);
    setFetchError(null);
    try {
      const res = await apiClient.get('/workshop/browse', { params: { q: query, page } });
      const data = res.data.data;
      setBrowseMods(data.mods ?? []);
      setBrowseTotal(data.total ?? 0);
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : '浏览创意工坊失败');
    } finally {
      setBrowseLoading(false);
    }
  }, []);

  /** 加载已安装的 Mod File_IDs */
  const fetchInstalled = useCallback(async () => {
    if (!server) { setInstalledIds(new Set()); return; }
    setInstalledLoading(true);
    try {
      const res = await apiClient.get(`/servers/${server.id}/config/workshop`);
      const ids: string[] = res.data.data?.File_IDs ?? [];
      setInstalledIds(new Set(ids));
    } catch {
      setInstalledIds(new Set());
    } finally {
      setInstalledLoading(false);
    }
  }, [server?.id]);

  // 初始加载 + server 切换时刷新
  useEffect(() => { fetchBrowse(searchQuery, browsePage); }, []);
  useEffect(() => { fetchInstalled(); }, [server?.id]);

  /** 搜索 */
  const handleSearch = (q: string) => {
    setSearchQuery(q);
    setBrowsePage(1);
    fetchBrowse(q, 1);
  };

  /** 翻页 */
  const handlePage = (p: number) => {
    if (p < 1 || p > totalPages || p === browsePage) return;
    setBrowsePage(p);
    fetchBrowse(searchQuery, p);
  };

  /** 订阅 Mod（添加到服务器） */
  const handleSubscribe = async (fileId: string) => {
    if (!server) return;
    setActionLoading((prev) => ({ ...prev, [fileId]: 'subscribing' }));
    try {
      const current = [...installedIds, fileId];
      await apiClient.post(`/servers/${server.id}/apply`, { fileIds: current });
      setInstalledIds(new Set(current));
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : '订阅失败');
    } finally {
      setActionLoading((prev) => { const next = { ...prev }; delete next[fileId]; return next; });
    }
  };

  /** 详情——打开 Steam Workshop 页面 */
  const handleDetails = (fileId: string) => {
    window.open(`https://steamcommunity.com/sharedfiles/filedetails/?id=${fileId}`, '_blank');
  };

  /** 移除 Mod */
  const handleRemove = (fileId: string) => {
    setPendingRemovals((prev) => {
      const next = new Set(prev);
      next.has(fileId) ? next.delete(fileId) : next.add(fileId);
      return next;
    });
  };

  /** 应用移除变更 */
  const applyRemovals = async () => {
    if (!server || pendingRemovals.size === 0) return;
    setActionLoading((prev) => {
      const next = { ...prev };
      pendingRemovals.forEach((id) => { next[id] = 'removing'; });
      return next;
    });
    try {
      const newMods = [...installedIds].filter((id) => !pendingRemovals.has(id));
      await apiClient.post(`/servers/${server.id}/apply`, { fileIds: newMods });
      setInstalledIds(new Set(newMods));
      setPendingRemovals(new Set());
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : '移除失败');
    } finally {
      setActionLoading({});
    }
  };

  // 合并浏览结果 + 已安装标记
  const displayMods = browseMods.map((m) => ({
    ...m,
    installed: installedIds.has(m.fileId),
    pendingRemoval: pendingRemovals.has(m.fileId),
  }));

  const pageLoading = serverLoading || browseLoading || installedLoading;

  // ── Loading ──
  if (pageLoading && displayMods.length === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin" style={{ color: '#22C55E' }} />
          <span className="text-sm text-slate-400">加载中...</span>
        </div>
      </div>
    );
  }

  // ── Error ──
  if ((serverError || fetchError) && displayMods.length === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="flex flex-col items-center gap-3 max-w-md text-center">
          <AlertCircle size={32} style={{ color: '#EF4444' }} />
          <span className="text-sm text-slate-100">无法加载创意工坊</span>
          <span className="text-xs text-slate-500">{serverError || fetchError}</span>
          <Button onClick={() => fetchBrowse(searchQuery, browsePage)} variant="ghost" size="sm" className="text-slate-400">重试</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* TopBar — Figma: 仅标题，无按钮 */}
      <div className="shrink-0 flex items-center px-4 md:px-6 h-16">
        <h1 className="text-xs font-normal text-slate-100">模组管理</h1>
      </div>

      {/* Filter Bar — Figma 10:16234: 搜索 + 过滤文字 */}
      <div className="shrink-0 mx-4 md:mx-6 px-4 rounded-lg flex flex-wrap items-center gap-4 h-11"
        style={{ backgroundColor: '#172133' }}>
        <SearchInput value={searchQuery} onChange={handleSearch} placeholder="搜索名称或ID..." width={260} />
        <span className="text-sm text-slate-400 hidden md:inline">
          按名称 &nbsp;&nbsp; 按ID &nbsp;&nbsp; 类型: 全部 &nbsp;&nbsp; 排序: 评分
        </span>
      </div>

      {/* Pending removal bar */}
      {pendingRemovals.size > 0 && (
        <div className="shrink-0 mx-4 md:mx-6 mt-3 flex items-center justify-between px-4 rounded-lg h-9"
          style={{ backgroundColor: '#172133', border: '1px solid rgba(245,158,11,0.25)' }}>
          <span className="text-xs text-amber-500">{pendingRemovals.size} 个 Mod 待移除</span>
          <div className="flex gap-2">
            <Button onClick={() => setPendingRemovals(new Set())} variant="ghost" size="sm" className="h-6 text-xs">取消</Button>
            <Button onClick={applyRemovals} size="sm" className="h-6 text-xs bg-emerald-500 text-white">应用变更</Button>
          </div>
        </div>
      )}

      {/* Mod Grid — Figma: 3 列 */}
      <div className="flex-1 overflow-auto mx-4 md:mx-6 mt-4">
        {displayMods.length === 0 ? (
          <div className="flex items-center justify-center h-64 text-slate-500">
            <Package size={32} />
            <span className="ml-3 text-sm">
              {searchQuery ? (
                '没有匹配的 Mod'
              ) : (
                <span>
                  请先到{' '}
                  <a href="/settings" className="underline" style={{ color: '#3B82F6' }}>
                    Settings → Steam WebAPI Key
                  </a>{' '}
                  配置密钥后浏览创意工坊
                </span>
              )}
            </span>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {displayMods.map((mod) => (
              <ModCard
                key={mod.fileId}
                fileId={mod.fileId}
                title={mod.title}
                author={mod.author}
                description={mod.description}
                previewUrl={mod.previewUrl}
                subscriptions={mod.subscriptions}
                installed={mod.installed}
                pendingRemoval={mod.pendingRemoval}
                loading={!!actionLoading[mod.fileId]}
                onSubscribe={handleSubscribe}
                onDetails={handleDetails}
                onRemove={handleRemove}
              />
            ))}
          </div>
        )}
      </div>

      {/* Pagination Bar — Figma 10:16235 */}
      <div className="shrink-0 mx-4 md:mx-6 my-4">
        <PaginationBar page={browsePage} pageSize={pageSize} total={browseTotal} onPageChange={handlePage} />
      </div>
    </div>
  );
}
