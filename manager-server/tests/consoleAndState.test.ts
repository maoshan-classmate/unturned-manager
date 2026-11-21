import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { ServerManager } from "../src/modules/server/ServerManager.js";
import type {
  IPtyManager,
  IConfigService,
  IBroadcaster,
  IServerDiscovery,
  ServerEvent,
  PtyDataCallback,
  PtyExitCallback,
} from "@unturned-manager/shared";

vi.mock("../src/modules/server/startScript.js", () => ({
  detectStartScript: vi.fn(async () => "ServerHelper.sh"),
  ensureStartScriptExecutable: vi.fn(async () => {}),
  startScriptNames: vi.fn(() => ["ServerHelper.sh"]),
  normalizeStartCommand: vi.fn((cmd: string) => ({
    command: cmd,
    changed: false,
  })),
}));

function makeDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("journal_mode = MEMORY");
  db.exec(`CREATE TABLE settings (
    key TEXT PRIMARY KEY, value_enc TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  return db;
}

function makeMockPty() {
  const dataCallbacks = new Map<string, PtyDataCallback>();
  return {
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(async () => {}),
    forceKill: vi.fn(),
    isRunning: vi.fn(() => true),
    spawn: vi.fn(async () => 123),
    onData: vi.fn((id: string, cb: PtyDataCallback) => {
      dataCallbacks.set(id, cb);
      return () => {};
    }),
    onChunk: vi.fn(() => () => {}),
    onExit: vi.fn((_id: string, _cb: PtyExitCallback) => () => {}),
    waitExit: vi.fn(async () => true),
    waitForMarker: vi.fn(async () => {}),
    destroy: vi.fn(async () => {}),
    dataCallbacks,
  } as unknown as IPtyManager & { dataCallbacks: Map<string, PtyDataCallback> };
}

function makeMockConfig(): IConfigService {
  return {
    readCommandsDat: vi.fn(async () => ({ known: {}, unknown: {}, comments: [] })),
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

function makeBroadcaster() {
  const events: ServerEvent[] = [];
  return {
    events,
    broadcast: vi.fn((e: ServerEvent) => events.push(e)),
    init: vi.fn(),
    register: vi.fn(),
    unregister: vi.fn(),
    registerRequestHandler: vi.fn(),
    destroy: vi.fn(async () => {}),
  } as unknown as IBroadcaster & { events: ServerEvent[] };
}

function setup() {
  const db = makeDb();
  const pty = makeMockPty();
  const bcast = makeBroadcaster();
  const discovery = { scanSync: vi.fn(() => []) } as unknown as IServerDiscovery;
  const mgr = new ServerManager(db, discovery, pty, makeMockConfig(), bcast);
  return { mgr, pty, bcast };
}

describe("游戏退出后状态同步", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("PTY 输出关服完成标志后状态转 STOPPED", async () => {
    const { mgr, pty, bcast } = setup();
    await mgr.createServer({ id: "S1" as never, name: "S1", gamePort: 27015, ownerSteamId: "x", installDir: "/opt/unturned" });

    await mgr.start("S1" as never);
    // 推进定时器让 STARTING → RUNNING
    await vi.advanceTimersByTimeAsync(3000);
    expect(mgr.getState("S1" as never)).toBe("RUNNING");

    // 模拟游戏输出 "Finished quitting"
    const cb = pty.dataCallbacks.get("S1");
    expect(cb).toBeDefined();
    cb?.("[2026-11-21 08:29:03] Finished quitting");

    expect(mgr.getState("S1" as never)).toBe("STOPPED");
    expect(bcast.events).toContainEqual(
      expect.objectContaining({
        type: "state_change",
        serverId: "S1",
        from: "RUNNING",
        to: "STOPPED",
      }),
    );
  });

  it("普通日志输出不会误转 STOPPED", async () => {
    const { mgr, pty } = setup();
    await mgr.createServer({ id: "S1" as never, name: "S1", gamePort: 27015, ownerSteamId: "x", installDir: "/opt/unturned" });
    await mgr.start("S1" as never);
    await vi.advanceTimersByTimeAsync(3000);

    const cb = pty.dataCallbacks.get("S1");
    cb?.("[2026-11-21 08:29:03] Application quitting");

    expect(mgr.getState("S1" as never)).toBe("RUNNING");
  });
});
