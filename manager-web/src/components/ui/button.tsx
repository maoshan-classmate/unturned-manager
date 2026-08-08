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
 * - 动画：active 按压微缩 + transition-colors 过渡 + focus-visible ring
 */
const buttonVariants = cva(
  'group/button inline-flex shrink-0 items-center justify-center rounded-md text-sm font-medium whitespace-nowrap transition-colors duration-150 outline-none select-none active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-emerald-500/50 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*=\'size-\'])]:size-4',
  {
    variants: {
      variant: {
        default:
          'bg-emerald-500 text-white hover:bg-emerald-600',
        secondary:
          'bg-slate-800 text-slate-200 border border-slate-700 hover:bg-slate-700',
        outline:
          'bg-transparent text-slate-400 border border-slate-700 hover:bg-slate-800 hover:text-slate-200',
        ghost:
          'bg-transparent text-slate-400 hover:bg-slate-800 hover:text-slate-200',
        destructive:
          'bg-red-500 text-white hover:bg-red-600',
        link: 'text-emerald-500 underline-offset-4 hover:underline',
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
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

function Button({
  className,
  variant = 'default',
  size = 'default',
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
