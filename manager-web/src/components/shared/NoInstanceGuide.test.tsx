import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { NoInstanceGuide } from "./NoInstanceGuide.js";

describe("NoInstanceGuide — 未选实例内容区占位卡", () => {
  it("reason=empty 时显示「还没有服务器实例」", () => {
    render(
      <MemoryRouter>
        <NoInstanceGuide reason="empty" />
      </MemoryRouter>,
    );
    expect(screen.getByText("还没有服务器实例")).toBeTruthy();
    expect(screen.getByText(/创建一个服务器实例之后/)).toBeTruthy();
  });

  it("reason=missing 时显示「所选服务器实例已不存在」", () => {
    render(
      <MemoryRouter>
        <NoInstanceGuide reason="missing" />
      </MemoryRouter>,
    );
    expect(screen.getByText("所选服务器实例已不存在")).toBeTruthy();
    expect(screen.getByText(/已被删除/)).toBeTruthy();
  });

  it("按钮「去新建实例」跳转到 /server-setup", () => {
    render(
      <MemoryRouter>
        <NoInstanceGuide reason="empty" />
      </MemoryRouter>,
    );
    const btn = screen.getByRole("button", { name: /去新建实例/ });
    expect(btn).toBeTruthy();
  });
});
