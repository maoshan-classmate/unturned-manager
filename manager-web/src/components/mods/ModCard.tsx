import { Star, Eye, Plus, Trash2 } from 'lucide-react';
import { Button } from '../ui/button.js';
import { cn } from '@/lib/utils';

/** ModCard Props */
interface ModCardProps {
  /** Workshop File ID */
  fileId: string;
  /** Mod 名称 */
  title: string;
  /** 作者名 */
  author: string;
  /** Mod 简介描述 */
  description: string;
  /** 预览图 URL */
  previewUrl?: string;
  /** 订阅数（可选） */
  subscriptions?: number | string;
  /** 是否已订阅（已安装在服务器上） */
  installed?: boolean;
  /** 是否正在操作中 */
  loading?: boolean;
  /** 订阅回调 */
  onSubscribe?: (fileId: string) => void;
  /** 详情回调 */
  onDetails?: (fileId: string) => void;
  /** 移除回调（已安装时显示） */
  onRemove?: (fileId: string) => void;
  /** 是否标记为待移除 */
  pendingRemoval?: boolean;
}

/**
 * 创意工坊 Mod 卡片——对齐 Figma 14:16695 ModCard。
 *
 * @param props - 组件属性
 * @returns ModCard React 元素
 *
 * @example
 * ```tsx
 * <ModCard fileId="1753134636" title="Hawaii" author="Renaxon" description="热带群岛地图"
 *   subscriptions="12.3k" installed onSubscribe={handleSubscribe} />
 * ```
 */
export function ModCard({
  fileId, title, author, description, previewUrl,
  subscriptions, installed, loading, pendingRemoval,
  onSubscribe, onDetails, onRemove,
}: ModCardProps) {
  return (
    <div
      className={cn(
        'rounded-lg overflow-hidden transition-colors border border-slate-700',
        pendingRemoval ? 'opacity-50 ring-1 ring-red-500' : 'hover:ring-1 hover:ring-slate-600',
      )}
      style={{ backgroundColor: '#1E293B' }}
    >
      {/* Cover image */}
      {previewUrl ? (
        <div className="relative w-full h-[140px] overflow-hidden">
          <img src={previewUrl} alt={title} className="w-full h-full object-cover" />
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
          <span className="text-slate-700 text-xs">No Preview</span>
        </div>
      )}

      <div className="p-4 pt-3">
        {/* Name + star rating */}
        <div className="flex items-center gap-2">
          <h3 className="text-xs font-medium text-slate-100 truncate flex-1">{title}</h3>
          <div className="flex items-center gap-0.5 shrink-0">
            {Array.from({ length: 5 }).map((_, i) => (
              <Star key={i} size={12} className="text-slate-700" />
            ))}
          </div>
        </div>

        {/* Author · subscriptions · ID — Figma single line */}
        <p className="text-xs text-slate-500 mt-1.5 truncate">
          作者 {author}
          {subscriptions ? ` · ${subscriptions} 订阅` : ''}
          {' · '}ID {fileId}
        </p>

        {/* Description — Figma single line */}
        <p className="text-xs text-slate-500 mt-0.5 truncate">
          {description || '暂无描述'}
        </p>

        {/* Action buttons — Figma: 订阅 / 详情 / 移除 */}
        <div className="flex items-center gap-2 mt-3">
          {installed ? (
            <Button
              size="sm"
              variant="ghost"
              disabled
              className="h-7 text-[11px] px-3"
              style={{ color: '#22C55E', opacity: 0.6 }}
            >
              已安装
            </Button>
          ) : (
            <Button
              size="sm"
              onClick={() => onSubscribe?.(fileId)}
              disabled={loading}
              className="h-7 text-[11px] gap-1 px-3"
              style={{ backgroundColor: '#22C55E', color: 'white' }}
            >
              <Plus size={12} /> 订阅
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={() => onDetails?.(fileId)}
            className="h-7 text-[11px] gap-1 px-3 border-slate-500 text-slate-400"
          >
            <Eye size={12} /> 详情
          </Button>
          {installed && onRemove && (
            <Button
              size="sm"
              onClick={() => onRemove(fileId)}
              disabled={loading}
              className="h-7 text-[11px] gap-1 px-3"
              style={{ backgroundColor: '#EF4444', color: 'white' }}
            >
              <Trash2 size={12} /> 移除
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
