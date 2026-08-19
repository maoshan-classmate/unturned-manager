import { Star, Download, ExternalLink, Calendar, HardDrive } from 'lucide-react';
import { Dialog } from '../shared/Dialog.js';
import { Button } from '../ui/button.js';
import { formatSize, formatDate, stripBbcode } from '@/lib/utils';

/** Mod 详情数据类型（来自 GET /mods/:fileId）——不展示作者/ID */
interface ModDetail {
  fileId: string;
  title: string;
  description: string;
  previewUrl?: string;
  fileSize?: number;
  subscriptions?: number;
  voteScore?: number;
  updatedAt?: string;
}

/** ModDetailDialog Props */
interface ModDetailDialogProps {
  /** 是否打开 */
  open: boolean;
  /** 关闭回调 */
  onClose: () => void;
  /** Mod 详情数据；null 时显示 loading */
  mod: ModDetail | null;
  /** 是否正在加载 */
  loading?: boolean;
  /** 下载回调 */
  onDownload?: (fileId: string) => void;
}

/**
 * Mod 详情弹窗——详情按钮打开弹窗而非跳转 Steam 外链。
 * 包装 components/shared/Dialog.tsx，显示完整 Mod 信息 + 操作区。
 *
 * @param props - 组件属性
 * @returns 弹窗 React 元素；未打开或 mod 为 null 时返回 null
 *
 * @example
 * ```tsx
 * <ModDetailDialog open={!!fileId} mod={detailData} loading={detailLoading}
 *   onClose={() => setFileId(null)} onDownload={handleDownload} />
 * ```
 */
export function ModDetailDialog({ open, onClose, mod, loading, onDownload }: ModDetailDialogProps) {
  if (!open) return null;

  return (
    <Dialog open={open} onClose={onClose} width={680}>
      {loading || !mod ? (
        <div className="p-6 flex items-center justify-center h-48 text-slate-400 text-sm">
          加载详情中...
        </div>
      ) : (
        <div className="p-4">
          {/* 大封面——与列表页 ModCard 对齐：object-contain 完整显示 + 暗底 + 底部渐变；
              aspect-[16/9] 随弹窗宽度等比缩放（自适应，不钉死 px 高） */}
          {mod.previewUrl ? (
            <div className="relative w-full aspect-[16/9] rounded-md overflow-hidden mb-4">
              <img src={mod.previewUrl} alt={mod.title} loading="lazy"
                className="absolute inset-0 w-full h-full object-contain"
                style={{ backgroundColor: '#0F172A' }} />
              <div className="absolute inset-0 pointer-events-none"
                style={{ background: 'linear-gradient(to bottom, transparent 0%, rgba(0,0,0,0.3) 100%)' }} />
            </div>
          ) : (
            <div className="relative w-full aspect-[16/9] rounded-md overflow-hidden mb-4 flex items-center justify-center"
              style={{ backgroundColor: '#0F172A' }}>
              <span className="text-slate-600 text-sm">No Preview</span>
            </div>
          )}

          {/* 标题 */}
          <Dialog.Title>{mod.title}</Dialog.Title>

          {/* 元数据行：大小 / 更新时间（不展示作者/ID） */}
          <div className="grid grid-cols-2 gap-2 mb-4 text-xs">
            <MetaItem icon={HardDrive} label="大小" value={mod.fileSize != null ? formatSize(mod.fileSize) : '—'} />
            <MetaItem icon={Calendar} label="更新时间" value={mod.updatedAt ? formatDate(mod.updatedAt) : '—'} />
          </div>

          {/* 订阅数 + 评分 */}
          {(mod.subscriptions != null || mod.voteScore != null) && (
            <div className="flex items-center gap-4 mb-4 text-xs text-slate-400">
              {mod.subscriptions != null && <span>{mod.subscriptions.toLocaleString()} 订阅</span>}
              {mod.voteScore != null && (
                <span className="flex items-center gap-1">
                  {/* 评分星星——精确填充（问题 5：2.7 分 = 2 满星 + 0.7 部分填充） */}
                  {Array.from({ length: 5 }).map((_, i) => {
                    const fill = Math.min(Math.max(mod.voteScore! - i, 0), 1);
                    return (
                      <span key={i} className="relative inline-block" style={{ width: 12, height: 12 }}>
                        <Star size={12} className="text-slate-700 absolute inset-0" />
                        <span className="absolute inset-0 overflow-hidden" style={{ width: `${fill * 100}%` }}>
                          <Star size={12} className="text-amber-500" />
                        </span>
                      </span>
                    );
                  })}
                  <span className="ml-1">{mod.voteScore.toFixed(1)}</span>
                </span>
              )}
            </div>
          )}

          {/* 完整介绍（BBCode 已 strip） */}
          <div className="mb-5">
            <div className="text-xs font-medium text-slate-300 mb-1.5">介绍</div>
            <p className="text-xs text-slate-400 leading-relaxed whitespace-pre-wrap max-h-60 overflow-y-auto">
              {stripBbcode(mod.description) || '暂无描述'}
            </p>
          </div>

          {/* 操作区 */}
          <Dialog.Footer>
            <Button size="sm" variant="ghost" onClick={() => {
              window.open(`https://steamcommunity.com/sharedfiles/filedetails/?id=${mod.fileId}`, '_blank');
            }} className="text-xs">
              <ExternalLink size={14} /> 在 Steam 中打开
            </Button>
            <Button size="sm" variant="default" onClick={() => onDownload?.(mod.fileId)} className="text-xs">
              <Download size={14} /> 下载
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

/** 元数据单项 */
function MetaItem({ icon: Icon, label, value, mono }: {
  icon: typeof Calendar;
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-center gap-1.5 text-slate-400">
      <Icon size={13} className="shrink-0 text-slate-500" />
      <span className="shrink-0">{label}</span>
      <span className={mono ? 'font-mono text-slate-300 truncate' : 'text-slate-300 truncate'}>{value}</span>
    </div>
  );
}
