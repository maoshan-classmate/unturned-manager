import { describe, it, expect, vi, beforeEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { OnboardingSopCard } from "./OnboardingSopCard.js";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

/**
 * 在 JSDOM 里 `navigator.clipboard` 是只读 getter——必须用 Object.defineProperty 重写。
 * 每次 beforeEach 还原到原值，避免测试间污染。
 */
function mockClipboard(writeText: (text: string) => Promise<void>) {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
}

describe("OnboardingSopCard", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    mockClipboard(() => Promise.resolve());
  });

  it("首次进入默认展开（设计 §4 要求引导文案可见），5 步列表出现 + 收起按钮", () => {
    render(<OnboardingSopCard />);
    // 5 步列表可见
    expect(screen.getByText(/安装 Unturned 服务端/)).toBeInTheDocument();
    // 按钮显示收起
    expect(screen.getByText("收起")).toBeInTheDocument();
  });

  it("localStorage 已 dismiss → 默认折叠，按钮文案是展开", () => {
    localStorage.setItem("ldm.onboardingDismissed", "true");
    render(<OnboardingSopCard />);
    expect(screen.queryByText(/安装 Unturned 服务端/)).not.toBeInTheDocument();
    expect(screen.getByText("展开 5 步引导")).toBeInTheDocument();
  });

  it("点复制按钮 → navigator.clipboard.writeText 被调 + toast 成功", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    mockClipboard(writeText);
    const { container } = render(<OnboardingSopCard />);
    const copyBtn = container.querySelector(
      'button[aria-label="复制激活命令"]',
    ) as HTMLButtonElement;
    expect(copyBtn).toBeInTheDocument();
    fireEvent.click(copyBtn);
    // promise resolves → toast.success (microtask)
    await new Promise((r) => setTimeout(r, 10));
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText.mock.calls[0]![0]).toMatch(/cp -r .*Rocket\.Unturned/);
    expect(toast.success).toHaveBeenCalledWith("已复制激活命令");
  });

  it("clipboard.writeText reject → toast.error 被调", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    mockClipboard(writeText);
    const { container } = render(<OnboardingSopCard />);
    const copyBtn = container.querySelector(
      'button[aria-label="复制激活命令"]',
    ) as HTMLButtonElement;
    fireEvent.click(copyBtn);
    // promise rejected → toast.error
    await new Promise((r) => setTimeout(r, 10));
    expect(toast.error).toHaveBeenCalledWith("复制失败");
  });

  it("点收起 → 列表消失且 localStorage 标记 dismiss", async () => {
    const user = userEvent.setup();
    render(<OnboardingSopCard />);
    await user.click(screen.getByText("收起"));
    expect(screen.queryByText(/安装 Unturned 服务端/)).not.toBeInTheDocument();
    expect(localStorage.getItem("ldm.onboardingDismissed")).toBe("true");
  });

  it("收起状态下再展开 → 列表重新出现 + localStorage 标记清除", async () => {
    const user = userEvent.setup();
    render(<OnboardingSopCard />);
    await user.click(screen.getByText("收起"));
    await user.click(screen.getByText("展开 5 步引导"));
    expect(screen.getByText(/安装 Unturned 服务端/)).toBeInTheDocument();
    expect(localStorage.getItem("ldm.onboardingDismissed")).toBeNull();
  });
});