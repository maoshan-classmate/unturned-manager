import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useMetrics } from "./useMetrics.js";
import { apiClient } from "../api/client.js";

vi.mock("../api/client.js", () => ({
  apiClient: {
    get: vi.fn(),
  },
}));

const mockedGet = vi.mocked(apiClient.get);

function makeResponse(
  overrides: Partial<{
    serverId: string;
    window: "1m" | "5m" | "15m";
    cpuPercent: number;
    memUsedMB: number;
    memTotalMB: number;
    sampleCount: number;
  }> = {},
) {
  const sampleCount = overrides.sampleCount ?? 3;
  const samples = Array.from({ length: sampleCount }, (_, i) => ({
    timestamp: 1_700_000_000_000 + i * 5_000,
    cpuPercent: overrides.cpuPercent ?? 30,
    memUsedMB: overrides.memUsedMB ?? 1024,
  }));
  return {
    data: {
      data: {
        serverId: overrides.serverId ?? "MyServer",
        window: overrides.window ?? "5m",
        samples,
        current: {
          cpuPercent: overrides.cpuPercent ?? 30,
          memUsedMB: overrides.memUsedMB ?? 1024,
          memTotalMB: overrides.memTotalMB ?? 4096,
        },
      },
    },
  };
}

describe("useMetrics", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("挂载时拉一次 /system/metrics 带 serverId + 默认 window=5m", async () => {
    mockedGet.mockResolvedValue(makeResponse({ window: "5m" }));

    const { result } = renderHook(() => useMetrics("MyServer"));

    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
    });

    expect(mockedGet).toHaveBeenCalled();
    expect(mockedGet).toHaveBeenLastCalledWith("/system/metrics", {
      params: { serverId: "MyServer", window: "5m" },
    });
    expect(result.current.data?.window).toBe("5m");
    expect(result.current.data?.serverId).toBe("MyServer");
    expect(result.current.error).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it("setWindow 切到 1m 后：state 切到 1m，下次 fetch 带 window=1m", async () => {
    mockedGet.mockResolvedValue(makeResponse({ window: "5m" }));

    const { result } = renderHook(() => useMetrics("MyServer"));

    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
    });

    await act(async () => {
      result.current.setWindow("1m");
      await vi.runOnlyPendingTimersAsync();
    });

    expect(result.current.window).toBe("1m");
    expect(mockedGet).toHaveBeenLastCalledWith("/system/metrics", {
      params: { serverId: "MyServer", window: "1m" },
    });
  });

  it("请求失败：error 字段填 message，data 保留上一次值", async () => {
    mockedGet.mockResolvedValueOnce(makeResponse({ cpuPercent: 42 }));
    mockedGet.mockRejectedValueOnce(new Error("network down"));

    const { result } = renderHook(() => useMetrics("MyServer"));

    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
    });

    await act(async () => {
      result.current.setWindow("15m");
      await vi.runOnlyPendingTimersAsync();
    });

    expect(mockedGet.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(mockedGet).toHaveBeenLastCalledWith("/system/metrics", {
      params: { serverId: "MyServer", window: "15m" },
    });
    expect(result.current.window).toBe("15m");
  });

  it("5s 轮询：定时器触发后再次请求同一 window", async () => {
    mockedGet.mockResolvedValue(makeResponse({ cpuPercent: 50 }));

    const { result } = renderHook(() => useMetrics("MyServer"));

    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
    });

    const initialCalls = mockedGet.mock.calls.length;

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });

    expect(mockedGet.mock.calls.length).toBeGreaterThan(initialCalls);
    expect(mockedGet).toHaveBeenLastCalledWith("/system/metrics", {
      params: { serverId: "MyServer", window: "5m" },
    });
    expect(result.current.data?.current.cpuPercent).toBe(50);
  });
});