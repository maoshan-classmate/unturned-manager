import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useSessionManager } from "./useSessionManager.js";
import { apiClient } from "../api/client.js";

// ─── mock apiClient.get ───
vi.mock("../api/client.js", () => ({
  apiClient: {
    get: vi.fn(),
  },
}));

const mockedGet = vi.mocked(apiClient.get);

describe("useSessionManager", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("挂载时拉一次 /sessions，初始 loading=true → false", async () => {
    mockedGet.mockResolvedValueOnce({
      data: { data: { active: [], saved: [] } },
    });

    const { result } = renderHook(() => useSessionManager());

    expect(result.current.loading).toBe(true);

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(mockedGet).toHaveBeenCalledTimes(1);
    expect(mockedGet).toHaveBeenCalledWith("/sessions");
    expect(result.current.active).toEqual([]);
    expect(result.current.saved).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  it("正常返回：active + saved 分别填充", async () => {
    const activeSession = {
      id: "alpha" as never,
      name: "终端 - alpha",
      workingDirectory: "/opt/unturned",
      createdAt: "2026-08-11T00:00:00.000Z",
      lastActivity: "2026-08-11T00:00:00.000Z",
      isActive: true,
    };
    const savedSession = {
      id: "beta" as never,
      name: "终端 - beta",
      workingDirectory: "/opt/unturned",
      createdAt: "2026-08-10T00:00:00.000Z",
      lastActivity: "2026-08-10T00:00:00.000Z",
      isActive: false,
    };

    mockedGet.mockResolvedValueOnce({
      data: { data: { active: [activeSession], saved: [savedSession] } },
    });

    const { result } = renderHook(() => useSessionManager());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.active).toEqual([activeSession]);
    expect(result.current.saved).toEqual([savedSession]);
    expect(result.current.error).toBeNull();
  });

  it("请求失败：error 字段填 message", async () => {
    mockedGet.mockRejectedValueOnce(new Error("network down"));

    const { result } = renderHook(() => useSessionManager());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBe("network down");
    expect(result.current.active).toEqual([]);
    expect(result.current.saved).toEqual([]);
  });

  it("refresh：手动触发可重新拉取", async () => {
    mockedGet.mockResolvedValueOnce({
      data: { data: { active: [], saved: [] } },
    });

    const { result } = renderHook(() => useSessionManager());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(mockedGet).toHaveBeenCalledTimes(1);

    mockedGet.mockResolvedValueOnce({
      data: {
        data: {
          active: [],
          saved: [
            {
              id: "gamma" as never,
              name: "终端 - gamma",
              workingDirectory: "/opt/unturned",
              createdAt: "2026-08-11T01:00:00.000Z",
              lastActivity: "2026-08-11T01:00:00.000Z",
              isActive: false,
            },
          ],
        },
      },
    });

    await result.current.refresh();

    await waitFor(() => {
      expect(result.current.saved).toHaveLength(1);
    });
    expect(mockedGet).toHaveBeenCalledTimes(2);
    expect(result.current.saved[0]?.id).toBe("gamma");
  });
});