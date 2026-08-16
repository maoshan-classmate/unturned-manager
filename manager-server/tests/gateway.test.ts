import { describe, it, expect, vi, afterEach } from "vitest";
import { createServer, type Server } from "http";
import { AddressInfo } from "net";
import WebSocket from "ws";
import type {
  IPtyManager,
  ServerId,
  WsRequestHandler,
} from "@unturned-manager/shared";
import type { AuthService } from "../src/modules/auth/AuthService.js";

// ★ gateway.ts 的 wsBroadcaster 是模块级单例——直接 import 会跨测试串扰（init 一次注册全局
//   wss）。每个测试用 vi.resetModules + 动态 import 拿全新单例，测完 destroy。
//   这与「直连真实 ws 服务器端到端验证 terminal_input → ptyManager.write」的意图一致——
//   不 mock ws 库，验证契约真实性。

interface GatewayHandle {
  url: string;
  httpServer: Server;
  broadcaster: {
    destroy(): Promise<void>;
    registerRequestHandler(type: string, handler: WsRequestHandler): void;
  };
}

async function startGateway(ptyManager?: IPtyManager): Promise<GatewayHandle> {
  vi.resetModules();
  const { wsBroadcaster } = await import("../src/ws/gateway.js");

  const httpServer = createServer();
  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  const port = (httpServer.address() as AddressInfo).port;

  const fakeAuth = {
    validateAccessToken: vi.fn((token: string) =>
      token === "valid" ? { userId: "u1" } : null,
    ),
  } as unknown as AuthService;

  wsBroadcaster.init(httpServer, fakeAuth, ptyManager);
  return {
    url: `ws://127.0.0.1:${port}`,
    httpServer,
    broadcaster: wsBroadcaster,
  };
}

/** 建连并等待 'subscribed' 回执，返回 ws（已 OPEN） */
function connectAndSubscribe(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${url}?token=valid`);
    ws.on("message", (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.type === "subscribed") resolve(ws);
    });
    ws.on("error", reject);
    ws.on("open", () => {
      ws.send(
        JSON.stringify({ type: "subscribe", serverIds: [], eventTypes: null }),
      );
    });
  });
}

function makeMockPty(): IPtyManager & { writeCalls: [string, string][] } {
  const writeCalls: [string, string][] = [];
  return {
    writeCalls,
    spawn: vi.fn(async () => 12345),
    write: vi.fn((id: string, data: string) => {
      writeCalls.push([id, data]);
    }),
    resize: vi.fn(),
    kill: vi.fn(async () => {}),
    forceKill: vi.fn(),
    isRunning: vi.fn(() => true),
    onData: vi.fn(),
    onExit: vi.fn(),
    waitExit: vi.fn(async () => true),
    waitForMarker: vi.fn(async () => {}),
    destroy: vi.fn(async () => {}),
  };
}

describe("WS gateway — terminal_input（ADR-0004 Phase 3）", () => {
  let handle: GatewayHandle | undefined;
  afterEach(async () => {
    await handle?.broadcaster.destroy();
    handle?.httpServer.close();
    handle = undefined;
  });

  it("terminal_input 合法消息 → 写入对应 serverId 的 PTY stdin", async () => {
    const pty = makeMockPty();
    handle = await startGateway(pty);
    const ws = await connectAndSubscribe(handle.url);

    ws.send(
      JSON.stringify({
        type: "terminal_input",
        serverId: "S1",
        data: "Say hello\n",
      }),
    );
    // WS 单向写入无回执——给事件循环一个 tick 让 message handler 执行
    await new Promise((r) => setTimeout(r, 50));
    expect(pty.write).toHaveBeenCalledWith("S1" as ServerId, "Say hello\n");
    ws.close();
  });

  it("terminal_input 缺 serverId → 回 error（不写 PTY）", async () => {
    const pty = makeMockPty();
    handle = await startGateway(pty);
    const ws = await connectAndSubscribe(handle.url);

    const error = new Promise<Record<string, unknown>>((resolve) => {
      ws.on("message", (raw) => {
        const msg = JSON.parse(raw.toString());
        if (msg.type === "error") resolve(msg);
      });
    });
    ws.send(JSON.stringify({ type: "terminal_input", data: "x" }));
    const msg = await error;
    expect(msg.code).toBe("invalid_message");
    expect(pty.write).not.toHaveBeenCalled();
    ws.close();
  });

  it("ptyManager 未注入 → 回 pty_unavailable error", async () => {
    handle = await startGateway(undefined); // 不传 ptyManager
    const ws = await connectAndSubscribe(handle.url);

    const error = new Promise<Record<string, unknown>>((resolve) => {
      ws.on("message", (raw) => {
        const msg = JSON.parse(raw.toString());
        if (msg.type === "error") resolve(msg);
      });
    });
    ws.send(
      JSON.stringify({ type: "terminal_input", serverId: "S1", data: "x" }),
    );
    const msg = await error;
    expect(msg.code).toBe("pty_unavailable");
    ws.close();
  });

  it("未知消息类型 → 回 invalid_message error", async () => {
    handle = await startGateway(makeMockPty());
    const ws = await connectAndSubscribe(handle.url);

    const error = new Promise<Record<string, unknown>>((resolve) => {
      ws.on("message", (raw) => {
        const msg = JSON.parse(raw.toString());
        if (msg.type === "error") resolve(msg);
      });
    });
    ws.send(JSON.stringify({ type: "something_else" }));
    const msg = await error;
    expect(msg.code).toBe("invalid_message");
    ws.close();
  });
});

describe("WS gateway — ACK 请求-应答（ws-wrapper-design §2.4/§5.1）", () => {
  let handle: GatewayHandle | undefined;
  afterEach(async () => {
    await handle?.broadcaster.destroy();
    handle?.httpServer.close();
    handle = undefined;
  });

  /** 收集 ws 上收到的 ack 消息（过滤掉 subscribed 回执） */
  function ackCollector(ws: WebSocket) {
    const acks: Record<string, unknown>[] = [];
    ws.on("message", (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.type === "ack") acks.push(msg);
    });
    return acks;
  }

  /** 等待 acks 数组出现指定 requestId 的应答 */
  async function waitAck(
    acks: Record<string, unknown>[],
    requestId: string,
  ): Promise<Record<string, unknown>> {
    for (let i = 0; i < 100; i++) {
      const hit = acks.find((a) => a.requestId === requestId);
      if (hit) return hit;
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error(`等不到 requestId=${requestId} 的 ack`);
  }

  it("正常路径：业务返回 ok → 收到同 requestId 的 ack + payload", async () => {
    handle = await startGateway(makeMockPty());
    handle.broadcaster.registerRequestHandler("save", async () => ({
      ok: true,
      payload: { saved: true },
    }));
    const ws = await connectAndSubscribe(handle.url);
    const acks = ackCollector(ws);

    ws.send(
      JSON.stringify({ type: "save", serverId: "S1", requestId: "req-1" }),
    );
    const ack = await waitAck(acks, "req-1");
    expect(ack.ok).toBe(true);
    expect(ack.payload).toEqual({ saved: true });
    ws.close();
  });

  it("业务错误：handler 返回 ok:false → ack 携带 error.code/message", async () => {
    handle = await startGateway(makeMockPty());
    handle.broadcaster.registerRequestHandler("save", async () => ({
      ok: false,
      error: { code: "pty_not_running", message: "服务器没在运行，无法存档" },
    }));
    const ws = await connectAndSubscribe(handle.url);
    const acks = ackCollector(ws);

    ws.send(
      JSON.stringify({ type: "save", serverId: "S1", requestId: "req-2" }),
    );
    const ack = await waitAck(acks, "req-2");
    expect(ack.ok).toBe(false);
    expect(ack.error).toEqual({
      code: "pty_not_running",
      message: "服务器没在运行，无法存档",
    });
    ws.close();
  });

  it("handler 抛异常 → 兜底 ack：ok:false + internal_error（连接不断）", async () => {
    handle = await startGateway(makeMockPty());
    handle.broadcaster.registerRequestHandler("shutdown", async () => {
      throw new Error("boom");
    });
    const ws = await connectAndSubscribe(handle.url);
    const acks = ackCollector(ws);

    ws.send(
      JSON.stringify({
        type: "shutdown",
        serverId: "S1",
        requestId: "req-3",
        delaySeconds: 10,
      }),
    );
    const ack = await waitAck(acks, "req-3");
    expect(ack.ok).toBe(false);
    expect(ack.error).toMatchObject({ code: "internal_error" });

    // 连接仍然活着——还能正常处理后续请求
    ws.send(
      JSON.stringify({ type: "terminal_input", serverId: "S1", data: "x" }),
    );
    await new Promise((r) => setTimeout(r, 50));
    ws.close();
  });

  it("requestId 唯一性：并发两个请求，应答各自匹配不串线", async () => {
    handle = await startGateway(makeMockPty());
    // save 慢（50ms）、terminal_close 快——乱序返回验证按 requestId 匹配
    handle.broadcaster.registerRequestHandler("save", async () => {
      await new Promise((r) => setTimeout(r, 50));
      return { ok: true, payload: "slow" };
    });
    handle.broadcaster.registerRequestHandler("terminal_close", async () => ({
      ok: true,
      payload: "fast",
    }));
    const ws = await connectAndSubscribe(handle.url);
    const acks = ackCollector(ws);

    ws.send(
      JSON.stringify({ type: "save", serverId: "S1", requestId: "req-slow" }),
    );
    ws.send(
      JSON.stringify({
        type: "terminal_close",
        serverId: "S1",
        requestId: "req-fast",
      }),
    );

    const [slowAck, fastAck] = await Promise.all([
      waitAck(acks, "req-slow"),
      waitAck(acks, "req-fast"),
    ]);
    expect(slowAck.payload).toBe("slow");
    expect(fastAck.payload).toBe("fast");
    ws.close();
  });

  it("未注册请求类型 → ack ok:false + unsupported_request", async () => {
    handle = await startGateway(makeMockPty());
    const ws = await connectAndSubscribe(handle.url);
    const acks = ackCollector(ws);

    ws.send(
      JSON.stringify({ type: "save", serverId: "S1", requestId: "req-5" }),
    );
    const ack = await waitAck(acks, "req-5");
    expect(ack.ok).toBe(false);
    expect(ack.error).toMatchObject({ code: "unsupported_request" });
    ws.close();
  });

  it("缺 requestId → 回 invalid_message error（不进业务处理器）", async () => {
    handle = await startGateway(makeMockPty());
    const saveHandler = vi.fn(async () => ({ ok: true }));
    handle.broadcaster.registerRequestHandler("save", saveHandler);
    const ws = await connectAndSubscribe(handle.url);

    const error = new Promise<Record<string, unknown>>((resolve) => {
      ws.on("message", (raw) => {
        const msg = JSON.parse(raw.toString());
        if (msg.type === "error") resolve(msg);
      });
    });
    ws.send(JSON.stringify({ type: "save", serverId: "S1" }));
    const msg = await error;
    expect(msg.code).toBe("invalid_message");
    expect(saveHandler).not.toHaveBeenCalled();
    ws.close();
  });
});
