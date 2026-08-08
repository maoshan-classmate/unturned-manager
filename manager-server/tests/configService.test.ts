import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import Database from 'better-sqlite3';
import { ConfigService } from '../src/modules/config/ConfigService.js';
import { FileLockProvider } from '../src/modules/filelock/FileLockProvider.js';
import type { ServerId } from '@unturned-manager/shared';

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
    CREATE TABLE config_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      server_id TEXT NOT NULL,
      file_path TEXT NOT NULL,
      content TEXT NOT NULL,
      version INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  return db;
}

describe('ConfigService — 5 种格式往返', () => {
  let tmpDir: string;
  let db: Database.Database;
  let svc: ConfigService;
  const serverId: ServerId = 'TestServer' as ServerId;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'um-cfg-'));
    db = makeDb();
    db.prepare(
      'INSERT INTO servers (id, name, game_port, install_dir) VALUES (?, ?, ?, ?)',
    ).run('TestServer', 'TestServer', 27015, tmpDir);

    // 创建 Servers/<id>/ 子目录
    await fs.mkdir(path.join(tmpDir, 'Servers', 'TestServer', 'Server'), { recursive: true });

    svc = new ConfigService(db as never, new FileLockProvider());
  });

  it('Commands.dat: read → write → read 等价', async () => {
    const input = 'Name MyServer\nPort 27015\nCheats\n# comment\nUnknownKey customValue\n';
    await fs.writeFile(path.join(tmpDir, 'Servers', 'TestServer', 'Server', 'Commands.dat'), input);

    const first = await svc.readCommandsDat(serverId);
    expect(first.known.Name).toBe('MyServer');
    expect(first.known.Port).toBe('27015');
    expect(first.known.Cheats).toBe('');
    expect(first.unknown.UnknownKey).toBe('customValue');
    expect(first.comments).toContain('# comment');

    await svc.writeCommandsDat(serverId, first);
    const second = await svc.readCommandsDat(serverId);
    expect(second.known.Name).toBe(first.known.Name);
    expect(second.known.Port).toBe(first.known.Port);
    expect(second.known.Cheats).toBe(first.known.Cheats);
    expect(second.unknown.UnknownKey).toBe('customValue');
  });

  it('Commands.dat: 乐观锁 version 冲突抛 VERSION_CONFLICT', async () => {
    const relativePath = 'Servers/TestServer/Server/Commands.dat';
    await fs.writeFile(path.join(tmpDir, relativePath), 'Name A\n');

    await svc.writeCommandsDat(serverId, {
      known: { Name: 'A' },
      unknown: {},
      comments: [],
    }, 0); // expectedVersion=0 → 当前是 0 → 写成功，版本变 1

    await expect(
      svc.writeCommandsDat(serverId, { known: { Name: 'B' }, unknown: {}, comments: [] }, 0),
    ).rejects.toThrow('VERSION_CONFLICT');
  });

  it('Config.txt: sections Record 往返', async () => {
    // ConfigService parseConfigTxt 只认 '=' 或 ':' 分隔（当前实现），所以测试用等号
    const input = '[Browser]\nLogin_Token=abc123\nDesc_Full=hello\n\n[Server]\nVAC_Secure=true\n';
    await fs.writeFile(path.join(tmpDir, 'Servers', 'TestServer', 'Config.txt'), input);

    const first = await svc.readConfigTxt(serverId);
    expect(first.sections.Browser?.entries).toContainEqual(
      expect.objectContaining({ key: 'Login_Token', value: 'abc123' }),
    );
    expect(first.sections.Server?.entries[0]?.key).toBe('VAC_Secure');

    await svc.writeConfigTxt(serverId, first);
    const second = await svc.readConfigTxt(serverId);
    expect(Object.keys(second.sections).sort()).toEqual(['Browser', 'Server']);
  });

  it('Workshop.json: 只写 File_IDs，其他字段不动', async () => {
    const input = JSON.stringify({
      File_IDs: ['1', '2'],
      Should_Monitor_Updates: true,
      Query_Cache_Max_Age_Seconds: 600,
      Max_Query_Retries: 2,
      Use_Cached_Downloads: true,
      Shutdown_Update_Detected_Timer: 600,
      Shutdown_Update_Detected_Message: 'msg1',
      Shutdown_Kick_Message: 'msg2',
    });
    await fs.writeFile(path.join(tmpDir, 'Servers', 'TestServer', 'Server', 'WorkshopDownloadConfig.json'), input);

    await svc.writeWorkshopFileIds(serverId, ['3', '4']);
    const content = await fs.readFile(path.join(tmpDir, 'Servers', 'TestServer', 'Server', 'WorkshopDownloadConfig.json'), 'utf-8');
    const parsed = JSON.parse(content);
    expect(parsed.File_IDs).toEqual(['3', '4']);
    expect(parsed.Should_Monitor_Updates).toBe(true);
    expect(parsed.Shutdown_Update_Detected_Message).toBe('msg1');  // 未被改写
  });

  it('OpenMod YAML: 写入+读回等价', async () => {
    await fs.mkdir(path.join(tmpDir, 'Servers', 'TestServer', 'openmod', 'plugins', 'Economy'), { recursive: true });
    const svc2 = svc;

    const input = { Rate: 100, Enabled: true, Name: 'economy' };
    await svc2.writeOpenModConfig(serverId, 'Economy', input);
    const back = await svc2.readOpenModConfig(serverId, 'Economy');
    expect(back.Rate).toBe(100);
    expect(back.Enabled).toBe(true);
    expect(back.Name).toBe('economy');
  });

  it('Rocket XML: 写入+读回关键字段', async () => {
    await fs.mkdir(path.join(tmpDir, 'Servers', 'TestServer', 'Rocket', 'Plugins', 'BasicChat'), { recursive: true });
    const input = { PluginSettings: { MaxMessageLength: 200, AllowLinks: false } };
    await svc.writeRocketModConfig(serverId, 'BasicChat', input);
    const back = await svc.readRocketModConfig(serverId, 'BasicChat');
    expect(back.PluginSettings).toBeDefined();
  });
});
