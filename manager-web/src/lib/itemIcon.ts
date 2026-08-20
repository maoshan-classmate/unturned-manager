/**
 * 游戏内物品缩略图 URL 生成工具。
 * 资源基地址：`public/items/<id>.png`——vite 构建时整体拷贝到 dist/items/。
 * 找不到资源时调用方走 lucide `Package` 占位（见 ItemIcon 组件）。
 */

const ITEM_ICON_BASE = "/items";

/**
 * 把游戏内物品 ID 转成静态图路径。
 *
 * @param id - 物品 ID（ushort 0–65535）
 * @returns 静态资源路径；越界或非有限数返回 null
 *
 * @example
 * ```ts
 * getItemIconUrl(1100); // "/items/1100.png"
 * getItemIconUrl(99999); // null
 * getItemIconUrl(null);  // null
 * ```
 */
export function getItemIconUrl(id: number | null | undefined): string | null {
  if (id == null) return null;
  if (!Number.isFinite(id) || id < 0 || id > 65535) return null;
  return `${ITEM_ICON_BASE}/${id}.png`;
}