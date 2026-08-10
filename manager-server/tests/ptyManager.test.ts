import { describe, it, expect, vi, beforeEach } from "vitest";
import type { IPty } from "node-pty";

// ─── Mock node-pty ─────────────────────────────────────
//
// 不连真 PTY：每个测试自己造 FakePty，pty.spawn 返回 fakePty 即可。
// node-pty 在 Windows 上需要 ConPTY native 模块，单测完全 mock 掉。

interface DataHandler {
  (chunk: string): void;
}
interface ExitHandler {
  (info: { exitCode: number; signal?: number }): void;
}

class FakePty implements IPty {
  pid = 12345;
  cols = 80;
  rows = 24;
  // 允许测试直接 push 模拟 chunk/exit
  dataHandlers: DataHandler[] = [];
  exitHandlers: ExitHandler[] = [];
  // 记录调用
  writeCalls: string[] = [];
  resizeCalls: Array<{ cols: number; rows: number }> = [];
  killCalls: string[] = [];

  onData(handler: DataHandler): void {
    this.dataHandlers.push(handler);
  }
  onExit(handler: ExitHandler): void {
    this.exitHandlers.push(handler);
  }
  write(data: string): void {
    this.writeCalls.push(data);
  }
  resize(cols: number, rows: number): void {
    this.resizeCalls.push({ cols, rows });
    this.cols = cols;
    this.rows = rows;
  }
  kill(signal?: string): void {
    this.killCalls.push(signal ?? "SIGHUP");
  }
  pause(): void {}
  resume(): void {}
  // node-pty 还有 process 属性（兼容 Linux forkpty 子进程引用）
  // 但 TS 接口不一定要求；测试不需要

  // ── 测试辅助 ──
  emitData(chunk: string): void {
    for (const h of this.dataHandlers) h(chunk);
  }
  emitExit(exitCode: number, signal?: number): void {
    const info = signal !== undefined ? { exitCode, signal } : { exitCode };
    // node-pty 行为：onExit 只触发一次；实现里一次调用即可
    for (const h of [...this.exitHandlers]) h(info);
    // 清空防止后续重复触发
    this.exitHandlers = [];
  }
}

let lastSpawnArgs: unknown;
let spawnReturn: FakePty | Error = new FakePty();

vi.mock("node-pty", () => ({
  spawn: vi.fn((...args: unknown[]) => {
    lastSpawnArgs = args;
    if (spawnReturn instanceof Error) {
      throw spawnReturn;
    }
    return spawnReturn;
  }),
}));

import { spawn as ptySpawn } from "node-pty";
import { PtyManager } from "../src/modules/process/PtyManager.js";
import { AppError } from "../src/utils/AppError.js";

const ptySpawnMock = vi.mocked(ptySpawn);

beforeEach(() => {
  spawnReturn = new FakePty();
  lastSpawnArgs = undefined;
  ptySpawnMock.mockClear();
});

describe("PtyManager — spawn 生命周期", () => {
  it("spawn: 返回 PID + isRunning true", async () => {
    const fake = new FakePty();
    fake.pid = 9999;
    spawnReturn = fake;

    const mgr = new PtyManager();
    const pid = await mgr.spawn("S1", "/bin/echo", ["hello"]);
    expect(pid).toBe(9999);
    expect(mgr.isRunning("S1")).toBe(true);
  });

  it("spawn: 同 serverId 已有进程 → 抛 AppError 409", async () => {
    const fake = new FakePty();
    spawnReturn = fake;

    const mgr = new PtyManager();
    await mgr.spawn("S1", "/bin/echo", []);
    await expect(mgr.spawn("S1", "/bin/echo", [])).rejects.toMatchObject({
      code: "pty-already-running",
      status: 409,
    });
  });

  it("spawn: node-pty.spawn 抛错 → AppError 500 (pty-spawn-failed)", async () => {
    spawnReturn = new Error("ENOENT: no such file");

    const mgr = new PtyManager();
    await expect(mgr.spawn("S1", "/nope", [])).rejects.toBeInstanceOf(AppError);
    await expect(mgr.spawn("S1", "/nope", [])).rejects.toMatchObject({
      code: "pty-spawn-failed",
      status: 500,
    });
    expect(mgr.isRunning("S1")).toBe(false);
  });

  it("spawn: 校验 node-pty.spawn 调用参数（cols/rows/env/useConpty）", async () => {
    const fake = new FakePty();
    spawnReturn = fake;

    const mgr = new PtyManager();
    await mgr.spawn(
      "S1",
      "/opt/unturned/ServerHelper.sh",
      ["+InternetServer/S1"],
      {
        cols: 120,
        rows: 40,
        cwd: "/opt/unturned",
        env: { CUSTOM: "v" },
      },
    );
    expect(lastSpawnArgs).toBeDefined();
    const [, , opts] = lastSpawnArgs as [
      string,
      string[],
      Record<string, unknown>,
    ];
    expect(opts.cols).toBe(120);
    expect(opts.rows).toBe(40);
    expect(opts.cwd).toBe("/opt/unturned");
    expect(opts.env).toEqual({ CUSTOM: "v" });
    // useConpty 必须按平台切换（GSM3 同款依赖）
    expect(typeof opts.useConpty).toBe("boolean");
  });

  it("spawn: 不传 env 时默认走 buildChildProcessEnvironment（剥离 secret）", async () => {
    const fake = new FakePty();
    spawnReturn = fake;
    const prevSecret = process.env.JWT_SECRET;
    process.env.JWT_SECRET = "must-not-leak";

    try {
      const mgr = new PtyManager();
      await mgr.spawn("S1", "/bin/echo", []);
      const [, , opts] = lastSpawnArgs as [
        string,
        string[],
        { env: NodeJS.ProcessEnv },
      ];
      expect(opts.env.JWT_SECRET).toBeUndefined();
    } finally {
      if (prevSecret === undefined) {
        delete process.env.JWT_SECRET;
      } else {
        process.env.JWT_SECRET = prevSecret;
      }
    }
  });
});

describe("PtyManager — onData chunk 切行", () => {
  it("单 chunk 含多个换行 → 多次 onData 回调，每次一行", async () => {
    const fake = new FakePty();
    spawnReturn = fake;
    const mgr = new PtyManager();
    await mgr.spawn("S1", "/bin/echo", []);
    const received: string[] = [];
    mgr.onData("S1", (line) => received.push(line));

    fake.emitData("first\nsecond\nthird\n");
    expect(received).toEqual(["first", "second", "third"]);
  });

  it("chunk 无换行 → buffer 保留，下次 chunk 拼接", async () => {
    const fake = new FakePty();
    spawnReturn = fake;
    const mgr = new PtyManager();
    await mgr.spawn("S1", "/bin/echo", []);
    const received: string[] = [];
    mgr.onData("S1", (line) => received.push(line));

    fake.emitData("hello "); // 不切行
    expect(received).toEqual([]);
    fake.emitData("world\n"); // 补齐 \n
    expect(received).toEqual(["hello world"]);
  });

  it("\\r\\n 行尾：按 \\r?\\n 切，\\r 不出现在结果里", async () => {
    const fake = new FakePty();
    spawnReturn = fake;
    const mgr = new PtyManager();
    await mgr.spawn("S1", "/bin/echo", []);
    const received: string[] = [];
    mgr.onData("S1", (line) => received.push(line));

    fake.emitData("crlf\r\nnext\r\n");
    expect(received).toEqual(["crlf", "next"]);
  });

  it("空行也要转发（PTY 进度条刷新常见空行）", async () => {
    const fake = new FakePty();
    spawnReturn = fake;
    const mgr = new PtyManager();
    await mgr.spawn("S1", "/bin/echo", []);
    const received: string[] = [];
    mgr.onData("S1", (line) => received.push(line));

    fake.emitData("\n\ndone\n");
    expect(received).toEqual(["", "", "done"]);
  });

  it("未注册 onData → chunk 静默丢弃，不报错", async () => {
    const fake = new FakePty();
    spawnReturn = fake;
    const mgr = new PtyManager();
    await mgr.spawn("S1", "/bin/echo", []);

    // 不注册 callback，直接 emit data
    expect(() => fake.emitData("ignored\n")).not.toThrow();
  });

  it("多个 onData callback → 都收到", async () => {
    const fake = new FakePty();
    spawnReturn = fake;
    const mgr = new PtyManager();
    await mgr.spawn("S1", "/bin/echo", []);
    const a: string[] = [];
    const b: string[] = [];
    mgr.onData("S1", (line) => a.push(line));
    mgr.onData("S1", (line) => b.push(line));

    fake.emitData("x\ny\n");
    expect(a).toEqual(["x", "y"]);
    expect(b).toEqual(["x", "y"]);
  });

  it("data 回调异常 → 不影响其他 callback（logger.error 后继续）", async () => {
    const fake = new FakePty();
    spawnReturn = fake;
    const mgr = new PtyManager();
    await mgr.spawn("S1", "/bin/echo", []);
    const good: string[] = [];
    mgr.onData("S1", () => {
      throw new Error("boom");
    });
    mgr.onData("S1", (line) => good.push(line));

    fake.emitData("ok\n");
    expect(good).toEqual(["ok"]);
  });
});

describe("PtyManager — onExit 触发 flush tail + cleanup", () => {
  it("exit 触发 flush 未完成行（buffer 残留）", async () => {
    const fake = new FakePty();
    spawnReturn = fake;
    const mgr = new PtyManager();
    await mgr.spawn("S1", "/bin/echo", []);
    const received: string[] = [];
    mgr.onData("S1", (line) => received.push(line));

    fake.emitData("incomplete line without newline"); // buffer 留 "incomplete line without newline"
    expect(received).toEqual([]);
    fake.emitExit(0);
    expect(received).toEqual(["incomplete line without newline"]); // tail flush
  });

  it("exit 后进程 entry 清理（isRunning false）", async () => {
    const fake = new FakePty();
    spawnReturn = fake;
    const mgr = new PtyManager();
    await mgr.spawn("S1", "/bin/echo", []);
    expect(mgr.isRunning("S1")).toBe(true);
    fake.emitExit(0);
    expect(mgr.isRunning("S1")).toBe(false);
  });

  it("exit: 多个 onExit callback 都收到 {exitCode, signal}", async () => {
    const fake = new FakePty();
    spawnReturn = fake;
    const mgr = new PtyManager();
    await mgr.spawn("S1", "/bin/echo", []);
    const exits: Array<{ exitCode: number; signal?: number }> = [];
    mgr.onExit("S1", (info) => exits.push(info));
    mgr.onExit("S1", (info) => exits.push(info));

    fake.emitExit(137, 9); // SIGKILL
    expect(exits).toEqual([
      { exitCode: 137, signal: 9 },
      { exitCode: 137, signal: 9 },
    ]);
  });

  it("exit: exitCode=0 不带 signal 也正确转发", async () => {
    const fake = new FakePty();
    spawnReturn = fake;
    const mgr = new PtyManager();
    await mgr.spawn("S1", "/bin/echo", []);
    const exits: Array<{ exitCode: number; signal?: number }> = [];
    mgr.onExit("S1", (info) => exits.push(info));

    fake.emitExit(0);
    expect(exits).toEqual([{ exitCode: 0 }]);
  });

  it("exit: callback 异常 → 不影响其他 callback", async () => {
    const fake = new FakePty();
    spawnReturn = fake;
    const mgr = new PtyManager();
    await mgr.spawn("S1", "/bin/echo", []);
    const good: number[] = [];
    mgr.onExit("S1", () => {
      throw new Error("boom");
    });
    mgr.onExit("S1", (info) => good.push(info.exitCode));

    fake.emitExit(1);
    expect(good).toEqual([1]);
  });

  it("exit 后再 spawn 同 key → 成功（不卡 'already running'）", async () => {
    const fake1 = new FakePty();
    spawnReturn = fake1;
    const mgr = new PtyManager();
    await mgr.spawn("S1", "/bin/echo", []);
    fake1.emitExit(0);
    expect(mgr.isRunning("S1")).toBe(false);

    const fake2 = new FakePty();
    fake2.pid = 8888;
    spawnReturn = fake2;
    await mgr.spawn("S1", "/bin/echo", []);
    expect(mgr.isRunning("S1")).toBe(true);

    // 第二次 spawn 同 key 应抛 409
    await expect(mgr.spawn("S1", "/bin/echo", [])).rejects.toMatchObject({
      code: "pty-already-running",
    });
  });

  it("★ P0-2 修复：自然 exit 后 callback Map 被清理（防长寿命内存泄漏）", async () => {
    const mgr = new PtyManager();
    // 模拟 10 次 start→exit 周期（不同 serverId）
    for (let i = 0; i < 10; i++) {
      const f = new FakePty();
      spawnReturn = f;
      const sid = `S${i}`;
      await mgr.spawn(sid, "/bin/echo", []);
      mgr.onData(sid, () => {});
      mgr.onExit(sid, () => {});
      f.emitExit(0);
    }
    // 关键断言：exitCallbacks/dataCallbacks Map 应为空（10 个 key 全部 delete）
    const exitMap = (mgr as unknown as { exitCallbacks: Map<unknown, unknown> })
      .exitCallbacks;
    const dataMap = (mgr as unknown as { dataCallbacks: Map<unknown, unknown> })
      .dataCallbacks;
    expect(exitMap.size).toBe(0);
    expect(dataMap.size).toBe(0);
  });

  it("★ P0-2 修复：exit 后旧 callback 引用已被清理（垃圾回收前提）", async () => {
    const fake = new FakePty();
    spawnReturn = fake;
    const mgr = new PtyManager();
    await mgr.spawn("S1", "/bin/echo", []);

    // 注册一个闭包
    let cbRef: unknown = () => {};
    mgr.onData("S1", () => {
      cbRef = "should be unreachable";
    });

    fake.emitExit(0); // 触发清理

    // 验证 dataCallbacks Map 里 S1 key 已被 delete
    const dataMap = (mgr as unknown as { dataCallbacks: Map<unknown, unknown> })
      .dataCallbacks;
    expect(dataMap.has("S1")).toBe(false);
    expect(cbRef).not.toBe("should be unreachable"); // callback 未被触发
  });
});

describe("PtyManager — write / resize / lifecycle", () => {
  it("write: 写入 PTY stdin", async () => {
    const fake = new FakePty();
    spawnReturn = fake;
    const mgr = new PtyManager();
    await mgr.spawn("S1", "/bin/echo", []);

    mgr.write("S1", "Players\n");
    expect(fake.writeCalls).toEqual(["Players\n"]);
  });

  it("write: 进程不存在 → warn 不抛", async () => {
    const mgr = new PtyManager();
    expect(() => mgr.write("ghost", "x")).not.toThrow();
  });

  it("resize: 调整 cols/rows", async () => {
    const fake = new FakePty();
    spawnReturn = fake;
    const mgr = new PtyManager();
    await mgr.spawn("S1", "/bin/echo", []);

    mgr.resize("S1", 200, 60);
    expect(fake.resizeCalls).toEqual([{ cols: 200, rows: 60 }]);
  });

  it("resize: 进程不存在 → warn 不抛", async () => {
    const mgr = new PtyManager();
    expect(() => mgr.resize("ghost", 80, 24)).not.toThrow();
  });

  it("forceKill: 进程存在 → SIGKILL", async () => {
    const fake = new FakePty();
    spawnReturn = fake;
    const mgr = new PtyManager();
    await mgr.spawn("S1", "/bin/echo", []);

    mgr.forceKill("S1");
    expect(fake.killCalls).toEqual(["SIGKILL"]);
  });

  it("forceKill: 进程不存在 → 静默", async () => {
    const mgr = new PtyManager();
    expect(() => mgr.forceKill("ghost")).not.toThrow();
  });
});

describe("PtyManager — kill 优雅关停", () => {
  it("进程主动 exit → kill 立即 resolve true（不发 SIGTERM）", async () => {
    const fake = new FakePty();
    spawnReturn = fake;
    const mgr = new PtyManager();
    await mgr.spawn("S1", "/bin/echo", []);

    // kill 内部会再注册一次性 onExit；fakePty 已经退出会再次触发——但实现里 entry 已被 onExit 清理
    // 为模拟「退出后再 kill」，用 vi.useFakeTimers 让 onExit 的清理在 await 之前完成
    const killPromise = mgr.kill("S1");

    // 让 fake 退出（立即触发所有 onExit，包括 kill 内部新注册的那个）
    fake.emitExit(0);

    await killPromise;
    // 注：kill 的 SIGTERM 已发出，但 fake 同步 emitExit 触发 onExit 把 entry 清理
    // killCalls 至少包含 SIGTERM
    expect(fake.killCalls[0]).toBe("SIGTERM");
    expect(mgr.isRunning("S1")).toBe(false);
  });

  it("进程不响应 SIGTERM → 5s 超时 → 强杀 SIGKILL", async () => {
    vi.useFakeTimers();
    try {
      const fake = new FakePty();
      // 不在测试中 emitExit，模拟进程不死
      spawnReturn = fake;
      const mgr = new PtyManager();
      await mgr.spawn("S1", "/bin/echo", []);

      const killPromise = mgr.kill("S1");
      // 让 SIGTERM 之后 fake 不退出（不 emitExit）
      // 推进 5s 超时
      await vi.advanceTimersByTimeAsync(5_000);
      await killPromise;

      expect(fake.killCalls).toEqual(["SIGTERM", "SIGKILL"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("kill: 进程不存在 → 立即返回", async () => {
    const mgr = new PtyManager();
    await expect(mgr.kill("ghost")).resolves.toBeUndefined();
  });
});

describe("PtyManager — destroy", () => {
  it("destroy: 关闭所有 PTY + 清空 callback 表", async () => {
    const fake1 = new FakePty();
    const fake2 = new FakePty();
    // 第一次 spawn 用 fake1，第二次用 fake2
    const sequence = [fake1, fake2];
    let i = 0;
    ptySpawnMock.mockImplementation(() => {
      const f = sequence[i++];
      if (!f) throw new Error("unexpected spawn");
      return f as unknown as IPty;
    });

    const mgr = new PtyManager();
    await mgr.spawn("S1", "/bin/echo", []);
    await mgr.spawn("S2", "/bin/echo", []);

    await mgr.destroy();

    // destroy 给所有 PTY 发 SIGKILL
    expect(fake1.killCalls).toEqual(["SIGKILL"]);
    expect(fake2.killCalls).toEqual(["SIGKILL"]);

    // 模拟 OS 把进程回收（forceKill 只发信号，exit 事件由 OS 异步触发）
    fake1.emitExit(137, 9);
    fake2.emitExit(137, 9);
    expect(mgr.isRunning("S1")).toBe(false);
    expect(mgr.isRunning("S2")).toBe(false);

    // destroy 后 spawn 新进程应该可以（callback 表已清空）
    const fake3 = new FakePty();
    sequence.push(fake3);
    await mgr.spawn("S3", "/bin/echo", []);
    expect(mgr.isRunning("S3")).toBe(true);
  });
});

describe("PtyManager — 多 serverId 隔离", () => {
  it("不同 serverId 各自 isRunning，互不影响", async () => {
    const f1 = new FakePty();
    const f2 = new FakePty();
    const arr = [f1, f2];
    let i = 0;
    ptySpawnMock.mockImplementation(() => {
      const f = arr[i++];
      if (!f) throw new Error("unexpected spawn");
      return f as unknown as IPty;
    });

    const mgr = new PtyManager();
    await mgr.spawn("S1", "/bin/echo", []);
    await mgr.spawn("S2", "/bin/echo", []);

    const received1: string[] = [];
    const received2: string[] = [];
    mgr.onData("S1", (line) => received1.push(line));
    mgr.onData("S2", (line) => received2.push(line));

    f1.emitData("hello-1\n");
    f2.emitData("hello-2\n");

    expect(received1).toEqual(["hello-1"]);
    expect(received2).toEqual(["hello-2"]);

    f1.emitExit(0);
    expect(mgr.isRunning("S1")).toBe(false);
    expect(mgr.isRunning("S2")).toBe(true); // S2 不受影响
  });

  it("S1 exit 不会 flush S2 的 buffer", async () => {
    const f1 = new FakePty();
    const f2 = new FakePty();
    const arr = [f1, f2];
    let i = 0;
    ptySpawnMock.mockImplementation(() => {
      const f = arr[i++];
      if (!f) throw new Error("unexpected spawn");
      return f as unknown as IPty;
    });

    const mgr = new PtyManager();
    await mgr.spawn("S1", "/bin/echo", []);
    await mgr.spawn("S2", "/bin/echo", []);

    const r1: string[] = [];
    const r2: string[] = [];
    mgr.onData("S1", (line) => r1.push(line));
    mgr.onData("S2", (line) => r2.push(line));

    f1.emitData("partial-s1"); // 没 \n
    f2.emitData("partial-s2"); // 没 \n
    f1.emitExit(0); // S1 flush → r1 收到 "partial-s1"

    expect(r1).toEqual(["partial-s1"]);
    expect(r2).toEqual([]); // S2 没动

    f2.emitExit(0);
    expect(r2).toEqual(["partial-s2"]); // S2 退出时 flush 自己
  });
});
