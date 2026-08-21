import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen } from "@testing-library/react";
import { SystemMonitorCard } from "./SystemMonitorCard.js";

vi.mock("../../hooks/useMetrics.js", () => ({
  useMetrics: vi.fn(),
}));

import { useMetrics } from "../../hooks/useMetrics.js";
const mockedUseMetrics = vi.mocked(useMetrics);

function makeData(
  overrides: Partial<NonNullable<ReturnType<typeof useMetrics>["data"]>["current"]> = {},
) {
  return {
    serverId: "MyServer",
    samples: [],
    current: {
      cpuPercent: 42,
      memUsedMB: 4096,
      memTotalMB: 16384,
      diskUsedBytes: 140 * 1024 ** 3,
      diskTotalBytes: 250 * 1024 ** 3,
      networkRxBytes: 3000,
      networkTxBytes: 2000,
      networkRxRateBps: null,
      networkTxRateBps: null,
      ...overrides,
    },
  };
}

describe("SystemMonitorCard — 2×2 网格", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("正常渲染：4 张指标卡（CPU/内存/磁盘/网络）", () => {
    mockedUseMetrics.mockReturnValue({
      data: makeData(),
      loading: false,
      error: null,
      refresh: vi.fn(),
    });

    render(<SystemMonitorCard serverId="MyServer" />);

    expect(screen.getByTestId("system-monitor-card")).toBeTruthy();
    expect(screen.getByText("CPU")).toBeTruthy();
    expect(screen.getByText("内存")).toBeTruthy();
    expect(screen.getByText("磁盘")).toBeTruthy();
    expect(screen.getByText("网络")).toBeTruthy();
  });

  it("CPU 百分比 = 当前 cpuPercent", () => {
    mockedUseMetrics.mockReturnValue({
      data: makeData({ cpuPercent: 73.5 }),
      loading: false,
      error: null,
      refresh: vi.fn(),
    });

    render(<SystemMonitorCard serverId="MyServer" />);
    // 第一个 metric-percent 是 CPU
    const percents = screen.getAllByTestId("metric-percent");
    expect(percents[0]?.textContent).toContain("73.5");
  });

  it("内存百分比 = memUsedMB / memTotalMB × 100", () => {
    mockedUseMetrics.mockReturnValue({
      data: makeData({ memUsedMB: 8192, memTotalMB: 16384 }),
      loading: false,
      error: null,
      refresh: vi.fn(),
    });

    render(<SystemMonitorCard serverId="MyServer" />);
    const percents = screen.getAllByTestId("metric-percent");
    // 内存百分比应该是 50.0（8192 / 16384 * 100）
    const memText = percents.find((el) => el.textContent?.includes("50.0"));
    expect(memText).toBeTruthy();
  });

  it("磁盘百分比 = diskUsedBytes / diskTotalBytes × 100", () => {
    mockedUseMetrics.mockReturnValue({
      data: makeData({
        diskUsedBytes: 125 * 1024 ** 3,
        diskTotalBytes: 250 * 1024 ** 3,
      }),
      loading: false,
      error: null,
      refresh: vi.fn(),
    });

    render(<SystemMonitorCard serverId="MyServer" />);
    const percents = screen.getAllByTestId("metric-percent");
    const diskText = percents.find((el) => el.textContent?.includes("50.0"));
    expect(diskText).toBeTruthy();
  });

  it("网络行不显示百分比，显示 ↓ / ↑ 速率文本", () => {
    mockedUseMetrics.mockReturnValue({
      data: makeData({
        networkRxRateBps: 1024 * 12, // 12 KB/s
        networkTxRateBps: 1024 * 3, // 3 KB/s
      }),
      loading: false,
      error: null,
      refresh: vi.fn(),
    });

    render(<SystemMonitorCard serverId="MyServer" />);
    expect(screen.getByText(/↓ 12\.0 KB\/s · ↑ 3\.0 KB\/s/)).toBeTruthy();
  });

  it("网络首次采样（速率 null）显示 — 占位", () => {
    mockedUseMetrics.mockReturnValue({
      data: makeData({
        networkRxRateBps: null,
        networkTxRateBps: null,
      }),
      loading: false,
      error: null,
      refresh: vi.fn(),
    });

    render(<SystemMonitorCard serverId="MyServer" />);
    expect(screen.getByText(/↓ — · ↑ —/)).toBeTruthy();
  });

  it("磁盘字段缺失（null）时磁盘卡显示 — 占位", () => {
    mockedUseMetrics.mockReturnValue({
      data: makeData({
        diskUsedBytes: null,
        diskTotalBytes: null,
      }),
      loading: false,
      error: null,
      refresh: vi.fn(),
    });

    render(<SystemMonitorCard serverId="MyServer" />);
    const percents = screen.getAllByTestId("metric-percent");
    // 磁盘不应有 percent（找不到含具体数字的），CPU/内存正常
    expect(percents.length).toBe(2); // 只有 CPU/内存
  });

  it("error 态：占满卡片显示错误文案", () => {
    mockedUseMetrics.mockReturnValue({
      data: null,
      loading: false,
      error: "后端连接失败",
      refresh: vi.fn(),
    });

    render(<SystemMonitorCard serverId="MyServer" />);
    expect(screen.getByTestId("system-monitor-error")).toBeTruthy();
    expect(screen.getByText("后端连接失败")).toBeTruthy();
  });
});