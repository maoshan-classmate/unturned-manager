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
  /** 标题行右侧操作区（可选，如「管理物品清单」按钮） */
  actions?: ReactNode;
}

export function ConfigSection({ title, subtitle, children, actions }: ConfigSectionProps) {
  return (
    <fieldset className="p-4 rounded-lg" style={{ backgroundColor: '#1E293B', border: '1px solid #334155' }}>
      <legend className="text-xs font-medium px-1 w-full">
        <div className="flex items-center justify-between w-full gap-2">
          <span style={{ color: '#64748B' }}>{title}</span>
          {actions}
        </div>
      </legend>
      {subtitle && <p className="text-[11px] -mt-1 mb-2" style={{ color: '#475569' }}>{subtitle}</p>}
      <div className="space-y-3">{children}</div>
    </fieldset>
  );
}
