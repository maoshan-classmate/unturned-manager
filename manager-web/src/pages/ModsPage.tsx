import { useState, useCallback, useEffect } from 'react';
import { Package, Loader2, AlertCircle, Search } from 'lucide-react';
import { useServer } from '../hooks/useServer.js';
import { apiClient } from '../api/client.js';
import { Dropdown, type DropdownOption } from '../components/shared/Dropdown.js';
import { ModCard } from '../components/mods/ModCard.js';
import { PaginationBar } from '../components/shared/PaginationBar.js';
import { SearchInput } from '../components/shared/SearchInput.js';
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

/** 排序选项——Steam 客户端创意工坊官方 5 项 + 搜索相关度，映射 EPublishedFileQueryType */
const SORT_OPTIONS: ReadonlyArray<DropdownOption<'popular' | 'rated' | 'published' | 'updated' | 'subscribed' | 'relevance'>> = [
  { value: 'popular', label: '最热门' },
  { value: 'rated', label: '最受好评（发布至今）' },
  { value: 'published', label: '最近发行' },
  { value: 'updated', label: '最新更新' },
  { value: 'subscribed', label: '不重复订阅者总计' },
  { value: 'relevance', label: '搜索相关度' },
];

/** 时间范围选项——Steam 客户端官方 7 档，映射 QueryFiles days 参数（仅最热门排序生效） */
const RANGE_OPTIONS: ReadonlyArray<DropdownOption<'day' | 'week' | 'month' | 'months3' | 'months6' | 'year' | 'all'>> = [
  { value: 'day', label: '今天' },
  { value: 'week', label: '1 周' },
  { value: 'month', label: '30 天' },
  { value: 'months3', label: '3 个月' },
  { value: 'months6', label: '6 个月' },
  { value: 'year', label: '1 年' },
  { value: 'all', label: '发布至今' },
];

/** 每页条数选项——默认 10 */
const PAGE_SIZE_OPTIONS: ReadonlyArray<DropdownOption<number>> = [
  { value: 10, label: '10 条/页' },
  { value: 15, label: '15 条/页' },
  { value: 30, label: '30 条/页' },
  { value: 50, label: '50 条/页' },
];

/** 从 axios 错误中提取后端返回的中文 message（后端 AppError 统一格式） */
function getApiError(err: unknown, fallback: string): string {
  const msg = (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message;
  return msg ?? (err instanceof Error ? err.message : fallback);
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

  // 搜索 & 筛选
  const [searchInput, setSearchInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [sort, setSort] = useState<'popular' | 'rated' | 'published' | 'updated' | 'subscribed' | 'relevance'>('popular');
  const [timeRange, setTimeRange] = useState<'day' | 'week' | 'month' | 'months3' | 'months6' | 'year' | 'all'>('week');
  const [fetchError, setFetchError] = useState<string | null>(null);

  // 待移除
  const [pendingRemovals, setPendingRemovals] = useState<Set<string>>(new Set());

  // 操作状态: { fileId: 'subscribing' | 'removing' }
  const [actionLoading, setActionLoading] = useState<Record<string, string>>({});

  // 每页条数——默认 10，可选 10/15/30/50
  const [pageSize, setPageSize] = useState(10);
  const totalPages = Math.max(1, Math.ceil(browseTotal / pageSize));

  /** 加载 Workshop 浏览数据 */
  const fetchBrowse = useCallback(async (
    query: string, sortBy: typeof sort, range: typeof timeRange, page: number, size: number,
  ) => {
    setBrowseLoading(true);
    setFetchError(null);
    try {
      const res = await apiClient.get('/workshop/browse', {
        params: { q: query, sort: sortBy, range, page, pageSize: size },
      });
      const data = res.data.data;
      setBrowseMods(data.mods ?? []);
      setBrowseTotal(data.total ?? 0);
    } catch (err) {
      setFetchError(getApiError(err, '浏览创意工坊失败'));
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
  useEffect(() => { fetchBrowse(searchQuery, sort, timeRange, browsePage, pageSize); }, []);
  useEffect(() => { fetchInstalled(); }, [server?.id]);

  /**
   * 输入框清空时自动清除已提交的搜索词——
   * 否则用户删掉输入内容后 searchQuery 仍残留（如"坦克"），接口继续带 q=坦克。
   * 仅在"输入框为空但已提交查询非空"时触发一次，避免循环。
   */
  useEffect(() => {
    if (searchInput === '' && searchQuery !== '') {
      setSearchQuery('');
      setSort('popular'); // 清空搜索后恢复默认"最热门"排序
      setTimeRange('week');
      setBrowsePage(1);
      fetchBrowse('', 'popular', 'week', 1, pageSize);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput]);

  /**
   * 搜索按钮点击——搜索框有内容时按内容搜索（自动切相关度排序）；
   * 搜索框为空时清空当前搜索，恢复浏览全部。
   */
  const handleSearchClick = () => {
    const trimmed = searchInput.trim();
    if (trimmed === '') {
      // 空搜索 = 清除搜索，恢复"最热门+1周"浏览全部
      setSearchQuery('');
      setSort('popular');
      setTimeRange('week');
      setBrowsePage(1);
      fetchBrowse('', 'popular', 'week', 1, pageSize);
    } else {
      setSearchQuery(trimmed);
      setSort('relevance'); // 搜索时自动切到相关度排序
      setBrowsePage(1);
      fetchBrowse(trimmed, 'relevance', timeRange, 1, pageSize);
    }
  };

  /** 搜索触发（回车）——自动切换为"搜索相关度"排序 */
  const triggerSearch = (q: string) => {
    const trimmed = q.trim();
    setSearchQuery(trimmed);
    setSort('relevance'); // 搜索时自动切到相关度排序
    setBrowsePage(1);
    fetchBrowse(trimmed, 'relevance', timeRange, 1, pageSize);
  };

  /** 排序改变——每选一个自动筛选 */
  const handleSortChange = (next: typeof sort) => {
    setSort(next);
    setBrowsePage(1);
    // 非"最热门"排序时时间范围被 Steam 忽略，重置为发布至今避免误导
    const range = next === 'popular' ? timeRange : 'all';
    if (next !== 'popular') setTimeRange('all');
    fetchBrowse(searchQuery, next, range, 1, pageSize);
  };

  /** 时间范围改变——每选一个自动筛选 */
  const handleRangeChange = (next: typeof timeRange) => {
    setTimeRange(next);
    setBrowsePage(1);
    fetchBrowse(searchQuery, sort, next, 1, pageSize);
  };

  /** 每页条数改变——自动重新筛选 */
  const handlePageSizeChange = (next: number) => {
    setPageSize(next);
    setBrowsePage(1);
    fetchBrowse(searchQuery, sort, timeRange, 1, next);
  };

  /** 翻页 */
  const handlePage = (p: number) => {
    if (p < 1 || p > totalPages || p === browsePage) return;
    setBrowsePage(p);
    fetchBrowse(searchQuery, sort, timeRange, p, pageSize);
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
      setFetchError(getApiError(err, '订阅失败'));
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
      setFetchError(getApiError(err, '移除失败'));
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
          <Button onClick={() => fetchBrowse(searchQuery, sort, timeRange, browsePage, pageSize)} variant="ghost" size="sm" className="text-slate-400">重试</Button>
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

      {/* Filter Bar — Figma 10:16234: 搜索 + 可交互筛选 */}
      <div className="shrink-0 mx-4 md:mx-6 px-4 rounded-lg flex flex-wrap items-center gap-3 h-11"
        style={{ backgroundColor: '#172133' }}>
        {/* 搜索输入框（复用 SearchInput 组件，仅按名称搜索） */}
        <SearchInput
          value={searchInput}
          onChange={setSearchInput}
          onEnter={triggerSearch}
          placeholder="搜索 Mod 名称..."
          width={260}
        />

        {/* 排序下拉——含"搜索相关度"（搜索时自动切换） */}
        <Dropdown<'popular' | 'rated' | 'published' | 'updated' | 'subscribed' | 'relevance'>
          value={sort}
          options={SORT_OPTIONS}
          onChange={handleSortChange}
          width={170}
          ariaLabel="排序方式"
        />

        {/* 时间范围下拉——Steam days 参数仅"最热门"排序生效，其余排序置灰 */}
        <Dropdown<'day' | 'week' | 'month' | 'months3' | 'months6' | 'year' | 'all'>
          value={timeRange}
          options={RANGE_OPTIONS}
          onChange={handleRangeChange}
          disabled={sort !== 'popular'}
          width={110}
          ariaLabel="时间范围"
        />

        {/* 每页条数下拉——默认 10，可选 10/15/30/50 */}
        <Dropdown<number>
          value={pageSize}
          options={PAGE_SIZE_OPTIONS}
          onChange={handlePageSizeChange}
          width={110}
          ariaLabel="每页条数"
        />

        {/* 搜索按钮——始终用主题强调色（Button default variant），默认即可点击 */}
        <Button
          size="sm"
          onClick={handleSearchClick}
          className="h-9 text-xs gap-1"
        >
          <Search size={14} /> 搜索
        </Button>

        {/* 结果摘要 */}
        <span className="text-xs text-slate-500 ml-auto">
          {searchQuery ? <>搜索「{searchQuery}」</> : <>浏览全部</>}
          {browseTotal > 0 && <> · 共 {browseTotal} 条</>}
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
