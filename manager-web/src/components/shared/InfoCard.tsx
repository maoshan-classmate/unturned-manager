import type { LucideIcon } from "lucide-react";
import { Info } from "lucide-react";

/**
 * 信息说明卡——通用的暗色提示容器，承载步骤说明 / 小贴士 / 帮助文案 / 配置提示。
 * 形态：暗色背景 #1E293B + 边框 #334059 + 顶部图标 + 标题 + 子内容（列表 / 段落 / 任意 children）。
 *
 * 复用参考：
 *   - ConfigPage.tsx 「💡 配置提示」侧栏
 *   - LdmPage.tsx 「💡 插件安装步骤」内嵌卡
 *
 * @param props - 组件属性
 * @param props.icon - 标题前图标，缺省 Info
 * @param props.title - 卡片标题（React 节点，可含 emoji）
 * @param props.variant - 视觉变体：default 主色（绿） / warning 警告（橙）
 * @param props.children - 卡片主体内容
 * @returns 信息说明卡 React 元素
 *
 * @example
 * ```tsx
 * <InfoCard title="💡 配置提示">
 *   <ol className="list-decimal list-inside space-y-1 text-xs">
 *     <li>修改配置后点保存</li>
 *   </ol>
 * </InfoCard>
 * ```
 */
export function InfoCard({
  icon: Icon = Info,
  title,
  variant = "default",
  children,
}: {
  icon?: LucideIcon;
  title?: React.ReactNode;
  variant?: "default" | "warning";
  children: React.ReactNode;
}) {
  const iconColor = variant === "warning" ? "#F59E0B" : "#22C55E";
  return (
    <div
      className="rounded-lg p-4"
      style={{ backgroundColor: "#1E293B", border: "1px solid #334059" }}
    >
      {title && (
        <div className="flex items-center gap-2 mb-3">
          {Icon && <Icon size={16} style={{ color: iconColor }} />}
          <h3 className="text-sm font-medium" style={{ color: "#F1F5FB" }}>
            {title}
          </h3>
        </div>
      )}
      <div className="text-xs leading-relaxed" style={{ color: "#94A3B8" }}>
        {children}
      </div>
    </div>
  );
}