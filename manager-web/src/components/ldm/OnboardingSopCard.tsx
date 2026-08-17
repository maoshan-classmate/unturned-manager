import { useState } from "react";
import { Copy, ChevronDown, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { InfoCard } from "../shared/InfoCard.js";
import { Button } from "../ui/button.js";

const SOP_KEY = "ldm.onboardingDismissed";

/**
 * LDM 激活引导 SOP 卡片——首次启用 LDM 框架的 5 步操作指引。
 * 安装在 LdmPage 顶层（4 Tab 之上），全局展示。
 *
 * 内容真源：`docs/architecture/ldm-integration-design.md` §4 SOP + `unturned-sop.md` §LDM
 * 默认展开（设计 §4 明确要求首次进入 LdmPage 时引导文案可见）；
 * 用户点「收起」后写入 `localStorage[ldm.onboardingDismissed]`，
 * 下次进入不再自动展开——通过 useState 初始化时读 localStorage 实现。
 *
 * 复制命令按钮沿用项目惯例（FilesPage.tsx:494）：`navigator.clipboard.writeText` 裸调，
 * 失败由 sonner toast 反馈；不引入兜底方案。
 *
 * @returns 引导卡 React 元素
 *
 * @example
 * ```tsx
 * <OnboardingSopCard />
 * ```
 */
export function OnboardingSopCard() {
  // 默认展开；localStorage 标记 dismiss 后下次初始化为 true（收起）
  const [collapsed, setCollapsed] = useState<boolean>(
    () => typeof window !== "undefined" && localStorage.getItem(SOP_KEY) === "true",
  );

  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    if (next) localStorage.setItem(SOP_KEY, "true");
    else localStorage.removeItem(SOP_KEY);
  };

  const copyCmd = (label: string, cmd: string) => {
    void navigator.clipboard.writeText(cmd).then(
      () => toast.success(`已复制${label}`),
      () => toast.error("复制失败"),
    );
  };

  return (
    <InfoCard title="💡 首次启用 Mod 框架" icon={collapsed ? ChevronRight : ChevronDown}>
      <button
        type="button"
        onClick={toggle}
        className="text-xs underline mb-2"
        style={{ color: "#94A3B8" }}
      >
        {collapsed ? "展开 5 步引导" : "收起"}
      </button>
      {!collapsed && (
        <ol className="space-y-2 list-decimal list-inside mt-1">
          <li>
            安装 Unturned 服务端（Steam AppID 1110390）—— 已有「安装 Unturned 服务端」按钮
          </li>
          <li>
            复制 Unturned 服务端安装包自带的 Mod 框架到 Modules 目录：
            <div className="flex items-center gap-2 mt-1 ml-5">
              <code
                className="text-xs px-2 py-0.5 rounded font-mono"
                style={{ backgroundColor: "#0F172A", color: "#F1F5FB" }}
              >
                cp -r /opt/unturned/Extras/Rocket.Unturned /opt/unturned/Modules/
              </code>
              <Button
                size="xs"
                variant="outline"
                onClick={() =>
                  copyCmd(
                    "激活命令",
                    "cp -r /opt/unturned/Extras/Rocket.Unturned /opt/unturned/Modules/",
                  )
                }
                aria-label="复制激活命令"
              >
                <Copy size={12} /> 复制
              </Button>
            </div>
          </li>
          <li>
            启动一次服务端，让 Mod 框架配置目录自动生成：
            <div className="flex items-center gap-2 mt-1 ml-5">
              <code
                className="text-xs px-2 py-0.5 rounded font-mono"
                style={{ backgroundColor: "#0F172A", color: "#F1F5FB" }}
              >
                ServerHelper.sh +InternetServer/&lt;ServerID&gt; -ThreadedConsole
              </code>
              <Button
                size="xs"
                variant="outline"
                onClick={() =>
                  copyCmd(
                    "启动命令",
                    "/opt/unturned/ServerHelper.sh +InternetServer/<ServerID> -ThreadedConsole",
                  )
                }
                aria-label="复制启动命令"
              >
                <Copy size={12} /> 复制
              </Button>
            </div>
          </li>
          <li>
            由用户自行下载插件 .dll（从插件项目的 GitHub Releases 或开发者官网）→ 到「已装插件」Tab 点
            「上传 .dll」按钮上传（面板不会自动下载 .dll，以避免引入不受信任的二进制）
          </li>
          <li>
            编辑框架配置 → 点「应用变更」，重启后生效
          </li>
        </ol>
      )}
    </InfoCard>
  );
}