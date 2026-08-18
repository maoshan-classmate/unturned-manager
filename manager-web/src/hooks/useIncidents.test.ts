import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useIncidents } from "./useIncidents.js";
import { apiClient } from "../api/client.js";

vi.mock("../api/client.js", () => ({
  apiClient: {
    get: vi.fn(),
  },
}));

const mockedGet = vi.mocked(apiClient.get);

interface SubscribeCall {
  eventType: string;
  handler: (msg: Record<string, unknown>) => void;
}
const subscribeCalls: SubscribeCall[] = [];
const unsubscribeMock = vi.fn();

vi.mock("../contexts/WebSocketContext.js", () => ({
  useWebSocket: () => ({
    subscribe: (eventType: string, handler: (msg: Record<string, unknown>) => void) => {
      subscribeCalls.push({ eventType, handler });
      return unsubscribeMock;
    },
    send: vi.fn(),
    request: vi.fn(),
    connected: true,
  }),
}));

function makeResponse(incidents: Array<{
  id: string;
  type: string;
  severity: string;
  message: string;
  timestamp: number;
}> = []) {
  return {
    data: {
      data: {
        serverId: "MyServer",
        total: incidents.length,
        incidents,
      },
    },
  };
}

function makeIncident(overrides: Partial<{
  id: string;
  type: string;
  severity: string;
  message: string;
  timestamp: number;
}> = {}) {
  return {
    id: overrides.id ?? "inc-1",
    serverId: "MyServer",
    type: overrides.type ?? "start",
    severity: overrides.severity ?? "info",
    message: overrides.message ?? "启动请求已发起",
    timestamp: overrides.timestamp ?? 1_700_000_000_000,
  };
}

describe("useIncidents", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    subscribeCalls.length = 0;
  });

  it("挂载时拉历史 /servers/:id/incidents?limit=50", async () => {
    mockedGet.mockResolvedValueOnce(
      makeResponse([makeIncident({ id: "a" }), makeIncident({ id: "b" })]),
    );

    const { result } = renderHook(() => useIncidents("MyServer"));

    await act(async () => {
      await Promise.resolve();
    });

    expect(mockedGet).toHaveBeenCalledTimes(1);
    expect(mockedGet).toHaveBeenCalledWith("/servers/MyServer/incidents", {
      params: { limit: 50 },
    });
    expect(result.current.data).toHaveLength(2);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("订阅 incident_created 事件 + 追加新事件（前置去重）", async () => {
    mockedGet.mockResolvedValueOnce(
      makeResponse([makeIncident({ id: "existing" })]),
    );

    const { result } = renderHook(() => useIncidents("MyServer"));

    await act(async () => {
      await Promise.resolve();
    });

    expect(subscribeCalls.length).toBeGreaterThanOrEqual(1);
    const call = subscribeCalls.find((c) => c.eventType === "incident_created");
    expect(call).toBeDefined();
    const handler = call?.handler;
    expect(handler).toBeDefined();

    await act(async () => {
      handler?.({
        serverId: "MyServer",
        incident: makeIncident({ id: "new", message: "新事件" }),
      });
    });

    expect(result.current.data).toHaveLength(2);
    expect(result.current.data[0]?.id).toBe("new");

    // 重复 id 被去重过滤——不追加
    await act(async () => {
      handler?.({
        serverId: "MyServer",
        incident: makeIncident({ id: "new", message: "重复" }),
      });
    });

    expect(result.current.data).toHaveLength(2);
  });

  it("过滤其他 serverId 的事件", async () => {
    mockedGet.mockResolvedValueOnce(makeResponse([]));

    const { result } = renderHook(() => useIncidents("MyServer"));

    await act(async () => {
      await Promise.resolve();
    });

    const handler = subscribeCalls[0]?.handler;

    await act(async () => {
      handler?.({
        serverId: "OtherServer",
        incident: makeIncident({ id: "x" }),
      });
    });

    expect(result.current.data).toHaveLength(0);
  });

  it("请求失败：error 字段填 message", async () => {
    mockedGet.mockRejectedValueOnce(new Error("network down"));

    const { result } = renderHook(() => useIncidents("MyServer"));

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.error).toBe("network down");
    expect(result.current.data).toEqual([]);
  });

  it("空 serverId 时跳过拉取和订阅", async () => {
    const { result } = renderHook(() => useIncidents(""));

    await act(async () => {
      await Promise.resolve();
    });

    expect(mockedGet).not.toHaveBeenCalled();
    expect(subscribeCalls).toHaveLength(0);
    expect(result.current.data).toEqual([]);
  });

  it("refresh 手动刷新重新拉取", async () => {
    mockedGet.mockResolvedValueOnce(makeResponse([]));

    const { result } = renderHook(() => useIncidents("MyServer"));

    await act(async () => {
      await Promise.resolve();
    });

    expect(mockedGet).toHaveBeenCalledTimes(1);

    mockedGet.mockResolvedValueOnce(
      makeResponse([makeIncident({ id: "fresh" })]),
    );

    await act(async () => {
      await result.current.refresh();
    });

    expect(mockedGet).toHaveBeenCalledTimes(2);
    expect(result.current.data).toHaveLength(1);
    expect(result.current.data[0]?.id).toBe("fresh");
  });
});
