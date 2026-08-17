import { DialogShell } from "./DialogShell.js";

interface DialogProps {
  open: boolean;
  onClose: () => void;
  width?: number;
  /** 出入场动画：淡入加缩放（默认）| 仅淡入 */
  animation?: "fade-scale" | "fade-only";
  children: React.ReactNode;
}

/**
 * 通用对话框——统一的暗色 overlay + 卡片容器。
 * 替代各页面内联的 fixed inset-0 bg-black/50 弹窗。
 * 出入场动画由 DialogShell 处理；本组件只管面板自身样式与宽度。
 */
export function Dialog({ open, onClose, width = 480, animation: _animation = "fade-scale", children }: DialogProps) {
  return (
    <DialogShell open={open} onClose={onClose}>
      <div
        className="rounded-lg overflow-y-auto"
        style={{
          // 自适应：宽 = min(期望宽, 视口宽 - 2rem)，小屏自动缩窄；高 = 85vh 封顶，超高内部滚动
          width: `min(${width}px, calc(100vw - 2rem))`,
          maxHeight: "85vh",
          backgroundColor: "#1E293B",
          border: "1px solid #334059",
        }}
      >
        {children}
      </div>
    </DialogShell>
  );
}

function DialogTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="text-sm font-medium text-slate-100 mb-4">{children}</h3>;
}

function DialogFooter({ children }: { children: React.ReactNode }) {
  return <div className="flex items-center gap-2 justify-end mt-3">{children}</div>;
}

Dialog.Title = DialogTitle;
Dialog.Footer = DialogFooter;