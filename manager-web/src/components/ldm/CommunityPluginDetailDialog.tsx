import { useQuery } from "@tanstack/react-query";
import { Calendar, User, Tag, ExternalLink, BookText } from "lucide-react";
import { apiClient } from "../../api/client.js";
import { Dialog } from "../shared/Dialog.js";
import { Button } from "../ui/button.js";
import { formatDate, stripBbcode } from "../../lib/utils.js";

/** 社区插件详情（GET /api/ldm/community-plugins/:owner/:repo） */
interface CommunityPluginDetail {
  slug: string;
  name: string;
  author: string;
  description: string;
  repoUrl: string;
  latestVersion: string;
  updatedAtIso: string;
  /** GitHub Releases URL——「下载 .dll」外链按钮 */
  releasesUrl: string;
  /** GitHub Releases body 截断（≤ 500 字）——详情抽屉「发布说明（Release Notes）」展示 */
  releaseNotes: string | null;
}

interface CommunityPluginDetailDialogProps {
  /** 是否打开 */
  open: boolean;
  /** 关闭回调 */
  onClose: () => void;
  /** 插件 slug（`owner/repo` 两段）—— null 时不查询 */
  slug: { owner: string; repo: string } | null;
  /** GitHub PAT（提升限流）；null = 匿名调用 */
  pat: string | null;
}

/**
 * 社区插件详情抽屉——点击 CommunityCard 标题旁的 Info 按钮触发。
 * 复用 components/shared/Dialog 容器（width=560）；展示 README 预览 + Releases 外链。
 *
 * 数据源：`GET /api/ldm/community-plugins/:owner/:repo`（Phase 3 后端已落档）。
 * PAT 经 header `X-GitHub-PAT` 透传——同 listCommunityPlugins 模式，不入服务端存储。
 *
 * 重要边界（G5 钉死）：本组件**不**触发 .dll 下载或上传。下载由用户在 GitHub Releases
 * 页手动完成；上传由 CommunityCard 的「上传到此实例」按钮独立触发（Files API）。
 *
 * @param props - 组件属性
 * @returns 抽屉 React 元素；未打开时返回 null
 *
 * @example
 * ```tsx
 * <CommunityPluginDetailDialog
 *   open={!!slug}
 *   onClose={() => setSlug(null)}
 *   slug={slug}
 *   pat={pat}
 * />
 * ```
 */
export function CommunityPluginDetailDialog({
  open,
  onClose,
  slug,
  pat,
}: CommunityPluginDetailDialogProps) {
  const owner = slug?.owner ?? "";
  const repo = slug?.repo ?? "";

  const { data, isLoading, error } = useQuery({
    queryKey: ["ldm", "plugin-detail", owner, repo],
    queryFn: async () => {
      const res = await apiClient.get<{ data: CommunityPluginDetail }>(
        `/ldm/community-plugins/${owner}/${repo}`,
        pat ? { headers: { "X-GitHub-Pat": pat } } : {},
      );
      return res.data.data;
    },
    enabled: !!owner && !!repo && open,
    staleTime: 5 * 60_000,
    retry: false,
  });

  if (!open) return null;

  return (
    <Dialog open={open} onClose={onClose} width={560}>
      {isLoading ? (
        <div className="p-6 flex items-center justify-center h-48 text-slate-400 text-sm">
          加载详情中…
        </div>
      ) : error || !data ? (
        <div className="p-6 flex items-center justify-center h-48 text-slate-400 text-sm">
          详情读取失败（插件可能在 LDM-Community 列表之外）
        </div>
      ) : (
        <div className="p-5">
          <Dialog.Title>{data.name}</Dialog.Title>

          {/* 元数据行：作者 / 版本 / 更新时间 */}
          <div className="grid grid-cols-3 gap-3 mb-4 text-xs">
            <MetaItem icon={User} label="作者" value={data.author} />
            <MetaItem icon={Tag} label="最新版本" value={data.latestVersion} />
            <MetaItem icon={Calendar} label="更新时间" value={formatDate(data.updatedAtIso)} />
          </div>

          {/* 完整介绍 */}
          <div className="mb-4">
            <div className="text-xs font-medium text-slate-300 mb-1.5">介绍</div>
            <p className="text-xs text-slate-400 leading-relaxed whitespace-pre-wrap max-h-40 overflow-y-auto">
              {stripBbcode(data.description) || "暂无描述"}
            </p>
          </div>

          {/* 发布说明（Release Notes） */}
          {data.releaseNotes && (
            <div className="mb-4">
              <div className="flex items-center gap-1 text-xs font-medium text-slate-300 mb-1.5">
                <BookText size={12} /> 发布说明（Release Notes）
              </div>
              <pre
                className="text-[11px] leading-relaxed whitespace-pre-wrap p-2 rounded max-h-32 overflow-y-auto font-mono"
                style={{
                  backgroundColor: "#0F172A",
                  color: "#94A3B8",
                  border: "1px solid #334059",
                }}
              >
                {data.releaseNotes}
              </pre>
            </div>
          )}

          <Dialog.Footer>
            <Button
              size="sm"
              variant="default"
              onClick={() => window.open(data.releasesUrl, "_blank")}
              className="text-xs"
            >
              <ExternalLink size={14} /> 打开 GitHub Releases
            </Button>
            <Button size="sm" variant="ghost" onClick={onClose} className="text-xs">
              关闭
            </Button>
          </Dialog.Footer>
        </div>
      )}
    </Dialog>
  );
}

/** 元数据单项（与 ModDetailDialog.tsx 内部实现对齐） */
function MetaItem({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Calendar;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-1.5 text-slate-400">
      <Icon size={12} className="shrink-0 text-slate-500" />
      <span className="shrink-0">{label}</span>
      <span className="text-slate-300 truncate">{value}</span>
    </div>
  );
}