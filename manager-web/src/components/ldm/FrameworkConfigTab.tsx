import { Settings } from "lucide-react";
import { Card } from "../shared/Card.js";
import { LdmAboutCard } from "./LdmAboutCard.js";

interface FrameworkConfigTabProps {
  /** 实例标识 */
  serverId: string;
  /** 配置变更标记回调（编辑器骨架完成时由 input onChange 触发） */
  onDirtyChange?: (dirty: boolean) => void;
}

/**
 * 框架配置 Tab（Mod 框架页 4 Tab 之一）。
 *
 * 当前实现：
 * - 顶部 LdmAboutCard——LDM 版本 + 模块状态
 * - 中部 + 下部两张占位卡（结构化编辑器待后续实现）
 *
 * 编辑器需依赖 `GET /api/servers/:id/ldm/rocket-config` +
 * `GET /rocket-unturned-config` 读端点（当前未实现）。
 *
 * @param props - 组件属性
 * @returns 框架配置 Tab React 元素
 *
 * @example
 * ```tsx
 * <FrameworkConfigTab serverId="MyServer" />
 * ```
 */
export function FrameworkConfigTab({ serverId }: FrameworkConfigTabProps) {
  return (
    <div className="space-y-3">
      <LdmAboutCard serverId={serverId} />

      <Card title="Rocket.config.xml 编辑器">
        <div className="flex items-center gap-2 text-xs" style={{ color: "#94A3B8" }}>
          <Settings size={12} />
          结构化字段编辑器（语言 / 帧预算 / 自动关服 / 远程同步 9 字段）将在后续版本上线
        </div>
      </Card>

      <Card title="Rocket.Unturned.config.xml 编辑器">
        <div className="flex items-center gap-2 text-xs" style={{ color: "#94A3B8" }}>
          <Settings size={12} />
          结构化字段编辑器（自动存档 / 角色名校验 / 可疑日志 / 物品与载具黑名单 9 字段）将在后续版本上线
        </div>
      </Card>
    </div>
  );
}