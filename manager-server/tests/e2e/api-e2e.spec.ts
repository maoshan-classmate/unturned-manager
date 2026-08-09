import { test, expect } from '@playwright/test';

let accessToken = '';
let refreshToken = '';

// ─── D1 + D8: Login + 认证链路 ──────────────────────
test.describe('认证链路 (D1)', () => {
  test('login → 200 + tokens', async ({ request }) => {
    const res = await request.post('/api/auth/login', {
      data: { username: 'admin', password: 'admin123' },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    accessToken = body.data.accessToken;
    refreshToken = body.data.refreshToken;
    expect(accessToken).toBeTruthy();
    expect(refreshToken).toBeTruthy();
  });

  test('login 错误密码 → 401', async ({ request }) => {
    const res = await request.post('/api/auth/login', {
      data: { username: 'admin', password: 'wrong' },
    });
    expect(res.status()).toBe(401);
  });

  test('refresh → 200 + 新 token', async ({ request }) => {
    const res = await request.post('/api/auth/refresh', {
      data: { refreshToken },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    accessToken = body.data.accessToken;
  });
});

// ─── D4 + D5: 服务端 CRUD ────────────────────────────
test.describe('服务端 CRUD (D4,D5)', () => {
  test('创建服务器 → 201', async ({ request }) => {
    const res = await request.post('/api/servers', {
      headers: { Authorization: `Bearer ${accessToken}` },
      data: {
        id: 'MyServer',
        name: 'E2E Test',
        gamePort: 27015,
        ownerSteamId: '76561198000000001',
        installDir: '/tmp/um-e2e',
      },
    });
    expect(res.status()).toBe(201);
  });

  test('列出 → 200 + 有数据', async ({ request }) => {
    const res = await request.get('/api/servers', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].id).toBe('MyServer');
  });

  test('无 token → 401', async ({ request }) => {
    const res = await request.get('/api/servers');
    expect(res.status()).toBe(401);
  });
});

// ─── D9: Zod 校验 ────────────────────────────────────
test.describe('Zod 校验 (D9)', () => {
  test('空用户名 → 400', async ({ request }) => {
    const res = await request.post('/api/auth/login', {
      data: { username: '', password: '' },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('validation_failed');
  });

  test('缺 installDir → 400', async ({ request }) => {
    const res = await request.post('/api/servers', {
      headers: { Authorization: `Bearer ${accessToken}` },
      data: { id: 'X', name: 'X', gamePort: 1, ownerSteamId: '76561198000000001' },
    });
    expect(res.status()).toBe(400);
  });
});

// ─── 健康检查 ─────────────────────────────────────────
test('GET /api/health → 200', async ({ request }) => {
  // server 启动竞态——poll 直到 health 返回 ok
  await expect
    .poll(
      async () => {
        const res = await request.get('/api/health');
        return res.status();
      },
      { intervals: [500, 500, 1000, 2000], timeout: 15_000 },
    )
    .toBe(200);
  const res = await request.get('/api/health');
  expect(await res.json()).toMatchObject({ status: 'ok' });
});

// ─── Mods 链路 (Phase C) ─────────────────────────────
test.describe('Mods 管理链路 (Phase C)', () => {
  // 独立 login + 确保 MyServer 存在（不依赖前序 describe 的共享模块变量）
  let modsToken = '';
  test.beforeAll(async ({ request }) => {
    const login = await request.post('/api/auth/login', {
      data: { username: 'admin', password: 'admin123' },
    });
    const loginBody = await login.json();
    modsToken = loginBody.data.accessToken;

    // 若 MyServer 不存在则创建（幂等——已存在时跳过）
    const existing = await request.get('/api/servers', {
      headers: { Authorization: `Bearer ${modsToken}` },
    });
    const servers = await existing.json();
    if (!servers.data.some((s: { id: string }) => s.id === 'MyServer')) {
      await request.post('/api/servers', {
        headers: { Authorization: `Bearer ${modsToken}` },
        data: {
          id: 'MyServer',
          name: 'E2E Test',
          gamePort: 27015,
          ownerSteamId: '76561198000000001',
          installDir: '/tmp/um-e2e',
        },
      });
    }
  });

  test('配置 WebAPI Key → 200 + masked', async ({ request }) => {
    const res = await request.post('/api/settings/webapi-key', {
      headers: { Authorization: `Bearer ${modsToken}` },
      data: { apiKey: 'E2E_TEST_FAKE_KEY_FOR_E2E_ONLY_12345678' },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.data.masked).toContain('E2E_');
  });

  test('GET /mods/search → 200 或 502（Steam 可达性容忍）', async ({ request }) => {
    // Steam 不可达时后端冷启动等待 ConnectTimeout 可达 30s——playwright 默认 15s 太短
    test.setTimeout(60_000);
    const res = await request.get('/api/mods/search?page=1&pageSize=3&sort=popular&range=week', {
      headers: { Authorization: `Bearer ${modsToken}` },
    });
    // 允许：200（Steam 通）或 502/504（Steam 不通）—— 只要不是 500 就说明路由接线正确
    expect([200, 502, 503, 504]).toContain(res.status());
    if (res.status() === 200) {
      const body = await res.json();
      expect(body.data).toHaveProperty('total');
      expect(body.data).toHaveProperty('rows');
    }
  });

  test('GET /mods/acf → 200 + items 数组', async ({ request }) => {
    const res = await request.get('/api/servers/MyServer/mods/acf', {
      headers: { Authorization: `Bearer ${modsToken}` },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.data.items)).toBe(true);
  });

  test('GET /mods/downloaded → 200 + 数组', async ({ request }) => {
    const res = await request.get('/api/servers/MyServer/mods/downloaded', {
      headers: { Authorization: `Bearer ${modsToken}` },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.data)).toBe(true);
  });

  test('POST /mods/batch-details → 200 或 502（Steam 可达性容忍）', async ({ request }) => {
    const res = await request.post('/api/mods/batch-details', {
      headers: { Authorization: `Bearer ${modsToken}` },
      data: { fileIds: ['1753134636'] },
    });
    expect([200, 502, 503, 504]).toContain(res.status());
    if (res.status() === 200) {
      const body = await res.json();
      expect(Array.isArray(body.data)).toBe(true);
    }
  });

  test('DELETE /mods/:fileId（无 acf）→ 200 + removedFrom', async ({ request }) => {
    // MyServer 的 acf 大概率不存在，删除应幂等成功
    const res = await request.delete('/api/servers/MyServer/mods/999999999', {
      headers: { Authorization: `Bearer ${modsToken}` },
    });
    expect([200, 409]).toContain(res.status());
    if (res.status() === 200) {
      const body = await res.json();
      expect(body.data.success).toBe(true);
    }
  });
});

// ─── 注销 ────────────────────────────────────────────
test('POST /api/auth/logout → 200', async ({ request }) => {
  const res = await request.post('/api/auth/logout', { data: {} });
  expect(res.status()).toBe(200);
});
