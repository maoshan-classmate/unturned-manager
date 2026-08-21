import { describe, it, expect, vi, beforeEach } from "vitest";
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
    cpuPercent: number;
    memUsedMB: number;
    memTotalMB: number;
    diskUsedBytes: number | null;
    diskTotalBytes: number | null;
    networkRxBytes: number | null;
    networkTxBytes: number | null;
    networkRxRateBps: number | null;
    networkTxRateBps: number | null;
    sampleCount: number;
  }> = {},
) {
  const sampleCount = overrides.sampleCount ?? 3;
  const samples = Array.from({ length: sampleCount }, (_, i) => ({
    timestamp: 1_700_000_000_000 + i * 5_000,
    cpuPercent: overrides.cpuPercent ?? 30,
    memUsedMB: overrides.memUsedMB ?? 1024,
    networkRxBytes: overrides.networkRxBytes ?? null,
    networkTxBytes: overrides.networkTxBytes ?? null,
    networkRxRateBps: overrides.networkRxRateBps ?? null,
    networkTxRateBps: overrides.networkTxRateBps ?? null,
  }));
  return {
    data: {
      data: {
        serverId: overrides.serverId ?? "MyServer",
        samples,
        current: {
          cpuPercent: overrides.cpuPercent ?? 30,
          memUsedMB: overrides.memUsedMB ?? 1024,
          memTotalMB: overrides.memTotalMB ?? 4096,
          diskUsedBytes: overrides.diskUsedBytes ?? null,
          diskTotalBytes: overrides.diskTotalBytes ?? null,
          networkRxBytes: overrides.networkRxBytes ?? null,
          networkTxBytes: overrides.networkTxBytes ?? null,
          networkRxRateBps: overrides.networkRxRateBps ?? null,
          networkTxRateBps: overrides.networkTxRateBps ?? null,
        },
      },
    },
  };
}

describe("useMetrics", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("挂载时拉一次 /system/metrics 带 serverId", async () => {
    mockedGet.mockResolvedValue(makeResponse({ cpuPercent: 42 }));

    const { result } = renderHook(() => useMetrics("MyServer"));

    await act(async () => {
      await Promise.resolve();
    });

    expect(mockedGet).toHaveBeenCalled();
    expect(mockedGet).toHaveBeenLastCalledWith("/system/metrics", {
      params: { serverId: "MyServer" },
    });
    expect(result.current.data?.serverId).toBe("MyServer");
    expect(result.current.data?.current.cpuPercent).toBe(42);
    expect(result.current.error).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it("响应包含磁盘字段：diskUsedBytes / diskTotalBytes 透传", async () => {
    mockedGet.mockResolvedValue(
      makeResponse({
        diskUsedBytes: 140 * 1024 ** 3,
        diskTotalBytes: 250 * 1024 ** 3,
      }),
    );

    const { result } = renderHook(() => useMetrics("MyServer"));

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.data?.current.diskUsedBytes).toBe(140 * 1024 ** 3);
    expect(result.current.data?.current.diskTotalBytes).toBe(250 * 1024 ** 3);
  });

  it("响应包含网络字段：bytes + rate 透传（首次速率为 null）", async () => {
    mockedGet.mockResolvedValue(
      makeResponse({
        networkRxBytes: 3000,
        networkTxBytes: 2000,
        networkRxRateBps: null,
        networkTxRateBps: null,
      }),
    );

    const { result } = renderHook(() => useMetrics("MyServer"));

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.data?.current.networkRxBytes).toBe(3000);
    expect(result.current.data?.current.networkTxBytes).toBe(2000);
    expect(result.current.data?.current.networkRxRateBps).toBeNull();
    expect(result.current.data?.current.networkTxRateBps).toBeNull();
  });

  it("第二次起网络速率字段填充差值", async () => {
    mockedGet.mockResolvedValue(
      makeResponse({
        networkRxRateBps: 1000,
        networkTxRateBps: 500,
      }),
    );

    const { result } = renderHook(() => useMetrics("MyServer"));

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.data?.current.networkRxRateBps).toBe(1000);
    expect(result.current.data?.current.networkTxRateBps).toBe(500);
  });

  it("请求失败：error 字段填 message，loading 仍归 false", async () => {
    mockedGet.mockRejectedValueOnce(new Error("network down"));

    const { result } = renderHook(() => useMetrics("MyServer"));

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.error).toBe("network down");
    expect(result.current.loading).toBe(false);
  });

  it("refresh 手动重拉：触发新请求且 error 清空", async () => {
    mockedGet.mockRejectedValueOnce(new Error("first failed"));
    mockedGet.mockResolvedValueOnce(makeResponse({ cpuPercent: 80 }));

    const { result } = renderHook(() => useMetrics("MyServer"));

    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.error).toBe("first failed");

    await act(async () => {
      await result.current.refresh();
      await Promise.resolve();
    });

    expect(result.current.error).toBeNull();
    expect(result.current.data?.current.cpuPercent).toBe(80);
  });
});