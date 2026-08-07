interface DialogProps {
  open: boolean;
  onClose: () => void;
  width?: number;
  children: React.ReactNode;
}

/**
 * 通用对话框——统一的暗色 overlay + 卡片容器。
 * 替代各页面内联的 fixed inset-0 bg-black/50 弹窗。
 */
export function Dialog({ open, onClose, width, children }: DialogProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="rounded-lg" style={{ width, backgroundColor: '#1E293B', border: '1px solid #334059' }}
        onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

function DialogTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="text-sm font-medium text-slate-100 mb-4">{children}</h3>;
}

function DialogFooter({ children }: { children: React.ReactNode }) {
  return <div className="flex items-center gap-2 justify-end">{children}</div>;
}

Dialog.Title = DialogTitle;
Dialog.Footer = DialogFooter;
