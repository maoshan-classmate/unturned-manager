import { Loader2, AlertCircle, type LucideIcon } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { Button } from "../ui/button.js";

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

/**
 * 页面三态切换——loading / error / empty 之间淡入淡出。
 *
 * 设计要点：
 *   - 三个占位态加 AnimatePresence 切换动画（mode="wait"，前一个完全淡出再淡入下一个）
 *   - **正常内容分支不加任何包裹层**：页面依赖 h-full 高度传递链，插层会破坏多页布局；
 *     且内容区每次数据刷新都重播动画会很糟
 *   - 从占位态切到内容态时，占位态的退场动画被跳过（用户等待结束时希望内容立刻出现）
 *   - 全局已包 MotionConfig reducedMotion="user"，系统减弱动效偏好开启时退化为无动画
 */
export function PageState({
  loading,
  error,
  empty,
  loadingText = "加载中...",
  errorText = "无法加载数据",
  emptyText = "暂无数据",
  emptyIcon: EmptyIcon,
  emptyAction,
  onRetry,
  children,
}: PageStateProps) {
  const phase = loading ? "loading" : error ? "error" : empty ? "empty" : "content";

  if (phase === "content") return <>{children}</>;

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={phase}
        data-testid={`page-state-${phase}`}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2, ease: "easeOut" }}
        className="flex items-center justify-center h-full"
      >
        {phase === "loading" && (
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="h-8 w-8 animate-spin" style={{ color: "#22C55E" }} />
            <span className="text-sm text-slate-400">{loadingText}</span>
          </div>
        )}
        {phase === "error" && (
          <div className="flex flex-col items-center gap-3 max-w-md text-center">
            <AlertCircle size={32} style={{ color: "#EF4444" }} />
            <span className="text-sm text-slate-100">{errorText}</span>
            <span className="text-xs text-slate-500">{error}</span>
            {onRetry && <Button variant="ghost" onClick={onRetry}>重试</Button>}
          </div>
        )}
        {phase === "empty" && (
          <div className="flex flex-col items-center gap-3">
            {EmptyIcon && <EmptyIcon size={32} style={{ color: "#64748B" }} />}
            <span className="text-sm text-slate-500">{emptyText}</span>
            {emptyAction}
          </div>
        )}
      </motion.div>
    </AnimatePresence>
  );
}