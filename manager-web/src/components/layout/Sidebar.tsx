import { NavLink } from "react-router-dom";
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

/**
 * Figma 5:29 Sidebar — 1:1 复刻。
 *
 * Layout (260×900, bg #020617):
 *   [24,20]  UNTURNED MANAGER          12px Regular emerald-500 UPPERCASE
 *   [24,48]  ▽ MyServer  ● 在线        12px Regular text-secondary
 *   [0,80]   ┃ [24,80] 田 仪表盘       active: 3px emerald-500 left bar
 *   [24,120] >_ 控制台                   inactive: #94A3B8
 *   ...40px vertical rhythm...
 *   [24,460] ─── divider 212×1 #1E293B ───
 *   [24,480] 👤 管理员                  13px Regular text-secondary
 *
 * 行为要点：
 *   - 八个菜单标签永远渲染、永远能点
 *   - 路由表已重排到纯路径，侧栏不再拼接前缀
 *   - 未选实例时不显示引导按钮——点击实例类菜单后由内容区占位卡引导（NoInstanceGuide）
 *   - 文件菜单归全局级（不依赖具体实例）
 */
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

export function Sidebar() {
  return (
    <aside
      className="flex h-screen w-[260px] shrink-0 flex-col select-none"
      style={{ backgroundColor: "#020617" }}
    >
      {/* ── Logo ── */}
      <div className="px-6 pt-5">
        <span
          className="text-xs font-normal tracking-normal"
          style={{ color: "#22C55E" }}
        >
          UNTURNED MANAGER
        </span>
      </div>

      {/* ── 服务器选择器（取代旧的假按钮）── */}
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
            })}
          >
            {({ isActive }) => (
              <>
                <span
                  className="absolute left-0 top-1/2 -translate-y-1/2 h-[22px] transition-colors"
                  style={{
                    width: 3,
                    backgroundColor: isActive ? "#22C55E" : "transparent",
                  }}
                  aria-hidden="true"
                />
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
      <div
        className="flex items-center gap-2 px-6 h-[40px] shrink-0 text-[13px] font-normal"
        style={{ color: "#94A3B8" }}
      >
        <User size={16} className="shrink-0" />
        <span>管理员</span>
      </div>

      <div className="flex-1" />
    </aside>
  );
}
