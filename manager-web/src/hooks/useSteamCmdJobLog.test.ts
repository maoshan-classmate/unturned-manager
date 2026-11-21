import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useSteamCmdJobLog } from "./useSteamCmdJobLog.js";
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
    subscribe: (
      eventType: string,
      handler: (msg: Record<string, unknown>) => void,
    ) => {
      subscribeCalls.push({ eventType, handler });
      return unsubscribeMock;
    },
    send: vi.fn(),
    request: vi.fn(),
    connected: true,
  }),
}));

const JOB_ID = "steamcmd-install-/opt/unturned";

/** 构造历史输出响应 */
function makeLogResponse(
  lines: Array<{ seq: number; text: string }> = [],
  overrides: Record<string, unknown> = {},
) {
  return {
    data: {
      data: {
        jobId: JOB_ID,
        lines,
        finished: false,
        startedAt: "2026-11-21T00:00:00.000Z",
        ...overrides,
      },
    },
  };
}

/** 取订阅处理器 */
function getHandler() {
  const call = subscribeCalls.find((c) => c.eventType === "steamcmd_progress");
  return call?.handler;
}

describe("useSteamCmdJobLog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    subscribeCalls.length = 0;
  });

  it("挂载时按任务标识拉取历史输出", async () => {
    mockedGet.mockResolvedValueOnce(
      makeLogResponse([{ seq: 0, text: "正在下载 Unturned 服务端…" }]),
    );

    const { result } = renderHook(() => useSteamCmdJobLog([JOB_ID]));

    await act(async () => {
      await Promise.resolve();
    });

    expect(mockedGet).toHaveBeenCalledWith("/steamcmd/jobs/log", {
      params: { jobId: JOB_ID },
    });
    expect(result.current.lines).toEqual(["正在下载 Unturned 服务端…"]);
  });

  it("订阅任务进度事件并逐行追加输出", async () => {
    mockedGet.mockResolvedValueOnce(makeLogResponse([]));

    const { result } = renderHook(() => useSteamCmdJobLog([JOB_ID]));

    await act(async () => {
      await Promise.resolve();
    });

    const handler = getHandler();
    expect(handler).toBeDefined();

    await act(async () => {
      handler?.({
        jobId: JOB_ID,
        stage: "downloading",
        percent: 42,
        line: "Downloading app 1110390",
        lineSeq: 0,
      });
    });

    expect(result.current.lines).toEqual(["Downloading app 1110390"]);
    expect(result.current.stage).toBe("downloading");
    expect(result.current.percent).toBe(42);

    await act(async () => {
      handler?.({
        jobId: JOB_ID,
        stage: "downloading",
        percent: 80,
        line: "Downloading depot",
        lineSeq: 1,
      });
    });

    expect(result.current.lines).toEqual([
      "Downloading app 1110390",
      "Downloading depot",
    ]);
  });

  it("过滤其他任务的事件", async () => {
    mockedGet.mockResolvedValueOnce(makeLogResponse([]));

    const { result } = renderHook(() => useSteamCmdJobLog([JOB_ID]));

    await act(async () => {
      await Promise.resolve();
    });

    const handler = getHandler();

    await act(async () => {
      handler?.({
        jobId: "steamcmd-reinstall-/opt/steamcmd",
        stage: "downloading",
        line: "别的任务的输出",
        lineSeq: 0,
      });
    });

    expect(result.current.lines).toEqual([]);
  });

  it("同一序号的行不重复追加", async () => {
    mockedGet.mockResolvedValueOnce(
      makeLogResponse([{ seq: 0, text: "第一行" }]),
    );

    const { result } = renderHook(() => useSteamCmdJobLog([JOB_ID]));

    await act(async () => {
      await Promise.resolve();
    });

    const handler = getHandler();

    await act(async () => {
      handler?.({
        jobId: JOB_ID,
        stage: "downloading",
        line: "第一行",
        lineSeq: 0,
      });
    });

    expect(result.current.lines).toEqual(["第一行"]);
  });

  it("任务结束或失败时标记为已结束", async () => {
    mockedGet.mockResolvedValueOnce(makeLogResponse([]));

    const { result } = renderHook(() => useSteamCmdJobLog([JOB_ID]));

    await act(async () => {
      await Promise.resolve();
    });

    const handler = getHandler();

    await act(async () => {
      handler?.({ jobId: JOB_ID, stage: "failed", errorMessage: "下载失败" });
    });

    expect(result.current.finished).toBe(true);
    expect(result.current.stage).toBe("failed");
    expect(result.current.errorMessage).toBe("下载失败");
  });

  it("清空输出后保留任务状态", async () => {
    mockedGet.mockResolvedValueOnce(
      makeLogResponse([{ seq: 0, text: "第一行" }]),
    );

    const { result } = renderHook(() => useSteamCmdJobLog([JOB_ID]));

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.lines).toHaveLength(1);

    await act(async () => {
      result.current.clear();
    });

    expect(result.current.lines).toEqual([]);
  });

  it("没有任务标识时不拉取历史", async () => {
    const { result } = renderHook(() => useSteamCmdJobLog([]));

    await act(async () => {
      await Promise.resolve();
    });

    expect(mockedGet).not.toHaveBeenCalled();
    expect(result.current.lines).toEqual([]);
  });
});
