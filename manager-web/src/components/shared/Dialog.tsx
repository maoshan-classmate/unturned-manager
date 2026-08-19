import { DialogShell } from "./DialogShell.js";

interface DialogProps {
  open: boolean;
  onClose: () => void;
  width?: number;
  /** 出入场动画—— fade-scale 淡入+缩放（默认）/ fade-only 仅淡入 / slide-up 底部滑入 */
  animation?: "fade-scale" | "fade-only" | "slide-up";
  children: React.ReactNode;
}

/**
 * 通用对话框——统一的暗色 overlay + 卡片容器。
 * 出入场动画由 DialogShell 处理；本组件只管面板自身样式与宽度。
 */
export function Dialog({ open, onClose, width = 480, animation = "fade-scale", children }: DialogProps) {
  return (
    <DialogShell open={open} onClose={onClose} animation={animation}>
      <div
        data-testid="dialog-content"
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
