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
  const res = await request.get('/api/health');
  expect(res.status()).toBe(200);
  expect(await res.json()).toMatchObject({ status: 'ok' });
});

// ─── 注销 ────────────────────────────────────────────
test('POST /api/auth/logout → 200', async ({ request }) => {
  const res = await request.post('/api/auth/logout', { data: {} });
  expect(res.status()).toBe(200);
});
