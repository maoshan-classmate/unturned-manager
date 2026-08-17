import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Button } from "./button.js";

describe("Button — 变体与动画档", () => {
  it("默认渲染 default variant + default size", () => {
    render(<Button>确定</Button>);
    const btn = screen.getByRole("button", { name: "确定" });
    expect(btn.className).toContain("bg-emerald-500");
    expect(btn.className).toContain("hover:brightness-110");
    expect(btn.className).toContain("h-8");
  });

  it("variant=secondary 渲染 slate-700 背景", () => {
    render(<Button variant="secondary">次要</Button>);
    const btn = screen.getByRole("button", { name: "次要" });
    expect(btn.className).toContain("bg-slate-700");
    expect(btn.className).toContain("hover:brightness-110");
  });

  it("variant=outline 渲染带边框样式", () => {
    render(<Button variant="outline">轮廓</Button>);
    const btn = screen.getByRole("button", { name: "轮廓" });
    expect(btn.className).toContain("bg-slate-800");
    expect(btn.className).toContain("border-slate-500");
    expect(btn.className).toContain("hover:brightness-110");
  });

  it("variant=ghost 不含 brightness（透明背景无意义）", () => {
    render(<Button variant="ghost">透明</Button>);
    const btn = screen.getByRole("button", { name: "透明" });
    expect(btn.className).toContain("bg-transparent");
    expect(btn.className).not.toContain("hover:brightness-110");
  });

  it("variant=destructive 渲染红色背景", () => {
    render(<Button variant="destructive">删除</Button>);
    const btn = screen.getByRole("button", { name: "删除" });
    expect(btn.className).toContain("bg-red-500");
    expect(btn.className).toContain("hover:brightness-110");
  });

  it("variant=link 不含 brightness", () => {
    render(<Button variant="link">链接</Button>);
    const btn = screen.getByRole("button", { name: "链接" });
    expect(btn.className).toContain("text-emerald-500");
    expect(btn.className).toContain("underline-offset-4");
    expect(btn.className).not.toContain("hover:brightness-110");
  });

  it("variant=glow 渲染含光晕阴影类", () => {
    render(<Button variant="glow">关键操作</Button>);
    const btn = screen.getByRole("button", { name: "关键操作" });
    expect(btn.className).toContain("shadow-[0_0_24px_rgba(34,197,94,0.5)]");
    expect(btn.className).toContain("hover:brightness-110");
    expect(btn.className).toContain("hover:shadow-[0_0_32px_rgba(34,197,94,0.7)]");
  });

  it("size=xs / sm / lg / icon 各自渲染对应类", () => {
    const { rerender } = render(<Button size="xs">XS</Button>);
    expect(screen.getByRole("button").className).toContain("h-6");

    rerender(<Button size="sm">SM</Button>);
    expect(screen.getByRole("button").className).toContain("h-7");

    rerender(<Button size="lg">LG</Button>);
    expect(screen.getByRole("button").className).toContain("h-9");

    rerender(<Button size="icon">IC</Button>);
    expect(screen.getByRole("button").className).toContain("size-8");
  });

  it("focus-visible ring 带 offset（焦点态与背景区分）", () => {
    render(<Button>焦点</Button>);
    const btn = screen.getByRole("button");
    expect(btn.className).toContain("focus-visible:ring-offset-2");
    expect(btn.className).toContain("focus-visible:ring-offset-slate-900");
  });

  it("animation 入参三种取值都不抛错（normal / press-only / glow-pulse 类型预留）", () => {
    expect(() => render(<Button animation="normal">N</Button>)).not.toThrow();
    expect(() => render(<Button animation="press-only">P</Button>)).not.toThrow();
    expect(() => render(<Button animation="glow-pulse">G</Button>)).not.toThrow();
  });

  it("disabled 时禁用交互", () => {
    render(<Button disabled>不可用</Button>);
    const btn = screen.getByRole("button", { name: "不可用" }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.className).toContain("disabled:opacity-50");
    expect(btn.className).toContain("disabled:pointer-events-none");
  });
});