/**
 * LdmPluginSourceService 单测（HTML 解析 + GitHub 补全 + PAT 测试 + 缓存）。
 * 13 用例覆盖：
 *   1. HTML 解析：单插件卡片
 *   2. HTML 解析：多个插件 + 去重
 *   3. HTML 解析：跳过框架元仓库（SmartlyDressedGames/ldm-community）
 *   4. HTML 解析：跳过非 GitHub 链接
 *   5. HTML 解析：.git 后缀清理
 *   6. testPat 空字符串 → github-pat-invalid
 *   7. testPat 401 → github-pat-invalid
 *   8. testPat 200 → ok=true + rateLimit
 *   9. testPat 500 → network-error
 *   10. listCommunityPlugins 上游 5xx → community-source-unreachable
 *   11. listCommunityPlugins HTML 0 插件 → community-source-malformed
 *   12. listCommunityPlugins 全部 GitHub 403 → community-source-rate-limited
 *   13. listCommunityPlugins 正常：HTML + GitHub 融合 + 缓存命中
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

vi.mock('../src/utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

const { LdmPluginSourceService, __resetCommunityCacheForTest } = await import(
  '../src/modules/ldm/LdmPluginSourceService.js'
);

const SAMPLE_HTML = `
  <html><body>
    <div class="plugin-card">
      <h3>Uconomy</h3>
      <p>Economy plugin for Unturned</p>
      <a href="https://github.com/ExampleAuthor/Uconomy">Uconomy</a>
      <span class="author">@ExampleAuthor</span>
    </div>
    <div class="plugin-card">
      <h3>DeathMessages</h3>
      <p>Show kill messages</p>
      <a href="https://github.com/AnotherRepo/death-messages.git">DeathMessages</a>
    </div>
    <div>
      <a href="https://example.com/not-github">other</a>
      <a href="https://github.com/SmartlyDressedGames/Legally-Distinct-Missile">framework</a>
    </div>
  </body></html>
`;

describe('LdmPluginSourceService', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    __resetCommunityCacheForTest();
  });

  it('1. HTML 解析：单插件卡片完整字段', async () => {
    const html = `
      <div class="plugin-card">
        <h3>MyPlugin</h3>
        <p>Test description</p>
        <a href="https://github.com/SomeOwner/MyPlugin">MyPlugin</a>
      </div>
    `;
    fetchMock.mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve(html),
    });
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      headers: { forEach: () => {} },
      json: () => Promise.resolve({ pushed_at: '2026-01-01T00:00:00Z', tag_name: 'v1.0.0' }),
    });

    const svc = new LdmPluginSourceService();
    const result = await svc.listCommunityPlugins(null);
    expect(result.plugins.length).toBe(1);
    expect(result.plugins[0]?.slug).toBe('SomeOwner/MyPlugin');
    expect(result.plugins[0]?.repoUrl).toBe('https://github.com/SomeOwner/MyPlugin');
  });

  it('2. HTML 解析：多个插件 + 去重', async () => {
    const html = `
      <div><a href="https://github.com/A/repo1">r1</a></div>
      <div><a href="https://github.com/A/repo1">r1-dup</a></div>
      <div><a href="https://github.com/A/repo2">r2</a></div>
    `;
    fetchMock.mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve(html),
    });
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      headers: { forEach: () => {} },
      json: () => Promise.resolve({ pushed_at: '2026-01-01T00:00:00Z', tag_name: 'v1.0.0' }),
    });
    const svc = new LdmPluginSourceService();
    const result = await svc.listCommunityPlugins(null);
    expect(result.plugins.length).toBe(2);
  });

  it('3. HTML 解析：跳过框架元仓库', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve(SAMPLE_HTML),
    });
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      headers: { forEach: () => {} },
      json: () => Promise.resolve({ pushed_at: '', tag_name: '' }),
    });
    const svc = new LdmPluginSourceService();
    const result = await svc.listCommunityPlugins(null);
    const slugs = result.plugins.map((p) => p.slug);
    expect(slugs).not.toContain('SmartlyDressedGames/Legally-Distinct-Missile');
    expect(slugs).toContain('ExampleAuthor/Uconomy');
  });

  it('4. HTML 解析：跳过非 GitHub 链接', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve(SAMPLE_HTML),
    });
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      headers: { forEach: () => {} },
      json: () => Promise.resolve({ pushed_at: '', tag_name: '' }),
    });
    const svc = new LdmPluginSourceService();
    const result = await svc.listCommunityPlugins(null);
    const slugs = result.plugins.map((p) => p.slug);
    expect(slugs).not.toContain('example.com/not-github');
  });

  it('5. HTML 解析：.git 后缀清理', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve(SAMPLE_HTML),
    });
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      headers: { forEach: () => {} },
      json: () => Promise.resolve({ pushed_at: '', tag_name: '' }),
    });
    const svc = new LdmPluginSourceService();
    const result = await svc.listCommunityPlugins(null);
    const slugs = result.plugins.map((p) => p.slug);
    expect(slugs).toContain('AnotherRepo/death-messages');
  });

  it('6. testPat 空字符串 → github-pat-invalid', async () => {
    const svc = new LdmPluginSourceService();
    const result = await svc.testPat('');
    expect(result.ok).toBe(false);
    expect(result.code).toBe('github-pat-invalid');
    expect(result.rateLimit).toBeNull();
  });

  it('7. testPat 401 → github-pat-invalid（带 rateLimit）', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 401,
      headers: { forEach: (cb: (v: string, k: string) => void) => {
        cb('5000', 'x-ratelimit-limit');
        cb('0', 'x-ratelimit-remaining');
        cb('1234567890', 'x-ratelimit-reset');
      } },
      json: () => Promise.resolve({}),
    });
    const svc = new LdmPluginSourceService();
    const result = await svc.testPat('ghp_xxx');
    expect(result.ok).toBe(false);
    expect(result.code).toBe('github-pat-invalid');
    expect(result.rateLimit).toEqual({ limit: 5000, remaining: 0, reset: 1234567890 });
  });

  it('8. testPat 200 → ok=true + rateLimit 解析', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: { forEach: (cb: (v: string, k: string) => void) => {
        cb('5000', 'x-ratelimit-limit');
        cb('4999', 'x-ratelimit-remaining');
        cb('1234567890', 'x-ratelimit-reset');
      } },
      json: () => Promise.resolve({ login: 'me' }),
    });
    const svc = new LdmPluginSourceService();
    const result = await svc.testPat('ghp_xxx');
    expect(result.ok).toBe(true);
    expect(result.code).toBeNull();
    expect(result.rateLimit?.limit).toBe(5000);
  });

  it('9. testPat 网络失败 → network-error', async () => {
    fetchMock.mockRejectedValueOnce(new Error('ECONNRESET'));
    const svc = new LdmPluginSourceService();
    const result = await svc.testPat('ghp_xxx');
    expect(result.ok).toBe(false);
    expect(result.code).toBe('network-error');
  });

  it('10. listCommunityPlugins 上游 5xx → community-source-unreachable', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 502,
      text: () => Promise.resolve(''),
    });
    const svc = new LdmPluginSourceService();
    await expect(svc.listCommunityPlugins(null)).rejects.toMatchObject({
      code: 'community-source-unreachable',
    });
  });

  it('11. listCommunityPlugins HTML 0 插件 → community-source-malformed', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve('<html><body><div>no plugins here</div></body></html>'),
    });
    const svc = new LdmPluginSourceService();
    await expect(svc.listCommunityPlugins(null)).rejects.toMatchObject({
      code: 'community-source-malformed',
    });
  });

  it('12. listCommunityPlugins 全部 GitHub 403 → community-source-rate-limited', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve(SAMPLE_HTML),
    });
    // 全部 GitHub 调用 403
    fetchMock.mockResolvedValue({
      ok: false,
      status: 403,
      headers: { forEach: () => {} },
      json: () => Promise.resolve({}),
    });
    const svc = new LdmPluginSourceService();
    await expect(svc.listCommunityPlugins(null)).rejects.toMatchObject({
      code: 'community-source-rate-limited',
    });
  });

  it('13. listCommunityPlugins 正常：HTML + GitHub 融合 + 第二次命中缓存', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve(SAMPLE_HTML),
    });
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      headers: { forEach: () => {} },
      json: () => Promise.resolve({ pushed_at: '2026-08-01T00:00:00Z', tag_name: 'v2.3.1' }),
    });

    const svc = new LdmPluginSourceService();
    const first = await svc.listCommunityPlugins(null);
    expect(first.plugins.length).toBeGreaterThan(0);
    const withVersion = first.plugins.find((p) => p.latestVersion);
    expect(withVersion).toBeDefined();

    // 第二次：fetch 应该不再次调用上游（缓存命中）
    fetchMock.mockClear();
    const second = await svc.listCommunityPlugins(null);
    expect(second.plugins.length).toBe(first.plugins.length);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
