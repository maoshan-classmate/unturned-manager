import { NavLink, useParams } from "react-router-dom";
import {
  LayoutDashboard,
  Terminal,
  Settings,
  Package,
  FolderOpen,
  Zap,
  Puzzle,
  Rocket,
  ChevronDown,
  User,
  Plus,
} from "lucide-react";
import { useServer } from "../../hooks/useServer.js";

/**
 * Figma 5:29 Sidebar — 1:1 复刻
 *
 * 三态渲染（commit 56a0d27 修复，sc:troubleshoot）：
 *   - Loading：GET /servers 未完成（loading=true && servers 空）→ 8 个骨架占位，不渲染菜单
 *   - Empty：servers 加载完毕仍为空 → 空态卡 + 「去新建」CTA，不渲染菜单
 *   - Ready：servers 非空 → 完整菜单，每个 fullTo 是合法路由
 *
 * 关键设计原则：
 *   1. 永远不存在 "prefix 未知" 状态——三态之一，所有 NavLink 的 fullTo 必是 `/` 或 `${prefix}${to}`
 *   2. 永远不写 disabled + "#" 假死态——loading/empty 时不渲染菜单 DOM，无 pointer-events-none
 *   3. 永远不复活 `_default` 占位——side-server-setup CTA 是独立引导元素，不是菜单项
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
  const { servers, loading } = useServer();

  // ── State 1: Loading —— 后端 GET /servers 还没回来，骨架占位代替菜单
  if (loading && servers.length === 0) {
    return <SidebarSkeleton />;
  }

  // ── State 2: Empty —— 后端返空，给明确引导卡；不渲染菜单，菜单项根本不存在
  //    ↑ 此处之后 TS 已 narrow：servers.length > 0
  if (servers.length === 0) {
    return <SidebarEmptyState />;
  }

  // ── State 3: Ready —— servers 必非空，下面这一段是真实菜单渲染
  //   URL 上的 serverId 在列表里 → 用它，否则回退到列表第一个
  const validIds = new Set(servers.map((s) => s.id));
  // 提取首个元素并 narrow——TS 对数组索引 `servers[0]` 不主动 narrow
  const firstServer = servers[0];
  if (!firstServer) return null;
  const activeId =
    serverId && validIds.has(serverId) ? serverId : firstServer.id;
  const prefix = `/${activeId}`;

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

      {/* ── Server Selector ── */}
      <div
        className="flex items-center gap-2 px-6 mt-3 text-xs font-normal"
        style={{ color: "#94A3B8" }}
      >
        <ChevronDown size={16} aria-hidden="true" />
        <span>{activeId}</span>
        <span
          className="inline-block h-2 w-2 rounded-full shrink-0"
          style={{ backgroundColor: "#22C55E" }}
          aria-hidden="true"
        />
      </div>

      {/* ── Navigation ── */}
      <nav className="mt-2">
        {NAV_ITEMS.map(({ to, icon: Icon, label }) => {
          // fullTo 永远要么是 "/" 要么是 `${prefix}${to}` 两种合法路由
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

/** Loading 态：8 个骨架占位代替菜单。User 看到 "正在准备" 的明确状态。 */
function SidebarSkeleton() {
  return (
    <aside
      className="flex h-screen w-[260px] shrink-0 flex-col select-none"
      style={{ backgroundColor: "#020617" }}
      aria-label="侧边栏加载中"
      aria-busy="true"
    >
      <div className="px-6 pt-5">
        <span
          className="text-xs font-normal tracking-normal animate-pulse"
          style={{ color: "#334059" }}
        >
          UNTURNED MANAGER
        </span>
      </div>
      <nav
        className="mt-6 px-6 space-y-3"
        aria-hidden="true"
        data-testid="sidebar-skeleton"
      >
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={i}
            className="h-[16px] w-full rounded animate-pulse"
            style={{ backgroundColor: "#1E293B" }}
          />
        ))}
      </nav>
      <div className="flex-1" />
    </aside>
  );
}

/** Empty 态：明确告诉用户 "没有实例，去创建一个"，独立 CTA 元素，不是菜单项。 */
function SidebarEmptyState() {
  return (
    <aside
      className="flex h-screen w-[260px] shrink-0 flex-col select-none"
      style={{ backgroundColor: "#020617" }}
      data-testid="sidebar-empty"
    >
      <div className="px-6 pt-5">
        <span
          className="text-xs font-normal tracking-normal"
          style={{ color: "#22C55E" }}
        >
          UNTURNED MANAGER
        </span>
      </div>

      <div className="mx-4 mt-12 rounded-md px-4 py-5 text-center" style={{ backgroundColor: "#1E293B" }}>
        <div className="text-sm font-medium" style={{ color: "#F1F5FB" }}>
          还没有服务器实例
        </div>
        <p className="mt-2 text-xs leading-5" style={{ color: "#94A3B8" }}>
          创建一个实例后才能管理控制台、模组、文件等
        </p>
        <a
          href="/server-setup"
          className="mt-4 inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-2 text-xs font-medium transition-colors hover:opacity-90"
          style={{ backgroundColor: "#22C55E", color: "#0F172A" }}
        >
          <Plus size={14} aria-hidden="true" />
          去新建实例
        </a>
      </div>

      <div className="flex-1" />
    </aside>
  );
}
