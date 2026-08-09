import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { WorkshopAcfService } from '../src/modules/workshop/WorkshopAcfService.js';
import type { IConfigService, ServerId, WorkshopFileId } from '@unturned-manager/shared';

// ─── Mock IConfigService ──────────────────────────────────

function makeConfigService(): IConfigService {
  // IConfigService 接口在单测中只需要 install_dir → filePath 映射，
  // 实际 writeWorkshopFileIds / readWorkshopConfig 由 AcfService 通过 db 自身管，
  // 只需要不抛错即可。
  return {} as IConfigService;
}

// ─── 测试基础设施 ────────────────────────────────────────

let tmpDir: string;
let db: Database.Database;
let acfService: WorkshopAcfService;
const SERVER_ID = 'TestServer' as ServerId;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'unturned-acf-test-'));
  const installDir = path.join(tmpDir, 'U3DS');
  const serverDir = path.join(installDir, 'Servers', SERVER_ID);
  const workshopDir = path.join(serverDir, 'Workshop', 'steamapps', 'workshop');
  await fs.mkdir(workshopDir, { recursive: true });

  db = new Database(':memory:');
  db.exec(`
    CREATE TABLE servers (
      id TEXT PRIMARY KEY,
      install_dir TEXT NOT NULL
    );
  `);
  db.prepare('INSERT INTO servers (id, install_dir) VALUES (?, ?)').run(SERVER_ID, installDir);

  acfService = new WorkshopAcfService(db, makeConfigService());
});

afterEach(async () => {
  db.close();
  await fs.rm(tmpDir, { recursive: true, force: true });
});

// ─── parse ──────────────────────────────────────────────

describe('WorkshopAcfService · parse', () => {
  it('acf 不存在返回空 acf', async () => {
    const acf = await acfService.parse(SERVER_ID);
    expect(acf.appid).toBe('1110390');
    expect(acf.items.size).toBe(0);
  });

  it('解析真实格式 acf', async () => {
    const acfPath = path.join(tmpDir, 'U3DS', 'Servers', SERVER_ID, 'Workshop', 'steamapps', 'workshop', 'appworkshop_1110390.acf');
    await fs.writeFile(
      acfPath,
      `"AppWorkshop"
{
	"appid"		"1110390"
	"WorkshopItemsInstalled"
	{
		"1753134636"
		{
			"timeupdated"		"1722612345"
			"size"				"12345678"
			"manifest"			"4567890123456789"
		}
		"1234567890"
		{
			"timeupdated"		"1722612789"
			"size"				"9876543"
		}
	}
}`,
      'utf-8',
    );
    const acf = await acfService.parse(SERVER_ID);
    expect(acf.appid).toBe('1110390');
    expect(acf.items.size).toBe(2);
    expect(acf.items.get('1753134636' as WorkshopFileId)).toEqual({
      fileId: '1753134636' as WorkshopFileId,
      timeupdated: 1722612345,
      size: 12345678,
      manifest: '4567890123456789',
    });
  });
});

// ─── write + addItem + removeItem ───────────────────────

describe('WorkshopAcfService · write/addItem/removeItem', () => {
  it('write 原子写 + 创建备份', async () => {
    // 先创建原 acf
    const acfPath = path.join(tmpDir, 'U3DS', 'Servers', SERVER_ID, 'Workshop', 'steamapps', 'workshop', 'appworkshop_1110390.acf');
    await fs.writeFile(acfPath, '"AppWorkshop"\n{\n  "appid"\t\t"1110390"\n}\n', 'utf-8');

    await acfService.write(SERVER_ID, {
      appid: '1110390',
      items: new Map(),
    });

    // 备份存在
    const files = await fs.readdir(path.dirname(acfPath));
    const backup = files.find((f) => f.startsWith('appworkshop_1110390.acf.bak.'));
    expect(backup).toBeDefined();
  });

  it('addItem 后 listItems 包含该项', async () => {
    const fileId = '1753134636' as WorkshopFileId;
    await acfService.addItem(SERVER_ID, fileId, {
      fileId,
      timeupdated: 1722612345,
      size: 12345678,
    });
    const items = await acfService.listItems(SERVER_ID);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ fileId, size: 12345678 });
  });

  it('addItem 失败回滚（写不进去时不留半成品）', async () => {
    const fileId = '1753134636' as WorkshopFileId;
    await acfService.addItem(SERVER_ID, fileId, {
      fileId,
      timeupdated: 1722612345,
      size: 12345678,
    });
    // 模拟磁盘写失败——把 install_dir 改成不可写位置
    db.prepare('UPDATE servers SET install_dir = ? WHERE id = ?').run('/proc/0/cannot-write', SERVER_ID);
    await expect(
      acfService.addItem('Other' as ServerId, fileId, {
        fileId,
        timeupdated: 999,
        size: 1,
      }),
    ).rejects.toThrow();
  });

  it('removeItem 后 listItems 不包含该项', async () => {
    const fileId = '1753134636' as WorkshopFileId;
    await acfService.addItem(SERVER_ID, fileId, {
      fileId,
      timeupdated: 1722612345,
      size: 12345678,
    });
    await acfService.removeItem(SERVER_ID, fileId);
    const items = await acfService.listItems(SERVER_ID);
    expect(items).toHaveLength(0);
  });

  it('removeItem 不存在的 mod 幂等返回', async () => {
    const fileId = '999999' as WorkshopFileId;
    await expect(acfService.removeItem(SERVER_ID, fileId)).resolves.toBeUndefined();
  });
});

// ─── backup + rollback ──────────────────────────────────

describe('WorkshopAcfService · backup/rollback', () => {
  it('backup 返回 .bak.<UTC-ISO> 路径', async () => {
    const fileId = '1753134636' as WorkshopFileId;
    await acfService.addItem(SERVER_ID, fileId, {
      fileId,
      timeupdated: 1722612345,
      size: 12345678,
    });
    const backupPath = await acfService.backup(SERVER_ID);
    expect(backupPath).toMatch(/\.bak\.\d{4}-\d{2}-\d{2}T/);
  });

  it('rollback 从备份恢复 acf', async () => {
    const fileId = '1753134636' as WorkshopFileId;
    await acfService.addItem(SERVER_ID, fileId, {
      fileId,
      timeupdated: 1722612345,
      size: 12345678,
    });
    const backupPath = await acfService.backup(SERVER_ID);
    // 改 acf（加新 mod）
    await acfService.addItem(SERVER_ID, '9999999' as WorkshopFileId, {
      fileId: '9999999' as WorkshopFileId,
      timeupdated: 1,
      size: 1,
    });
    expect((await acfService.listItems(SERVER_ID))).toHaveLength(2);
    // 回滚
    await acfService.rollback(SERVER_ID, backupPath);
    expect((await acfService.listItems(SERVER_ID))).toHaveLength(1);
  });

  it('acf 不存在时 backup 抛错', async () => {
    await expect(acfService.backup(SERVER_ID)).rejects.toThrow(/acf 不存在/);
  });
});

// ─── parseStagingItem ──────────────────────────────────

describe('WorkshopAcfService · parseStagingItem', () => {
  it('staging acf 不存在返回 null', async () => {
    const item = await acfService.parseStagingItem(SERVER_ID, '1753134636' as WorkshopFileId);
    expect(item).toBeNull();
  });

  it('staging acf 存在且包含该 mod 时返回元数据', async () => {
    const stagingAcfDir = path.join(tmpDir, 'U3DS', 'Servers', SERVER_ID, 'Workshop', 'staging', 'steamapps', 'workshop');
    await fs.mkdir(stagingAcfDir, { recursive: true });
    const stagingAcfPath = path.join(stagingAcfDir, 'appworkshop_1110390.acf');
    await fs.writeFile(
      stagingAcfPath,
      `"AppWorkshop"
{
	"appid"		"1110390"
	"WorkshopItemsInstalled"
	{
		"1753134636"
		{
			"timeupdated"		"1722612345"
			"size"				"12345678"
		}
	}
}`,
      'utf-8',
    );
    const item = await acfService.parseStagingItem(SERVER_ID, '1753134636' as WorkshopFileId);
    expect(item).toEqual({
      fileId: '1753134636' as WorkshopFileId,
      timeupdated: 1722612345,
      size: 12345678,
    });
  });
});
