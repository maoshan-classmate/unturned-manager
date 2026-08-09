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

  // 问题 8：Mods 页页面壳（标题 + 筛选栏）立即可见，不等 Steam 数据
  test('Mods 页页面壳立即渲染（不等 Steam 数据）', async ({ page }) => {
    // 先登录（Mods 页受认证门控）
    await page.goto('/');
    await page.fill('#login-username', 'admin');
    await page.fill('#login-password', '123456');
    await page.getByRole('button', { name: /登录|Sign/i }).first().click();
    // 等登录完成跳转（侧边栏出现 = 登录成功）
    await expect(page.locator('aside')).toBeVisible({ timeout: 10_000 });

    await page.goto('/test-server/mods');
    // 页面壳（标题 + 搜索框）应立即可见——即使 Steam 未通/服务器不存在也渲染（问题 8）
    await expect(page.getByPlaceholder('搜索 Mod 名称...')).toBeVisible({ timeout: 10_000 });
    // 排序下拉「最热门」存在
    await expect(page.getByText('最热门')).toBeVisible({ timeout: 10_000 });
    // 不崩溃——无 JS 错误
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    await page.waitForTimeout(800);
    expect(errors.filter((e) => !e.includes('@base-ui') && !e.includes('motion'))).toHaveLength(0);
  });

  // 问题 8：Mods 页不整页 loading——页面壳渲染时错误/空态也在合理位置
  test('Mods 页 loading 只覆盖列表区，页面壳始终渲染', async ({ page }) => {
    // 登录
    await page.goto('/');
    await page.fill('#login-username', 'admin');
    await page.fill('#login-password', '123456');
    await page.getByRole('button', { name: /登录|Sign/i }).first().click();
    await expect(page.locator('aside')).toBeVisible({ timeout: 10_000 });

    await page.goto('/test-server/mods');
    // 页面壳（搜索框）立即渲染 = 不是整页 loading
    await expect(page.getByPlaceholder('搜索 Mod 名称...')).toBeVisible({ timeout: 10_000 });
    // 结果区显示「共 X 条」或错误态——二者必居其一，证明列表区有明确状态而非死等
    const resultText = await page.locator('text=/浏览全部|无法加载/').first().isVisible().catch(() => false);
    expect(resultText).toBe(true);
  });

  // 问题 1+2+3 回归：详情弹窗用列表数据立即渲染（不等 Steam detail），封面 object-contain、宽自适应
  test('详情弹窗立即渲染——封面 contain 不裁剪、宽度自适应、不白屏', async ({ page }) => {
    // Steam browse 冷启动 20-40s，该用例单独放宽 timeout（全局 30s 不够）
    test.setTimeout(120_000);

    // 登录
    await page.goto('/');
    await page.fill('#login-username', 'admin');
    await page.fill('#login-password', '123456');
    await page.getByRole('button', { name: /登录|Sign/i }).first().click();
    await expect(page.locator('aside')).toBeVisible({ timeout: 10_000 });

    await page.goto('/test-server/mods');
    // 等列表出现第一个「详情」按钮（不等 Steam 数据返回，卡片先出壳）
    const detailBtn = page.locator('button:has-text("详情")').first();
    await expect(detailBtn).toBeVisible({ timeout: 60_000 });
    await detailBtn.click();

    // 弹窗立即出现：标题（Dialog h3）可见——列表数据兜底，detail 请求慢/失败也不白屏
    const dialog = page.locator('div[style*="min("]').last();
    await expect(dialog.locator('h3')).toBeVisible({ timeout: 10_000 });

    // 问题 2：封面图 object-fit: contain（完整显示不裁剪）
    const cover = dialog.locator('img[class*="object-contain"]').first();
    await expect(cover).toBeVisible({ timeout: 10_000 });
    await expect(cover).toHaveCSS('object-fit', 'contain');

    // 问题 3：弹窗宽 ≤ 视口宽（自适应，不钉死 px 溢出）
    const box = await dialog.boundingBox();
    expect(box).not.toBeNull();
    if (box) {
      const vw = page.viewportSize()?.width ?? 1280;
      expect(box.width).toBeLessThanOrEqual(vw);
    }

    // 操作区渲染（在 Steam 中打开 / 下载 / 关闭）——弹窗内容完整
    await expect(dialog.getByRole('button', { name: /关闭/ })).toBeVisible({ timeout: 10_000 });
  });
});
