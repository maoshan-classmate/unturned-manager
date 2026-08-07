import * as React from 'react';
import { Input as InputPrimitive } from '@base-ui/react/input';

import { cn } from '@/lib/utils';

/**
 * 暗色主题适配版 Input——保留 @base-ui/react 的可访问性/语义原语，
 * 仅修改 Tailwind class 适配 slate 暗色主题。
 *
 * 原 shadcn 用 CSS 变量（bg-input/text-foreground 等），
 * 在纯暗色场景下变量默认值偏亮（白框）。此处改用显式 slate 色值。
 */
const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<'input'>>(
  ({ className, type, ...props }, ref) => {
    return (
      <InputPrimitive
        ref={ref}
        type={type}
        data-slot="input"
        className={cn(
          // 用显式 slate 色值替代 CSS 变量，适配暗色主题
          'h-8 w-full min-w-0 rounded-lg border px-2.5 py-1 text-sm',
          'bg-slate-800 text-slate-100',
          'border-slate-600',
          'placeholder:text-slate-500',
          'outline-none transition-all duration-200',
          'focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/30',
          'disabled:cursor-not-allowed disabled:opacity-50',
          className,
        )}
        {...props}
      />
    );
  },
);
Input.displayName = 'Input';

export { Input };
