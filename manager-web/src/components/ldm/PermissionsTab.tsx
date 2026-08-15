import { Shield } from "lucide-react";
import { Card } from "../shared/Card.js";

/**
 * 权限组 Tab（4 Tab 之一，Phase 3-3 骨架）。
 *
 * 当前实现：单张占位卡。Permissions.config.xml 的结构化树形编辑器（Groups / Members /
 * Permissions / Color / ParentGroup / Priority）需 Phase 4 落地，依赖：
 * - `GET /api/servers/:id/ldm/permissions-config` 读端点（当前未实现）
 * - Monaco XML 原文编辑器作为备选（设计 §2.6 决策）
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
    <Card title="权限组编辑器">
      <div className="flex items-center gap-2 text-xs" style={{ color: "#94A3B8" }}>
        <Shield size={12} />
        权限组结构化编辑器（Groups / Members / Permissions / Color）将在后续版本上线
      </div>
    </Card>
  );
}