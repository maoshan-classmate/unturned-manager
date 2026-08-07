import { test, expect } from '@playwright/test';

test.describe('unturned-manager E2E 冒烟测试', () => {
  test('登录页面渲染正常', async ({ page }) => {
    await page.goto('/');
    // 未认证时重定向到登录页
    await expect(page.locator('text=Sign in').or(page.locator('text=登录'))).toBeVisible({ timeout: 10_000 });
  });

  test('Dashboard 页面认证门控', async ({ page }) => {
    await page.goto('/');
    // 未登录应显示登录表单
    await expect(page.locator('input[type="text"], input[name="username"]')).toBeVisible({ timeout: 10_000 });
  });

  test('页面路由可达——不崩溃', async ({ page }) => {
    // 所有页面路由无 JS 错误（未登录时重定向到登录页是正常行为）
    const routes = [
      '/',
      '/_default',
      '/test-server/console',
      '/test-server/mods',
      '/test-server/players',
      '/test-server/config/commands',
      '/test-server/files',
      '/test-server/server-setup',
      '/settings',
    ];

    for (const route of routes) {
      const errors: string[] = [];
      page.on('pageerror', (err) => errors.push(err.message));

      await page.goto(route);
      await page.waitForTimeout(500);

      // 页面不应有 JS 错误
      expect(errors.filter((e) => !e.includes('@base-ui') && !e.includes('motion'))).toHaveLength(0);
    }
  });
});
