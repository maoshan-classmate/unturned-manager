/**
 * HUD 装饰组件——叠在卡片内部上层的视觉装饰，强化科技感调性。
 *
 * 两种强度：
 *  - subtle：仅顶部 dot-matrix 行（克制，不抢内容）
 *  - normal：subtle + 扫描线（emerald 半透明光线从顶滑到底，4s 循环）
 *
 * 使用方式：作为装饰层 `absolute inset-0 pointer-events-none` 嵌入父容器
 * （父容器需 `position: relative`）。不拦截交互，纯视觉。
 *
 * 无障碍：`prefers-reduced-motion: reduce` 时停止扫描线动画。
 *
 * @param props - 组件属性
 * @param props.intensity - 装饰强度（默认 subtle）
 * @param props.scanColor - 扫描线颜色（默认 emerald-500/20）
 * @param props.className - 额外样式透传（容器）
 * @returns 装饰层 React 元素
 *
 * @example
 * ```tsx
 * <div className="relative">
 *   <HudDecoration intensity="normal" />
 *   <Card>...</Card>
 * </div>
 * ```
 */
export interface HudDecorationProps {
  /** 装饰强度：subtle（仅 dot-matrix）/ normal（+ 扫描线） */
  intensity?: "subtle" | "normal";
  /** 扫描线颜色（CSS color 字符串，默认 emerald-500/20） */
  scanColor?: string;
  /** 额外样式透传 */
  className?: string;
}

const DOT_COUNT = 8;
const SCAN_DURATION_S = 4;

/** 扫描线 keyframes（运行时注入一次，与 ProgressBar / Button 同模式） */
if (typeof document !== "undefined") {
  const STYLE_ID = "hud-decoration-keyframes";
  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      @keyframes hud-scan-line {
        0% { transform: translateY(-100%); opacity: 0; }
        10% { opacity: 1; }
        90% { opacity: 1; }
        100% { transform: translateY(100%); opacity: 0; }
      }
      @media (prefers-reduced-motion: reduce) {
        .hud-scan-line-anim {
          animation: none !important;
          opacity: 0 !important;
        }
      }
    `;
    document.head.appendChild(style);
  }
}

export function HudDecoration({
  intensity = "subtle",
  scanColor = "rgba(34, 197, 94, 0.2)",
  className,
}: HudDecorationProps) {
  const dots = Array.from({ length: DOT_COUNT }, (_, i) => i);

  return (
    <div
      aria-hidden="true"
      className={[
        "absolute inset-0 pointer-events-none overflow-hidden",
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {/* 顶部 dot-matrix 行 */}
      <div className="absolute top-0 left-3 right-3 flex items-center gap-[6px] py-1">
        {dots.map((i) => (
          <span
            key={i}
            className="inline-block h-[2px] w-[2px] rounded-full bg-emerald-500/30"
          />
        ))}
      </div>

      {/* 扫描线（仅 normal 强度） */}
      {intensity === "normal" && (
        <div
          className="hud-scan-line-anim absolute inset-x-0 top-0 h-[2px]"
          style={{
            backgroundColor: scanColor,
            animation: `hud-scan-line ${SCAN_DURATION_S}s linear infinite`,
            boxShadow: `0 0 12px ${scanColor}`,
          }}
        />
      )}
    </div>
  );
}