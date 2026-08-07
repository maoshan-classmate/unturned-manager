import type { LucideIcon } from 'lucide-react';

interface TabItem {
  key: string;
  label: string;
  icon: LucideIcon;
}

interface TabBarProps {
  tabs: TabItem[];
  active: string;
  onChange: (key: string) => void;
}

export function TabBar({ tabs, active, onChange }: TabBarProps) {
  return (
    <div className="flex items-center gap-1 p-1 rounded-lg" style={{ backgroundColor: '#0F172A' }}>
      {tabs.map(({ key, label, icon: Icon }) => (
        <button
          key={key}
          onClick={() => onChange(key)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-colors"
          style={{
            backgroundColor: active === key ? '#1E293B' : 'transparent',
            color: active === key ? '#F1F5FB' : '#64748B',
          }}
        >
          <Icon size={14} /> {label}
        </button>
      ))}
    </div>
  );
}
