import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Database from "better-sqlite3";
import { ServerManager } from "../src/modules/server/ServerManager.js";
import { resolveInstallDir } from "../src/modules/server/pathResolver.js";
import { detectStartScript } from "../src/modules/server/startScript.js";
import {
  ServerState,
  type IPtyManager,
  type IRconManager,
  type IConfigService,
  type IBroadcaster,
  type IServerDiscovery,
  type ServerEvent,
  type ServerId,
  type PtyExitCallback,
} from "@unturned-manager/shared";

// T6: mock 启动脚本探测——避免 Windows 上真实 detectStartScript 返回 null 抛 409
vi.mock("../src/modules/server/startScript.js", () => ({
  detectStartScript: vi.fn(async () => "ServerHelper.sh"),
  ensureStartScriptExecutable: vi.fn(async () => {}),
  startScriptNames: vi.fn(() => ["ServerHelper.sh", "ExampleServer.sh"]),
}));

// ─── Mocks ────────────────────────────────────────────────

function makeDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("journal_mode = MEMORY");
  // ADR-0003 B2：只保留 settings 表（ServerManager 仅用于 RCON 凭证 K-V，不再读写 servers）
  db.exec(`
    CREATE TABLE settings (
      key TEXT PRIMARY KEY, value_enc TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  return db;
}

function makeMockDiscovery(): IServerDiscovery {
  return {
    scanSync: vi.fn(() => []),
  };
}

/** ★ ADR-0004 Phase 2：mock 从 processSupervisor 换成 ptyManager（U3DS 实例进程走 PTY） */
interface PtyMock extends IPtyManager {
  writeCalls: [string, string][];
  exitCallbacks: Map<string, PtyExitCallback>;
}

function makeMockPty(): PtyMock {
  const writeCalls: [string, string][] = [];
  const exitCallbacks = new Map<string, PtyExitCallback>();
  // 模拟真实 PtyManager：spawn 后 processes.set → running；测试手动 mockReturnValue 模拟 exit 清空
  let running = false;
  return {
    writeCalls,
    exitCallbacks,
    spawn: vi.fn(async (_id, _file, _args, _opts) => {
      running = true;
      return 12345;
    }),
    write: vi.fn((serverId: string, data: string) => {
      writeCalls.push([serverId, data]);
    }),
    resize: vi.fn(),
    kill: vi.fn(async () => {}),
    forceKill: vi.fn(() => {
      running = false; // 模拟 exit 事件清 processes
    }),
    isRunning: vi.fn(() => running),
    onData: vi.fn(),
    onExit: vi.fn((serverId: string, cb: PtyExitCallback) => {
      exitCallbacks.set(serverId, cb);
    }),
    waitExit: vi.fn(async () => {
      running = false; // waitExit true = 确认 bash 已退，exit 事件已清 processes（真实 PtyManager 语义）
      return true;
    }),
    destroy: vi.fn(async () => {}),
  };
}

function makeMockRcon(): IRconManager {
  return {
    register: vi.fn(),
    unregister: vi.fn(),
    connect: vi.fn(async () => {}),
    disconnect: vi.fn(),
    execute: vi.fn(async () => "OK"),
    getProtocol: vi.fn(() => "unreachable" as never),
    isReachable: vi.fn(() => true),
    destroy: vi.fn(async () => {}),
    onStateChange: vi.fn(),
  };
}

function makeMockConfig(): IConfigService {
  return {
    readCommandsDat: vi.fn(async () => ({
      known: {},
      unknown: {},
      comments: [],
    })),
    writeCommandsDat: vi.fn(async () => {}),
    readConfigTxt: vi.fn(async () => ({ sections: {} })),
    writeConfigTxt: vi.fn(async () => {}),
    readWorkshopConfig: vi.fn(async () => ({
      File_IDs: [],
      Should_Monitor_Updates: true,
      Query_Cache_Max_Age_Seconds: 600,
      Max_Query_Retries: 2,
      Use_Cached_Downloads: true,
      Shutdown_Update_Detected_Timer: 600,
      Shutdown_Update_Detected_Message: "",
      Shutdown_Kick_Message: "",
    })),
    writeWorkshopFileIds: vi.fn(async () => {}),
    backup: vi.fn(async () => "/tmp/backup.json"),
    readOpenModConfig: vi.fn(async () => ({})),
    writeOpenModConfig: vi.fn(async () => {}),
    readRocketModConfig: vi.fn(async () => ({})),
    writeRocketModConfig: vi.fn(async () => {}),
  };
}

function makeMockBroadcaster(): IBroadcaster & { events: ServerEvent[] } {
  const events: ServerEvent[] = [];
  return {
    events,
    broadcast: vi.fn((event: ServerEvent) => {
      events.push(event);
    }),
    register: vi.fn(),
    unregister: vi.fn(),
    destroy: vi.fn(async () => {}),
  };
}

/** 造一个 ServerManager + 完整 mock 集（fake timers 用于 start 的 1s 塞命令窗口） */
function setup() {
  const db = makeDb();
  const pty = makeMockPty();
  const rcon = makeMockRcon();
  const cfg = makeMockConfig();
  const bcast = makeMockBroadcaster();
  const discovery = makeMockDiscovery();
  const mgr = new ServerManager(db as never, discovery, pty, rcon, cfg, bcast);
  return { db, pty, rcon, cfg, bcast, discovery, mgr };
}

async function createServer(mgr: ServerManager, id: string) {
  await mgr.createServer({
    id: id as ServerId,
    name: id,
    gamePort: 27015,
    ownerSteamId: "76561198000000001",
    installDir: "/opt/unturned",
  });
}

/** start 并推进 1s 塞命令窗口，返回 PTY mock */
async function started(mgr: ServerManager, pty: PtyMock, id: string) {
  await createServer(mgr, id);
  await mgr.start(id as ServerId);
  await vi.advanceTimersByTimeAsync(1000);
  expect(mgr.getState(id as ServerId)).toBe(ServerState.RUNNING);
  return pty;
}

// ─── 测试 ────────────────────────────────────────────────

describe("ServerManager — 状态机（ADR-0004 Phase 2 PTY）", () => {
  let pty: PtyMock;
  let rcon: IRconManager;
  let cfg: IConfigService;
  let bcast: IBroadcaster & { events: ServerEvent[] };
  let mgr: ServerManager;

  beforeEach(async () => {
    vi.useFakeTimers();
    const s = setup();
    pty = s.pty;
    rcon = s.rcon;
    cfg = s.cfg;
    bcast = s.bcast;
    mgr = s.mgr;
  });

  afterEach(() => vi.useRealTimers());

  it("createServer 写入 DB + STOPPED", async () => {
    await createServer(mgr, "SMTest");
    expect(mgr.getState("SMTest" as ServerId)).toBe(ServerState.STOPPED);
    const list = await mgr.listServers();
    expect(list).toHaveLength(1);
  });

  it("start 流程：spawn /bin/bash → STARTING → 1s 塞命令 → RUNNING", async () => {
    await createServer(mgr, "S1");
    const promise = mgr.start("S1" as ServerId);
    // 同步断言：操作中
    expect(mgr.getActiveOperation("S1" as ServerId).type).toBe("manual_start");
    const result = await promise;
    // 立即返回 terminalSessionId + pid（不等 U3DS 就绪）
    expect(result).toEqual({ terminalSessionId: "S1", pid: 12345 });
    const dir = resolveInstallDir();
    expect(pty.spawn).toHaveBeenCalledWith("S1" as ServerId, "/bin/bash", [], {
      cwd: dir,
    });
    // 刚 spawn 完 = STARTING；1s 后写 startCommand 才 RUNNING
    expect(mgr.getState("S1" as ServerId)).toBe(ServerState.STARTING);

    await vi.advanceTimersByTimeAsync(1000);
    expect(pty.write).toHaveBeenCalledWith(
      "S1" as ServerId,
      "./ServerHelper.sh +InternetServer/S1 -ThreadedConsole\r",
    );
    expect(mgr.getState("S1" as ServerId)).toBe(ServerState.RUNNING);
    const states = bcast.events
      .filter((e) => e.type === "state_change")
      .map((e) => (e as { to: ServerState }).to);
    expect(states).toEqual([ServerState.STARTING, ServerState.RUNNING]);
  });

  it("start 幂等：RUNNING 状态重复 start 返回已有会话（不重 spawn）", async () => {
    await started(mgr, pty, "S1");
    const result = await mgr.start("S1" as ServerId);
    expect(result).toEqual({ terminalSessionId: "S1", pid: 12345 });
    expect(pty.spawn).toHaveBeenCalledTimes(1);
  });

  it("start 幂等：STARTING 窗口重复 start 返回已有会话（不重 spawn）", async () => {
    await createServer(mgr, "S1");
    await mgr.start("S1" as ServerId); // state=STARTING，1s 窗口未推进
    expect(mgr.getState("S1" as ServerId)).toBe(ServerState.STARTING);
    const result = await mgr.start("S1" as ServerId);
    expect(result).toEqual({ terminalSessionId: "S1", pid: 12345 });
    expect(pty.spawn).toHaveBeenCalledTimes(1);
  });

  it("并发 start 应 409", async () => {
    await createServer(mgr, "S1");
    const first = mgr.start("S1" as ServerId);
    await expect(mgr.start("S1" as ServerId)).rejects.toMatchObject({
      status: 409,
    });
    await first;
  });

  it("未装 U3DS（detectStartScript null）→ start 409 start-script-not-found，回 STOPPED", async () => {
    await createServer(mgr, "S1");
    vi.mocked(detectStartScript).mockResolvedValueOnce(null);
    await expect(mgr.start("S1" as ServerId)).rejects.toMatchObject({
      status: 409,
      code: "start-script-not-found",
    });
    expect(mgr.getState("S1" as ServerId)).toBe(ServerState.STOPPED);
  });

  it("stop 流程：RCON Save+Shutdown → PTY ctrl+c + exit → waitExit → STOPPED", async () => {
    await started(mgr, pty, "S1");
    await mgr.stop("S1" as ServerId, "unit-test");
    expect(mgr.getState("S1" as ServerId)).toBe(ServerState.STOPPED);
    expect(rcon.execute).toHaveBeenCalledWith("S1" as ServerId, "Save");
    expect(rcon.execute).toHaveBeenCalledWith(
      "S1" as ServerId,
      expect.stringContaining("Shutdown 30"),
    );
    const writes = pty.writeCalls.map(([, d]) => d);
    expect(writes).toContain(""); // ctrl+c
    expect(writes).toContain("exit\r"); // 关永驻 bash
    expect(pty.waitExit).toHaveBeenCalledWith("S1" as ServerId, 30_000);
    expect(pty.forceKill).not.toHaveBeenCalled();
  });

  it("stop 超时（waitExit false）→ forceKill 兜底 → STOPPED", async () => {
    await started(mgr, pty, "S1");
    vi.mocked(pty.waitExit)
      .mockResolvedValueOnce(false) // 第一次：bash 30s 未退
      .mockResolvedValueOnce(true); // forceKill 后等 exit 事件
    await mgr.stop("S1" as ServerId, "unit-test");
    expect(pty.forceKill).toHaveBeenCalled();
    expect(mgr.getState("S1" as ServerId)).toBe(ServerState.STOPPED);
  });

  it("restart 全程一个 activeOperation 覆盖，stop + start 走通", async () => {
    await started(mgr, pty, "S1");
    const promise = mgr.restart("S1" as ServerId, "restart-test");
    expect(mgr.getActiveOperation("S1" as ServerId).type).toBe(
      "manual_restart",
    );
    await promise;
    // restart 完成后应能再 restart（activeOperation 已释放）
    const promise2 = mgr.restart("S1" as ServerId, "restart-test-2");
    expect(mgr.getActiveOperation("S1" as ServerId).type).toBe(
      "manual_restart",
    );
    await promise2;
    // restart = stop + start → bash spawn 2 次
    expect(pty.spawn).toHaveBeenCalledTimes(3);
  });

  it("forceStop 立即 STOPPED + PTY forceKill", async () => {
    await started(mgr, pty, "S1");
    await mgr.forceStop("S1" as ServerId);
    expect(mgr.getState("S1" as ServerId)).toBe(ServerState.STOPPED);
    expect(pty.forceKill).toHaveBeenCalled();
  });

  it("过期 1s timer 不误写新会话（会话代际保护，BUG-2 review 修复）", async () => {
    await createServer(mgr, "T8");
    await mgr.start("T8" as ServerId); // spawn bash A，timer A 排期
    expect(mgr.getState("T8" as ServerId)).toBe(ServerState.STARTING);
    // 1s 窗口内 stop → 再 start（spawn bash B，timer B 排期）
    await mgr.stop("T8" as ServerId, "fast-stop");
    await mgr.start("T8" as ServerId);
    // 推进 1s：timer A 到期（epoch 不匹配丢弃），timer B 到期（写命令一次）
    await vi.advanceTimersByTimeAsync(1000);
    const startCommands = pty.writeCalls.filter(([, d]) =>
      d.startsWith("./ServerHelper.sh"),
    );
    expect(startCommands).toHaveLength(1); // 只塞了一次命令（来自 timer B）
    expect(mgr.getState("T8" as ServerId)).toBe(ServerState.RUNNING);
  });

  it("STOPPED 实例调 stop 幂等返回，不闪动 STOPPING（风险-6 review 修复）", async () => {
    await createServer(mgr, "T9");
    const before = bcast.events.length;
    await mgr.stop("T9" as ServerId, "idle-stop");
    expect(mgr.getState("T9" as ServerId)).toBe(ServerState.STOPPED);
    const stopTransitions = bcast.events
      .slice(before)
      .filter((e) => e.type === "state_change");
    expect(stopTransitions).toHaveLength(0); // 无 STOPPING 闪动
    expect(pty.write).not.toHaveBeenCalled(); // 无空转 write
  });

  it("applyModChanges：state 非 RUNNING/DEGRADED → 409", async () => {
    await createServer(mgr, "S1");
    // STOPPED 状态下调用 mod_apply 应抛 409
    await expect(
      mgr.applyModChanges("S1" as ServerId, ["id1"]),
    ).rejects.toMatchObject({
      status: 409,
    });
  });

  it("listServersSync 同步返 in-memory serverId 列表", () => {
    expect(mgr.listServersSync()).toEqual([]);
  });
});

describe("ServerManager — activeOperation 锁", () => {
  afterEach(() => vi.useRealTimers());

  it("操作完成后 activeOperation.type 回到 none", async () => {
    vi.useFakeTimers();
    const { pty, mgr } = setup();
    await started(mgr, pty, "S1");
    expect(mgr.getActiveOperation("S1" as ServerId).type).toBe("none");
  });
});

describe("ServerManager — PTY 崩溃检测 + 5s 硬重启（ADR-0004 Phase 2）", () => {
  afterEach(() => vi.useRealTimers());

  it("bash 崩溃（exitCode≠0）→ STOPPED + 5s 后自动重启（spawn 2 次）", async () => {
    vi.useFakeTimers();
    const { pty, mgr } = setup();
    await started(mgr, pty, "T2");
    expect(pty.spawn).toHaveBeenCalledTimes(1);
    vi.mocked(pty.isRunning).mockReturnValue(false); // bash 真退，processes 清空
    const onExit = pty.exitCallbacks.get("T2");
    expect(onExit).toBeDefined();
    onExit!({ exitCode: 1 });
    expect(mgr.getState("T2" as ServerId)).toBe(ServerState.STOPPED);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(pty.spawn).toHaveBeenCalledTimes(2);
  });

  it("启动期 bash 崩溃（manual_start 期间 exitCode≠0）→ 放行 5s 重启（BUG-1 review 修复）", async () => {
    vi.useFakeTimers();
    const { pty, mgr } = setup();
    await createServer(mgr, "T7");
    // start 进行中（activeOperation=manual_start）bash 就崩了
    const p = mgr.start("T7" as ServerId);
    // flush 微任务直到 onExit 注册（spawn await resolve 后），此时仍在 manual_start 窗口
    for (let i = 0; i < 10 && !pty.exitCallbacks.has("T7"); i++) {
      await Promise.resolve();
    }
    const onExit = pty.exitCallbacks.get("T7");
    expect(onExit).toBeDefined();
    expect(mgr.getActiveOperation("T7" as ServerId).type).toBe("manual_start");
    vi.mocked(pty.isRunning).mockReturnValue(false); // bash 已崩，processes 清空
    onExit!({ exitCode: 1 });
    await p; // spawn 成功，start 正常返回
    await vi.advanceTimersByTimeAsync(5_000);
    expect(pty.spawn).toHaveBeenCalledTimes(2); // 启动期崩溃同样自动拉起
  });

  it("exitCode===0（正常退出）→ 不重启", async () => {
    vi.useFakeTimers();
    const { pty, mgr } = setup();
    await started(mgr, pty, "T3");
    const onExit = pty.exitCallbacks.get("T3");
    onExit!({ exitCode: 0 });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(pty.spawn).toHaveBeenCalledTimes(1);
  });

  it("stop 主动停止（stopRequested 置位）→ bash 退出不重启", async () => {
    vi.useFakeTimers();
    const { pty, mgr } = setup();
    await started(mgr, pty, "T4");
    // stop 超时路径：waitExit false → forceKill → bash exit 事件（signal 9）
    vi.mocked(pty.waitExit)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const promise = mgr.stop("T4" as ServerId, "stop-test");
    const onExit = pty.exitCallbacks.get("T4");
    onExit!({ exitCode: 0, signal: 9 }); // bash 被 SIGKILL
    await promise;
    await vi.advanceTimersByTimeAsync(5_000);
    expect(pty.spawn).toHaveBeenCalledTimes(1); // 不重启
  });

  it("bash 残留（isRunning=true + STOPPED）→ start 不重 spawn，只重塞命令", async () => {
    vi.useFakeTimers();
    const { pty, mgr } = setup();
    await started(mgr, pty, "T5");
    // 模拟异常：bash 退出事件已触发（state→STOPPED）但 processes 残留（isRunning 仍 true）
    vi.mocked(pty.isRunning).mockReturnValue(true);
    const onExit = pty.exitCallbacks.get("T5");
    onExit!({ exitCode: 1 });
    expect(mgr.getState("T5" as ServerId)).toBe(ServerState.STOPPED);
    await mgr.start("T5" as ServerId);
    expect(pty.spawn).toHaveBeenCalledTimes(1); // 不重 spawn
    expect(pty.write).toHaveBeenLastCalledWith(
      "T5" as ServerId,
      "./ServerHelper.sh +InternetServer/T5 -ThreadedConsole\r",
    );
    expect(mgr.getState("T5" as ServerId)).toBe(ServerState.RUNNING);
  });

  it("start 后 startCommand 缓存到 config（restart 复用不重复探测）", async () => {
    vi.useFakeTimers();
    const { pty, mgr } = setup();
    vi.mocked(detectStartScript).mockClear(); // 清掉前面测试的累积调用
    await started(mgr, pty, "T6");
    // 模拟 stop 成功关闭 bash：waitExit true + exit 事件 + processes 清空
    const onExit = pty.exitCallbacks.get("T6");
    onExit!({ exitCode: 0, signal: 15 });
    vi.mocked(pty.isRunning).mockReturnValue(false);
    await mgr.start("T6" as ServerId);
    await vi.advanceTimersByTimeAsync(1000);
    // detectStartScript 只应被调一次（首次生成后缓存到 config，重启复用）
    expect(vi.mocked(detectStartScript)).toHaveBeenCalledTimes(1);
  });
});
