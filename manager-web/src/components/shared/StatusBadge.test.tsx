import { describe, it, expect } from "vitest";
import React from "react";
import { render, screen } from "@testing-library/react";
import { StatusBadge } from "./StatusBadge.js";

describe("StatusBadge", () => {
  it("默认渲染：4 状态都包含色点 + 文字 + 状态动效 class", () => {
    const states = ["STOPPED", "STARTING", "RUNNING", "STOPPING"] as const;
    states.forEach((state) => {
      const { unmount } = render(<StatusBadge state={state} />);
      const badge = screen.getByTestId("status-badge");
      expect(badge.getAttribute("data-state")).toBe(state);
      expect(badge.textContent).toContain(
        state === "STOPPED"
          ? "已停止"
          : state === "STARTING"
            ? "启动中"
            : state === "RUNNING"
              ? "运行中"
              : "停止中",
      );
      unmount();
    });
  });

  it("RUNNING 时圆点带 animate-pulse class", () => {
    render(<StatusBadge state="RUNNING" />);
    const badge = screen.getByTestId("status-badge");
    const dot = badge.querySelector("span:first-child");
    expect(dot?.className).toContain("animate-pulse");
  });

  it("STOPPED / STARTING / STOPPING 圆点无 animate-pulse class", () => {
    const states = ["STOPPED", "STARTING", "STOPPING"] as const;
    states.forEach((state) => {
      const { unmount } = render(<StatusBadge state={state} />);
      const badge = screen.getByTestId("status-badge");
      const dot = badge.querySelector("span:first-child");
      expect(dot?.className).not.toContain("animate-pulse");
      unmount();
    });
  });

  it("STARTING / STOPPING 文字部分带 animate-spin 旋转环", () => {
    const states = ["STARTING", "STOPPING"] as const;
    states.forEach((state) => {
      const { unmount } = render(<StatusBadge state={state} />);
      const badge = screen.getByTestId("status-badge");
      const spin = badge.querySelector(".animate-spin");
      expect(spin).toBeTruthy();
      unmount();
    });
  });

  it("STOPPED / RUNNING 文字部分无 animate-spin", () => {
    const states = ["STOPPED", "RUNNING"] as const;
    states.forEach((state) => {
      const { unmount } = render(<StatusBadge state={state} />);
      const badge = screen.getByTestId("status-badge");
      const spin = badge.querySelector(".animate-spin");
      expect(spin).toBeNull();
      unmount();
    });
  });

  it("showLabel=false 仅渲染圆点 + 不显示文字", () => {
    render(<StatusBadge state="RUNNING" showLabel={false} />);
    const badge = screen.getByTestId("status-badge");
    expect(badge.textContent).toBe("");
    const dot = badge.querySelector("span:first-child");
    expect(dot?.className).toContain("animate-pulse");
  });

  it("size=sm 圆点尺寸档（h-2 w-2）", () => {
    render(<StatusBadge state="RUNNING" size="sm" />);
    const badge = screen.getByTestId("status-badge");
    const dot = badge.querySelector("span:first-child");
    expect(dot?.className).toContain("h-2 w-2");
  });

  it("size=md 圆点尺寸档（h-2.5 w-2.5）", () => {
    render(<StatusBadge state="RUNNING" size="md" />);
    const badge = screen.getByTestId("status-badge");
    const dot = badge.querySelector("span:first-child");
    expect(dot?.className).toContain("h-2.5 w-2.5");
  });

  it("自定义 color 覆盖 stateColor 默认", () => {
    render(<StatusBadge state="RUNNING" color="#FF00FF" />);
    const badge = screen.getByTestId("status-badge");
    const dot = badge.querySelector("span:first-child") as HTMLElement;
    expect(dot.style.backgroundColor).toBe("rgb(255, 0, 255)");
  });

  it("自定义 label 覆盖中文字典", () => {
    render(<StatusBadge state="STOPPED" label="已停服" />);
    expect(screen.getByText("已停服")).toBeTruthy();
  });

  it("未知 state 回落默认字典（兜底）", () => {
    render(<StatusBadge state="UNKNOWN_STATE" />);
    const badge = screen.getByTestId("status-badge");
    expect(badge.textContent).toContain("UNKNOWN_STATE");
  });

  it("颜色映射：RUNNING emerald / STARTING amber / STOPPING amber / STOPPED slate", () => {
    const expected: Array<[string, string]> = [
      ["RUNNING", "rgb(34, 197, 94)"],
      ["STARTING", "rgb(245, 158, 11)"],
      ["STOPPING", "rgb(245, 158, 11)"],
      ["STOPPED", "rgb(100, 116, 139)"],
    ];
    expected.forEach(([state, color]) => {
      const { unmount } = render(<StatusBadge state={state} />);
      const badge = screen.getByTestId("status-badge");
      const dot = badge.querySelector("span:first-child") as HTMLElement;
      expect(dot.style.backgroundColor).toBe(color);
      unmount();
    });
  });
});
