import { Star, Plus, Eye, Users, Check } from 'lucide-react';
import { Button } from '../ui/button.js';
import { ProgressBar } from '../shared/ProgressBar.js';
import { cn, stripBbcode } from '@/lib/utils';

/** ModCard Props（单 variant——只服务 ModsPage Steam 浏览） */
interface ModCardProps {
  /** Workshop File ID */
  fileId: string;
  /** Mod 名称 */
  title: string;
  /** Mod 简介描述（原始 BBCode，内部 strip） */
  description: string;
  /** 预览图 URL */
  previewUrl?: string;
  /** 订阅数（可选） */
  subscriptions?: number;
  /** 评分（0-5 星级，可选） */
  voteScore?: number;
  /** 是否正在操作中 */
  loading?: boolean;
  /** 是否已下载（来自 /mods/downloaded） */
  downloaded?: boolean;
  /** 进度条 stage：downloading/queued/verifying/completed/failed */
  progressStage?: string;
  /** 进度百分比（0-100）；undefined → indeterminate */
  progressPercent?: number;
  /** 排队位置（≥2 显示「排队中」）；undefined → 不展示 */
  queuePos?: number;
  /** 排队总长度 */
  queueTotal?: number;
  /** 失败时的真实根因 */
  progressErrorMessage?: string;
  /** 下载回调 */
  onDownload?: (fileId: string) => void;
  /** 详情回调 */
  onDetails?: (fileId: string) => void;
}

/**
 * 创意工坊 Mod 卡片——对齐 Figma 14:16695 ModCard。
 * 走 shadcn Button variant + 订阅数展示 + 精确评分星；
 * 不展示作者/ID；stripBbcode 兜底；下载按钮。
 *
 * @param props - 组件属性
 * @returns ModCard React 元素
 *
 * @example
 * ```tsx
 * <ModCard fileId="1753134636" title="Hawaii" description="[h1]热带群岛[/h1]"
 *   subscriptions={12345} voteScore={3.2}
 *   onDownload={handleDownload} onDetails={handleDetails} />
 * ```
 */
export function ModCard({
  fileId, title, description, previewUrl,
  subscriptions, voteScore, loading, downloaded,
  progressStage, progressPercent, queuePos, queueTotal, progressErrorMessage,
  onDownload, onDetails,
}: ModCardProps) {
  const cleanDescription = stripBbcode(description);

  return (
    <div
      className={cn(
        'rounded-lg overflow-hidden transition-colors border border-slate-700',
        'hover:ring-1 hover:ring-slate-600',
      )}
      style={{ backgroundColor: '#1E293B' }}
    >
      {/* Cover image */}
      {previewUrl ? (
        <div className="relative w-full h-[180px] overflow-hidden">
          {/* 问题 3：object-contain 完整显示图片（不裁剪），暗色背景填充留白 */}
          <img src={previewUrl} alt={title} loading="lazy" className="w-full h-full object-contain" style={{ backgroundColor: '#0F172A' }} />
          {/* Gradient overlay from Figma */}
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              background: 'linear-gradient(to bottom, transparent 0%, rgba(0,0,0,0.3) 100%)',
            }}
          />
        </div>
      ) : (
        <div
          className="relative w-full h-[140px] flex items-center justify-center"
          style={{ backgroundColor: '#0F172A' }}
        >
          <span className="text-slate-700 text-xs">暂无预览</span>
        </div>
      )}

      <div className="p-4 pt-3">
        {/* Name + star rating（按 voteScore 填充星级） */}
        <div className="flex items-center gap-2">
          <h3 className="text-xs font-medium text-slate-100 truncate flex-1">{title}</h3>
          {/* 评分星星 + 数字（补详情页已有的 toFixed(1) 评分数字） */}
          {voteScore != null && (
            <div className="flex items-center gap-0.5 shrink-0">
              {Array.from({ length: 5 }).map((_, i) => {
                const fill = Math.min(Math.max(voteScore - i, 0), 1);
                return (
                  <div key={i} className="relative" style={{ width: 12, height: 12 }}>
                    {/* 底星（空） */}
                    <Star size={12} className="text-slate-700 absolute inset-0" />
                    {/* 覆盖星（按填充比例裁剪） */}
                    <div className="absolute inset-0 overflow-hidden" style={{ width: `${fill * 100}%` }}>
                      <Star size={12} className="text-amber-500" />
                    </div>
                  </div>
                );
              })}
              <span className="ml-1 text-xs text-amber-500 font-mono tabular-nums">{voteScore.toFixed(1)}</span>
            </div>
          )}
        </div>

        {/* 订阅数（不展示作者/ID 信息） */}
        {subscriptions != null && subscriptions > 0 && (
          <div className="flex items-center gap-1 mt-1.5 text-xs text-slate-500">
            <Users size={11} />
            <span className="font-mono tabular-nums">{subscriptions.toLocaleString()}</span>{" "}订阅
          </div>
        )}

        {/* Description — BBCode 已 strip */}
        <p className="text-xs text-slate-500 mt-0.5 truncate">
          {cleanDescription || '暂无描述'}
        </p>

        {/* 进度条槽位：downloading/queued/verifying/completed/failed 时渲染 */}
        {progressStage && (
          <ProgressBar
            stage={progressStage}
            {...(progressPercent != null ? { percent: progressPercent } : {})}
            {...(queuePos != null ? { queuePos } : {})}
            {...(queueTotal != null ? { queueTotal } : {})}
            {...(progressErrorMessage ? { errorMessage: progressErrorMessage } : {})}
            className="mt-2"
          />
        )}

        {/* Action buttons — shadcn variant（问题 4）+ "订阅"→"下载"（问题 5） */}
        <div className="flex items-center gap-2 mt-3">
          <Button
            size="sm"
            variant={downloaded ? 'outline' : 'default'}
            onClick={() => !downloaded && onDownload?.(fileId)}
            disabled={loading || downloaded}
            className="h-7 text-xs gap-1 px-3"
          >
            {downloaded ? <Check size={12} /> : <Plus size={12} />}
            {downloaded ? '已下载' : '下载'}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => onDetails?.(fileId)}
            className="h-7 text-xs gap-1 px-3"
          >
            <Eye size={12} /> 详情
          </Button>
        </div>
      </div>
    </div>
  );
}
