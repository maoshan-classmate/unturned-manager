import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useSystemInfo } from "./useSystemInfo.js";
import { apiClient } from "../api/client.js";
import type { SystemInfo } from "@unturned-manager/shared";

vi.mock("../api/client.js", () => ({
  apiClient: {
    get: vi.fn(),
  },
}));

const mockedGet = vi.mocked(apiClient.get);

function makeInfo(overrides: Partial<SystemInfo> = {}): SystemInfo {
  return {
    hostname: "host-01",
    distro: "Debian GNU/Linux",
    release: "12",
    arch: "x64",
    kernel: "6.1.0-13-amd64",
    platform: "linux",
    cpu: { brand: "Intel Xeon", physicalCores: 4, cores: 8, speed: 2.6 },
    memTotalMB: 16384,
    diskTotalBytes: 250 * 1024 ** 3,
    diskUsedBytes: 140 * 1024 ** 3,
    gamePort: null,
    queryPort: null,
    ...overrides,
  };
}

function makeResponse(info: SystemInfo): { data: { data: SystemInfo } } {
  return { data: { data: info } };
}

describe("useSystemInfo", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("无 serverId 参数：调用 /system/info（无 query 参数）", async () => {
    mockedGet.mockResolvedValue(makeResponse(makeInfo()));

    const { result } = renderHook(() => useSystemInfo());

    await act(async () => {
      await Promise.resolve();
    });

    expect(mockedGet).toHaveBeenLastCalledWith("/system/info", {
      params: {},
    });
    expect(result.current.data?.hostname).toBe("host-01");
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("传入 serverId：调用带 serverId query 参数", async () => {
    mockedGet.mockResolvedValue(
      makeResponse(makeInfo({ gamePort: 27015, queryPort: 27016 })),
    );

    const { result } = renderHook(() => useSystemInfo("MyServer"));

    await act(async () => {
      await Promise.resolve();
    });

    expect(mockedGet).toHaveBeenLastCalledWith("/system/info", {
      params: { serverId: "MyServer" },
    });
    expect(result.current.data?.gamePort).toBe(27015);
    expect(result.current.data?.queryPort).toBe(27016);
  });

  it("请求失败：error 字段填 message", async () => {
    mockedGet.mockRejectedValueOnce(new Error("server error"));

    const { result } = renderHook(() => useSystemInfo());

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.error).toBe("server error");
    expect(result.current.loading).toBe(false);
  });

  it("refresh 手动重拉：触发新请求且 error 清空", async () => {
    mockedGet.mockRejectedValueOnce(new Error("first failed"));
    mockedGet.mockResolvedValueOnce(makeResponse(makeInfo({ hostname: "host-B" })));

    const { result } = renderHook(() => useSystemInfo());

    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.error).toBe("first failed");

    await act(async () => {
      await result.current.refresh();
      await Promise.resolve();
    });

    expect(result.current.error).toBeNull();
    expect(result.current.data?.hostname).toBe("host-B");
  });
});