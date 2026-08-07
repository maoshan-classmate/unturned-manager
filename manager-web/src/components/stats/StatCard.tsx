import type { ReactNode } from 'react';
import { type LucideIcon } from 'lucide-react';

interface StatCardProps {
  icon: LucideIcon;
  label: string;
  value: string | number;
  subtext?: string;
  /** Status color for the icon/indicator */
  status?: 'online' | 'warning' | 'danger' | 'neutral';
}

const statusColor: Record<string, string> = {
  online: '#22C55E',
  warning: '#F59E0B',
  danger: '#EF4444',
  neutral: '#94A3B8',
};

/**
 * Figma 5:34 StatCard — 271×112px 统计卡片。
 *
 * 四卡片布局：服务器状态 / 在线玩家 / CPU / Mod 数
 */
export function StatCard({ icon: Icon, label, value, subtext, status = 'neutral' }: StatCardProps) {
  return (
    <div
      className="flex flex-col gap-2 rounded-lg p-5"
      style={{ backgroundColor: '#1E293B', border: '1px solid #334155' }}
    >
      <div className="flex items-center gap-2">
        <Icon size={16} style={{ color: statusColor[status] }} />
        <span className="text-sm font-normal" style={{ color: '#94A3B8' }}>
          {label}
        </span>
      </div>
      <div className="flex items-baseline gap-1.5">
        <span className="text-2xl font-semibold" style={{ color: '#F1F5FB' }}>
          {value}
        </span>
        {subtext && (
          <span className="text-xs" style={{ color: '#64748B' }}>
            {subtext}
          </span>
        )}
      </div>
    </div>
  );
}
