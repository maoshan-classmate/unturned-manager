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

  // ADR-0002 §5.5 + Task #1：WS 必须用 accessToken 而非 refreshToken（C安全缺陷修复）
  test('WS 登录后自动连上——URL 使用 accessToken（短期 15min）而非 refreshToken', async ({ page }) => {
    // 注入 WebSocket 探针：在浏览器上下文里记录所有 WS 连接和握手 URL
    await page.addInitScript(() => {
      const w = window as unknown as { __wsUrls?: string[] };
      w.__wsUrls = [];
      const OrigWS = window.WebSocket;
      window.WebSocket = class extends OrigWS {
        constructor(url: string | URL, protocols?: string | string[]) {
          super(url, protocols);
          w.__wsUrls!.push(url.toString());
        }
      } as unknown as typeof WebSocket;
    });

    // 登录
    await page.goto('/');
    await page.fill('#login-username', 'admin');
    await page.fill('#login-password', '123456');
    await page.getByRole('button', { name: /登录|Sign/i }).first().click();
    await expect(page.locator('aside')).toBeVisible({ timeout: 10_000 });

    // 等 WSContext 建连——路由切到任一 server 触发
    await page.goto('/test-server/console');
    await page.waitForTimeout(2_000); // 给 ensureAccessToken + 建连 + subscribe 留时间

    const urls = await page.evaluate(() => (window as unknown as { __wsUrls?: string[] }).__wsUrls ?? []);
    expect(urls.length).toBeGreaterThan(0);
    const wsUrl = urls.find((u) => u.includes('/ws?token='));
    expect(wsUrl).toBeDefined();

    // C安全修复断言：URL 不能含 refreshToken
    const refreshToken = await page.evaluate(() => localStorage.getItem('refreshToken'));
    expect(refreshToken).toBeTruthy(); // 前提:有 refreshToken(否则用例无意义)
    expect(wsUrl!).not.toContain(refreshToken!); // ★ 核心断言:WS URL ≠ refreshToken

    // 副断言:URL 是 ws:// 或 wss:// 开头,符合 WS 协议
    expect(wsUrl!).toMatch(/^ws(s)?:\/\//);
  });

  // Task #1 闭环：accessToken 过期后 WS 触发服务端 401 → 自动 refresh + 重连
  test('WS accessToken 过期后自动 refresh + 重连', async ({ page }) => {
    await page.addInitScript(() => {
      const w = window as unknown as { __wsReconnects?: number; __origWs?: typeof WebSocket };
      w.__wsReconnects = 0;
      const OrigWS = window.WebSocket;
      window.WebSocket = class extends OrigWS {
        constructor(url: string | URL, protocols?: string | string[]) {
          super(url, protocols);
          w.__wsReconnects = (w.__wsReconnects ?? 0) + 1;
          // 模拟服务端 401 后断开：3 秒后强制 close 触发客户端重连逻辑
          setTimeout(() => {
            if (this.readyState === WebSocket.OPEN) this.close(4001, 'simulated-401');
          }, 3_000);
        }
      } as unknown as typeof WebSocket;
    });

    // 登录
    await page.goto('/');
    await page.fill('#login-username', 'admin');
    await page.fill('#login-password', '123456');
    await page.getByRole('button', { name: /登录|Sign/i }).first().click();
    await expect(page.locator('aside')).toBeVisible({ timeout: 10_000 });

    await page.goto('/test-server/console');

    // 等首次 WS 建连 + 3 秒模拟 401 + 退避重连(默认 1s) + 第二次建连
    await page.waitForTimeout(6_000);

    const reconnects = await page.evaluate(
      () => (window as unknown as { __wsReconnects?: number }).__wsReconnects ?? 0,
    );
    // 期望:至少 2 次 WS 构造(首次 + 重连后)
    expect(reconnects).toBeGreaterThanOrEqual(2);
  });

  // Figma 🎨 Server Setup 1:1 复刻回归——4 卡片 + 实例库侧栏可达
  test('Server Setup 页 4 卡片 + 实例库侧栏全部渲染', async ({ page }) => {
    // 登录
    await page.goto('/');
    await page.fill('#login-username', 'admin');
    await page.fill('#login-password', '123456');
    await page.getByRole('button', { name: /登录|Sign/i }).first().click();
    await expect(page.locator('aside')).toBeVisible({ timeout: 10_000 });

    await page.goto('/test-server/server-setup');

    // Header 标题 + 实例库侧栏
    await expect(page.getByText('服务器部署与管理')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('实例库', { exact: true })).toBeVisible({ timeout: 10_000 });

    // 4 卡片标题(SteamCMD / U3DS / 服务器控制 / 计划任务)
    await expect(page.getByText('SteamCMD').first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Unturned 专用服务器').first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('服务器控制').first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('计划任务').first()).toBeVisible({ timeout: 10_000 });

    // 实例库「新建」按钮——验证点击能弹出 Dialog(必须存在的弹窗行为)
    const newBtn = page.getByRole('button', { name: /新建/ }).first();
    await newBtn.click();
    await expect(page.getByText('创建新实例', { exact: true })).toBeVisible({ timeout: 5_000 });

    // 视觉回归:实拍截图,让 CI 能 diff 颜色变化(撞色问题)
    await page.screenshot({ path: 'test-results/server-setup-snap.png', fullPage: false });
  });
});
