import { describe, it, expect, vi } from "vitest";
import React from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Boxes, Database, Server } from "lucide-react";

const motionFactory = vi.hoisted(() => {
  const make = (tag: string) => (props: Record<string, unknown>) => {
    const { layoutId, transition, initial, animate, exit, ...rest } = props;
    return React.createElement(tag, rest);
  };
  return { motion: { span: make("span"), div: make("div"), button: make("button") } };
});

vi.mock("motion/react", () => motionFactory);

import { TabBar } from "./TabBar.js";

const TABS = [
  { key: "a", label: "标签 A", icon: Boxes },
  { key: "b", label: "标签 B", icon: Database },
  { key: "c", label: "标签 C", icon: Server },
];

function renderTabBar(props: Parameters<typeof TabBar>[0] = { tabs: TABS, active: "a", onChange: () => {} }) {
  return render(<TabBar {...props} />);
}

describe("TabBar — 指示器与交互", () => {
  it("默认 indicatorStyle=background 渲染填充块指示器", () => {
    const { container } = renderTabBar();
    const indicators = container.querySelectorAll("[data-indicator-style='background']");
    expect(indicators).toHaveLength(1);
  });

  it("indicatorStyle=underline 渲染下划线指示器（不带填充块）", () => {
    const { container } = renderTabBar({ tabs: TABS, active: "a", onChange: () => {}, indicatorStyle: "underline" });
    const underline = container.querySelectorAll("[data-indicator-style='underline']");
    expect(underline).toHaveLength(1);
    const filled = container.querySelectorAll("[data-indicator-style='background']");
    expect(filled).toHaveLength(0);
  });

  it("切换 active 后指示器仍唯一", () => {
    const { container } = renderTabBar({ tabs: TABS, active: "b", onChange: () => {} });
    const indicators = container.querySelectorAll("[data-indicator-style='background']");
    expect(indicators).toHaveLength(1);
  });

  it("点击未选中标签触发 onChange", async () => {
    const onChange = vi.fn();
    renderTabBar({ tabs: TABS, active: "a", onChange });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /标签 B/ }));
    expect(onChange).toHaveBeenCalledWith("b");
  });

  it("选中按钮文字色为主文本色（#F1F5FB）", () => {
    renderTabBar({ tabs: TABS, active: "b", onChange: () => {} });
    const btnB = screen.getByRole("button", { name: /标签 B/ });
    expect(btnB.style.color).toBe("rgb(241, 245, 251)");
  });

  it("未选中按钮文字色为弱化色（#64748B）", () => {
    renderTabBar({ tabs: TABS, active: "a", onChange: () => {} });
    const btnB = screen.getByRole("button", { name: /标签 B/ });
    expect(btnB.style.color).toBe("rgb(100, 116, 139)");
  });
});