import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import { SteamCmdManager } from '../src/modules/steamcmd/SteamCmdManager.js';
import { RconManager } from '../src/modules/rcon/RconManager.js';
import { FilesService } from '../src/modules/files/FilesService.js';
import { FileLockProvider } from '../src/modules/filelock/FileLockProvider.js';
import type { IBroadcaster, IProcessSupervisor, ServerId } from '@unturned-manager/shared';

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = MEMORY');
  db.exec(`
    CREATE TABLE servers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      game_port INTEGER NOT NULL,
      state TEXT NOT NULL DEFAULT 'STOPPED',
      install_dir TEXT NOT NULL,
      rcon_port INTEGER,
      rcon_password_enc TEXT,
      owner_steam_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  return db;
}

function makeMockBroadcaster(): IBroadcaster {
  return {
    broadcast: vi.fn(),
    register: vi.fn(),
    unregister: vi.fn(),
    destroy: vi.fn(async () => {}),
  };
}

describe('SteamCmdManager', () => {
  it('updateU3DS: 有运行实例时拒绝', async () => {
    const db = makeDb();
    db.prepare(
      'INSERT INTO servers (id, name, game_port, state, install_dir) VALUES (?, ?, ?, ?, ?)',
    ).run('S1', 'S1', 27015, 'RUNNING', '/opt/unturned');

    const proc: IProcessSupervisor = {
      spawn: vi.fn(), gracefulShutdown: vi.fn(), waitForExit: vi.fn(),
      forceKill: vi.fn(), isRunning: vi.fn(), destroy: vi.fn(),
      onStdout: vi.fn(), onCrash: vi.fn(),
    };
    const mgr = new SteamCmdManager(db as never, proc, makeMockBroadcaster(), '/usr/bin/steamcmd');
    await expect(mgr.updateU3DS('/opt/unturned')).rejects.toThrow(/运行/);
  });

  it('updateU3DS: 全部 STOPPED 但 SteamCMD 不存在 → 拒绝', async () => {
    const db = makeDb();
    db.prepare(
      'INSERT INTO servers (id, name, game_port, state, install_dir) VALUES (?, ?, ?, ?, ?)',
    ).run('S1', 'S1', 27015, 'STOPPED', '/opt/unturned');
    const proc: IProcessSupervisor = {
      spawn: vi.fn(), gracefulShutdown: vi.fn(), waitForExit: vi.fn(),
      forceKill: vi.fn(), isRunning: vi.fn(), destroy: vi.fn(),
      onStdout: vi.fn(), onCrash: vi.fn(),
    };
    const mgr = new SteamCmdManager(db as never, proc, makeMockBroadcaster(), '/nope/steamcmd');
    await expect(mgr.updateU3DS('/opt/unturned')).rejects.toThrow(/未安装/);
  });

  it('parseProgressLine: downloading + 78% → stage=downloading, percent=78', () => {
    const db = makeDb();
    const proc: IProcessSupervisor = {
      spawn: vi.fn(), gracefulShutdown: vi.fn(), waitForExit: vi.fn(),
      forceKill: vi.fn(), isRunning: vi.fn(), destroy: vi.fn(),
      onStdout: vi.fn(), onCrash: vi.fn(),
    };
    const mgr = new SteamCmdManager(db as never, proc, makeMockBroadcaster());
    const parsed = (mgr as unknown as {
      parseProgressLine: (l: string) => { stage: string; percent?: number };
    }).parseProgressLine('Update state (0x61) downloading,78.36 MB  78% / 4589923');
    expect(parsed.stage).toBe('downloading');
    expect(parsed.percent).toBe(78);
  });
});

describe('RconManager — 模块结构验证', () => {
  it('execute 在未注册时抛错', async () => {
    const mgr = new RconManager();
    await expect(mgr.execute('X' as ServerId, 'help')).rejects.toThrow(/未连接/);
  });

  it('暴露执行与断开方法', () => {
    const mgr = new RconManager();
    expect(typeof mgr.execute).toBe('function');
    expect(typeof mgr.disconnect).toBe('function');
    expect(typeof mgr.register).toBe('function');
  });

  // 危险指令门控、私有函数 sanitizeCommand 已在 routes/rcon.ts 中由 DANGEROUS_COMMANDS 守卫（见 routes/rcon.ts 后端强制 428）
});

describe('FilesService', () => {
  let tmpDir: string;
  let db: Database.Database;
  let svc: FilesService;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'um-files-'));
    db = makeDb();
    db.prepare(
      'INSERT INTO servers (id, name, game_port, install_dir) VALUES (?, ?, ?, ?)',
    ).run('TestServer', 'TestServer', 27015, tmpDir);
    await fs.mkdir(path.join(tmpDir, 'Servers', 'TestServer'), { recursive: true });

    svc = new FilesService(new FileLockProvider(), db as never);
  });

  it('validatePath: `..` 越界拒绝', async () => {
    await expect(
      svc.listDirectory('TestServer' as ServerId, '../../../etc'),
    ).rejects.toMatchObject({});
  });

  it('listDirectory: 空目录 → []', async () => {
    const result = await svc.listDirectory('TestServer' as ServerId, '');
    expect(result).toEqual([]);
  });

  it('writeFile + readFile: 文本往返不破', async () => {
    await svc.writeFile('TestServer' as ServerId, 'Commands.dat', new TextEncoder().encode('Name X\n'));
    const buf = await svc.readFile('TestServer' as ServerId, 'Commands.dat');
    const text = new TextDecoder().decode(buf);
    expect(text).toBe('Name X\n');
  });

  it('敏感字段 GSLT/Password 脱敏', async () => {
    await svc.writeFile('TestServer' as ServerId, 'openmod.yaml',
      new TextEncoder().encode('GSLT mySecretToken123456\nPassword hunter2\n'));
    const buf = await svc.readFile('TestServer' as ServerId, 'openmod.yaml');
    const text = new TextDecoder().decode(buf);
    expect(text).toContain('GSLT [REDACTED]');
    expect(text).toContain('Password [REDACTED]');
    expect(text).not.toContain('mySecretToken123456');
  });
});
