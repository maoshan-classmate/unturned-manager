import { useState, useRef, useEffect } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Dropdown 选项 */
export interface DropdownOption<T extends string | number = string> {
  /** 选项唯一标识 */
  value: T;
  /** 显示文本 */
  label: string;
}

/** Dropdown Props */
interface DropdownProps<T extends string | number> {
  /** 当前选中值 */
  value: T;
  /** 选项列表 */
  options: ReadonlyArray<DropdownOption<T>>;
  /** 选中回调 */
  onChange: (value: T) => void;
  /** 容器宽度（px） */
  width?: number;
  /** 占位符 */
  placeholder?: string;
  /** 禁用 */
  disabled?: boolean;
  /** 自定义 className */
  className?: string;
  /** ARIA label */
  ariaLabel?: string;
}

/**
 * 通用下拉选择组件——对齐 Figma 暗色主题。
 * 显式渲染 option list（shadcn Select 复杂度高，此处走轻量自研路线）。
 *
 * @param props - 组件属性
 * @returns Dropdown React 元素
 *
 * @example
 * ```tsx
 * <Dropdown<Sort>
 *   value={sort}
 *   options={[
 *     { value: 'playtime', label: '使用量' },
 *     { value: 'votes', label: '评分' },
 *   ]}
 *   onChange={setSort}
 *   width={120}
 * />
 * ```
 */
export function Dropdown<T extends string | number>({
  value, options, onChange, width, placeholder, disabled, className, ariaLabel,
}: DropdownProps<T>) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // 点外部关闭
  useEffect(() => {
    if (!open) return;
    const onClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [open]);

  const current = options.find((o) => o.value === value);
  const display = current?.label ?? placeholder ?? '请选择';

  return (
    <div ref={ref} className={cn('relative', className)} style={width ? { width } : undefined}>
      <button
        type="button"
        onClick={() => !disabled && setOpen(!open)}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={cn(
          'h-9 px-3 rounded-md text-sm flex items-center justify-between gap-2',
          'border border-slate-700 bg-slate-950 text-slate-400',
          'hover:border-slate-600 transition-colors',
          'disabled:opacity-50 disabled:cursor-not-allowed',
        )}
        style={width ? { width } : undefined}
      >
        <span className="truncate">{display}</span>
        <ChevronDown size={14} className={cn('transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <ul
          role="listbox"
          className="absolute top-full left-0 mt-1 z-50 rounded-md border border-slate-700 bg-slate-950 shadow-lg overflow-hidden"
          style={{ width: width ?? '100%', minWidth: 120 }}
        >
          {options.map((opt) => {
            const active = opt.value === value;
            return (
              <li
                key={opt.value}
                role="option"
                aria-selected={active}
                onClick={() => { onChange(opt.value); setOpen(false); }}
                className={cn(
                  'px-3 py-2 text-sm cursor-pointer transition-colors',
                  active ? 'text-slate-100 bg-slate-800' : 'text-slate-400 hover:bg-slate-800/50 hover:text-slate-200',
                )}
              >
                {opt.label}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
