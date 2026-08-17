import type { ReactNode } from "react";
import { motion, type Variants } from "motion/react";

interface StaggerContainerProps {
  children: ReactNode[];
  /** 子元素 stagger 间隔（ms），默认 80 */
  staggerMs?: number;
  /** 入场动画时长（ms），默认 300 */
  durationMs?: number;
  /** stagger 入场 Y 轴位移（px），默认 8 */
  yOffset?: number;
  /** 超过此数量的子元素不 stagger（整体 fade），避免超长列表入场过慢；默认 12 */
  maxStaggeredItems?: number;
}

/**
 * 卡片网格 stagger 入场——挂载时子元素依次淡入上浮。
 * 父组件重渲染时不重播（motion 的 variants 状态保留在 animate="visible"）。
 * 全局已包 MotionConfig reducedMotion="user"，系统减弱动效偏好开启时退化为无动画。
 */
export function StaggerContainer({
  children,
  staggerMs = 80,
  durationMs = 300,
  yOffset = 8,
  maxStaggeredItems = 12,
}: StaggerContainerProps) {
  const items = Array.isArray(children) ? children : [children];
  const staggered = items.length <= maxStaggeredItems;

  if (!staggered) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: durationMs / 1000, ease: "easeOut" }}
      >
        {items.map((child, i) => (
          <div key={i}>{child}</div>
        ))}
      </motion.div>
    );
  }

  const container: Variants = {
    hidden: {},
    visible: { transition: { staggerChildren: staggerMs / 1000 } },
  };
  const item: Variants = {
    hidden: { opacity: 0, y: yOffset },
    visible: {
      opacity: 1,
      y: 0,
      transition: { duration: durationMs / 1000, ease: "easeOut" },
    },
  };

  return (
    <motion.div variants={container} initial="hidden" animate="visible">
      {items.map((child, i) => (
        <motion.div key={i} variants={item}>
          {child}
        </motion.div>
      ))}
    </motion.div>
  );
}