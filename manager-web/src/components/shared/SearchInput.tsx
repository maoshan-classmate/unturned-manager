import { Search } from 'lucide-react';

interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  width?: number;
  className?: string;
}

export function SearchInput({
  value, onChange, placeholder = '搜索...', width = 200, className = '',
}: SearchInputProps) {
  return (
    <div className={`relative ${className}`}>
      <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: '#64748B' }} />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="pl-8 pr-3 h-8 text-xs rounded outline-none"
        style={{ width, backgroundColor: '#0F172A', border: '1px solid #334059', color: '#F1F5FB' }}
      />
    </div>
  );
}
