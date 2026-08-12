/**
 * LDM-Community 插件来源服务——公开列表的双源融合。
 *
 * **数据源**：
 *   1. 主页 HTML（https://ldm-community.github.io/pluginlist） → 解析插件名/作者/简介/仓库 URL
 *   2. GitHub API（每插件仓库） → 补 latestVersion（releases/latest）+ updatedAtIso（pushed_at）
 *
 * **为何要融合**：HTML 静态展示无版本/时间信息；GitHub API 限流（匿名 60/h、有 PAT 5000/h）。
 * 顺序：先 HTML 把每个 plugin 的 repoUrl 拿到，再批量并发 GitHub API（5 并发）。
 *
 * **缓存策略**：5min 进程内 Map（单用户系统足够），无 stale 兜底——上游不可达直接抛错。
 * **PAT 行为**：传 PAT 后 GitHub 限流放宽 + 显示私有仓库（社区页只列公开仓库，PAT 影响微）。
 */
import { load as cheerioLoad } from 'cheerio';
import type {
  ILdmPluginSourceService,
  CommunityPlugin,
} from '@unturned-manager/shared';
import { AppError } from '../../utils/AppError.js';
import { httpClient } from '../../utils/httpClient.js';
import { logger } from '../../utils/logger.js';

// ─── 常量 ────────────────────────────────────────────────

const LDM_COMMUNITY_URL = 'https://ldm-community.github.io/pluginlist';
const GITHUB_API_REPO = 'https://api.github.com/repos';
const GITHUB_API_RELEASES = 'https://api.github.com/repos'; // /repos/{owner}/{repo}/releases/latest
const CACHE_TTL_MS = 5 * 60 * 1000;
const GITHUB_BATCH_SIZE = 5; // 每批 5 并发——避开 GitHub 匿名 60/h 限流太快
const PAT_TEST_TIMEOUT_MS = 8_000;
const HTML_FETCH_TIMEOUT_MS = 15_000;
const GITHUB_FETCH_TIMEOUT_MS = 8_000;

// ─── 缓存 ────────────────────────────────────────────────

interface CacheEntry {
  result: { plugins: CommunityPlugin[]; fetchedAtIso: string; stale: boolean };
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

/** 测试钩子：清空缓存。单测 beforeEach 调。 */
export function __resetCommunityCacheForTest(): void {
  cache.clear();
}

// ─── 实现 ────────────────────────────────────────────────

export class LdmPluginSourceService implements ILdmPluginSourceService {
  /**
   * 拉取 LDM-Community 公开插件列表 + GitHub 元数据补全。
   *
   * @param pat - GitHub PAT；null = 匿名调用
   * @returns 插件列表 + 获取时间（fetchedAtIso，stale 永远 false——进程内缓存无 stale 概念）
   * @throws AppError('community-source-unreachable') 上游空白且无缓存
   * @throws AppError('community-source-malformed') HTML 解析失败或 0 plugin
   * @throws AppError('community-source-rate-limited') GitHub 全部 403 限流
   */
  async listCommunityPlugins(pat: string | null) {
    const cacheKey = pat ?? '__anon__';
    const cached = cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      logger.debug({ cacheKey }, 'listCommunityPlugins 命中缓存');
      return cached.result;
    }
    if (cached) cache.delete(cacheKey);

    // 1. 拉 HTML（直接用 fetch——httpClient 内部是 JSON 解析，对 HTML 不适用）
    let html: string;
    try {
      const raw = await fetch(LDM_COMMUNITY_URL, {
        signal: AbortSignal.timeout(HTML_FETCH_TIMEOUT_MS),
      });
      if (!raw.ok) throw new Error(`status ${raw.status}`);
      html = await raw.text();
    } catch {
      throw new AppError(
        'community-source-unreachable',
        'LDM 社区插件列表暂时无法访问，请稍后重试',
        502,
      );
    }

    // 2. cheerio 解析
    const basePlugins = parseHtml(html);
    if (basePlugins.length === 0) {
      throw new AppError(
        'community-source-malformed',
        'LDM 社区页面结构异常（0 插件），请稍后重试',
        502,
      );
    }

    // 3. GitHub 元数据补全（5 并发批）
    const enriched = await enrichWithGitHub(basePlugins, pat);

    const result = {
      plugins: enriched,
      fetchedAtIso: new Date().toISOString(),
      stale: false,
    };
    cache.set(cacheKey, { result, expiresAt: Date.now() + CACHE_TTL_MS });
    return result;
  }

  /**
   * 测试 GitHub PAT 连通性。
   *
   * @param pat - GitHub PAT；空字符串视为匿名
   * @returns ok 状态 + 限流配额 + 错误码
   */
  async testPat(pat: string) {
    if (!pat) {
      return {
        ok: false,
        code: 'github-pat-invalid' as const,
        rateLimit: null,
        message: 'PAT 不能为空',
      };
    }
    const headers: Record<string, string> = {
      Authorization: `Bearer ${pat}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    };
    try {
      const res = await httpClient.get(`${GITHUB_API_REPO}/`, {
        headers,
        timeoutMs: PAT_TEST_TIMEOUT_MS,
      });
      if (res.status === 401) {
        return {
          ok: false,
          code: 'github-pat-invalid' as const,
          rateLimit: parseRateLimit(res.headers),
          message: 'PAT 无效或已过期',
        };
      }
      if (!res.ok) {
        return {
          ok: false,
          code: 'network-error' as const,
          rateLimit: parseRateLimit(res.headers),
          message: `GitHub 返回 HTTP ${res.status}`,
        };
      }
      return {
        ok: true,
        code: null,
        rateLimit: parseRateLimit(res.headers),
        message: null,
      };
    } catch {
      return {
        ok: false,
        code: 'network-error' as const,
        rateLimit: null,
        message: '网络连接失败',
      };
    }
  }
}

// ─── 工具函数 ────────────────────────────────────────────

/** 从 GitHub 响应头解析限流配额 */
function parseRateLimit(
  headers: Record<string, string>,
): { limit: number; remaining: number; reset: number } | null {
  const limit = headers['x-ratelimit-limit'];
  const remaining = headers['x-ratelimit-remaining'];
  const reset = headers['x-ratelimit-reset'];
  if (!limit || !remaining || !reset) return null;
  return {
    limit: parseInt(limit, 10),
    remaining: parseInt(remaining, 10),
    reset: parseInt(reset, 10),
  };
}

/**
 * 解析 LDM-Community 主页 HTML —— 提取插件名 / 仓库 URL / 描述 / 作者。
 *
 * 真实页面结构（2026-08-12 实测）：每个 plugin 是 `<div class="plugin-card">` 或类似
 * 容器，内含 `<h3>` 名称、`<a href="https://github.com/owner/repo">` 链接、`<p>` 描述、
 * `<span class="author">` 作者。本解析器在结构变化时返回的数组更短，但不会抛错。
 */
function parseHtml(html: string): CommunityPlugin[] {
  const $ = cheerioLoad(html);
  const plugins: CommunityPlugin[] = [];
  const seen = new Set<string>();

  // 抓 repo URL 的所有 a 标签——GitHub 链接是 plugin 标识的最稳定锚点
  $('a[href*="github.com/"]').each((_, el) => {
    const href = $(el).attr('href') ?? '';
    const m = href.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+?)\/?$/);
    if (!m) return;
    const owner = m[1] ?? '';
    const repoName = (m[2] ?? '').replace(/\.git$/, '');
    if (owner === 'SmartlyDressedGames' || owner === 'ldm-community') return; // 框架元仓库
    const slug = `${owner}/${repoName}`;
    if (seen.has(slug)) return;
    seen.add(slug);

    // 名称：a 文本本身或最近的 h3
    const name = $(el).text().trim() || $(el).closest('div').find('h3').first().text().trim() || repoName;
    // 描述：closest 容器内的 p
    const description =
      $(el).closest('div').find('p').first().text().trim() || '';
    const author = owner;

    plugins.push({
      slug,
      name,
      author,
      description,
      repoUrl: `https://github.com/${owner}/${repoName}`,
      latestVersion: '', // GitHub 补全后填
      updatedAtIso: '', // GitHub 补全后填
    });
  });

  return plugins;
}

/**
 * 批量 GitHub API 补全 latestVersion + updatedAtIso。
 * 5 并发批；限流 403 时跳过该 plugin（不影响其他）。
 */
async function enrichWithGitHub(
  basePlugins: CommunityPlugin[],
  pat: string | null,
): Promise<CommunityPlugin[]> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (pat) headers.Authorization = `Bearer ${pat}`;

  const enriched: CommunityPlugin[] = [];
  let allRateLimited = true; // 若全部 403，抛 community-source-rate-limited

  for (let i = 0; i < basePlugins.length; i += GITHUB_BATCH_SIZE) {
    const batch = basePlugins.slice(i, i + GITHUB_BATCH_SIZE);
    const results = await Promise.all(
      batch.map(async (p) => {
        const [owner, repo] = p.slug.split('/');
        try {
          const repoRes = await httpClient.get<{ pushed_at: string }>(
            `${GITHUB_API_REPO}/${owner}/${repo}`,
            { headers, timeoutMs: GITHUB_FETCH_TIMEOUT_MS },
          );
          if (repoRes.status === 403) {
            return { ...p, latestVersion: '', updatedAtIso: '' };
          }
          if (!repoRes.ok || !repoRes.body) {
            return { ...p, latestVersion: '', updatedAtIso: '' };
          }
          const releaseRes = await httpClient.get<{ tag_name: string }>(
            `${GITHUB_API_RELEASES}/${owner}/${repo}/releases/latest`,
            { headers, timeoutMs: GITHUB_FETCH_TIMEOUT_MS },
          );
          allRateLimited = false;
          return {
            ...p,
            latestVersion: releaseRes.body?.tag_name ?? '',
            updatedAtIso: repoRes.body.pushed_at ?? '',
          };
        } catch {
          return { ...p, latestVersion: '', updatedAtIso: '' };
        }
      }),
    );
    enriched.push(...results);
  }

  // 全部 403 → 抛限流错（用户可能被限流到无法获取任何元数据）
  if (allRateLimited && enriched.length > 0) {
    throw new AppError(
      'community-source-rate-limited',
      'GitHub API 限流，请配置 PAT 或稍后重试',
      429,
    );
  }

  return enriched;
}
