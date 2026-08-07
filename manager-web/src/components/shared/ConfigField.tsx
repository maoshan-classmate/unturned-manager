import { Input } from '@/components/ui/input';

/**
 * 配置表单字段——标签 + Input 组合。
 * 在 ConfigPage / Config.txt / SettingsPage 中复用。
 */
interface ConfigFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
}

export function ConfigField({ label, value, onChange, type = 'text' }: ConfigFieldProps) {
  return (
    <label className="block">
      <span className="text-xs" style={{ color: '#94A3B8' }}>{label}</span>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 h-8 text-sm"
        type={type}
      />
    </label>
  );
}
