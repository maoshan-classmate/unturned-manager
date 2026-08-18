import { describe, it, expect, vi } from "vitest";
import React from "react";
import { render, screen } from "@testing-library/react";
import { Server } from "lucide-react";

const motionFactory = vi.hoisted(() => {
  const make = (tag: string) => (props: Record<string, unknown>) => {
    const { layoutId, transition, initial, animate, exit, ...rest } = props;
    return React.createElement(tag, rest);
  };
  const AnimatePresence = ({ children }: { children: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children);
  return { motion: { div: make("div"), span: make("span") }, AnimatePresence };
});
vi.mock("motion/react", () => motionFactory);

vi.mock("@number-flow/react", () => ({
  default: ({ value, format, className }: { value: number; format?: { useGrouping?: boolean }; className?: string }) =>
    React.createElement(
      "span",
      {
        "data-testid": "number-flow",
        "data-value": String(value),
        "data-grouping": format?.useGrouping ? "true" : "false",
        className,
      },
      String(value),
    ),
}));

import { StatCard } from "./StatCard.js";

function isInDocument(el: Element | null): boolean {
  return el !== null && document.body.contains(el);
}

describe("StatCard — 三件套 + 数字滚动", () => {
  it("默认渲染——无状态动效、无数字滚动", () => {
    render(<StatCard icon={Server} label="状态" value={42} />);
    expect(screen.getByTestId("stat-card-neutral")).toBeTruthy();
    expect(screen.queryByTestId(/stat-indicator-/)).toBeNull();
    expect(screen.queryByTestId("number-flow")).toBeNull();
  });

  it("enableStatusIndicator=true 渲染左侧 8px 圆点（online 色 = emerald）", () => {
    render(
      <StatCard
        icon={Server}
        label="服务器状态"
        value="运行中"
        status="online"
        enableStatusIndicator
      />,
    );
    const dot = screen.getByTestId("stat-indicator-online");
    expect(isInDocument(dot)).toBe(true);
    expect(dot.className).toContain("rounded-full");
    expect(dot.className).toContain("bg-emerald-500");
  });

  it("status=transitioning 渲染 amber 色点", () => {
    render(
      <StatCard
        icon={Server}
        label="状态"
        value="启动中"
        status="transitioning"
        enableStatusIndicator
      />,
    );
    const dot = screen.getByTestId("stat-indicator-transitioning");
    expect(dot.className).toContain("bg-amber-500");
  });

  it("status=danger 渲染红色色点（无动效——静默）", () => {
    render(
      <StatCard
        icon={Server}
        label="状态"
        value="异常"
        status="danger"
        enableStatusIndicator
      />,
    );
    const dot = screen.getByTestId("stat-indicator-danger");
    expect(dot.className).toContain("bg-red-500");
  });

  it("enableNumberTicker + value 为 number 时渲染 NumberFlow（含 tabular-nums）", () => {
    render(
      <StatCard
        icon={Server}
        label="Mod 数"
        value={1234}
        enableNumberTicker
      />,
    );
    const flow = screen.getByTestId("number-flow");
    expect(isInDocument(flow)).toBe(true);
    expect(flow.getAttribute("data-value")).toBe("1234");
    expect(flow.getAttribute("data-grouping")).toBe("true");
    expect(flow.className).toContain("tabular-nums");
  });

  it("enableNumberTicker 但 value 是字符串时走 span 分支（不渲染 NumberFlow）", () => {
    render(
      <StatCard
        icon={Server}
        label="状态"
        value="运行中"
        enableNumberTicker
      />,
    );
    expect(screen.queryByTestId("number-flow")).toBeNull();
  });

  it("label / subtext 正常渲染", () => {
    render(
      <StatCard
        icon={Server}
        label="在线玩家"
        value={42}
        subtext="人"
      />,
    );
    expect(screen.getByText("在线玩家")).toBeTruthy();
    expect(screen.getByText("人")).toBeTruthy();
  });

  it("样式用 Tailwind utility 而非 inline hex（铁律 ③ 清理）", () => {
    render(<StatCard icon={Server} label="x" value={1} />);
    const card = screen.getByTestId("stat-card-neutral");
    expect(card.className).toContain("bg-slate-800");
    expect(card.className).toContain("border-slate-700");
    expect((card as HTMLElement).style.backgroundColor).toBe("");
    expect((card as HTMLElement).style.borderColor).toBe("");
  });

  it("data-testid 携带 status 值便于测试定位", () => {
    const { rerender } = render(
      <StatCard icon={Server} label="x" value={1} status="online" />,
    );
    expect(screen.getByTestId("stat-card-online")).toBeTruthy();

    rerender(<StatCard icon={Server} label="x" value={1} status="danger" />);
    expect(screen.getByTestId("stat-card-danger")).toBeTruthy();
  });
});