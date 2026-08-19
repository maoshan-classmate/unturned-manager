import type { LucideIcon } from 'lucide-react';
import { cn } from '../../lib/utils.js';

interface CardProps {
  icon?: LucideIcon;
  title?: string;
  children: React.ReactNode;
  className?: string;
  /** hover 效果档—— none 不变, lift 抬升, glow 边框投影 */
  hover?: 'none' | 'lift' | 'glow';
  /** 入场动效—— none 不变, fade-in 淡入, stagger 委托父级 StaggerContainer */
  animation?: 'none' | 'fade-in' | 'stagger';
}

/**
 * 暗色主题卡片——统一的 #1E293B + #334059 容器。
 *
 * 动效档：
 * - hover: 'lift'  → hover 时 translateY(-2px) + 边框过渡
 * - hover: 'glow'  → hover 时 emerald 投影提升
 * - animation: 'fade-in' → 卡片 mount 时 opacity 0→1 200ms
 * - animation: 'stagger' → 父级 StaggerContainer 接管入场,本组件不渲染独立动效
 */
export function Card({
  icon: Icon,
  title,
  children,
  className = '',
  hover = 'none',
  animation = 'none',
}: CardProps) {
  const hoverClass =
    hover === 'lift'
      ? 'transition-transform duration-200 motion-safe:hover:-translate-y-0.5'
      : hover === 'glow'
        ? 'transition-shadow duration-200 motion-safe:hover:shadow-[0_0_12px_rgba(34,197,94,0.35)]'
        : '';
  const animationClass =
    animation === 'fade-in'
      ? 'animate-[card-fade-in_200ms_ease-out]'
      : animation === 'stagger'
        ? ''
        : '';

  return (
    <div
      data-testid="card"
      data-hover={hover}
      data-animation={animation}
      className={cn(
        'p-4 rounded-lg h-full',
        hoverClass,
        animationClass,
        className,
      )}
      style={{ backgroundColor: '#1E293B', border: '1px solid #334059' }}
    >
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
