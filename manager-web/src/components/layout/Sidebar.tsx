import { NavLink, useParams } from 'react-router-dom';
import {
  LayoutDashboard,
  Terminal,
  Package,
  Users,
  Settings,
  FolderOpen,
  Server,
  Sliders,
  LogOut,
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext.js';

const NAV_ITEMS = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/console', icon: Terminal, label: 'Console' },
  { to: '/mods', icon: Package, label: 'Mods' },
  { to: '/players', icon: Users, label: 'Players' },
  { to: '/config/commands', icon: Settings, label: 'Config' },
  { to: '/files', icon: FolderOpen, label: 'Files' },
  { to: '/server-setup', icon: Server, label: 'Server Setup' },
  { to: '/settings', icon: Sliders, label: 'Settings' },
] as const;

export function Sidebar() {
  const { serverId } = useParams();
  const { logout } = useAuth();

  // 如果当前有 serverId，所有导航链接前缀 serverId
  const prefix = serverId ? `/${serverId}` : '/_default';

  return (
    <aside className="w-[260px] bg-slate-950 flex flex-col shrink-0">
      {/* Logo */}
      <div className="h-16 flex items-center px-6 border-b border-slate-800">
        <h1 className="text-lg font-semibold text-emerald-500 tracking-tight">
          unturned-manager
        </h1>
      </div>

      {/* Navigation */}
      <nav className="flex-1 py-4 space-y-1 px-3">
        {NAV_ITEMS.map(({ to, icon: Icon, label }) => {
          const fullTo = to === '/' ? prefix : `${prefix}${to}`;
          return (
            <NavLink
              key={to}
              to={fullTo}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-emerald-500/10 text-emerald-500 border-l-[3px] border-emerald-500 pl-[9px]'
                    : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800/50 border-l-[3px] border-transparent pl-[9px]'
                }`
              }
            >
              <Icon size={18} />
              {label}
            </NavLink>
          );
        })}
      </nav>

      {/* Logout */}
      <div className="p-3 border-t border-slate-800">
        <button
          onClick={logout}
          className="flex items-center gap-3 px-3 py-2 w-full rounded-md text-sm font-medium text-slate-400 hover:text-red-400 hover:bg-slate-800/50 transition-colors"
        >
          <LogOut size={18} />
          登出
        </button>
      </div>
    </aside>
  );
}
