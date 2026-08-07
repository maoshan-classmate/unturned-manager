import type { LucideIcon } from 'lucide-react';
import { Button } from '../ui/button.js';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'default';
  icon?: LucideIcon;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open, title, message,
  confirmLabel = '确认', cancelLabel = '取消',
  variant = 'default', icon: Icon,
  loading, onConfirm, onCancel,
}: ConfirmDialogProps) {
  if (!open) return null;

  const confirmColor = variant === 'danger' ? '#EF4444' : '#22C55E';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onCancel}>
      <div className="rounded-lg p-6 text-center" style={{ width: 340, backgroundColor: '#1E293B', border: '1px solid #334059' }}
        onClick={(e) => e.stopPropagation()}>
        {Icon && <Icon size={28} style={{ color: confirmColor, margin: '0 auto 12px' }} />}
        <h3 className="text-sm font-medium text-slate-100 mb-1">{title}</h3>
        <p className="text-xs text-slate-400 mb-4">{message}</p>
        <div className="flex items-center gap-2 justify-center">
          <button onClick={onCancel} disabled={loading}
            className="rounded text-slate-400 hover:text-slate-200 h-7 px-4 text-xs"
            style={{ border: '1px solid #334059' }}>{cancelLabel}</button>
          <button onClick={onConfirm} disabled={loading}
            className="rounded text-white h-7 px-4 text-xs disabled:opacity-50"
            style={{ backgroundColor: confirmColor }}>{loading ? '执行中...' : confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}
