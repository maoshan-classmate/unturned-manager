import { useState } from "react";
import { Package } from "lucide-react";
import { getItemIconUrl } from "../../lib/itemIcon.js";

/** ItemIcon 组件属性 */
export interface ItemIconProps {
  /** 物品 ID（ushort 0–65535）；null/undefined/越界 → 占位 Package */
  id: number | null | undefined;
  /** 显示尺寸（CSS 像素，正方形）；默认 16 */
  size?: number;
  /** 透传给根元素；用于布局微调 */
  className?: string;
  /**
   * 资源加载失败或 ID 非法时显示的占位图标；默认 lucide `Package`。
   * 透传 fallback 用于未来按物品类型换占位（武器 / 医疗 / 食物）。
   */
  fallback?: typeof Package;
  /**
   * 透传给 `<img>` 的 alt 文本；缺省时空字符串（装饰性图，不读屏）。
   * 屏幕阅读场景下调用方应传入「手枪」「医疗包」等中文名。
   */
  alt?: string;
}

/**
 * 游戏内物品缩略图——显示 16–24px PNG 方块贴图。
 * 资源来自 `public/items/<id>.png`（构建时由 copy-icons.mjs 从 `.research/Icons/` 拷贝）。
 * 找不到资源 / 加载失败 → lucide `Package` 灰色占位。
 *
 * @param props - 组件属性
 * @returns 缩略图 React 元素
 *
 * @example
 * ```tsx
 * <ItemIcon id={1100} size={16} />
 * <ItemIcon id={item.id} size={20} className="shrink-0" alt={item.label ?? item.name} />
 * ```
 */
export function ItemIcon({
  id,
  size = 16,
  className,
  fallback: Fallback = Package,
  alt = "",
}: ItemIconProps) {
  const url = getItemIconUrl(id);
  const [errored, setErrored] = useState(false);

  if (url === null || errored) {
    return (
      <Fallback
        size={size}
        className={className}
        style={{ color: "#64748B" }}
        aria-hidden="true"
      />
    );
  }

  return (
    <img
      src={url}
      alt={alt}
      width={size}
      height={size}
      loading="lazy"
      onError={() => setErrored(true)}
      className={className}
      style={{
        borderRadius: 2,
        objectFit: "contain",
        backgroundColor: "transparent",
      }}
    />
  );
}