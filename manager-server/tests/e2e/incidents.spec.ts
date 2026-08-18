import { test, expect } from '@playwright/test';

// ServerID 事件流端点测试——Status Block 后端支撑
let accessToken = '';

test.describe('ServerID 事件流端点', () => {
  test.beforeAll(async ({ request }) => {
    const login = await request.post('/api/auth/login', {
      data: { username: 'admin', password: 'admin123' },
    });
    const body = await login.json();
    accessToken = body.data.accessToken;
  });

  test('GET /api/servers/:id/incidents → 200 + 响应结构', async ({ request }) => {
    const res = await request.get('/api/servers/MyServer/incidents', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.data).toMatchObject({
      serverId: 'MyServer',
      total: expect.any(Number),
      incidents: expect.any(Array),
    });
  });

  test('limit 参数生效', async ({ request }) => {
    const res = await request.get('/api/servers/MyServer/incidents?limit=5', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.data.incidents.length).toBeLessThanOrEqual(5);
  });

  test('limit 越界（>200）回落默认 50', async ({ request }) => {
    const res = await request.get('/api/servers/MyServer/incidents?limit=999', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.data.incidents.length).toBeLessThanOrEqual(50);
  });

  test('limit 非数字回落默认', async ({ request }) => {
    const res = await request.get('/api/servers/MyServer/incidents?limit=abc', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.data).toMatchObject({ serverId: 'MyServer' });
  });

  test('无 token → 401', async ({ request }) => {
    const res = await request.get('/api/servers/MyServer/incidents');
    expect(res.status()).toBe(401);
  });
});
