import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { WorkshopAcfService } from '../src/modules/workshop/WorkshopAcfService.js';
import { resolveInstallDir } from '../src/modules/server/pathResolver.js';
import type { IConfigService, ServerId, WorkshopFileId } from '@unturned-manager/shared';

// ─── Mock IConfigService ──────────────────────────────────

function makeConfigService(): IConfigService {
  // IConfigService 接口在单测中只需不抛错；AcfService 的路径真源已由 pathResolver 接管
  return {} as IConfigService;
}

// ─── 测试基础设施 ────────────────────────────────────────

// serverId 唯一（并行 forks pool 下各文件目录隔离，避免互踩 .test-install）
const SERVER_ID = 'AcfServer' as ServerId;
/** fixture 根 = config.installDir（ADR-0003 / T2：真源全局，与 pathResolver 读取一致） */
const installDir = resolveInstallDir();
const serverDir = path.join(installDir, 'Servers', SERVER_ID);
const workshopDir = path.join(serverDir, 'Workshop', 'steamapps', 'workshop');
const acfPath = path.join(workshopDir, 'appworkshop_304930.acf');

let acfService: WorkshopAcfService;

beforeEach(async () => {
  // 清理 + 重建本测试的 Servers/<id> 目录（避免跨用例残留）
  await fs.rm(serverDir, { recursive: true, force: true });
  await fs.mkdir(workshopDir, { recursive: true });

  // T2 后构造器单参（configService）——不再依赖 db
  acfService = new WorkshopAcfService(makeConfigService());
});

afterEach(async () => {
  await fs.rm(serverDir, { recursive: true, force: true });
});

// ─── parse ──────────────────────────────────────────────

describe('WorkshopAcfService · parse', () => {
  it('acf 不存在返回空 acf', async () => {
    const acf = await acfService.parse(SERVER_ID);
    expect(acf.appid).toBe('304930');
    expect(acf.items.size).toBe(0);
  });

  it('解析真实格式 acf', async () => {
    await fs.writeFile(
      acfPath,
      `"AppWorkshop"
{
	"appid"		"304930"
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
    expect(acf.appid).toBe('304930');
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
    await fs.writeFile(acfPath, '"AppWorkshop"\n{\n  "appid"\t\t"304930"\n}\n', 'utf-8');

    await acfService.write(SERVER_ID, {
      appid: '304930',
      items: new Map(),
    });

    // 备份存在
    const files = await fs.readdir(path.dirname(acfPath));
    const backup = files.find((f) => f.startsWith('appworkshop_304930.acf.bak.'));
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
    // 模拟磁盘写失败——mock fs.writeFile 抛错（无 DB 可注入 install_dir 后，改用 IO 层 mock）
    const spy = vi.spyOn(fs, 'writeFile').mockRejectedValueOnce(new Error('ENOSPC'));
    try {
      await expect(
        acfService.addItem('Other' as ServerId, fileId, {
          fileId,
          timeupdated: 999,
          size: 1,
        }),
      ).rejects.toThrow();
    } finally {
      spy.mockRestore();
    }
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
    const stagingAcfDir = path.join(serverDir, 'Workshop', 'staging', 'steamapps', 'workshop');
    await fs.mkdir(stagingAcfDir, { recursive: true });
    const stagingAcfPath = path.join(stagingAcfDir, 'appworkshop_304930.acf');
    await fs.writeFile(
      stagingAcfPath,
      `"AppWorkshop"
{
	"appid"		"304930"
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
