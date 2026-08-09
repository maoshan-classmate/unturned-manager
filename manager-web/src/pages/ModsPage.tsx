import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Search, Package, AlertCircle } from 'lucide-react';
import { useParams } from 'react-router-dom';
import { useServer } from '../hooks/useServer.js';
import { apiClient } from '../api/client.js';
import { Dropdown, type DropdownOption } from '../components/shared/Dropdown.js';
import { ModCard } from '../components/mods/ModCard.js';
import { ModCardSkeleton } from '../components/mods/ModCardSkeleton.js';
import { ModDetailDialog } from '../components/mods/ModDetailDialog.js';
import { PaginationBar } from '../components/shared/PaginationBar.js';
import { SearchInput } from '../components/shared/SearchInput.js';
import { Button } from '../components/ui/button.js';

/** Mod 浏览元数据（GET /mods/search 返回） */
interface BrowseMod {
  fileId: string;
  title: string;
  author: string;
  authorName?: string;
  description: string;
  previewUrl?: string;
  fileSize?: number;
  subscriptions?: number;
  voteScore?: number;
  votesUp?: number;
  votesDown?: number;
  timeUpdated?: number;
}

/** 排序选项——Steam 客户端创意工坊官方 5 项 + 搜索相关度 */
const SORT_OPTIONS: ReadonlyArray<DropdownOption<'popular' | 'rated' | 'published' | 'updated' | 'subscribed' | 'relevance'>> = [
  { value: 'popular', label: '最热门' },
  { value: 'rated', label: '最受好评（发布至今）' },
  { value: 'published', label: '最近发行' },
  { value: 'updated', label: '最新更新' },
  { value: 'subscribed', label: '不重复订阅者总计' },
  { value: 'relevance', label: '搜索相关度' },
];

/** 时间范围选项——Steam 官方 7 档（仅最热门排序生效） */
const RANGE_OPTIONS: ReadonlyArray<DropdownOption<'day' | 'week' | 'month' | 'months3' | 'months6' | 'year' | 'all'>> = [
  { value: 'day', label: '今天' },
  { value: 'week', label: '1 周' },
  { value: 'month', label: '30 天' },
  { value: 'months3', label: '3 个月' },
  { value: 'months6', label: '6 个月' },
  { value: 'year', label: '1 年' },
  { value: 'all', label: '发布至今' },
];

/** 每页条数选项（问题 2：10→12、50→48） */
const PAGE_SIZE_OPTIONS: ReadonlyArray<DropdownOption<number>> = [
  { value: 12, label: '12 条/页' },
  { value: 15, label: '15 条/页' },
  { value: 30, label: '30 条/页' },
  { value: 48, label: '48 条/页' },
];

/** 从 axios 错误提取后端中文 message */
function getApiError(err: unknown, fallback: string): string {
  const msg = (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message;
  return msg ?? (err instanceof Error ? err.message : fallback);
}

/**
 * 模组管理页面——单 Tab（问题 8：Loading 拆态；问题 5：订阅→下载 + Toast）。
 * 浏览 Steam 创意工坊 + 下载入口；已下载 Mod 的启用/禁用/删除在 Config > Workshop Tab。
 * 数据流：React Query 前端防抖（browse 60s staleTime），后端 0 缓存。
 */
export function ModsPage() {
  // 浏览 Steam 创意工坊是全局操作——走 /api/mods（不依赖 serverId）。
  // 仅「下载」需要 serverId（下载到哪个服务器），从 useServer 拿第一个真实服务器。
  const { serverId: routeServerId } = useParams<{ serverId: string }>();
  const { servers } = useServer();
  const serverId = (routeServerId && routeServerId !== '_default' ? routeServerId : servers[0]?.id) ?? '';

  // 搜索 & 筛选
  const [searchInput, setSearchInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [sort, setSort] = useState<'popular' | 'rated' | 'published' | 'updated' | 'subscribed' | 'relevance'>('popular');
  const [timeRange, setTimeRange] = useState<'day' | 'week' | 'month' | 'months3' | 'months6' | 'year' | 'all'>('week');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(12); // 问题 2：默认每页 12 条（原 10）

  // 下载操作状态 { fileId: true }
  const [downloading, setDownloading] = useState<Record<string, boolean>>({});

  // 详情弹窗
  const [detailFileId, setDetailFileId] = useState<string | null>(null);

  // ── 浏览数据（React Query，60s staleTime 前端防抖）──
  const {
    data: browse,
    isLoading: browseLoading,
    isError: browseError,
    refetch,
  } = useQuery({
    queryKey: ['mods', 'browse', serverId, searchQuery, sort, timeRange, page, pageSize],
    queryFn: async () => {
      // 全局浏览——不带 serverId（Steam 创意工坊是全局操作）
      const res = await apiClient.get<{ data: { total: number; rows: BrowseMod[] } }>('/mods/search', {
        params: { q: searchQuery, sort, range: timeRange, page, pageSize, type: 'text' },
      });
      return res.data.data;
    },
    staleTime: 60_000, // 纯前端防抖（后端 0 缓存）
    retry: 1,
  });

  // ── 详情数据（0 staleTime——每次进弹窗都拉新）──
  const {
    data: detailData,
    isLoading: detailLoading,
  } = useQuery({
    queryKey: ['mods', 'detail', detailFileId],
    queryFn: async () => {
      // 全局详情——不带 serverId
      const res = await apiClient.get<{ data: BrowseMod }>(`/mods/${detailFileId}`);
      return res.data.data;
    },
    enabled: !!detailFileId,
    staleTime: 0,
    retry: 0,
  });

  const total = browse?.total ?? 0;

  // ── 操作 handler ────────────────────────────────────

  /** 搜索触发 */
  const triggerSearch = (q: string) => {
    const trimmed = q.trim();
    setSearchQuery(trimmed);
    setSort('relevance'); // 搜索时自动切相关度排序
    setPage(1);
  };

  /** 搜索按钮点击（空输入 = 清空搜索） */
  const handleSearchClick = () => {
    const trimmed = searchInput.trim();
    setSearchQuery(trimmed);
    setSort(trimmed ? 'relevance' : 'popular');
    setTimeRange(trimmed ? timeRange : 'week');
    setPage(1);
  };

  /** 排序改变 */
  const handleSortChange = (next: typeof sort) => {
    setSort(next);
    setPage(1);
    // 非 popular 排序 Steam 忽略时间范围，重置避免误导
    if (next !== 'popular') setTimeRange('all');
  };

  /** 时间范围改变 */
  const handleRangeChange = (next: typeof timeRange) => {
    setTimeRange(next);
    setPage(1);
  };

  /** 每页条数改变 */
  const handlePageSizeChange = (next: number) => {
    setPageSize(next);
    setPage(1);
  };

  /** 下载 Mod（问题 5——调 download 端点，Toast 即全部反馈，不跳转） */
  const handleDownload = async (fileId: string) => {
    setDownloading((prev) => ({ ...prev, [fileId]: true }));
    try {
      if (!serverId) {
        toast.error('没有可用的服务器实例');
        return;
      }
      const res = await apiClient.post<{ data: { success: boolean; modTitle?: string; error?: string } }>(
        `/servers/${serverId}/mods/download`,
        { fileId },
      );
      const { success, modTitle, error } = res.data.data;
      if (success) {
        toast.success(`${modTitle ?? 'Mod'} 下载成功`);
        // 关闭详情弹窗（若打开）
        setDetailFileId(null);
      } else {
        toast.error(error || '下载失败');
      }
    } catch (err) {
      toast.error(getApiError(err, '下载失败'));
    } finally {
      setDownloading((prev) => {
        const next = { ...prev };
        delete next[fileId];
        return next;
      });
    }
  };

  // ── 渲染 ────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full">
      {/* TopBar — 始终渲染（问题 8） */}
      <div className="shrink-0 flex items-center px-4 md:px-6 h-16">
        <h1 className="text-xs font-normal text-slate-100">模组管理</h1>
      </div>

      {/* Filter Bar — 始终渲染（问题 8） */}
      <div className="shrink-0 mx-4 md:mx-6 px-4 rounded-lg flex flex-wrap items-center gap-3 h-11"
        style={{ backgroundColor: '#172133' }}>
        <SearchInput
          value={searchInput}
          onChange={setSearchInput}
          onEnter={triggerSearch}
          placeholder="搜索 Mod 名称..."
          width={260}
        />
        <Dropdown value={sort} options={SORT_OPTIONS} onChange={handleSortChange} width={170} ariaLabel="排序方式" />
        <Dropdown value={timeRange} options={RANGE_OPTIONS} onChange={handleRangeChange} disabled={sort !== 'popular'} width={110} ariaLabel="时间范围" />
        <Dropdown<number> value={pageSize} options={PAGE_SIZE_OPTIONS} onChange={handlePageSizeChange} width={110} ariaLabel="每页条数" />
        <Button size="sm" onClick={handleSearchClick} className="h-9 text-xs gap-1">
          <Search size={14} /> 搜索
        </Button>
        <span className="text-xs text-slate-500 ml-auto">
          {searchQuery ? <>搜索「{searchQuery}」</> : <>浏览全部</>}
          {total > 0 && <> · 共 {total} 条</>}
        </span>
      </div>

      {/* 卡片网格 — 独立 loading（问题 8） */}
      <div className="flex-1 overflow-auto mx-4 md:mx-6 mt-4">
        {browseLoading && !browse ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <ModCardSkeleton key={i} />
            ))}
          </div>
        ) : browseError && !browse ? (
          <div className="flex items-center justify-center h-64 text-slate-500 flex-col gap-3">
            <AlertCircle size={32} style={{ color: '#EF4444' }} />
            <span className="text-sm text-slate-300">无法加载创意工坊</span>
            <span className="text-xs text-slate-500">请确认已配置 Steam WebAPI Key，或稍后重试</span>
            <Button variant="ghost" size="sm" onClick={() => refetch()} className="text-slate-400">重试</Button>
          </div>
        ) : (browse?.rows ?? []).length === 0 ? (
          <div className="flex items-center justify-center h-64 text-slate-500">
            <Package size={32} />
            <span className="ml-3 text-sm">
              {searchQuery ? '没有匹配的 Mod' : (
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
            {(browse?.rows ?? []).map((mod) => (
              <ModCard
                key={mod.fileId}
                fileId={mod.fileId}
                title={mod.title}
                description={mod.description}
                previewUrl={mod.previewUrl}
                subscriptions={mod.subscriptions}
                voteScore={mod.voteScore}
                loading={!!downloading[mod.fileId]}
                onDownload={handleDownload}
                onDetails={(id) => setDetailFileId(id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Pagination — 始终渲染 */}
      <div className="shrink-0 mx-4 md:mx-6 my-4">
        <PaginationBar page={page} pageSize={pageSize} total={total} onPageChange={setPage} />
      </div>

      {/* 详情弹窗（问题 6——弹窗而非跳转）
          mod 优先用浏览列表已有数据（title/description/preview 立即显示），detail 接口补充评分/大小等 */}
      <ModDetailDialog
        open={!!detailFileId}
        mod={detailData ?? browse?.rows.find((m) => m.fileId === detailFileId) ?? null}
        loading={detailLoading && !browse?.rows.some((m) => m.fileId === detailFileId)}
        onClose={() => setDetailFileId(null)}
        onDownload={handleDownload}
      />
    </div>
  );
}
