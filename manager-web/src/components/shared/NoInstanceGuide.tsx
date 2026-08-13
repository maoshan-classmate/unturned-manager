import { useNavigate } from "react-router-dom";
import { Rocket } from "lucide-react";
import { Button } from "../ui/button.js";

/**
 * 未选实例时的内容区占位卡。
 *
 * 当用户点击控制台 / 配置 / 模组 / Mod 框架这类依赖实例的菜单、但当前还没有
 * 任何服务器实例（或所选实例已不存在）时，内容区渲染这张卡片——用文字解释
 * 原因，用按钮把用户引导到「服务器设置」页去创建实例。
 *
 * @param props - 组件属性
 * @param props.reason - 未选实例的原因：'empty'=还没有任何实例；'missing'=所选实例已不存在
 * @returns 占位卡 React 元素
 *
 * @example
 * ```tsx
 * <NoInstanceGuide reason="empty" />
 * ```
 */
export function NoInstanceGuide({
  reason = "empty",
}: {
  /** 未选实例的原因：'empty'=还没有任何实例；'missing'=所选实例已不存在 */
  reason?: "empty" | "missing";
}) {
  const navigate = useNavigate();

  const title = reason === "missing" ? "所选服务器实例已不存在" : "还没有服务器实例";
  const description =
    reason === "missing"
      ? "当前选中的服务器实例可能已被删除，请重新选择一个实例，或创建一个新的。"
      : "创建一个服务器实例之后，才能使用控制台、配置、模组等功能。";

  return (
    <div className="flex flex-col items-center justify-center h-full">
      <div className="flex flex-col items-center gap-4 max-w-sm text-center">
        <div
          className="flex items-center justify-center rounded-full"
          style={{
            width: 56,
            height: 56,
            backgroundColor: "#1E293B",
            border: "1px solid #334059",
          }}
        >
          <Rocket size={24} aria-hidden="true" style={{ color: "#22C55E" }} />
        </div>
        <div>
          <h2
            className="text-base font-semibold"
            style={{ color: "#F1F5FB" }}
          >
            {title}
          </h2>
          <p
            className="mt-2 text-sm leading-5"
            style={{ color: "#94A3B8" }}
          >
            {description}
          </p>
        </div>
        <Button onClick={() => navigate("/server-setup")}>
          <Rocket size={16} className="mr-1.5" aria-hidden="true" />
          去新建实例
        </Button>
      </div>
    </div>
  );
}
