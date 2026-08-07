import { forwardRef, useState, useCallback } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { Input } from '@/components/ui/input.js';
import { cn } from '@/lib/utils';

interface PasswordInputProps extends Omit<React.ComponentProps<'input'>, 'type'> {
  /** Optional className for the wrapper */
  wrapperClassName?: string;
}

/**
 * Password input with visibility toggle.
 * Built on top of shadcn/ui Input component.
 */
export const PasswordInput = forwardRef<HTMLInputElement, PasswordInputProps>(function PasswordInput(
  { className, wrapperClassName, disabled, ...props },
  ref,
) {
  const [showPassword, setShowPassword] = useState(false);

  const toggle = useCallback(() => {
    setShowPassword((prev) => !prev);
  }, []);

  return (
    <div className={cn('relative', wrapperClassName)}>
      <Input
        ref={ref}
        type={showPassword ? 'text' : 'password'}
        className={cn('pr-9', className)}
        disabled={disabled}
        autoComplete="current-password"
        {...props}
      />
      <button
        type="button"
        onClick={toggle}
        disabled={disabled}
        className={cn(
          'absolute right-2 top-1/2 -translate-y-1/2',
          'inline-flex items-center justify-center',
          'h-5 w-5 rounded-sm',
          'text-muted-foreground hover:text-foreground',
          'transition-colors',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          'disabled:pointer-events-none disabled:opacity-50',
        )}
        aria-label={showPassword ? '隐藏密码' : '显示密码'}
        aria-pressed={showPassword}
      >
        {showPassword ? (
          <EyeOff className="h-4 w-4" />
        ) : (
          <Eye className="h-4 w-4" />
        )}
      </button>
    </div>
  );
});
PasswordInput.displayName = 'PasswordInput';
