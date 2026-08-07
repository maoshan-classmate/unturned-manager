import { Button as ButtonPrimitive } from '@base-ui/react/button';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';

/**
 * 暗色主题适配版 Button——保留 @base-ui/react 的原语能力和 a11y，
 * 仅将 variant 中的 CSS 变量替换为显式 slate/emerald 色值。
 */
const buttonVariants = cva(
  'group/button inline-flex shrink-0 items-center justify-center rounded-lg text-sm font-medium whitespace-nowrap transition-all outline-none select-none focus-visible:ring-2 focus-visible:ring-emerald-500/50 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*=\'size-\'])]:size-4',
  {
    variants: {
      variant: {
        default:
          'bg-emerald-500 text-white hover:bg-emerald-600',
        outline:
          'border border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700',
        secondary:
          'bg-slate-800 text-slate-200 hover:bg-slate-700 border border-slate-700',
        ghost:
          'bg-transparent text-slate-400 hover:bg-slate-800 hover:text-slate-200',
        destructive:
          'bg-red-500/20 text-red-400 hover:bg-red-500/30',
        link: 'text-emerald-500 underline-offset-4 hover:underline',
      },
      size: {
        default:
          'h-8 gap-1.5 px-3',
        xs: 'h-6 gap-1 px-2 text-xs rounded-md',
        sm: 'h-7 gap-1 px-2.5 text-xs',
        lg: 'h-9 gap-1.5 px-4',
        icon: 'size-8',
        'icon-xs': 'size-6 rounded-md',
        'icon-sm': 'size-7 rounded-md',
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
