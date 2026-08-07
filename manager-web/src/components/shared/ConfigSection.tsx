import type { ReactNode } from 'react';

/**
 * 配置表单分组容器——Figma 的 fieldset 分组样式。
 * 在 ConfigPage 和 SettingsPage 中复用，避免硬编码 inline style。
 */
interface ConfigSectionProps {
  title: string;
  children: ReactNode;
  /** 分组下面再加一个子标题（可选） */
  subtitle?: string;
}

export function ConfigSection({ title, subtitle, children }: ConfigSectionProps) {
  return (
    <fieldset className="p-4 rounded-lg" style={{ backgroundColor: '#1E293B', border: '1px solid #334155' }}>
      <legend className="text-xs font-medium px-1" style={{ color: '#64748B' }}>{title}</legend>
      {subtitle && <p className="text-[11px] -mt-1 mb-2" style={{ color: '#475569' }}>{subtitle}</p>}
      <div className="space-y-3">{children}</div>
    </fieldset>
  );
}
