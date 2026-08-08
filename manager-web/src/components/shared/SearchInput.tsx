import { Search } from 'lucide-react';

interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
  /** 回车 KeyDown 触发（用于「边输入边搜索」或「回车才搜索」两种模式） */
  onEnter?: (value: string) => void;
  placeholder?: string;
  width?: number;
  className?: string;
}

/** 通用搜索输入框——暗色主题适配。
 * @param props.value - 当前值
 * @param props.onChange - 输入变化回调
 * @param props.onEnter - 回车键回调（可选）
 * @param props.placeholder - 占位符
 * @param props.width - 容器宽度（px）
 */
export function SearchInput({
  value, onChange, onEnter, placeholder = '搜索...', width = 200, className = '',
}: SearchInputProps) {
  return (
    <div className={`relative ${className}`}>
      <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: '#64748B' }} />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && onEnter?.(value)}
        placeholder={placeholder}
        className="pl-8 pr-3 h-8 text-xs rounded outline-none"
        style={{ width, backgroundColor: '#0F172A', border: '1px solid #334059', color: '#F1F5FB' }}
      />
    </div>
  );
}
