import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import {
  ServerManager,
} from '../src/modules/server/ServerManager.js';
import { resolveInstallDir } from '../src/modules/server/pathResolver.js';
import {
  ServerState,
  type IProcessSupervisor,
  type IRconManager,
  type IA2SClient,
  type IConfigService,
  type IBroadcaster,
  type IServerDiscovery,
  type ServerEvent,
  type ServerId,
  type ActiveOperation,
} from '@unturned-manager/shared';

// T6: mock 启动脚本探测——避免 Windows 上真实 detectStartScript 返回 null 抛 500
vi.mock('../src/modules/server/startScript.js', () => ({
  detectStartScript: vi.fn(async () => 'ServerHelper.sh'),
  ensureStartScriptExecutable: vi.fn(async () => {}),
}));

// ─── Mocks ────────────────────────────────────────────────

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = MEMORY');
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

function makeMockProcess(): IProcessSupervisor {
  return {
    spawn: vi.fn(async (_id, _cmd, _args, _cwd) => 12345),
    gracefulShutdown: vi.fn(async () => {}),
    waitForExit: vi.fn(async () => {}),
    forceKill: vi.fn(() => {}),
    isRunning: vi.fn(() => false),
    destroy: vi.fn(async () => {}),
    onStdout: vi.fn(),
    onCrash: vi.fn(),
  };
}

function makeMockRcon(): IRconManager {
  return {
    register: vi.fn(),
    unregister: vi.fn(),
    connect: vi.fn(async () => {}),
    disconnect: vi.fn(),
    execute: vi.fn(async () => 'OK'),
    getProtocol: vi.fn(() => 'unreachable' as never),
    isReachable: vi.fn(() => true),
    destroy: vi.fn(async () => {}),
    onStateChange: vi.fn(),
  };
}

function makeMockA2S(): IA2SClient {
  return {
    register: vi.fn(),
    unregister: vi.fn(),
    query: vi.fn(async () => ({
      players: 0,
      maxPlayers: 16,
      map: 'PEI',
      version: '3.25',
      latency: 5,
    })),
    destroy: vi.fn(async () => {}),
  };
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
      Shutdown_Update_Detected_Message: '',
      Shutdown_Kick_Message: '',
    })),
    writeWorkshopFileIds: vi.fn(async () => {}),
    backup: vi.fn(async () => '/tmp/backup.json'),
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
    broadcast: vi.fn((event: ServerEvent) => { events.push(event); }),
    register: vi.fn(),
    unregister: vi.fn(),
    destroy: vi.fn(async () => {}),
  };
}

// ─── 测试 ────────────────────────────────────────────────

describe('ServerManager — 状态机', () => {
  let db: Database.Database;
  let proc: IProcessSupervisor;
  let rcon: IRconManager;
  let a2s: IA2SClient;
  let cfg: IConfigService;
  let bcast: IBroadcaster & { events: ServerEvent[] };
  let mgr: ServerManager;
  let discovery: IServerDiscovery;

  beforeEach(async () => {
    db = makeDb();
    proc = makeMockProcess();
    rcon = makeMockRcon();
    a2s = makeMockA2S();
    cfg = makeMockConfig();
    bcast = makeMockBroadcaster();
    discovery = makeMockDiscovery();
    mgr = new ServerManager(db as never, discovery, proc, rcon, a2s, cfg, bcast);
  });

  it('createServer 写入 DB + STOPPED', async () => {
    await mgr.createServer({
      id: 'SMTest' as ServerId,
      name: 'Test',
      gamePort: 27015,
      ownerSteamId: '76561198000000001',
      installDir: '/opt/unturned',
    });
    expect(mgr.getState('SMTest' as ServerId)).toBe(ServerState.STOPPED);
    const list = await mgr.listServers();
    expect(list).toHaveLength(1);
  });

  it('start 流程：STOPPED → STARTING → RUNNING 广播', async () => {
    await mgr.createServer({
      id: 'S1' as ServerId, name: 'S1', gamePort: 27015,
      ownerSteamId: '76561198000000001', installDir: '/opt/unturned',
    });
    const promise = mgr.start('S1' as ServerId);
    // 同步断言：操作中
    expect(mgr.getActiveOperation('S1' as ServerId).type).toBe('manual_start');
    await promise;
    expect(mgr.getState('S1' as ServerId)).toBe(ServerState.RUNNING);
    const states = bcast.events.filter((e) => e.type === 'state_change').map((e) => (e as { to: ServerState }).to);
    expect(states).toEqual([ServerState.STARTING, ServerState.RUNNING]);
  });

  it('并发 start 应 409', async () => {
    await mgr.createServer({
      id: 'S1' as ServerId, name: 'S1', gamePort: 27015,
      ownerSteamId: '76561198000000001', installDir: '/opt/unturned',
    });
    const first = mgr.start('S1' as ServerId);
    await expect(mgr.start('S1' as ServerId)).rejects.toMatchObject({ status: 409 });
    await first;
  });

  it('stop 流程：save → shutdown → SIGTERM 等待 → STOPPED', async () => {
    await mgr.createServer({
      id: 'S1' as ServerId, name: 'S1', gamePort: 27015,
      ownerSteamId: '76561198000000001', installDir: '/opt/unturned',
    });
    await mgr.start('S1' as ServerId);
    expect(mgr.getState('S1' as ServerId)).toBe(ServerState.RUNNING);
    await mgr.stop('S1' as ServerId, 'unit-test');
    expect(mgr.getState('S1' as ServerId)).toBe(ServerState.STOPPED);
    expect(rcon.execute).toHaveBeenCalledWith('S1' as ServerId, 'Save');
    expect(rcon.execute).toHaveBeenCalledWith('S1' as ServerId, expect.stringContaining('Shutdown 30'));
  });

  it('restart 全程一个 activeOperation 覆盖', async () => {
    await mgr.createServer({
      id: 'S1' as ServerId, name: 'S1', gamePort: 27015,
      ownerSteamId: '76561198000000001', installDir: '/opt/unturned',
    });
    await mgr.start('S1' as ServerId);
    const promise = mgr.restart('S1' as ServerId, 'restart-test');
    expect(mgr.getActiveOperation('S1' as ServerId).type).toBe('manual_restart');
    await promise;
    // restart 完成后应能再 restart（activeOperation 已释放）
    const promise2 = mgr.restart('S1' as ServerId, 'restart-test-2');
    expect(mgr.getActiveOperation('S1' as ServerId).type).toBe('manual_restart');
    await promise2;
  });

  it('forceStop 立即 STOPPED', async () => {
    await mgr.createServer({
      id: 'S1' as ServerId, name: 'S1', gamePort: 27015,
      ownerSteamId: '76561198000000001', installDir: '/opt/unturned',
    });
    await mgr.start('S1' as ServerId);
    await mgr.forceStop('S1' as ServerId);
    expect(mgr.getState('S1' as ServerId)).toBe(ServerState.STOPPED);
    expect(proc.forceKill).toHaveBeenCalled();
  });

  it('applyModChanges：state 非 RUNNING/DEGRADED → 409', async () => {
    await mgr.createServer({
      id: 'S1' as ServerId, name: 'S1', gamePort: 27015,
      ownerSteamId: '76561198000000001', installDir: '/opt/unturned',
    });
    // STOPPED 状态下调用 mod_apply 应抛 409
    await expect(mgr.applyModChanges('S1' as ServerId, ['id1'])).rejects.toMatchObject({
      status: 409,
    });
  });

  it('listServersSync 同步返 in-memory serverId 列表', () => {
    expect(mgr.listServersSync()).toEqual([]);
  });
});

describe('ServerManager — activeOperation 锁', () => {
  it('操作完成后 activeOperation.type 回到 none', async () => {
    const db = makeDb();
    const proc = makeMockProcess();
    const rcon = makeMockRcon();
    const a2s = makeMockA2S();
    const cfg = makeMockConfig();
    const bcast = makeMockBroadcaster();
    const discovery = makeMockDiscovery();
    const mgr = new ServerManager(db as never, discovery, proc, rcon, a2s, cfg, bcast);

    await mgr.createServer({
      id: 'S1' as ServerId, name: 'S1', gamePort: 27015,
      ownerSteamId: '76561198000000001', installDir: '/opt/unturned',
    });
    await mgr.start('S1' as ServerId);
    expect(mgr.getActiveOperation('S1' as ServerId).type).toBe('none');
  });
});

describe('ServerManager — T6 启动脚本 + 崩溃 5s 重启', () => {
  afterEach(() => vi.useRealTimers());

  async function setup() {
    const db = makeDb();
    const proc = makeMockProcess();
    const rcon = makeMockRcon();
    const a2s = makeMockA2S();
    const cfg = makeMockConfig();
    const bcast = makeMockBroadcaster();
    const discovery = makeMockDiscovery();
    const mgr = new ServerManager(db as never, discovery, proc, rcon, a2s, cfg, bcast);
    return { mgr, proc };
  }

  it('start 经 spawnU3DS：ServerHelper.sh → 多实例参数 +InternetServer/<id>', async () => {
    const { mgr, proc } = await setup();
    await mgr.createServer({
      id: 'T1' as ServerId, name: 'T1', gamePort: 27015,
      ownerSteamId: '76561198000000001', installDir: '/opt/unturned',
    });
    await mgr.start('T1' as ServerId);
    const dir = resolveInstallDir();
    expect(proc.spawn).toHaveBeenCalledWith(
      'T1' as ServerId,
      `${dir}/ServerHelper.sh`,
      ['+InternetServer/T1', '-ThreadedConsole'],
      dir,
    );
  });

  it('崩溃（exitCode≠0）→ 5s 后自动重启（spawn 调 2 次）', async () => {
    vi.useFakeTimers();
    const { mgr, proc } = await setup();
    await mgr.createServer({
      id: 'T2' as ServerId, name: 'T2', gamePort: 27015,
      ownerSteamId: '76561198000000001', installDir: '/opt/unturned',
    });
    await mgr.start('T2' as ServerId);
    expect(proc.spawn).toHaveBeenCalledTimes(1);
    const onCrash = vi.mocked(proc.onCrash).mock.calls[0][0];
    onCrash('T2' as ServerId, 1);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(proc.spawn).toHaveBeenCalledTimes(2);
  });

  it('exitCode===0（RCON 优雅退出）→ 不重启', async () => {
    vi.useFakeTimers();
    const { mgr, proc } = await setup();
    await mgr.createServer({
      id: 'T3' as ServerId, name: 'T3', gamePort: 27015,
      ownerSteamId: '76561198000000001', installDir: '/opt/unturned',
    });
    await mgr.start('T3' as ServerId);
    const onCrash = vi.mocked(proc.onCrash).mock.calls[0][0];
    onCrash('T3' as ServerId, 0);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(proc.spawn).toHaveBeenCalledTimes(1);
  });

  it('activeOperation 非 none（用户操作期间退出）→ 不重启', async () => {
    vi.useFakeTimers();
    const { mgr, proc } = await setup();
    await mgr.createServer({
      id: 'T4' as ServerId, name: 'T4', gamePort: 27015,
      ownerSteamId: '76561198000000001', installDir: '/opt/unturned',
    });
    const promise = mgr.start('T4' as ServerId);
    // start 进行中（activeOperation=manual_start）进程退出 → 不重启
    expect(mgr.getActiveOperation('T4' as ServerId).type).toBe('manual_start');
    const onCrash = vi.mocked(proc.onCrash).mock.calls[0][0];
    onCrash('T4' as ServerId, 1);
    await promise;
    await vi.advanceTimersByTimeAsync(5_000);
    expect(proc.spawn).toHaveBeenCalledTimes(1);
  });
});
