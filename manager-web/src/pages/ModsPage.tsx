import { useState, useMemo, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Search, Package, AlertCircle } from "lucide-react";
import { useCurrentServer } from "../contexts/CurrentServerContext.js";
import { useSteamCmdProgress } from "../hooks/useSteamCmdProgress.js";
import { apiClient } from "../api/client.js";
import {
  Dropdown,
  type DropdownOption,
} from "../components/shared/Dropdown.js";
import { ModCard } from "../components/mods/ModCard.js";
import { ModCardSkeleton } from "../components/mods/ModCardSkeleton.js";
import { ModDetailDialog } from "../components/mods/ModDetailDialog.js";
import { PaginationBar } from "../components/shared/PaginationBar.js";
import { SearchInput } from "../components/shared/SearchInput.js";
import { Button } from "../components/ui/button.js";

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
const SORT_OPTIONS: ReadonlyArray<
  DropdownOption<
    "popular" | "rated" | "published" | "updated" | "subscribed" | "relevance"
  >
> = [
  { value: "popular", label: "最热门" },
  { value: "rated", label: "最受好评（发布至今）" },
  { value: "published", label: "最近发行" },
  { value: "updated", label: "最新更新" },
  { value: "subscribed", label: "不重复订阅者总计" },
  { value: "relevance", label: "搜索相关度" },
];

/** 时间范围选项——Steam 官方 7 档（仅最热门排序生效） */
const RANGE_OPTIONS: ReadonlyArray<
  DropdownOption<
    "day" | "week" | "month" | "months3" | "months6" | "year" | "all"
  >
> = [
  { value: "day", label: "今天" },
  { value: "week", label: "1 周" },
  { value: "month", label: "30 天" },
  { value: "months3", label: "3 个月" },
  { value: "months6", label: "6 个月" },
  { value: "year", label: "1 年" },
  { value: "all", label: "发布至今" },
];

/** 每页条数选项（问题 2：10→12、50→48） */
const PAGE_SIZE_OPTIONS: ReadonlyArray<DropdownOption<number>> = [
  { value: 12, label: "12 条/页" },
  { value: 15, label: "15 条/页" },
  { value: 30, label: "30 条/页" },
  { value: 48, label: "48 条/页" },
];

/** 从 axios 错误提取后端中文 message */
function getApiError(err: unknown, fallback: string): string {
  const msg = (
    err as { response?: { data?: { error?: { message?: string } } } }
  )?.response?.data?.error?.message;
  return msg ?? (err instanceof Error ? err.message : fallback);
}

/**
 * 模组管理页面——单 Tab（问题 8：Loading 拆态；问题 5：订阅→下载 + Toast）。
 * 浏览 Steam 创意工坊 + 下载入口；已下载 Mod 的启用/禁用/删除在 Config > Workshop Tab。
 * 数据流：React Query 前端防抖（browse 60s staleTime），后端 0 缓存。
 */
export function ModsPage() {
  // 浏览 Steam 创意工坊是全局操作（不需要实例）；仅「下载」需要 serverId。
  // 取值来源：共享层当前选中实例（sc:design 第 4 阶段）；无实例时浏览照常，下载禁用。
  const { currentServerId } = useCurrentServer();
  const serverId = currentServerId ?? "";

  // 搜索 & 筛选
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [sort, setSort] = useState<
    "popular" | "rated" | "published" | "updated" | "subscribed" | "relevance"
  >("popular");
  const [timeRange, setTimeRange] = useState<
    "day" | "week" | "month" | "months3" | "months6" | "year" | "all"
  >("week");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(12); // 问题 2：默认每页 12 条（原 10）

  // 下载进行中 { fileId: jobId }——jobId 关联 WS 进度事件，completed/failed 时清（BUG-5/6）
  const [downloading, setDownloading] = useState<Record<string, string>>({});
  // downloading 的 ref 镜像——useEffect 内读 ref 而非 state，避免 setDownloading 触发 effect 重跑重复 toast
  const downloadingRef = useRef(downloading);
  downloadingRef.current = downloading;
  // 已 toast 过的 progress 去重集合（同一 jobId+currentFileId+stage 只处理一次）
  const handledProgressRef = useRef<Set<string>>(new Set());

  // 详情弹窗
  const [detailFileId, setDetailFileId] = useState<string | null>(null);

  // ★ BUG-5 修复：已下载 Mod 集合（acf 扫描真源，每次刷新）
  const { data: downloaded, refetch: refetchDownloaded } = useQuery({
    queryKey: ["mods", "downloaded", serverId],
    queryFn: async () => {
      if (!serverId) return [];
      const res = await apiClient.get<{
        data: Array<{ fileId: string; applied?: boolean }>;
      }>(`/servers/${serverId}/mods/downloaded`);
      return res.data.data;
    },
    enabled: !!serverId,
    refetchOnMount: "always",
    staleTime: 0,
  });

  // ★ BUG-5 修复：已下载 fileId 集合（含 applied——下载到 staging 即可标记已下载）
  const downloadedSet = useMemo(
    () => new Set((downloaded ?? []).map((d) => d.fileId)),
    [downloaded],
  );

  // ── 浏览数据（React Query，60s staleTime 前端防抖）──
  const {
    data: browse,
    isLoading: browseLoading,
    isError: browseError,
    refetch,
  } = useQuery({
    queryKey: [
      "mods",
      "browse",
      serverId,
      searchQuery,
      sort,
      timeRange,
      page,
      pageSize,
    ],
    queryFn: async () => {
      // 全局浏览——不带 serverId（Steam 创意工坊是全局操作）。
      // timeout 60s：后端调 Steam 冷启动 20-40s，全局默认 10s 会 axios abort（实测 ERR_ABORTED）
      const res = await apiClient.get<{
        data: { total: number; rows: BrowseMod[] };
      }>("/mods/search", {
        params: {
          q: searchQuery,
          sort,
          range: timeRange,
          page,
          pageSize,
          type: "text",
        },
        timeout: 60_000,
      });
      return res.data.data;
    },
    // 5 分钟前端防抖——配合后端 browseMods 进程内缓存（5min TTL）。
    // 重复访问同筛选条件：后端缓存命中 0 Steam 调用 + 前端缓存命中 0 网络往返。
    // 首次加载仍要等 Steam（不可控）；切回页面 / 切回旧筛选 = 0ms。
    staleTime: 5 * 60_000,
    retry: 1,
  });

  // ── 详情数据（0 staleTime——每次进弹窗都拉新）──
  const { data: detailData, isLoading: detailLoading } = useQuery({
    queryKey: ["mods", "detail", detailFileId],
    queryFn: async () => {
      // 全局详情——不带 serverId。
      // timeout 60s：后端 GetDetails 冷启动 20-40s，全局默认 10s 必超时（ERR_ABORTED 根因）
      const res = await apiClient.get<{ data: BrowseMod }>(
        `/mods/${detailFileId}`,
        { timeout: 60_000 },
      );
      return res.data.data;
    },
    enabled: !!detailFileId,
    staleTime: 0,
    retry: 0,
  });

  const total = browse?.total ?? 0;

  // ── 详情弹窗数据（问题 1 修复——合并而非整体覆盖）──
  // 列表源（QueryFiles 带 return_vote_data）有 voteScore，detail 源（GetDetails 带 includevotes）补充 fileSize/updatedAt。
  // 用 detail 覆盖同名字段、保留列表独有字段，防止星星/订阅数在 detail 返回后被 undefined 顶掉。
  const dialogRow = browse?.rows.find((m) => m.fileId === detailFileId);
  const dialogMod = detailData
    ? { ...(dialogRow ?? {}), ...detailData }
    : (dialogRow ?? null);

  // ── 操作 handler ────────────────────────────────────

  /** 搜索触发 */
  const triggerSearch = (q: string) => {
    const trimmed = q.trim();
    setSearchQuery(trimmed);
    setSort("relevance"); // 搜索时自动切相关度排序
    setPage(1);
  };

  /** 搜索按钮点击（空输入 = 清空搜索） */
  const handleSearchClick = () => {
    const trimmed = searchInput.trim();
    setSearchQuery(trimmed);
    setSort(trimmed ? "relevance" : "popular");
    setTimeRange(trimmed ? timeRange : "week");
    setPage(1);
  };

  /** 排序改变 */
  const handleSortChange = (next: typeof sort) => {
    setSort(next);
    setPage(1);
    // 非 popular 排序 Steam 忽略时间范围，重置避免误导
    if (next !== "popular") setTimeRange("all");
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

  /**
   * 下载 Mod（BUG-5/6 修复）。
   * 下载改为**异步启动**：POST 立即 202 返回 jobId（不再等 SteamCMD 下载进程 → 原实现
   * HTTP 挂起导致 axios 10s 超时）。完成/失败由 WS steamcmd_progress 事件驱动刷新已下载列表。
   */
  const handleDownload = async (fileId: string) => {
    if (!serverId) {
      toast.error("没有可用的服务器实例");
      return;
    }
    if (downloading[fileId] || downloadedSet.has(fileId)) return;
    setDownloading((prev) => ({ ...prev, [fileId]: "pending" }));
    try {
      const res = await apiClient.post<{
        data: { jobId?: string; modTitle?: string };
      }>(`/servers/${serverId}/mods/download`, { fileId });
      const { jobId, modTitle } = res.data.data;
      if (!jobId) {
        toast.error("下载启动失败");
        setDownloading((prev) => {
          const next = { ...prev };
          delete next[fileId];
          return next;
        });
        return;
      }
      // 记录 jobId——WS completed/failed 事件用它反查 fileId
      setDownloading((prev) => ({ ...prev, [fileId]: jobId }));
      toast.success(`${modTitle ?? "Mod"} 下载已启动`);
      // 不立即刷新已下载列表、不关详情弹窗——等 WS completed 事件
    } catch (err) {
      toast.error(getApiError(err, "下载失败"));
      setDownloading((prev) => {
        const next = { ...prev };
        delete next[fileId];
        return next;
      });
    }
  };

  // ★ BUG-5/6 修复：监听 SteamCMD 下载任务完成/失败 → 刷新已下载列表 + 恢复按钮状态
  // ★ 2026-08-14：每 fileId 自己的 progress state（按 jobId + currentFileId 反查 fileId）——
  // 让 ModCard 渲染各自进度条，队列中 fileId 也能显示「排队中（前 X 个）」。
  const downloadProgress = useSteamCmdProgress();
  const [progressByFile, setProgressByFile] = useState<
    Record<
      string,
      {
        stage: string;
        percent?: number;
        queuePos?: number;
        queueTotal?: number;
        errorMessage?: string;
      }
    >
  >({});
  useEffect(() => {
    const p = downloadProgress;
    if (!p) return;
    const { jobId, stage, percent, queuePos, queueTotal, errorMessage } = p;
    if (!jobId || !jobId.startsWith("steamcmd-download-")) return;

    // ★ 去重：同一 (jobId + currentFileId + stage) 组合只处理一次——防止 setDownloading
    // 触发 effect 重跑时重复 toast。WS 偶发重复广播 completed 也走同一去重。
    const dedupKey = `${jobId}|${p.currentFileId ?? ""}|${stage}`;
    if (handledProgressRef.current.has(dedupKey)) return;
    handledProgressRef.current.add(dedupKey);

    // ★ 2026-08-14 修复：所有 mod 共享同一个 jobId（steamcmd-download-<installDir>），
    // 靠 jobId 反查 fileId 永远命中第一个 → 接力时删错进度条。
    // 正确做法：优先用 currentFileId（后端 completed/downloading 都带）精确锁定；
    // 退化到 jobId 唯一匹配（仅当 downloading 里该 jobId 恰好一个 fileId 时才可信）。
    // 用 downloadingRef.current 读最新 downloading（不参与 deps——避免 setDownloading
    // 触发 effect 重跑重复 toast）。

    // completed/failed：用 currentFileId 精确锁定 fileId
    if (stage === "completed" || stage === "failed") {
      let targetFileId = p.currentFileId;
      if (!targetFileId) {
        const entries = Object.entries(downloadingRef.current).filter(
          ([, jid]) => jid === jobId,
        );
        if (entries.length === 1) targetFileId = entries[0]![0];
      }
      if (!targetFileId) return;

      if (stage === "completed") {
        toast.success("Mod 下载完成");
        void refetchDownloaded();
      } else {
        toast.error(errorMessage ?? "Mod 下载失败");
      }
      setProgressByFile((prev) => {
        const next = { ...prev };
        delete next[targetFileId!];
        return next;
      });
      setDownloading((prev) => {
        const next = { ...prev };
        delete next[targetFileId!];
        return next;
      });
      return;
    }

    // queued 阶段：用 currentFileId 或 jobId 唯一匹配定位（单 mod 进队瞬间）
    if (stage === "queued") {
      let targetFileId = p.currentFileId;
      if (!targetFileId) {
        const entries = Object.entries(downloadingRef.current).filter(
          ([, jid]) => jid === jobId,
        );
        if (entries.length === 1) targetFileId = entries[0]![0];
      }
      if (!targetFileId) return;
      setProgressByFile((prev) => ({
        ...prev,
        [targetFileId!]: {
          stage: "queued",
          ...(queuePos != null ? { queuePos } : {}),
          ...(queueTotal != null ? { queueTotal } : {}),
        },
      }));
      return;
    }

    // active 阶段（downloading/verifying）：currentFileId 精确锁定
    let targetFileId = p.currentFileId;
    if (!targetFileId) {
      const entries = Object.entries(downloadingRef.current).filter(
        ([, jid]) => jid === jobId,
      );
      if (entries.length === 1) targetFileId = entries[0]![0];
    }
    if (!targetFileId) return;
    setProgressByFile((prev) => ({
      ...prev,
      [targetFileId!]: {
        stage,
        ...(percent != null ? { percent } : {}),
        ...(queuePos != null ? { queuePos } : {}),
        ...(queueTotal != null ? { queueTotal } : {}),
        ...(errorMessage ? { errorMessage } : {}),
      },
    }));
  }, [downloadProgress]);

  // ── 渲染 ────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full">
      {/* TopBar — 始终渲染（问题 8） */}
      <div className="shrink-0 flex items-center px-4 md:px-6 h-16">
        <h1 className="text-xs font-normal text-slate-100">模组管理</h1>
      </div>

      {/* Filter Bar — 始终渲染（问题 8） */}
      <div
        className="shrink-0 mx-4 md:mx-6 px-4 rounded-lg flex flex-wrap items-center gap-3 h-11"
        style={{ backgroundColor: "#172133" }}
      >
        <SearchInput
          value={searchInput}
          onChange={setSearchInput}
          onEnter={triggerSearch}
          placeholder="搜索 Mod 名称..."
          width={260}
        />
        <Dropdown
          value={sort}
          options={SORT_OPTIONS}
          onChange={handleSortChange}
          width={170}
          ariaLabel="排序方式"
        />
        <Dropdown
          value={timeRange}
          options={RANGE_OPTIONS}
          onChange={handleRangeChange}
          disabled={sort !== "popular"}
          width={110}
          ariaLabel="时间范围"
        />
        <Dropdown<number>
          value={pageSize}
          options={PAGE_SIZE_OPTIONS}
          onChange={handlePageSizeChange}
          width={110}
          ariaLabel="每页条数"
        />
        <Button
          size="sm"
          onClick={handleSearchClick}
          className="h-9 text-xs gap-1"
        >
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
            <AlertCircle size={32} style={{ color: "#EF4444" }} />
            <span className="text-sm text-slate-300">无法加载创意工坊</span>
            <span className="text-xs text-slate-500">
              请确认已配置 Steam WebAPI Key，或稍后重试
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => refetch()}
              className="text-slate-400"
            >
              重试
            </Button>
          </div>
        ) : (browse?.rows ?? []).length === 0 ? (
          <div className="flex items-center justify-center h-64 text-slate-500">
            <Package size={32} />
            <span className="ml-3 text-sm">
              {searchQuery ? (
                "没有匹配的 Mod"
              ) : (
                <span>
                  请先到{" "}
                  <a
                    href="/settings"
                    className="underline"
                    style={{ color: "#3B82F6" }}
                  >
                    Settings → Steam WebAPI Key
                  </a>{" "}
                  配置密钥后浏览创意工坊
                </span>
              )}
            </span>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {(browse?.rows ?? []).map((mod) => {
              const fileProgress = progressByFile[mod.fileId];
              return (
                <ModCard
                  key={mod.fileId}
                  fileId={mod.fileId}
                  title={mod.title}
                  description={mod.description}
                  previewUrl={mod.previewUrl}
                  subscriptions={mod.subscriptions}
                  voteScore={mod.voteScore}
                  loading={!!downloading[mod.fileId]}
                  downloaded={downloadedSet.has(mod.fileId)} // ★ BUG-5 修复
                  // ★ 2026-08-14：每 mod 行自己的进度条（按 fileId 维度）
                  {...(fileProgress?.stage ? { progressStage: fileProgress.stage } : {})}
                  {...(fileProgress?.percent != null ? { progressPercent: fileProgress.percent } : {})}
                  {...(fileProgress?.queuePos != null ? { queuePos: fileProgress.queuePos } : {})}
                  {...(fileProgress?.queueTotal != null ? { queueTotal: fileProgress.queueTotal } : {})}
                  {...(fileProgress?.errorMessage ? { progressErrorMessage: fileProgress.errorMessage } : {})}
                  onDownload={handleDownload}
                  onDetails={(id) => setDetailFileId(id)}
                />
              );
            })}
          </div>
        )}
      </div>

      {/* Pagination — 始终渲染 */}
      <div className="shrink-0 mx-4 md:mx-6 my-4">
        <PaginationBar
          page={page}
          pageSize={pageSize}
          total={total}
          onPageChange={setPage}
        />
      </div>

      {/* 详情弹窗（问题 6——弹窗而非跳转）
          dialogMod = 列表数据兜底 + detail 覆盖（问题 1：评分/订阅数稳定不闪） */}
      <ModDetailDialog
        open={!!detailFileId}
        mod={dialogMod}
        loading={detailLoading && !dialogRow}
        onClose={() => setDetailFileId(null)}
        onDownload={handleDownload}
      />
    </div>
  );
}
