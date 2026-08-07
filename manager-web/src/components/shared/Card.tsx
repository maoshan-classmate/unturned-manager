import type { LucideIcon } from 'lucide-react';

interface CardProps {
  icon?: LucideIcon;
  title?: string;
  children: React.ReactNode;
  className?: string;
}

/**
 * 暗色主题卡片——统一的 #1E293B + #334059 容器。
 * 替代 30+ 处 inline style 的 "卡片"。
 */
export function Card({ icon: Icon, title, children, className = '' }: CardProps) {
  return (
    <div className={`p-4 rounded-lg ${className}`}
      style={{ backgroundColor: '#1E293B', border: '1px solid #334059' }}>
      {(Icon || title) && (
        <div className="flex items-center gap-2 mb-3">
          {Icon && <Icon size={16} style={{ color: '#22C55E' }} />}
          {title && <h3 className="text-sm font-medium text-slate-100">{title}</h3>}
        </div>
      )}
      {children}
    </div>
  );
}
