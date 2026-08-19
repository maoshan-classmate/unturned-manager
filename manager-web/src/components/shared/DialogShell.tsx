import type { ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";

interface DialogShellProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  /** 入场动画—— fade-scale(默认), fade-only, slide-up */
  animation?: "fade-scale" | "fade-only" | "slide-up";
}

/**
 * 弹窗公共遮罩层——Dialog 与 ConfirmDialog 共用,消掉重复的 fixed inset-0 + bg-black/50 标记。
 *
 * 出入场动画由 animation prop 驱动:
 * - fade-scale: opacity + scale 0.95→1(默认)
 * - fade-only:  仅 opacity
 * - slide-up:  opacity + y 20px→0
 */
export function DialogShell({ open, onClose, children, animation = "fade-scale" }: DialogShellProps) {
  const initial =
    animation === "fade-only"
      ? { opacity: 0 }
      : animation === "slide-up"
        ? { opacity: 0, y: 20 }
        : { opacity: 0, scale: 0.95 };
  const animate =
    animation === "fade-only"
      ? { opacity: 1 }
      : animation === "slide-up"
        ? { opacity: 1, y: 0 }
        : { opacity: 1, scale: 1 };
  const exit =
    animation === "fade-only"
      ? { opacity: 0 }
      : animation === "slide-up"
        ? { opacity: 0, y: 20 }
        : { opacity: 0, scale: 0.95 };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="dialog-overlay"
          data-testid="dialog-overlay"
          data-animation={animation}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2, ease: "easeOut" }}
          onClick={onClose}
        >
          <motion.div
            data-testid="dialog-panel"
            initial={initial}
            animate={animate}
            exit={exit}
            transition={{ duration: 0.2, ease: "easeOut" }}
            onClick={(e) => e.stopPropagation()}
          >
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
