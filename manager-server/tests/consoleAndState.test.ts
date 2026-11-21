import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import fs from "fs/promises";
import path from "path";
import os from "os";

// config 模块加载时读取 INSTALL_DIR——在 import ServerManager 前设置
const TEST_DIR = path.join(os.tmpdir(), "quit-watch-" + process.pid);
process.env.INSTALL_DIR = TEST_DIR;

const { ServerManager } = await import("../src/modules/server/ServerManager.js");
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

let tmpDir: string;

function setup() {
  const db = makeDb();
  const pty = makeMockPty();
  const bcast = makeBroadcaster();
  const discovery = { scanSync: vi.fn(() => []) } as unknown as IServerDiscovery;
  const mgr = new ServerManager(db, discovery, pty, makeMockConfig(), bcast);
  return { mgr, pty, bcast };
}

describe("游戏退出后状态同步（日志检测）", () => {
  beforeEach(async () => {
    tmpDir = TEST_DIR;
    await fs.mkdir(path.join(tmpDir, "Logs"), { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("日志出现关服完成标志后状态转 STOPPED", async () => {
    const { mgr, bcast } = setup();
    await mgr.createServer({
      id: "S1" as never,
      name: "S1",
      gamePort: 27015,
      ownerSteamId: "x",
      installDir: tmpDir,
    });
    await mgr.start("S1" as never);
    await new Promise((r) => setTimeout(r, 200));
    expect(mgr.getState("S1" as never)).toBe("RUNNING");

    // 模拟游戏写关服日志
    await fs.writeFile(
      path.join(tmpDir, "Logs", "Server_S1.log"),
      "[2026-11-21 08:29:03] Finished quitting\n",
    );
    // 推进定时器触发检测
    await new Promise((r) => setTimeout(r, 3500));

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

  it("日志没有退出标志时保持 RUNNING", async () => {
    const { mgr } = setup();
    await mgr.createServer({
      id: "S1" as never,
      name: "S1",
      gamePort: 27015,
      ownerSteamId: "x",
      installDir: tmpDir,
    });
    await mgr.start("S1" as never);
    await new Promise((r) => setTimeout(r, 200));

    await fs.writeFile(
      path.join(tmpDir, "Logs", "Server_S1.log"),
      "[2026-11-21 08:29:03] Application quitting\n",
    );
    await new Promise((r) => setTimeout(r, 3500));

    expect(mgr.getState("S1" as never)).toBe("RUNNING");
  });
});
