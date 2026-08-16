import { Shield } from "lucide-react";
import { Card } from "../shared/Card.js";
import { InfoCard } from "../shared/InfoCard.js";

/**
 * 权限组 Tab（4 Tab 之一，Phase 3-3 骨架 → Phase 5 前端实施）。
 *
 * 当前实现：单张占位卡。Permissions.config.xml 的结构化树形编辑器（Groups / Members /
 * Permissions / Color / ParentGroup / Priority / Cooldown）将在 Phase 5 前端实施时落地。
 *
 * 后端依赖（已就绪）：
 * - `GET /api/servers/:id/ldm/permissions-config`（commit `d03d432`）
 * - `PUT /api/servers/:id/ldm/permissions-config`（Phase 2）
 * - `serializePermissionsConfig` 未知键保留（Phase 5 §4.1）
 *
 * **推迟项**（2026-08-16 用户拍板）：Monaco XML 原文编辑器作为权限组备选——本期不做，
 * 推到「权限组编辑器 V2」独立 Phase（见 `docs/architecture/ldm-editor-design.md` §10）。
 *
 * @returns 权限组 Tab React 元素
 *
 * @example
 * ```tsx
 * <PermissionsTab serverId="MyServer" />
 * ```
 */
export function PermissionsTab() {
  return (
    <div className="space-y-3">
      <Card title="权限组编辑器">
        <div className="flex items-center gap-2 text-xs" style={{ color: "#94A3B8" }}>
          <Shield size={12} />
          权限组结构化编辑器（Groups / Members / Permissions / Color / ParentGroup / Priority / Cooldown）将在后续版本上线
        </div>
      </Card>
      <InfoCard title="💡 XML 原文编辑（备选方案）">
        本期只提供结构化编辑器。Monaco XML 原文编辑器作为权限组编辑器的备选方案——
        推迟到「权限组编辑器 V2」独立 Phase（见 `docs/architecture/ldm-editor-design.md` §10）。
      </InfoCard>
    </div>
  );
}