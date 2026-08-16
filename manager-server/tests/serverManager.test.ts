import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Database from "better-sqlite3";
import { ServerManager } from "../src/modules/server/ServerManager.js";
import { resolveInstallDir } from "../src/modules/server/pathResolver.js";
import { detectStartScript } from "../src/modules/server/startScript.js";
import {
  ServerState,
  type IPtyManager,
  type IConfigService,
  type IBroadcaster,
  type IServerDiscovery,
  type ServerEvent,
  type ServerId,
  type PtyDataCallback,
  type PtyExitCallback,
} from "@unturned-manager/shared";

// T6: mock 启动脚本探测——避免 Windows 上真实 detectStartScript 返回 null 抛 409
vi.mock("../src/modules/server/startScript.js", () => ({
  detectStartScript: vi.fn(async () => "ServerHelper.sh"),
  ensureStartScriptExecutable: vi.fn(async () => {}),
  startScriptNames: vi.fn(() => ["ServerHelper.sh", "ExampleServer.sh"]),
  // BUG-1：restoreStartCommand/startPty 会调用 normalizeStartCommand——mock 默认不过问（原样返回）
  normalizeStartCommand: vi.fn((cmd: string) => ({
    command: cmd,
    changed: false,
  })),
}));

// ─── Mocks ────────────────────────────────────────────────

function makeDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("journal_mode = MEMORY");
  // ADR-0003 B2：只保留 settings 表（ServerManager 用于 settings K-V：startCommand 等）
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
  dataCallbacks: Map<string, PtyDataCallback>;
}

function makeMockPty(): PtyMock {
  const writeCalls: [string, string][] = [];
  const exitCallbacks = new Map<string, PtyExitCallback>();
  const dataCallbacks = new Map<string, PtyDataCallback>();
  // 模拟真实 PtyManager：spawn 后 processes.set → running；测试手动 mockReturnValue 模拟 exit 清空
  let running = false;
  return {
    writeCalls,
    exitCallbacks,
    dataCallbacks,
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
    onData: vi.fn((serverId: string, cb: PtyDataCallback) => {
      dataCallbacks.set(serverId, cb); // 记录 data 回调，测试手动触发模拟 PTY stdout
      return () => {};
    }),
    onExit: vi.fn((serverId: string, cb: PtyExitCallback) => {
      exitCallbacks.set(serverId, cb);
      return () => {};
    }),
    waitExit: vi.fn(async () => {
      running = false; // waitExit true = 确认 bash 已退，exit 事件已清 processes（真实 PtyManager 语义）
      return true;
    }),
    waitForMarker: vi.fn(async () => {}),
    destroy: vi.fn(async () => {}),
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
    registerRequestHandler: vi.fn(),
    destroy: vi.fn(async () => {}),
  };
}

/** 造一个 ServerManager + 完整 mock 集（fake timers 用于 start 的 3s 塞命令窗口，对齐 GSM GameManager.ts:356） */
function setup() {
  const db = makeDb();
  const pty = makeMockPty();
  const cfg = makeMockConfig();
  const bcast = makeMockBroadcaster();
  const discovery = makeMockDiscovery();
  // ★ ADR-0004 Phase 6：RCON 通道已删除，构造签名少 1 个 rcon 参数
  const mgr = new ServerManager(db as never, discovery, pty, cfg, bcast);
  return { db, pty, cfg, bcast, discovery, mgr };
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

/** start 并推进 3s 塞命令窗口，返回 PTY mock（对齐 GSM GameManager.ts:356） */
async function started(mgr: ServerManager, pty: PtyMock, id: string) {
  await createServer(mgr, id);
  await mgr.start(id as ServerId);
  await vi.advanceTimersByTimeAsync(3000);
  expect(mgr.getState(id as ServerId)).toBe(ServerState.RUNNING);
  return pty;
}

// ─── 测试 ────────────────────────────────────────────────

describe("ServerManager — 状态机（ADR-0004 Phase 2 PTY）", () => {
  let pty: PtyMock;
  let cfg: IConfigService;
  let bcast: IBroadcaster & { events: ServerEvent[] };
  let mgr: ServerManager;

  beforeEach(async () => {
    vi.useFakeTimers();
    const s = setup();
    pty = s.pty;
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

  it("start 流程：spawn /bin/bash → STARTING → 3s 塞命令 → RUNNING（对齐 GSM）", async () => {
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
    // 刚 spawn 完 = STARTING；3s 后写 startCommand 才 RUNNING（对齐 GSM 3s）
    expect(mgr.getState("S1" as ServerId)).toBe(ServerState.STARTING);

    await vi.advanceTimersByTimeAsync(3000);
    expect(pty.write).toHaveBeenCalledWith(
      "S1" as ServerId,
      // BUG-1：+InternetServer 必须在末位（U3-SDK tryGetServer 取到行末）
      "./ServerHelper.sh -ThreadedConsole +InternetServer/S1\n",
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

  it("stop 流程：PTY 写 Save+Shutdown + ctrl+c + exit → waitExit → STOPPED", async () => {
    await started(mgr, pty, "S1");
    await mgr.stop("S1" as ServerId, "unit-test");
    expect(mgr.getState("S1" as ServerId)).toBe(ServerState.STOPPED);
    // 存档与关服命令送进控制台（owner-trust 模型），末尾用回车符
    const writes = pty.writeCalls.map(([, d]) => d);
    expect(writes).toContain("Save\r");
    expect(writes).toContain('Shutdown 30 "unit-test"\r');
    expect(writes).toContain(""); // ctrl+c
    expect(writes).toContain("exit\n"); // 关永驻 bash
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

  it("PTY stdout 经 onData 接线到 console_line 广播（P3-T2）", async () => {
    await started(mgr, pty, "S1");
    const onData = pty.dataCallbacks.get("S1");
    expect(onData).toBeDefined(); // start 时已注册 PTY 输出接线
    onData!("Server is ready");
    onData!("[32mWorld saved[0m");
    const consoleLines = bcast.events
      .filter((e) => e.type === "console_line")
      .map((e) => (e as { line: string }).line);
    expect(consoleLines).toEqual(["Server is ready", "[32mWorld saved[0m"]);
  });

  it("过期 1s timer 不误写新会话（会话代际保护，BUG-2 review 修复）", async () => {
    await createServer(mgr, "T8");
    await mgr.start("T8" as ServerId); // spawn bash A，timer A 排期
    expect(mgr.getState("T8" as ServerId)).toBe(ServerState.STARTING);
    // 1s 窗口内 stop → 再 start（spawn bash B，timer B 排期）
    await mgr.stop("T8" as ServerId, "fast-stop");
    await mgr.start("T8" as ServerId);
    // 推进 1s：timer A 到期（epoch 不匹配丢弃），timer B 到期（写命令一次）
    await vi.advanceTimersByTimeAsync(3000);
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

  // ─── 抄 GSM GameManager.ts:795-802：stdout 命中 ready 正则提前 transition ───

  it("stdout 命中 'Server is ready' → STARTING → RUNNING 不等 3s 兜底", async () => {
    await createServer(mgr, "T10");
    await mgr.start("T10" as ServerId);
    expect(mgr.getState("T10" as ServerId)).toBe(ServerState.STARTING);
    const before = bcast.events.length;

    const onData = pty.dataCallbacks.get("T10");
    expect(onData).toBeDefined();
    onData!("Server is ready"); // U3DS 启动成功信号

    // 命中正则 → 立即 transition(RUNNING)，不需等 3s
    expect(mgr.getState("T10" as ServerId)).toBe(ServerState.RUNNING);
    const runTransitions = bcast.events
      .slice(before)
      .filter(
        (e) =>
          e.type === "state_change" &&
          (e as { from?: string; to?: string }).to === "RUNNING",
      );
    expect(runTransitions).toHaveLength(1);
  });

  it("stdout 命中 'World saved' / 'Startup complete' 同样触发 RUNNING（正则覆盖）", async () => {
    for (const [idx, pattern] of [
      "World saved",
      "Startup complete",
    ].entries()) {
      const id = `T11_${idx}`;
      await createServer(mgr, id);
      await mgr.start(id as ServerId);
      const onData = pty.dataCallbacks.get(id);
      expect(onData).toBeDefined();
      onData!(pattern);
      expect(mgr.getState(id as ServerId)).toBe(ServerState.RUNNING);
    }
  });

  it("transition 幂等：stdout 命中 + 3s 兜底同时触发 → 只 transition 一次", async () => {
    await createServer(mgr, "T12");
    await mgr.start("T12" as ServerId);
    const onData = pty.dataCallbacks.get("T12");
    expect(onData).toBeDefined();
    onData!("Server is ready"); // 正则提前触发
    const afterReady = bcast.events.filter(
      (e) =>
        e.type === "state_change" && (e as { to?: string }).to === "RUNNING",
    ).length;
    expect(afterReady).toBe(1);

    // 3s 兜底 timer 触发：因幂等，state_change 计数仍为 1
    await vi.advanceTimersByTimeAsync(3000);
    const afterTimeout = bcast.events.filter(
      (e) =>
        e.type === "state_change" && (e as { to?: string }).to === "RUNNING",
    ).length;
    expect(afterTimeout).toBe(1); // 幂等守住，不重复广播
    expect(mgr.getState("T12" as ServerId)).toBe(ServerState.RUNNING);
  });

  it("v2.6：restartAndApplyMods 先调 applyStaged 再 spawn PTY（移动在 STOPPED 态执行）", async () => {
    vi.useFakeTimers();
    const { pty, mgr } = setup();
    // 注入追踪 workshopApply（验证 preStartHook 真的被调）
    const applyCalls: string[] = [];
    const trackingApply = {
      applyStaged: vi.fn(async (serverId: string) => {
        applyCalls.push(serverId);
      }),
    };
    (mgr as any).workshopApply = trackingApply;
    await createServer(mgr, "S1");
    await mgr.start("S1" as ServerId);
    await vi.advanceTimersByTimeAsync(3000);
    expect(mgr.getState("S1" as ServerId)).toBe(ServerState.RUNNING);
    // ★ P2 #4 改动：startInternal 默认不调 applyStaged；applyStaged 由 restartAndApplyMods 显式调
    expect(trackingApply.applyStaged).not.toHaveBeenCalled();
    expect(pty.spawn).toHaveBeenCalled(); // bash 已 spawn
    // 现在调 restartAndApplyMods——验证 preStartHook 真的触发 + spawn 顺序
    pty.spawn.mockClear();
    const restartPromise = mgr.restartAndApplyMods("S1" as ServerId, "测试重启");
    // 推进 stopPty（30s timeout）+ startCommand 3s 延迟
    await vi.advanceTimersByTimeAsync(40_000);
    await restartPromise;
    expect(trackingApply.applyStaged).toHaveBeenCalledWith("S1");
    expect(pty.spawn).toHaveBeenCalled();
  });

  it("v2.6：restartAndApplyMods 中 applyStaged 失败 → 上抛、不 spawn（不拿残缺 content 启动）", async () => {
    vi.useFakeTimers();
    const { pty, mgr } = setup();
    // 注入会抛错的 workshopApply
    const failingApply = {
      applyStaged: vi.fn(async () => {
        throw new Error("staging 移动失败");
      }),
    };
    // 注：workshopApply 是 TS private，运行时是普通字段——用 as any 强写
    (mgr as any).workshopApply = failingApply;
    await createServer(mgr, "S2");
    await mgr.start("S2" as ServerId);
    await vi.advanceTimersByTimeAsync(3000);
    pty.spawn.mockClear();
    // ★ P2 #4 改动：applyStaged 失败行为改由 restartAndApplyMods（preStartHook）触发上抛
    await expect(
      mgr.restartAndApplyMods("S2" as ServerId, "用户手动重启"),
    ).rejects.toThrow(/staging 移动失败/);
    expect(failingApply.applyStaged).toHaveBeenCalledTimes(1);
    expect(pty.spawn).not.toHaveBeenCalled(); // ★ spawn 没发生——不拿残缺 content 启动
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
      // BUG-1：+InternetServer 必须在末位
      "./ServerHelper.sh -ThreadedConsole +InternetServer/T5\n",
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
    await vi.advanceTimersByTimeAsync(3000);
    // detectStartScript 只应被调一次（首次生成后缓存到 config，重启复用）
    expect(vi.mocked(detectStartScript)).toHaveBeenCalledTimes(1);
  });
});

// ─── ADR-0004 Phase 4 ────────────────────────────────
// 测试 startCommand 持久化：configureServer / loadServersFromDisk / removeServer 链路
// 注：createServer 不主动调 buildStartCommand（U3DS 未装时 start 抛 409 的语义不
//      应当阻断创建——保留边界）。用户首次 startCommand 只能通过 PATCH 走进去。
describe("ServerManager — startCommand 持久化（ADR-0004 Phase 4）", () => {
  afterEach(() => vi.useRealTimers());

  it("configureServer 传 startCommand → 落 settings K-V + in-memory config 同步", async () => {
    const { db, mgr } = setup();
    await createServer(mgr, "P1");
    await mgr.configureServer("P1" as ServerId, {
      startCommand: "./custom.sh +InternetServer/P1 -ThreadedConsole",
    });
    // 1. K-V 落库（明文 value_enc）
    const row = db
      .prepare("SELECT value_enc FROM settings WHERE key = ?")
      .get("startCommand:P1") as { value_enc: string };
    expect(row.value_enc).toBe(
      "./custom.sh +InternetServer/P1 -ThreadedConsole",
    );
    // 2. in-memory config 同步
    const list = await mgr.listServers();
    expect(list[0].startCommand).toBe(
      "./custom.sh +InternetServer/P1 -ThreadedConsole",
    );
  });

  it("createServer 显式传入 startCommand → 落 K-V", async () => {
    const { db, mgr } = setup();
    await mgr.createServer({
      id: "P2" as ServerId,
      name: "P2",
      gamePort: 27015,
      ownerSteamId: "76561198000000001",
      installDir: "/opt/unturned",
      startCommand: "./init.sh +InternetServer/P2 -ThreadedConsole",
    });
    const row = db
      .prepare("SELECT value_enc FROM settings WHERE key = ?")
      .get("startCommand:P2") as { value_enc: string };
    expect(row.value_enc).toBe("./init.sh +InternetServer/P2 -ThreadedConsole");
  });

  it("configureServer 不传 startCommand → 不删旧值（PATCH 语义）", async () => {
    const { db, mgr } = setup();
    await createServer(mgr, "P3");
    // 设一个命令
    await mgr.configureServer("P3" as ServerId, {
      startCommand: "./first.sh +InternetServer/P3 -ThreadedConsole",
    });
    // 再改名字，不传 startCommand
    await mgr.configureServer("P3" as ServerId, { name: "新名字" });
    // 旧命令应保留
    const row = db
      .prepare("SELECT value_enc FROM settings WHERE key = ?")
      .get("startCommand:P3") as { value_enc: string };
    expect(row.value_enc).toBe(
      "./first.sh +InternetServer/P3 -ThreadedConsole",
    );
    const list = await mgr.listServers();
    expect(list[0].name).toBe("新名字");
    expect(list[0].startCommand).toBe(
      "./first.sh +InternetServer/P3 -ThreadedConsole",
    );
  });

  it("removeServer 同步清掉 startCommand K-V", async () => {
    const { db, mgr } = setup();
    await createServer(mgr, "P4");
    await mgr.configureServer("P4" as ServerId, {
      startCommand: "./to-be-deleted.sh +InternetServer/P4 -ThreadedConsole",
    });
    await mgr.removeServer("P4" as ServerId);
    // startCommand K-V 没了
    const row = db
      .prepare("SELECT value_enc FROM settings WHERE key = ?")
      .get("startCommand:P4");
    expect(row).toBeUndefined();
  });

  it("重启模拟：loadServersFromDisk 从 K-V 恢复 startCommand 到 in-memory config", async () => {
    // 直接预置 K-V → 构造 ServerManager → 验证 config.startCommand 恢复
    const db = makeDb();
    db.prepare(
      `INSERT INTO settings (key, value_enc, updated_at) VALUES (?, ?, datetime('now'))`,
    ).run(
      "startCommand:R1",
      "./restored.sh +InternetServer/R1 -ThreadedConsole",
    );
    const discovery = {
      scanSync: vi.fn(() => [
        {
          id: "R1" as ServerId,
          name: "R1",
          gamePort: 27015,
          ownerSteamId: "76561198000000001",
        },
      ]),
    };
    const pty = makeMockPty();
    const mgr = new ServerManager(
      db as never,
      discovery,
      pty,
      makeMockConfig(),
      makeMockBroadcaster(),
    );
    const list = await mgr.listServers();
    expect(list[0].startCommand).toBe(
      "./restored.sh +InternetServer/R1 -ThreadedConsole",
    );
  });
});

// ─── applyChangesCore（Phase 2 审计 P0-1 回归）───────────────
describe("ServerManager — applyChangesCore（配置变更流水线）", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it("P0-1 回归：postStartHook 在 startInternal 之后执行（实例已 RUNNING）", async () => {
    const { pty, mgr } = setup();
    await started(mgr, pty, "A1");

    // 记录 hook 执行时实例状态
    const hookStates: string[] = [];
    const preStopCalled = vi.fn();
    const postStartCalled = vi.fn();

    const applyPromise = mgr.applyChangesCore("A1" as ServerId, {
      hook: "ldm_apply",
      preStopHook: async () => {
        preStopCalled();
        hookStates.push(`preStop:${mgr.getState("A1" as ServerId)}`);
      },
      postStartHook: async () => {
        postStartCalled();
        hookStates.push(`postStart:${mgr.getState("A1" as ServerId)}`);
      },
    });
    // applyChangesCore 内 waitForState 轮询——推进 3s 触发 startInternal 的 3s 兜底 transition(RUNNING)
    await vi.advanceTimersByTimeAsync(4000);
    await applyPromise;

    // 顺序：preStop（此时实例还没 stop，仍 RUNNING）→ 启动完成 → postStart（已 RUNNING）
    expect(preStopCalled).toHaveBeenCalledTimes(1);
    expect(postStartCalled).toHaveBeenCalledTimes(1);
    expect(hookStates).toEqual([
      `preStop:${ServerState.RUNNING}`,
      `postStart:${ServerState.RUNNING}`,
    ]);
    // 实例最终 RUNNING
    expect(mgr.getState("A1" as ServerId)).toBe(ServerState.RUNNING);
  });

  it("preStopHook 抛错 → 流水线 abort（不进入 stop + start）", async () => {
    const { pty, mgr } = setup();
    await started(mgr, pty, "A2");

    const { AppError } = await import("../src/utils/AppError.js");
    await expect(
      mgr.applyChangesCore("A2" as ServerId, {
        hook: "ldm_apply",
        preStopHook: async () => {
          throw new AppError("ldm-apply-failed", "应用失败", 500);
        },
      }),
    ).rejects.toMatchObject({ code: "ldm-apply-failed", status: 500 });

    // 实例没被 stop/start——仍是 RUNNING（started 后状态未动）
    expect(mgr.getState("A2" as ServerId)).toBe(ServerState.RUNNING);
  });

  it("postStartHook 抛错 → 仅记录不阻止（实例已启动）", async () => {
    const { pty, mgr } = setup();
    await started(mgr, pty, "A3");

    const { AppError } = await import("../src/utils/AppError.js");
    const applyPromise = mgr.applyChangesCore("A3" as ServerId, {
      hook: "ldm_apply",
      postStartHook: async () => {
        throw new AppError("pty-write-failed", "PTY 写入失败", 500);
      },
    });
    // 推进触发 RUNNING（waitForState 轮询）
    await vi.advanceTimersByTimeAsync(4000);
    await applyPromise;

    // 抛错被吞，实例仍 RUNNING
    expect(mgr.getState("A3" as ServerId)).toBe(ServerState.RUNNING);
  });

  it("重入保护：已有 activeOperation → 抛 operation-conflict", async () => {
    const { pty, mgr } = setup();
    await createServer(mgr, "A4");

    const { AppError } = await import("../src/utils/AppError.js");
    // 手动置 activeOperation 模拟已有操作
    const entry = (mgr as unknown as { servers: Map<string, { activeOperation: { type: string } }> }).servers.get("A4")!;
    entry.activeOperation = { type: "manual_restart" };

    await expect(
      mgr.applyChangesCore("A4" as ServerId, { hook: "ldm_apply" }),
    ).rejects.toMatchObject({ code: "operation-conflict", status: 409 });
  });
});
