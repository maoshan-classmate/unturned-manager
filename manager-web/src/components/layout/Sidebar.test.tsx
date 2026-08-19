import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const motionFactory = vi.hoisted(() => {
  const make = (tag: string) => (props: Record<string, unknown>) => {
    const { layoutId, transition, initial, animate, exit, ...rest } = props;
    return React.createElement(tag, rest);
  };
  return { motion: { span: make("span"), div: make("div"), button: make("button") } };
});

vi.mock("motion/react", () => motionFactory);

// mock useServers（ServerSelector 经 useServer alias 调用）—— 测试不需要真起 ServersProvider
vi.mock("../../hooks/useServer.js", () => ({
  useServer: vi.fn(() => ({
    servers: [],
    loading: false,
    error: null,
    refresh: vi.fn(),
    addServer: vi.fn(),
    removeServer: vi.fn(),
    updateServer: vi.fn(),
  })),
}));

import { Sidebar } from "./Sidebar.js";
import { CurrentServerProvider } from "../../contexts/CurrentServerContext.js";

function renderSidebar(initialPath = "/") {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <CurrentServerProvider>
        <Sidebar />
      </CurrentServerProvider>
    </MemoryRouter>,
  );
}

describe("Sidebar — 选中条与路由高亮", () => {
  it("仪表盘路由激活时选中条渲染在该项上", () => {
    renderSidebar("/");
    const bars = screen.getAllByTestId("sidebar-active-bar");
    expect(bars).toHaveLength(1);
  });

  it("选中切换到控制台后选中条仍唯一", () => {
    renderSidebar("/console");
    const bars = screen.getAllByTestId("sidebar-active-bar");
    expect(bars).toHaveLength(1);
  });

  it("未选中导航项不渲染选中条元素", () => {
    renderSidebar("/");
    const inactiveLinks = screen.getAllByRole("link").filter(
      (a) => !a.textContent?.includes("仪表盘"),
    );
    inactiveLinks.forEach((link) => {
      expect(within(link).queryByTestId("sidebar-active-bar")).toBeNull();
    });
  });

  it("8 个菜单标签全部渲染", () => {
    renderSidebar();
    const expected = ["仪表盘", "控制台", "配置", "模组", "Mod 框架", "文件", "服务器设置", "系统设置"];
    const allLinks = screen.getAllByRole("link");
    expected.forEach((label) => {
      const matched = allLinks.some((a) => a.textContent?.includes(label));
      expect(matched, `期望找到含「${label}」的链接`).toBe(true);
    });
  });

  it("选中项文字色为 emerald、未选中为 slate", () => {
    renderSidebar("/");
    const dashLink = screen.getByRole("link", { name: /仪表盘/ });
    expect(dashLink.style.color).toBe("rgb(34, 197, 94)");
    const consoleLink = screen.getByRole("link", { name: /控制台/ });
    expect(consoleLink.style.color).toBe("rgb(148, 163, 184)");
  });
});