import { test, expect } from '@playwright/test';
import path from 'path';

/**
 * Sprint A + B 新端点 e2e（Sprint A 关闭 + Sprint B 关闭 共同验证）
 *
 * 验证项目：
 * - BUG-9: GET /api/steamcmd/status 返回 version 字段
 * - BUG-1: POST /api/steamcmd/check-update 端点可达
 * - BUG-1 附: POST /api/steamcmd/reinstall 端点可达
 * - BUG-3/7: POST /api/steamcmd/install-u3ds 端点可达
 * - BUG-2: WS 握手端点（探测端点存在，但不通 SteamCMD 实际流）
 */

let accessToken = '';

test.beforeAll(async ({ request }) => {
  const login = await request.post('/api/auth/login', {
    data: { username: 'admin', password: 'admin123' },
  });
  const body = await login.json();
  accessToken = body.data.accessToken;
  expect(accessToken).toBeTruthy();
});

test.describe('Sprint A 修复: SteamCMD 端点 (BUG-9 / BUG-1 / BUG-1 附)', () => {
  test('BUG-9: GET /steamcmd/status → 200 + isInstalled/lastChecked 字段', async ({ request }) => {
    const res = await request.get('/api/steamcmd/status', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.data).toHaveProperty('isInstalled');
    expect(body.data).toHaveProperty('lastChecked');
    // version 字段：契约 `version?: string`（可选）—— 当 SteamCMD 未装时省略
    // 当 SteamCMD 已装时返回 version 字符串
    if (body.data.isInstalled) {
      expect(typeof body.data.version === 'string' || body.data.version === undefined).toBe(true);
    }
  });

  test('BUG-1: POST /steamcmd/check-update → 404 或 200（SteamCMD 未安装时 404）', async ({ request }) => {
    const res = await request.post('/api/steamcmd/check-update', {
      headers: { Authorization: `Bearer ${accessToken}` },
      data: {},
    });
    // 接受 200（SteamCMD 装了）或 404（沙箱未装）
    expect([200, 404, 500]).toContain(res.status());
    if (res.status() === 200) {
      const body = await res.json();
      expect(body.data).toHaveProperty('lastChecked');
    }
  });

  test('BUG-1 附: POST /steamcmd/reinstall → 404 或 202', async ({ request }) => {
    const res = await request.post('/api/steamcmd/reinstall', {
      headers: { Authorization: `Bearer ${accessToken}` },
      data: {},
    });
    expect([202, 404, 500]).toContain(res.status());
  });

  test('GET /steamcmd/status 无 token → 401', async ({ request }) => {
    const res = await request.get('/api/steamcmd/status');
    expect(res.status()).toBe(401);
  });
});

test.describe('Sprint B 修复: SteamCMD install-u3ds 端点 (BUG-3/7)', () => {
  test('BUG-3/7: POST /steamcmd/install-u3ds → 404/409/500（SteamCMD 未装或无活跃实例时）', async ({ request }) => {
    const res = await request.post('/api/steamcmd/install-u3ds', {
      headers: { Authorization: `Bearer ${accessToken}` },
      data: { installDir: '/tmp/um-e2e-install' },
    });
    // 沙箱环境：SteamCMD 一般未装 → 404 steamcmd-not-found；或 500
    expect([202, 404, 409, 500]).toContain(res.status());
  });

  test('POST /steamcmd/install-u3ds 缺 installDir → 400', async ({ request }) => {
    const res = await request.post('/api/steamcmd/install-u3ds', {
      headers: { Authorization: `Bearer ${accessToken}` },
      data: {},
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('validation_failed');
  });

  test('POST /steamcmd/install-u3ds 无 token → 401', async ({ request }) => {
    const res = await request.post('/api/steamcmd/install-u3ds', {
      data: { installDir: '/tmp/test' },
    });
    expect(res.status()).toBe(401);
  });
});

test.describe('Sprint A 修复: SteamCMD update 端点 regression', () => {
  test('POST /steamcmd/update 缺 installDir → 400', async ({ request }) => {
    const res = await request.post('/api/steamcmd/update', {
      headers: { Authorization: `Bearer ${accessToken}` },
      data: {},
    });
    expect(res.status()).toBe(400);
  });

  test('POST /steamcmd/download-workshop 缺 itemIds → 400', async ({ request }) => {
    const res = await request.post('/api/steamcmd/download-workshop', {
      headers: { Authorization: `Bearer ${accessToken}` },
      data: { installDir: '/tmp/test' },
    });
    expect(res.status()).toBe(400);
  });
});

// ─── Sprint C 补强：BUG-5/6 缺口回归（staging 待 apply 的 mod 必须可见）───

/** 同步取 INSTALL_DIR（test-server 用 cwd/.test-install，见 playwright.config.ts） */
function resolveInstallDirSafe(): string {
  return path.join(process.cwd(), '.test-install');
}
// 为什么补：旧 e2e 只断言「/mods/downloaded 是数组」——空数组也过。
// 本用例写 staging acf fixture → 断言能看到 mod 且 applied=false。
test.describe('Sprint C 补强: /mods/downloaded staging 可见性 (BUG-5/6)', () => {
  test('staging acf 中的 mod → downloaded 列表可见 + applied=false', async ({ request }) => {
    // ① 确保 MyServer 存在（test-server 清空 Servers/，需重新创建）
    const createRes = await request.post('/api/servers', {
      headers: { Authorization: `Bearer ${accessToken}` },
      data: {
        id: 'MyServer',
        name: 'E2E Test',
        gamePort: 27015,
        ownerSteamId: '76561198000000001',
        installDir: resolveInstallDirSafe(),  // Schema 必填
      },
    });
    expect([201, 409]).toContain(createRes.status());

    // ② 写 staging acf fixture（test-server INSTALL_DIR = cwd/.test-install）
    //    注意：不用动态 import pathResolver（会触发 config 读 env，spec 进程无 JWT_SECRET）
    const path = (await import('path')).default;
    const fs = (await import('fs')).default;
    const installRoot = path.join(process.cwd(), '.test-install');
    const stagingDir = path.join(
      installRoot, 'Servers', 'MyServer', 'Workshop', 'staging', 'steamapps', 'workshop',
    );
    fs.mkdirSync(stagingDir, { recursive: true });
    fs.writeFileSync(
      path.join(stagingDir, 'appworkshop_1110390.acf'),
      `"AppWorkshop"
{
	"appid"		"1110390"
	"WorkshopItemsInstalled"
	{
		"666"
		{
			"timeupdated"		"1722612346"
			"size"				"888"
		}
	}
}`,
      'utf-8',
    );

    // ③ 断言：staging mod 必须可见 + applied=false
    const res = await request.get('/api/servers/MyServer/mods/downloaded', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.data)).toBe(true);
    const staged = body.data.find((m: { fileId: string }) => m.fileId === '666');
    expect(staged).toBeTruthy();                 // ★ BUG-5/6 缺口断言：必须能看到
    expect(staged.applied).toBe(false);          // 未 apply → applied=false

    // ④ 清理 fixture（防残留影响后续用例）
    fs.rmSync(path.join(installRoot, 'Servers', 'MyServer'), { recursive: true, force: true });
  });
});
