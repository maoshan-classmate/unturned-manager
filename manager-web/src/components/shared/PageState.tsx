import { Loader2, AlertCircle, type LucideIcon } from 'lucide-react';
import { Button } from '../ui/button.js';
import { cn } from '@/lib/utils';

/** 页面四态容器：loading / error / empty / data */
interface PageStateProps {
  loading: boolean;
  error: string | null;
  empty: boolean;
  loadingText?: string;
  errorText?: string;
  emptyText?: string;
  emptyIcon?: LucideIcon;
  emptyAction?: React.ReactNode;
  onRetry?: () => void;
  children: React.ReactNode;
}

export function PageState({
  loading, error, empty,
  loadingText = '加载中...',
  errorText = '无法加载数据',
  emptyText = '暂无数据',
  emptyIcon: EmptyIcon,
  emptyAction,
  onRetry,
  children,
}: PageStateProps) {
  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin" style={{ color: '#22C55E' }} />
          <span className="text-sm text-slate-400">{loadingText}</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="flex flex-col items-center gap-3 max-w-md text-center">
          <AlertCircle size={32} style={{ color: '#EF4444' }} />
          <span className="text-sm text-slate-100">{errorText}</span>
          <span className="text-xs text-slate-500">{error}</span>
          {onRetry && (
            <Button variant="ghost" onClick={onRetry}>重试</Button>
          )}
        </div>
      </div>
    );
  }

  if (empty) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="flex flex-col items-center gap-3">
          {EmptyIcon && <EmptyIcon size={32} style={{ color: '#64748B' }} />}
          <span className="text-sm text-slate-500">{emptyText}</span>
          {emptyAction}
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
