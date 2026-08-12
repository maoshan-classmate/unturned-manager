import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { ReactNode } from "react";
import {
  WebSocketProvider,
  useWebSocket,
  type ServerEventMessage,
  type WsRequestResult,
} from "./WebSocketContext.js";

// ─── mock 依赖 ─────────────────────────────────────────
// ensureAccessToken：测试环境无真后端，直接给固定 token
// ★ S5 修复：补 getAccessToken + getAccessTokenExpMs mock——scheduleRefresh 依赖
vi.mock("../api/client.js", () => ({
  ensureAccessToken: vi.fn(async () => "test-token"),
  getAccessToken: vi.fn(() => "test-token"),
  getAccessTokenExpMs: vi.fn(() => Date.now() + 15 * 60 * 1000),
  setAccessToken: vi.fn(),
}));
// useAuth：Provider 只看 isAuthenticated（路径相对本测试文件——同目录模块）
vi.mock("./AuthContext.js", () => ({
  useAuth: () => ({ isAuthenticated: true }),
}));

// ─── Fake WebSocket ────────────────────────────────────
// jsdom 的 WebSocket 不可控（无法手动触发 open/message/close），
// 换成可控 fake：实例入静态数组，测试手动 simulateOpen/Message/Close。
class FakeWebSocket {
  static OPEN = 1;
  static instances: FakeWebSocket[] = [];
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  readyState = 0;
  sent: string[] = [];
  closed = false;
  constructor(public url: string) {
    FakeWebSocket.instances.push(this);
  }
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    this.readyState = 3;
    this.onclose?.();
  }
  // ── 测试辅助 ──
  simulateOpen() {
    this.readyState = 1;
    this.onopen?.();
  }
  simulateMessage(msg: unknown) {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
  simulateClose() {
    this.readyState = 3;
    this.onclose?.();
  }
  /** 最后一帧发送的 JSON（send 可能多帧，取末帧断言） */
  lastSent(): Record<string, unknown> {
    const raw = this.sent[this.sent.length - 1];
    if (!raw) throw new Error("没有发送过任何帧");
    return JSON.parse(raw) as Record<string, unknown>;
  }
}

function lastInstance(): FakeWebSocket {
  const inst = FakeWebSocket.instances[FakeWebSocket.instances.length - 1];
  if (!inst) throw new Error("还没有建立过 WS 连接");
  return inst;
}

function wrapper({ children }: { children: ReactNode }) {
  return <WebSocketProvider>{children}</WebSocketProvider>;
}

/** 渲染 hook 并等到第一条连接 OPEN */
async function renderConnected() {
  const rendered = renderHook(() => useWebSocket(), { wrapper });
  // connect() 是 async（await ensureAccessToken）——flush 微任务让实例创建
  await act(async () => {});
  await act(async () => {
    lastInstance().simulateOpen();
  });
  return rendered;
}

describe("WebSocketContext — 事件订阅总线（ws-wrapper-design §3/§5.2）", () => {
  beforeEach(() => {
    FakeWebSocket.instances = [];
    vi.stubGlobal("WebSocket", FakeWebSocket);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("订阅事件分发：subscribe('console_line') 只收到 console_line", async () => {
    const { result } = await renderConnected();
    const received: ServerEventMessage[] = [];
    act(() => {
      result.current.subscribe("console_line", (msg) => received.push(msg));
    });

    act(() => {
      lastInstance().simulateMessage({
        type: "console_line",
        serverId: "S1",
        line: "hello",
      });
      lastInstance().simulateMessage({ type: "state_change", serverId: "S1" });
    });

    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({ type: "console_line", line: "hello" });
  });

  it("多订阅者隔离：A 订 console_line、B 订 state_change，互不干扰", async () => {
    const { result } = await renderConnected();
    const a: ServerEventMessage[] = [];
    const b: ServerEventMessage[] = [];
    act(() => {
      result.current.subscribe("console_line", (msg) => a.push(msg));
      result.current.subscribe("state_change", (msg) => b.push(msg));
    });

    act(() => {
      lastInstance().simulateMessage({ type: "console_line", line: "x" });
      lastInstance().simulateMessage({
        type: "state_change",
        to: "RUNNING",
      });
    });

    expect(a).toHaveLength(1);
    expect(a[0]?.type).toBe("console_line");
    expect(b).toHaveLength(1);
    expect(b[0]?.type).toBe("state_change");
  });

  it("退订函数：unsubscribe 后不再收到事件", async () => {
    const { result } = await renderConnected();
    const received: ServerEventMessage[] = [];
    let off!: () => void;
    act(() => {
      off = result.current.subscribe("console_line", (msg) =>
        received.push(msg),
      );
    });

    act(() => {
      lastInstance().simulateMessage({ type: "console_line", line: "a" });
      off();
      lastInstance().simulateMessage({ type: "console_line", line: "b" });
    });

    expect(received).toHaveLength(1);
  });

  it("请求-应答匹配：request 发出后收到同 requestId 的 ack → resolve", async () => {
    const { result } = await renderConnected();

    let promise!: Promise<WsRequestResult<{ saved: boolean }>>;
    act(() => {
      promise = result.current.request<{ saved: boolean }>({
        type: "save",
        serverId: "S1",
      });
    });

    // 上行帧应带自动生成的 requestId
    const sent = lastInstance().lastSent();
    expect(sent).toMatchObject({ type: "save", serverId: "S1" });
    expect(typeof sent.requestId).toBe("string");

    act(() => {
      lastInstance().simulateMessage({
        type: "ack",
        requestId: sent.requestId,
        ok: true,
        payload: { saved: true },
      });
      // 无关 requestId 的 ack 不应串线
      lastInstance().simulateMessage({
        type: "ack",
        requestId: "someone-else",
        ok: false,
      });
    });

    await expect(promise).resolves.toEqual({
      ok: true,
      payload: { saved: true },
    });
  });

  it("业务错误不 reject：ack ok:false → resolve 携带 error", async () => {
    const { result } = await renderConnected();

    let promise!: Promise<WsRequestResult>;
    act(() => {
      promise = result.current.request({ type: "save", serverId: "S1" });
    });
    const sent = lastInstance().lastSent();
    act(() => {
      lastInstance().simulateMessage({
        type: "ack",
        requestId: sent.requestId,
        ok: false,
        error: { code: "pty_not_running", message: "服务器没在运行" },
      });
    });

    await expect(promise).resolves.toEqual({
      ok: false,
      error: { code: "pty_not_running", message: "服务器没在运行" },
    });
  });

  it("本地超时：30s 无 ack → reject（服务端迟到应答被静默丢弃）", async () => {
    const { result } = await renderConnected();

    vi.useFakeTimers();
    let promise!: Promise<WsRequestResult>;
    act(() => {
      promise = result.current.request({ type: "save", serverId: "S1" });
    });
    const sent = lastInstance().lastSent();
    const assertion = expect(promise).rejects.toThrow("请求超时");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    await assertion;

    // 超时候才到的 ack：无 pending，静默丢弃不抛错
    act(() => {
      lastInstance().simulateMessage({
        type: "ack",
        requestId: sent.requestId,
        ok: true,
      });
    });
  });

  it("连接断开：在飞请求全部 reject，不挂着等超时", async () => {
    const { result } = await renderConnected();

    let promise!: Promise<WsRequestResult>;
    act(() => {
      promise = result.current.request({ type: "save", serverId: "S1" });
    });
    const assertion = expect(promise).rejects.toThrow("连接已断开");
    act(() => {
      lastInstance().simulateClose();
    });
    await assertion;
  });

  it("重连后自动重发 subscribe（卡 B 修复 C8 的回归保护）", async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useWebSocket(), { wrapper });
    await act(async () => {});
    act(() => {
      lastInstance().simulateOpen();
    });
    expect(result.current.connected).toBe(true);

    // 断线 → 1s 后重连
    act(() => {
      lastInstance().simulateClose();
    });
    expect(result.current.connected).toBe(false);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(FakeWebSocket.instances).toHaveLength(2);

    // 新连接 open → 自动发 subscribe
    act(() => {
      lastInstance().simulateOpen();
    });
    expect(lastInstance().lastSent()).toMatchObject({
      type: "subscribe",
      serverIds: [],
      eventTypes: null,
    });
    expect(result.current.connected).toBe(true);
  });

  it("指数退避：1s → 2s → 4s → … → 30s 封顶", async () => {
    vi.useFakeTimers();
    renderHook(() => useWebSocket(), { wrapper });
    await act(async () => {});
    act(() => {
      lastInstance().simulateOpen();
    });

    // 不 open 新实例 = 连接持续失败，退避必须逐次翻倍并封顶
    const expectedDelays = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000];
    for (const delay of expectedDelays) {
      const before = FakeWebSocket.instances.length;
      act(() => {
        lastInstance().simulateClose();
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(delay - 1);
      });
      // 差 1ms 不到点：不允许提前重连
      expect(FakeWebSocket.instances).toHaveLength(before);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
      });
      expect(FakeWebSocket.instances).toHaveLength(before + 1);
    }
  });
});
