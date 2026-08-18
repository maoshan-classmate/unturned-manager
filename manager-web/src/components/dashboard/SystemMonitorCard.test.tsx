import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SystemMonitorCard } from "./SystemMonitorCard.js";

vi.mock("@number-flow/react", () => ({
  default: ({ value, className }: { value: number; className?: string }) =>
    React.createElement(
      "span",
      { "data-testid": "number-flow", "data-value": String(value), className },
      String(value),
    ),
}));

vi.mock("../../hooks/useMetrics.js", () => ({
  useMetrics: vi.fn(),
}));

import { useMetrics } from "../../hooks/useMetrics.js";
const mockedUseMetrics = vi.mocked(useMetrics);

interface MockState {
  data: Parameters<typeof SystemMonitorCard>[0] extends { serverId: string }
    ? ReturnType<typeof useMetrics>["data"]
    : never;
  loading: boolean;
  error: string | null;
  window: "1m" | "5m" | "15m";
}

function makeMockData(
  overrides: Partial<{
    cpuPercent: number;
    memUsedMB: number;
    memTotalMB: number;
    window: "1m" | "5m" | "15m";
    sampleCount: number;
  }> = {},
): NonNullable<ReturnType<typeof useMetrics>["data"]> {
  const sampleCount = overrides.sampleCount ?? 4;
  const cpu = overrides.cpuPercent ?? 30;
  const mem = overrides.memUsedMB ?? 1024;
  const memTotal = overrides.memTotalMB ?? 4096;
  return {
    serverId: "MyServer",
    window: overrides.window ?? "5m",
    samples: Array.from({ length: sampleCount }, (_, i) => ({
      timestamp: 1_700_000_000_000 + i * 5_000,
      cpuPercent: cpu,
      memUsedMB: mem,
    })),
    current: {
      cpuPercent: cpu,
      memUsedMB: mem,
      memTotalMB: memTotal,
    },
  };
}

describe("SystemMonitorCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loading 状态显示加载中文案", () => {
    mockedUseMetrics.mockReturnValue({
      data: null,
      loading: true,
      error: null,
      window: "5m",
      setWindow: vi.fn(),
    });

    render(<SystemMonitorCard serverId="MyServer" />);
    expect(screen.getByText("加载中...")).toBeTruthy();
  });

  it("error 状态显示后端/网络错误中文", () => {
    mockedUseMetrics.mockReturnValue({
      data: null,
      loading: false,
      error: "网络错误",
      window: "5m",
      setWindow: vi.fn(),
    });

    render(<SystemMonitorCard serverId="MyServer" />);
    expect(screen.getByText("网络错误")).toBeTruthy();
  });

  it("默认渲染——含卡片标题、时间窗切换、CPU/内存行、底部统计", () => {
    mockedUseMetrics.mockReturnValue({
      data: makeMockData(),
      loading: false,
      error: null,
      window: "5m",
      setWindow: vi.fn(),
    });

    render(<SystemMonitorCard serverId="MyServer" />);
    expect(screen.getByTestId("system-monitor-card")).toBeTruthy();
    expect(screen.getByText("系统资源（多实例）")).toBeTruthy();

    const tabs = ["1m", "5m", "15m"];
    tabs.forEach((w) => {
      expect(screen.getByTestId(`metrics-window-${w}`)).toBeTruthy();
    });

    expect(screen.getAllByText("CPU").length).toBeGreaterThan(0);
    expect(screen.getAllByText("内存").length).toBeGreaterThan(0);
    expect(screen.getByText(/样本数 4 · 时间窗 5m/)).toBeTruthy();
    expect(screen.getByText("网络 — 暂未启用")).toBeTruthy();
  });

  it("NumberFlow 渲染当前 cpuPercent + memUsedMB", () => {
    mockedUseMetrics.mockReturnValue({
      data: makeMockData({ cpuPercent: 42.5, memUsedMB: 2048 }),
      loading: false,
      error: null,
      window: "5m",
      setWindow: vi.fn(),
    });

    render(<SystemMonitorCard serverId="MyServer" />);
    const flows = screen.getAllByTestId("number-flow");
    const values = flows.map((f) => f.getAttribute("data-value"));
    expect(values).toContain("42.5");
    expect(values).toContain("2048");
  });

  it("CPU > 80% 切 amber 颜色（text-amber-500）；≤80% 用 emerald", () => {
    mockedUseMetrics.mockReturnValue({
      data: makeMockData({ cpuPercent: 90 }),
      loading: false,
      error: null,
      window: "5m",
      setWindow: vi.fn(),
    });

    render(<SystemMonitorCard serverId="MyServer" />);
    const cpuFlow = screen
      .getAllByTestId("number-flow")
      .find((f) => f.getAttribute("data-value") === "90");
    expect(cpuFlow?.className).toContain("text-amber-500");

    mockedUseMetrics.mockReturnValue({
      data: makeMockData({ cpuPercent: 50 }),
      loading: false,
      error: null,
      window: "5m",
      setWindow: vi.fn(),
    });

    const { rerender } = render(<SystemMonitorCard serverId="MyServer" />);
    rerender(<SystemMonitorCard serverId="MyServer" />);
    const cpuFlow2 = screen
      .getAllByTestId("number-flow")
      .find((f) => f.getAttribute("data-value") === "50");
    expect(cpuFlow2?.className).toContain("text-emerald-500");
  });

  it("sparkline 在 ≥2 样本时渲染 <polyline>；1 样本时降级为空占位", () => {
    mockedUseMetrics.mockReturnValue({
      data: makeMockData({ sampleCount: 3 }),
      loading: false,
      error: null,
      window: "5m",
      setWindow: vi.fn(),
    });

    const { rerender } = render(<SystemMonitorCard serverId="MyServer" />);
    expect(screen.getAllByTestId("sparkline").length).toBe(2);

    mockedUseMetrics.mockReturnValue({
      data: makeMockData({ sampleCount: 1 }),
      loading: false,
      error: null,
      window: "5m",
      setWindow: vi.fn(),
    });

    rerender(<SystemMonitorCard serverId="MyServer" />);
    expect(screen.queryAllByTestId("sparkline").length).toBe(0);
    expect(screen.getAllByTestId("sparkline-empty").length).toBe(2);
  });

  it("点击时间窗切换按钮 → 调用 hook 的 setWindow(win)", async () => {
    const setWindow = vi.fn();
    mockedUseMetrics.mockReturnValue({
      data: makeMockData({ window: "5m" }),
      loading: false,
      error: null,
      window: "5m",
      setWindow,
    });

    render(<SystemMonitorCard serverId="MyServer" />);

    fireEvent.click(screen.getByTestId("metrics-window-1m"));
    expect(setWindow).toHaveBeenCalledWith("1m");

    fireEvent.click(screen.getByTestId("metrics-window-15m"));
    expect(setWindow).toHaveBeenCalledWith("15m");

    expect(setWindow).toHaveBeenCalledTimes(2);
  });

  it("data 未返回时 CPU/内存显示 — 占位", () => {
    mockedUseMetrics.mockReturnValue({
      data: null,
      loading: false,
      error: null,
      window: "5m",
      setWindow: vi.fn(),
    });

    render(<SystemMonitorCard serverId="MyServer" />);
    expect(screen.getByText("系统资源（多实例）")).toBeTruthy();
    expect(screen.queryAllByTestId("number-flow").length).toBe(0);
    const dashes = screen.getAllByText("—");
    expect(dashes.length).toBeGreaterThanOrEqual(2);
  });
});