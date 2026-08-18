import { Button as ButtonPrimitive } from '@base-ui/react/button';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';

/**
 * 暗色主题适配版 Button——保留 @base-ui/react 的原语能力和 a11y。
 *
 * 对齐项目规范：
 * - 色值：component-abstraction.md（#22C55E 强调 / #EF4444 危险 / #1E293B 卡片 / #334059 边框 / #94A3B8 次级）
 * - 圆角：Figma radius 6px（rounded-md）
 * - 尺寸：Figma 按钮高 36px（主流程 lg）/ 32px（卡片内 default）/ 28px（紧凑 sm）
 * - 动画：active 按压微缩 + transition-colors 过渡 + focus-visible ring + hover brightness
 */
const buttonVariants = cva(
  'group/button inline-flex shrink-0 items-center justify-center rounded-md text-sm font-medium whitespace-nowrap transition-colors duration-150 outline-none select-none active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-emerald-500/50 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*=\'size-\'])]:size-4',
  {
    variants: {
      variant: {
        default:
          'bg-emerald-500 text-white hover:bg-emerald-600 hover:brightness-110',
        secondary:
          // slate-700 明显比 Card 背景 #1E293B(slate-800)亮一档,有视觉差
          'bg-slate-700 text-slate-100 border border-slate-600 hover:bg-slate-600 hover:brightness-110',
        outline:
          // outline 用 bg-slate-800(等于 Card 色) + 亮边框 + 高对比文字——透明 background 已被验证隐形,显式上色
          'bg-slate-800 text-slate-100 border border-slate-500 hover:bg-slate-700 hover:text-white hover:brightness-110',
        ghost:
          'bg-transparent text-slate-300 hover:bg-slate-800 hover:text-white',
        destructive:
          'bg-red-500 text-white hover:bg-red-600 hover:brightness-110',
        link: 'text-emerald-500 underline-offset-4 hover:underline',
        glow:
          // 启动/保存等关键 CTA 用：emerald 背景 + emerald 光晕，hover 时亮度+光晕双增
          'bg-emerald-500 text-white shadow-[0_0_24px_rgba(34,197,94,0.5)] hover:brightness-110 hover:shadow-[0_0_32px_rgba(34,197,94,0.7)]',
      },
      size: {
        default:
          'h-8 gap-1.5 px-3',
        xs: 'h-6 gap-1 px-2 text-xs',
        sm: 'h-7 gap-1 px-2.5 text-xs',
        lg: 'h-9 gap-1.5 px-4',
        icon: 'size-8',
        'icon-xs': 'size-6',
        'icon-sm': 'size-7',
        'icon-lg': 'size-9',
      },
      animation: {
        normal: '',
        'press-only': '[&:not(:hover)]:brightness-100 hover:!brightness-100',
        'glow-pulse': 'animate-[button-glow-pulse_1.5s_ease-in-out_infinite]',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
      animation: 'normal',
    },
  },
);

/** 动画档——normal 默认；press-only 仅 active scale 无 hover 亮度；glow-pulse 仅在 glow variant 生效（呼吸光晕） */
export type ButtonAnimation = 'normal' | 'press-only' | 'glow-pulse';

function Button({
  className,
  variant = 'default',
  size = 'default',
  animation = 'normal',
  ...props
}: ButtonPrimitive.Props &
  VariantProps<typeof buttonVariants> & { animation?: ButtonAnimation }) {
  // glow-pulse 仅在 variant="glow" 时生效；非 glow variant 降级为 normal（避免视觉混乱）
  const effectiveAnimation: ButtonAnimation =
    animation === 'glow-pulse' && variant !== 'glow' ? 'normal' : animation;

  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(
        buttonVariants({ variant, size, animation: effectiveAnimation, className }),
      )}
      {...props}
    />
  );
}

// glow-pulse keyframes（运行时注入一次，与 ProgressBar 同模式）
if (typeof document !== 'undefined') {
  const STYLE_ID = 'button-glow-pulse-keyframes';
  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      @keyframes button-glow-pulse {
        0%, 100% { box-shadow: 0 0 24px rgba(34, 197, 94, 0.5); }
        50% { box-shadow: 0 0 36px rgba(34, 197, 94, 0.8); }
      }
      @media (prefers-reduced-motion: reduce) {
        .animate-\\[button-glow-pulse_1\\.5s_ease-in-out_infinite\\] {
          animation: none;
        }
      }
    `;
    document.head.appendChild(style);
  }
}

export { Button, buttonVariants };