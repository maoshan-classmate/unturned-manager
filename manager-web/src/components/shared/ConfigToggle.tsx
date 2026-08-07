/**
 * 配置开关——Figma 的 Switch 样式（Checkbox 版本）。
 * 在 ConfigPage / Config.txt / SettingsPage 中复用。
 */
interface ConfigToggleProps {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

export function ConfigToggle({ label, checked, onChange }: ConfigToggleProps) {
  return (
    <label className="flex items-center gap-2 cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="w-4 h-4 rounded accent-emerald-500"
      />
      <span className="text-sm" style={{ color: '#94A3B8' }}>{label}</span>
    </label>
  );
}
