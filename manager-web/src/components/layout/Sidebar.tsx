import { NavLink } from "react-router-dom";
import { motion } from "motion/react";
import {
  LayoutDashboard,
  Terminal,
  Settings,
  Package,
  FolderOpen,
  Rocket,
  Zap,
  Puzzle,
  User,
} from "lucide-react";
import { ServerSelector } from "./ServerSelector.js";

interface NavItem {
  to: string;
  icon: typeof LayoutDashboard;
  label: string;
}

const NAV_ITEMS: NavItem[] = [
  { to: "/", icon: LayoutDashboard, label: "仪表盘" },
  { to: "/console", icon: Terminal, label: "控制台" },
  { to: "/config/commands", icon: Settings, label: "配置" },
  { to: "/mods", icon: Package, label: "模组" },
  { to: "/ldm", icon: Puzzle, label: "Mod 框架" },
  { to: "/files", icon: FolderOpen, label: "文件" },
  { to: "/server-setup", icon: Rocket, label: "服务器设置" },
  { to: "/settings", icon: Zap, label: "系统设置" },
] as const;

interface SidebarProps {
  /** active 项指示器样式—— left-bar 左侧 3px 竖条（默认）/ background 背景色块 / pill 圆角胶囊 */
  indicatorStyle?: "left-bar" | "background" | "pill";
}

/**
 * Figma 5:29 Sidebar — 1:1 复刻。
 *
 * 动效：active 项指示器用 motion 共享布局动画在两项之间滑动（layoutId = sidebar-active-bar）。
 * 选中切换时 motion 在新旧位置之间插值；全局已包 MotionConfig reducedMotion="user"，系统减弱动效偏好开启时退化为无动画。
 */
export function Sidebar({ indicatorStyle = "left-bar" }: SidebarProps = {}) {
  return (
    <aside
      data-testid="sidebar"
      data-indicator-style={indicatorStyle}
      className="flex h-screen w-[260px] shrink-0 flex-col select-none"
      style={{ backgroundColor: "#020617" }}
    >
      {/* ── Logo ── */}
      <div className="px-6 pt-5">
        <span className="text-xs font-normal tracking-normal text-emerald-500">
          UNTURNED MANAGER
        </span>
      </div>

      {/* ── 服务器选择器 ── */}
      <ServerSelector />

      {/* ── 导航 ── */}
      <nav className="mt-2">
        {NAV_ITEMS.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            end={to === "/"}
            className={({ isActive }) =>
              `relative flex items-center h-[40px] px-6 text-sm font-normal transition-colors ${
                isActive ? "" : "hover:text-slate-200"
              }`
            }
            style={({ isActive }) => ({
              color: isActive ? "#22C55E" : "#94A3B8",
              backgroundColor:
                isActive && indicatorStyle === "background"
                  ? "rgba(34,197,94,0.12)"
                  : isActive && indicatorStyle === "pill"
                    ? "rgba(34,197,94,0.18)"
                    : "transparent",
              borderRadius:
                isActive && indicatorStyle === "pill" ? "9999px" : undefined,
              margin:
                isActive && indicatorStyle === "pill" ? "0 12px" : undefined,
            })}
          >
            {({ isActive }) => (
              <>
                {isActive && indicatorStyle === "left-bar" && (
                  <motion.span
                    layoutId="sidebar-active-bar"
                    data-testid="sidebar-active-bar"
                    className="absolute left-0 top-1/2 -translate-y-1/2 h-[22px] w-[3px] bg-emerald-500"
                    transition={{ type: "spring", stiffness: 400, damping: 35 }}
                    aria-hidden="true"
                  />
                )}
                {isActive && indicatorStyle === "pill" && (
                  <motion.span
                    layoutId="sidebar-active-pill"
                    data-testid="sidebar-active-pill"
                    className="absolute inset-0 rounded-full"
                    style={{ backgroundColor: "rgba(34,197,94,0.18)" }}
                    transition={{ type: "spring", stiffness: 400, damping: 35 }}
                    aria-hidden="true"
                  />
                )}
                <Icon size={16} className="shrink-0" />
                <span className="ml-2">{label}</span>
              </>
            )}
          </NavLink>
        ))}
      </nav>

      {/* ── Divider ── */}
      <div
        className="mx-6 h-px shrink-0 mt-[20px] mb-[19px]"
        style={{ backgroundColor: "#1E293B" }}
      />

      {/* ── User ── */}
      <div className="flex items-center gap-2 px-6 h-[40px] shrink-0 text-sm font-normal text-slate-400">
        <User size={16} className="shrink-0" />
        <span>管理员</span>
      </div>

      <div className="flex-1" />
    </aside>
  );
}
