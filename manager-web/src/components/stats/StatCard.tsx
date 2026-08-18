import { motion } from 'motion/react';
import NumberFlow from '@number-flow/react';
import { type LucideIcon } from 'lucide-react';

interface StatCardProps {
  icon: LucideIcon;
  label: string;
  value: string | number;
  subtext?: string;
  /** 状态色 + 状态动效载体；启用 enableStatusIndicator 时承载第三件套（动效） */
  status?: 'online' | 'warning' | 'danger' | 'neutral' | 'transitioning';
  /** 是否启用状态动效——左侧 8px 圆点按 status 动画（pulse / spin / 静默）；默认 false */
  enableStatusIndicator?: boolean;
  /** 是否启用数字滚动——需 value 为 number；启用后加 tabular-nums */
  enableNumberTicker?: boolean;
}

type StatusKind = NonNullable<StatCardProps['status']>;

const statusMeta: Record<StatusKind, { dot: string; icon: string }> = {
  online: { dot: 'bg-emerald-500', icon: '#22C55E' },
  warning: { dot: 'bg-amber-500', icon: '#F59E0B' },
  danger: { dot: 'bg-red-500', icon: '#EF4444' },
  neutral: { dot: 'bg-slate-400', icon: '#94A3B8' },
  transitioning: { dot: 'bg-amber-500', icon: '#F59E0B' },
};

/**
 * Figma 5:34 StatCard — 271×112px 统计卡片。
 *
 * 四卡片布局：服务器状态 / 在线玩家 / CPU / Mod 数。
 *
 * 状态动效（启用 enableStatusIndicator 时）：
 *   - online：色点 pulse（呼吸 1.5s easeInOut loop）
 *   - transitioning：色点 spin（线性旋转 1.5s loop）
 *   - danger / warning / neutral：色点静默
 *
 * 数字滚动（启用 enableNumberTicker 且 value 为 number 时）：用 @number-flow/react 插值。
 *
 * 全局已包 MotionConfig reducedMotion="user"，系统减弱动效偏好开启时退化为无动画。
 */
export function StatCard({
  icon: Icon,
  label,
  value,
  subtext,
  status = 'neutral',
  enableStatusIndicator = false,
  enableNumberTicker = false,
}: StatCardProps) {
  const meta = statusMeta[status ?? 'neutral'];

  return (
    <div
      data-testid={`stat-card-${status}`}
      className="flex flex-col gap-2 rounded-lg p-5 bg-slate-800 border border-slate-700"
    >
      <div className="flex items-center gap-2">
        {enableStatusIndicator && (
          <motion.span
            data-testid={`stat-indicator-${status}`}
            className={`h-2 w-2 rounded-full ${meta.dot}`}
            animate={
              status === 'online'
                ? { scale: [1, 1.3, 1], opacity: [1, 0.7, 1] }
                : status === 'transitioning'
                  ? { rotate: 360 }
                  : {}
            }
            transition={
              status === 'online'
                ? { duration: 1.5, repeat: Infinity, ease: 'easeInOut' }
                : status === 'transitioning'
                  ? { duration: 1.5, repeat: Infinity, ease: 'linear' }
                  : { duration: 0 }
            }
            aria-hidden="true"
          />
        )}
        <Icon size={16} style={{ color: meta.icon }} />
        <span className="text-sm font-normal text-slate-400">{label}</span>
      </div>
      <div className="flex items-baseline gap-1.5">
        {typeof value === 'number' && enableNumberTicker ? (
          <NumberFlow
            value={value}
            format={{ useGrouping: true }}
            className="text-2xl font-semibold tabular-nums text-slate-100"
          />
        ) : (
          <span className="text-2xl font-semibold text-slate-100">{value}</span>
        )}
        {subtext && <span className="text-xs text-slate-500">{subtext}</span>}
      </div>
    </div>
  );
}