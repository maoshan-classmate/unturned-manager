import type { ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";

/**
 * 弹窗公共遮罩层——Dialog 与 ConfirmDialog 共用，消掉重复的 fixed inset-0 + bg-black/50 标记。
 *
 * 设计要点：
 *   - 外层 overlay 保持常驻（z-50 + 居中），由 open 控制点击关闭
 *   - children（弹窗面板）交给 AnimatePresence 处理出场动画——关闭后保留在 DOM 直到动画结束才卸载
 *   - 内层 motion.div 加 data-testid 便于测试定位；面板元素自身的样式由调用方（Dialog / ConfirmDialog）控制
 *
 * 全局已包 MotionConfig reducedMotion="user"，系统减弱动效偏好开启时退化为无动画。
 */
interface DialogShellProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}

export function DialogShell({ open, onClose, children }: DialogShellProps) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="dialog-overlay"
          data-testid="dialog-overlay"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2, ease: "easeOut" }}
          onClick={onClose}
        >
          <motion.div
            data-testid="dialog-panel"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
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