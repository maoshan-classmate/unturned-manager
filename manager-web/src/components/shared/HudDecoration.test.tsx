import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { HudDecoration } from "./HudDecoration.js";

describe("HudDecoration — 装饰强度档", () => {
  it("默认 intensity=subtle 渲染 dot-matrix 行（8 个点）", () => {
    const { container } = render(<HudDecoration />);
    const dots = container.querySelectorAll(".bg-emerald-500\\/30");
    expect(dots).toHaveLength(8);
  });

  it("默认 intensity=subtle 不渲染扫描线元素", () => {
    const { container } = render(<HudDecoration />);
    const scan = container.querySelector(".hud-scan-line-anim");
    expect(scan).toBeNull();
  });

  it("intensity=normal 渲染 dot-matrix + 扫描线", () => {
    const { container } = render(<HudDecoration intensity="normal" />);
    const dots = container.querySelectorAll(".bg-emerald-500\\/30");
    expect(dots).toHaveLength(8);
    const scan = container.querySelector(".hud-scan-line-anim");
    expect(scan).not.toBeNull();
  });

  it("intensity=normal 时扫描线 animation duration = 4s", () => {
    const { container } = render(<HudDecoration intensity="normal" />);
    const scan = container.querySelector(".hud-scan-line-anim") as HTMLElement;
    expect(scan).not.toBeNull();
    // style.animation 包含 'hud-scan-line 4s linear infinite'
    expect(scan.style.animation).toContain("hud-scan-line");
    expect(scan.style.animation).toContain("4s");
    expect(scan.style.animation).toContain("linear");
    expect(scan.style.animation).toContain("infinite");
  });
});

describe("HudDecoration — 颜色与样式透传", () => {
  it("scanColor 默认 emerald 半透明", () => {
    const { container } = render(<HudDecoration intensity="normal" />);
    const scan = container.querySelector(".hud-scan-line-anim") as HTMLElement;
    expect(scan.style.backgroundColor).toBe("rgba(34, 197, 94, 0.2)");
  });

  it("scanColor 自定义颜色生效", () => {
    const { container } = render(
      <HudDecoration intensity="normal" scanColor="rgba(255, 0, 0, 0.3)" />,
    );
    const scan = container.querySelector(".hud-scan-line-anim") as HTMLElement;
    expect(scan.style.backgroundColor).toBe("rgba(255, 0, 0, 0.3)");
    // box-shadow 也跟随 scanColor
    expect(scan.style.boxShadow).toContain("rgba(255, 0, 0, 0.3)");
  });

  it("className 透传到最外层容器", () => {
    const { container } = render(<HudDecoration className="custom-class" />);
    const root = container.firstChild as HTMLElement;
    expect(root.className).toContain("custom-class");
  });
});

describe("HudDecoration — 交互与无障碍", () => {
  it("装饰层 pointer-events-none 不抢交互", () => {
    const { container } = render(<HudDecoration />);
    const root = container.firstChild as HTMLElement;
    expect(root.className).toContain("pointer-events-none");
  });

  it("装饰层 absolute inset-0 覆盖整个父容器", () => {
    const { container } = render(<HudDecoration />);
    const root = container.firstChild as HTMLElement;
    expect(root.className).toContain("absolute");
    expect(root.className).toContain("inset-0");
  });

  it("aria-hidden=true 不被屏幕阅读器读出", () => {
    const { container } = render(<HudDecoration />);
    const root = container.firstChild as HTMLElement;
    expect(root.getAttribute("aria-hidden")).toBe("true");
  });
});