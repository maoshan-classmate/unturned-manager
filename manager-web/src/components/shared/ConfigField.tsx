import { Input } from '@/components/ui/input';

/**
 * 配置表单字段——标签 + Input 组合。
 * 在 ConfigPage / Config.txt / SettingsPage 中复用。
 */
interface ConfigFieldProps {
  /** 字段标签，显示在输入框上方 */
  label: string;
  /** 输入框当前值 */
  value: string;
  /** 输入值变化回调 */
  onChange: (value: string) => void;
  /** HTML input type（text/password/number 等），默认 text */
  type?: string;
  /** 占位符——表单字段为空时显示。留空 = 无占位符 */
  placeholder?: string;
}

export function ConfigField({ label, value, onChange, type = 'text', placeholder }: ConfigFieldProps) {
  return (
    <label className="block">
      <span className="text-xs" style={{ color: '#94A3B8' }}>{label}</span>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 h-8 text-sm"
        type={type}
        placeholder={placeholder}
      />
    </label>
  );
}
