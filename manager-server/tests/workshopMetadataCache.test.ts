import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type Database from 'better-sqlite3';

// ─── mock 依赖（必须在 import WorkshopMetadataService 之前）────────────

// mock getSteamWebApiKey：返回固定 fake key；如需"未配置 Key"场景，单独覆盖
vi.mock('../src/modules/settings/settingsStorage.js', () => ({
  getSteamWebApiKey: vi.fn(() => 'fake-key-for-test'),
}));

// mock fetch：每个测试按场景替换实现
const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

// mock logger：避免控制台噪音
vi.mock('../src/utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// ★ WorkshopMetadataService 模块级缓存（browseCache Map）需要在每用例清空
// ——vitest pool=forks 让模块状态隔离，但同文件内多用例共享，所以 beforeEach 清
const { WorkshopMetadataService, __resetBrowseCacheForTest } = await import(
  '../src/modules/workshop/WorkshopMetadataService.js'
);

// ─── 工具 ───────────────────────────────────────────────

/** 单条 Steam mod 数据字段类型（测试 fixture 用） */
interface SteamModFixture {
  publishedfileid?: string;
  title?: string;
  creator?: string;
  file_description?: string;
  preview_url?: string;
  file_size?: number;
  time_updated?: number;
  subscriptions?: number;
  vote_data?: { score: number; votes_up: number; votes_down: number };
}

/** 构造 Steam QueryFiles 标准响应 */
function makeSteamQueryFilesResponse(
  rows: SteamModFixture[],
  total = 100,
): unknown {
  return {
    response: {
      total,
      publishedfiledetails: rows.map((r) => ({
        result: 1,
        publishedfileid: r.publishedfileid ?? '111111',
        creator: r.creator ?? '76561198000000001',
        creator_appid: 304930,
        filename: 'mod.unity3d',
        file_size: r.file_size ?? 1024,
        preview_url: r.preview_url ?? 'https://example.com/preview.jpg',
        title: r.title ?? 'Test Mod',
        file_description: r.file_description ?? 'desc',
        time_updated: r.time_updated ?? 1700000000,
        subscriptions: r.subscriptions ?? 100,
        vote_data: r.vote_data ?? { score: 0.5, votes_up: 10, votes_down: 0 },
      })),
    },
  };
}

/** 取一条最小可用的 Steam 响应数据 */
function oneRow(overrides: Record<string, unknown> = {}): SteamModFixture[] {
  return [
    {
      publishedfileid: '1753134636',
      title: 'Test Mod',
      subscriptions: 12345,
      vote_data: { score: 0.8, votes_up: 100, votes_down: 5 },
      file_description: 'desc',
      ...overrides,
    },
  ];
}

/** 假 db 实例（browseMods 实际上不直接查 db，传任意即可满足 constructor 类型） */
function fakeDb(): Database.Database {
  return {} as Database.Database;
}

// ─── 测试 ───────────────────────────────────────────────

describe('WorkshopMetadataService.browseMods — 5 分钟进程内缓存', () => {
  let svc: InstanceType<typeof WorkshopMetadataService>;

  beforeEach(() => {
    __resetBrowseCacheForTest(); // 模块级缓存每用例清空
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => makeSteamQueryFilesResponse(oneRow()),
    });
    svc = new WorkshopMetadataService(fakeDb());
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('同条件二次调用 → fetch 只调 1 次（命中缓存）', async () => {
    const a = await svc.browseMods('', 'popular', 'week', 'text', 1, 12);
    const b = await svc.browseMods('', 'popular', 'week', 'text', 1, 12);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(a).toBe(b); // 同一引用
  });

  it('不同 sort → 缓存不命中，分别调 Steam', async () => {
    await svc.browseMods('', 'popular', 'week', 'text', 1, 12);
    await svc.browseMods('', 'rated', 'week', 'text', 1, 12);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('不同 page → 缓存不命中', async () => {
    await svc.browseMods('', 'popular', 'week', 'text', 1, 12);
    await svc.browseMods('', 'popular', 'week', 'text', 2, 12);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('不同 search query → 缓存不命中', async () => {
    await svc.browseMods('halo', 'popular', 'week', 'text', 1, 12);
    await svc.browseMods('zombie', 'popular', 'week', 'text', 1, 12);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('TTL 过期（5min+1ms）→ 重发 Steam + 旧条目被惰性清理', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-12T12:00:00Z'));

    await svc.browseMods('', 'popular', 'week', 'text', 1, 12);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // 4 分钟 59 秒——仍在 TTL 内
    vi.setSystemTime(new Date('2026-08-12T12:04:59Z'));
    await svc.browseMods('', 'popular', 'week', 'text', 1, 12);
    expect(fetchMock).toHaveBeenCalledTimes(1); // 仍命中

    // 5 分钟 + 1 秒——过期
    vi.setSystemTime(new Date('2026-08-12T12:05:01Z'));
    await svc.browseMods('', 'popular', 'week', 'text', 1, 12);
    expect(fetchMock).toHaveBeenCalledTimes(2); // 重发
  });

  it('subscriptions 字段正确映射（修 v2.4 之前 ModCard 永远 undefined bug）', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => makeSteamQueryFilesResponse([
        {
          publishedfileid: '111',
          subscriptions: 9999,
          vote_data: { score: 0.6, votes_up: 50, votes_down: 2 },
        },
      ]),
    });
    const result = await svc.browseMods('', 'popular', 'week', 'text', 1, 12);
    expect(result.mods[0]?.subscriptions).toBe(9999);
    expect(result.mods[0]?.voteScore).toBeCloseTo(3.0, 1);
  });

  it('空结果也缓存（避免重复搜不到词时反复打 Steam）', async () => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => makeSteamQueryFilesResponse([], 0),
    });
    const a = await svc.browseMods('nothing-found-xyz', 'popular', 'week', 'text', 1, 12);
    const b = await svc.browseMods('nothing-found-xyz', 'popular', 'week', 'text', 1, 12);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(a.mods).toEqual([]);
    expect(b.mods).toEqual([]);
  });
});
