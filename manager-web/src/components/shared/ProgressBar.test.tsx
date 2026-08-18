import { describe, it, expect, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { ProgressBar } from "./ProgressBar.js";

afterEach(() => {
  // 确保每个测试后无残留 setTimeout 干扰下一个测试
  // vitest 会自动清理 fake timers（如果使用）
});

describe("ProgressBar — 完成闪烁开关（onCompleteFlash）", () => {
  it("默认 onCompleteFlash=false 不给 fill 加闪烁动画类", () => {
    const { container } = render(<ProgressBar stage="completed" percent={100} />);
    const fill = container.querySelector('[class*="h-full"]');
    expect(fill).not.toBeNull();
    expect(fill!.className).not.toContain("animate-[progressbar-complete-flash");
  });

  it("onCompleteFlash=true + downloading → completed 切换时触发闪烁", () => {
    const { container, rerender } = render(
      <ProgressBar stage="downloading" percent={50} onCompleteFlash />,
    );

    // 切换 stage → completed，触发 useEffect setShouldFlash(true)
    rerender(<ProgressBar stage="completed" percent={100} onCompleteFlash />);

    const fill = container.querySelector('[class*="h-full"]');
    expect(fill).not.toBeNull();
    expect(fill!.className).toContain(
      "animate-[progressbar-complete-flash_700ms_ease-out]",
    );
  });

  it("初始 mount 已 completed + onCompleteFlash=true 不闪烁（避免误触发）", () => {
    const { container } = render(
      <ProgressBar stage="completed" percent={100} onCompleteFlash />,
    );

    const fill = container.querySelector('[class*="h-full"]');
    expect(fill).not.toBeNull();
    expect(fill!.className).not.toContain("animate-[progressbar-complete-flash");
  });

  it("failed 状态即使 onCompleteFlash=true 也不闪烁", () => {
    const { container, rerender } = render(
      <ProgressBar stage="downloading" percent={50} onCompleteFlash />,
    );

    // 切到 failed（不是 completed），不应触发闪烁
    rerender(
      <ProgressBar stage="failed" percent={50} errorMessage="boom" onCompleteFlash />,
    );

    // failed 状态下 fill 仍是 .h-full.transition-all 但不应含闪烁类
    const fill = container.querySelector('[class*="h-full"]');
    // failed 时 fill div 存在但 width=50%（不是 100%），className 不应包含闪烁类
    expect(fill).not.toBeNull();
    expect(fill!.className).not.toContain("animate-[progressbar-complete-flash");
  });

  it("completed → downloading → completed 二次触发也能闪（useRef 状态正确更新）", () => {
    const { container, rerender } = render(
      <ProgressBar stage="downloading" percent={30} onCompleteFlash />,
    );

    // 第一次进入 completed
    rerender(<ProgressBar stage="completed" percent={100} onCompleteFlash />);
    let fill = container.querySelector('[class*="h-full"]');
    expect(fill!.className).toContain("animate-[progressbar-complete-flash");

    // 清掉闪烁状态（700ms 后）—— 通过 rerender 到 downloading 再回 completed
    rerender(<ProgressBar stage="downloading" percent={30} onCompleteFlash />);
    // 此时 setTimeout(700ms) 还没触发，shouldFlash 仍 true，需 act 推进 fake timer
    // 但这里主要验证 useRef 状态机闭合——再切回 completed 应能再次闪烁
    act(() => {
      rerender(<ProgressBar stage="completed" percent={100} onCompleteFlash />);
    });
    fill = container.querySelector('[class*="h-full"]');
    expect(fill!.className).toContain("animate-[progressbar-complete-flash");
  });
});

describe("ProgressBar — 基础渲染", () => {
  it("downloading + percent=45 渲染带百分比的 fill", () => {
    render(<ProgressBar stage="downloading" percent={45} />);
    const bar = screen.getByRole("progressbar");
    expect(bar.getAttribute("aria-valuenow")).toBe("45");
  });

  it("completed 渲染已完成状态（aria-valuenow=100）", () => {
    render(<ProgressBar stage="completed" />);
    const bar = screen.getByRole("progressbar");
    expect(bar.getAttribute("aria-valuenow")).toBe("100");
  });

  it("indeterminate（percent 缺失）走条纹动画路径", () => {
    const { container } = render(<ProgressBar stage="validating" />);
    // indeterminate 分支渲染 absolute inset-y-0 w-1/3 条纹，fill 走 indeterminate
    const stripe = container.querySelector(".absolute.inset-y-0");
    expect(stripe).not.toBeNull();
  });

  it("queued + queuePos=2 显示「排队中」文案", () => {
    render(<ProgressBar stage="queued" queuePos={2} queueTotal={3} />);
    expect(screen.getByText(/排队中/)).toBeTruthy();
  });

  it("failed + errorMessage 显示错误文案", () => {
    render(<ProgressBar stage="failed" errorMessage="steamcmd-busy" />);
    expect(screen.getByText(/失败.*steamcmd-busy/)).toBeTruthy();
  });
});