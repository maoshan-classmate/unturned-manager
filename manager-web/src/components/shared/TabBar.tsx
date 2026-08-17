import type { LucideIcon } from "lucide-react";
import { motion } from "motion/react";

interface TabItem {
  key: string;
  label: string;
  icon: LucideIcon;
}

interface TabBarProps {
  tabs: TabItem[];
  active: string;
  onChange: (key: string) => void;
  /** 指示器样式：填充块（默认，保持现有观感）| 下划线 */
  indicatorStyle?: "background" | "underline";
}

/**
 * 分页签——背景容器深色，按钮透明背景，共享布局动画的指示块在标签间滑动。
 * 全局已包 MotionConfig reducedMotion="user"，系统减弱动效偏好开启时退化为无动画。
 */
export function TabBar({ tabs, active, onChange, indicatorStyle = "background" }: TabBarProps) {
  return (
    <div
      className="relative flex items-center gap-1 p-1 rounded-lg bg-slate-900"
    >
      {tabs.map(({ key, label, icon: Icon }) => (
        <button
          key={key}
          onClick={() => onChange(key)}
          className="relative flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-colors"
          style={{ color: active === key ? "#F1F5FB" : "#64748B" }}
        >
          {active === key && (
            <motion.span
              layoutId="tab-active-indicator"
              data-indicator-style={indicatorStyle}
              className="absolute inset-0 rounded"
              style={{
                backgroundColor: indicatorStyle === "background" ? "#1E293B" : "transparent",
                borderBottom: indicatorStyle === "underline" ? "2px solid #22C55E" : undefined,
              }}
              transition={{ type: "spring", stiffness: 400, damping: 35 }}
              aria-hidden="true"
            />
          )}
          <Icon size={14} className="relative z-10" />
          <span className="relative z-10">{label}</span>
        </button>
      ))}
    </div>
  );
}