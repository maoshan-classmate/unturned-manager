import { Shield } from "lucide-react";
import { Card } from "../shared/Card.js";
import { InfoCard } from "../shared/InfoCard.js";

/**
 * 权限组 Tab（4 Tab 之一，编辑器骨架阶段）。
 *
 * 当前实现：单张占位卡。Permissions.config.xml 的结构化树形编辑器（Groups / Members /
 * Permissions / Color / ParentGroup / Priority / Cooldown）编辑器骨架完成时启用。
 *
 * 后端依赖（已就绪）：
 * - `GET /api/servers/:id/ldm/permissions-config`
 * - `PUT /api/servers/:id/ldm/permissions-config`
 * - `serializePermissionsConfig` 未知键保留
 *
 * @param props - 组件属性
 * @param props.onDirtyChange - 权限组变更标记回调（编辑器骨架完成时触发）
 * @returns 权限组 Tab React 元素
 *
 * @example
 * ```tsx
 * <PermissionsTab onDirtyChange={setDirty} />
 * ```
 */
export function PermissionsTab({
  onDirtyChange: _onDirtyChange,
}: {
  onDirtyChange?: (dirty: boolean) => void;
} = {}) {
  return (
    <div className="space-y-3">
      <Card title="权限组编辑器">
        <div className="flex items-center gap-2 text-xs" style={{ color: "#94A3B8" }}>
          <Shield size={12} />
          结构化分组编辑器（Groups / Members / Permissions / Color / ParentGroup / Priority / Cooldown）将在后续版本上线
        </div>
      </Card>
      <InfoCard title="说明">
        <p className="text-xs leading-relaxed">
          权限组采用分组树结构，每组包含成员名单、权限位、配色与冷却时间。当前版本仅展示骨架。
        </p>
      </InfoCard>
    </div>
  );
}
