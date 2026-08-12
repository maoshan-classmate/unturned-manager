import { NavLink, useParams } from "react-router-dom";
import {
  LayoutDashboard,
  Terminal,
  Settings,
  Package,
  FolderOpen,
  Key,
  Rocket,
  Zap,
  ChevronDown,
  User,
  Puzzle,
} from "lucide-react";

/**
 * Figma 5:29 Sidebar — 1:1 复刻
 *
 * Layout (260×900, bg #020617):
 *   [24,20]  UNTURNED MANAGER          12px Regular emerald-500 UPPERCASE
 *   [24,48]  ▽ MyServer  ● 在线        12px Regular text-secondary
 *   [0,80]   ┃ [24,80] 田 仪表盘       active: 3px emerald-500 left bar
 *   [24,120] >_ 控制台                   inactive: #94A3B8
 *   ...40px vertical rhythm...
 *   [24,460] ─── divider 212×1 #1E293B ───
 *   [24,480] 👤 管理员                  13px Regular text-secondary
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
  const { serverId } = useParams();
  const prefix = serverId ? `/${serverId}` : "/_default";

  return (
    <aside
      className="flex h-screen w-[260px] shrink-0 flex-col select-none"
      style={{ backgroundColor: "#020617" }}
    >
      {/* ── Logo (Figma: x=24, y=20, 12px Inter Regular emerald-500 UPPERCASE) ── */}
      <div className="px-6 pt-5">
        <span
          className="text-xs font-normal tracking-normal"
          style={{ color: "#22C55E" }}
        >
          UNTURNED MANAGER
        </span>
      </div>

      {/* ── Server Selector (Figma: chevron-down 16px + "MyServer ● 在线" 12px, y=48) ── */}
      <button
        type="button"
        className="flex items-center gap-2 px-6 mt-3 text-xs font-normal hover:opacity-80 transition-opacity"
        style={{ color: "#94A3B8" }}
        aria-label="切换服务器"
      >
        <ChevronDown size={16} />
        <span className="flex items-center gap-1.5">
          MyServer
          <span
            className="inline-block h-2 w-2 rounded-full shrink-0"
            style={{ backgroundColor: "#22C55E" }}
            aria-hidden="true"
          />
          <span>在线</span>
        </span>
      </button>

      {/* ── Navigation (Figma: 9 items, y=80→420, 40px rhythm, 14px Regular) ── */}
      <nav className="mt-2">
        {NAV_ITEMS.map(({ to, icon: Icon, label }) => {
          // Dashboard 始终指向根路由
          const fullTo = to === "/" ? "/" : `${prefix}${to}`;
          return (
            <NavLink
              key={to}
              to={fullTo}
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
                  {/* Active indicator: 3×22px left bar emerald-500 (Figma 5:25) */}
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
          );
        })}
      </nav>

      {/* ── Divider (Figma: x=24, y=460, 212×1, #1E293B) ── */}
      <div
        className="mx-6 h-px shrink-0 mt-[20px] mb-[19px]"
        style={{ backgroundColor: "#1E293B" }}
      />

      {/* ── User (Figma: icon/user 16px + "管理员" 13px Regular, y=480) ── */}
      <div
        className="flex items-center gap-2 px-6 h-[40px] shrink-0 text-[13px] font-normal"
        style={{ color: "#94A3B8" }}
      >
        <User size={16} className="shrink-0" />
        <span>管理员</span>
      </div>

      {/* Spacer: pushes nav+divider+user to top, empty space below (Figma: y≈500–900空白) */}
      <div className="flex-1" />
    </aside>
  );
}
