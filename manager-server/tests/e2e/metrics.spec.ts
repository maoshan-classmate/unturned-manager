import { test, expect } from '@playwright/test';

// ─── 系统指标链路（Dashboard 资源图后端支撑）───────────────
// 不依赖前序 describe 的共享 token——独立 login 走完整鉴权链路
let accessToken = '';

test.describe('系统指标链路', () => {
  test.beforeAll(async ({ request }) => {
    const login = await request.post('/api/auth/login', {
      data: { username: 'admin', password: 'admin123' },
    });
    const body = await login.json();
    accessToken = body.data.accessToken;
  });

  test('GET /api/system/metrics → 200 + 响应结构', async ({ request }) => {
    const res = await request.get('/api/system/metrics?serverId=MyServer', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.data).toMatchObject({
      serverId: 'MyServer',
      window: expect.stringMatching(/^(1m|5m|15m)$/),
      samples: expect.any(Array),
      current: {
        cpuPercent: expect.any(Number),
        memUsedMB: expect.any(Number),
        memTotalMB: expect.any(Number),
      },
    });
  });

  test('window=1m 参数生效', async ({ request }) => {
    const res = await request.get(
      '/api/system/metrics?window=1m',
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.data.window).toBe('1m');
  });

  test('非法 window 值回落默认 5m（Zod safeParse 兜底）', async ({ request }) => {
    const res = await request.get(
      '/api/system/metrics?window=invalid',
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.data.window).toBe('5m');
  });

  test('无 token → 401', async ({ request }) => {
    const res = await request.get('/api/system/metrics');
    expect(res.status()).toBe(401);
  });
});