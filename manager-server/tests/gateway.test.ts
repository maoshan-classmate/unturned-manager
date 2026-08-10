import { describe, it, expect, vi, afterEach } from "vitest";
import { createServer, type Server } from "http";
import { AddressInfo } from "net";
import WebSocket from "ws";
import type { IPtyManager, ServerId } from "@unturned-manager/shared";
import type { AuthService } from "../src/modules/auth/AuthService.js";

// ★ gateway.ts 的 wsBroadcaster 是模块级单例——直接 import 会跨测试串扰（init 一次注册全局
//   wss）。每个测试用 vi.resetModules + 动态 import 拿全新单例，测完 destroy。
//   这与「直连真实 ws 服务器端到端验证 terminal_input → ptyManager.write」的意图一致——
//   不 mock ws 库，验证契约真实性。

interface GatewayHandle {
  url: string;
  httpServer: Server;
  broadcaster: { destroy(): Promise<void> };
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
        data: "Say hello\r",
      }),
    );
    // WS 单向写入无回执——给事件循环一个 tick 让 message handler 执行
    await new Promise((r) => setTimeout(r, 50));
    expect(pty.write).toHaveBeenCalledWith("S1" as ServerId, "Say hello\r");
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
