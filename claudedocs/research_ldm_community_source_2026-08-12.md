# LDM-Community pluginlist 源调研

> **状态**：调研报告 · **日期**：2026-08-12
> **驱动**：`claudedocs/workflow_sprint5_ldm_phase1.md` §5.2「上游 API 假设」调研前置
> **Phase 1 范围**：`LdmPluginSourceService.listCommunityPlugins()` 上游契约

---

## 0. 一句话结论

**LDM-Community pluginlist 无公开 JSON API**——纯静态 HTML（GitHub Pages + Bootstrap 渲染）。Phase 1 走 **HTML 解析 + GitHub API 批量补充** 双源方案：
1. **HTML 解析**（主页 25 条一次性）拿 `name` / `slug` / `author` / `description` / `repoUrl`
2. **GitHub API 批量**（25 个仓库 × 2 端点 = 50 调用/次）拿 `latestVersion`（`tag_name`）+ `updatedAtIso`（`pushed_at`）
3. 5min 进程内缓存复用，匿名 60/h 限流恰好够 1 次全量刷新；**用户配置 GitHub Token 后可提到 5000/h**

**用户有 GitHub API 访问能力**（2026-08-12 用户明确）：Phase 1 走**双源融合**而非降级方案。

---

## 1. 上游真相

| 维度 | 实测结果 |
|---|---|
| **公开 URL** | `https://ldm-community.github.io/pluginlist/` |
| **HTML 体积** | 54,565 字节 |
| **拉取延迟** | 287ms（GitHub Pages CDN，国内访问实测 ≤ 1s） |
| **HTTP 状态** | 200 |
| **JSON API 存在？** | ❌ 无（feed.json / plugins.json / plugins.yaml 均 404） |
| **数据格式** | Bootstrap card 模板静态渲染（`<div class="card">`） |
| **插件总数** | 25（去重后） |
| **详情页模板** | `https://ldm-community.github.io/pluginlist/plugins/<Name>.html`（9.8KB） |
| **详情页是否含 latestVersion** | ❌ 无（详情页外链 `github.com/.../releases/latest`，本身不带版本号） |

---

## 2. HTML 解析方案

### 2.1 单 card 模板

```html
<div class="card">
    <div class="media" style="height: 170px;">
        <img src="./plugins/static/img/logo.svg" class="plugin-icon">
        <div class="card-body media-body">
            <h5 class="card-title" id="plugintitle">AdvancedGodVanish</h5>
            <!-- <span class="badge badge-danger">Deprecated</span> -->
            <span class="badge badge-primary">Open Source</span>
            <span class="badge badge-danger">Unmaintained</span>
            <p class="card-text">RM4 - Fixed
            </p>
        </div>
    </div>
    <div class="card-footer text-muted">
        <p>
            <a href="https://github.com/RocketModPlugins"><i class="fa fa-github"></i> RocketModPlugins</a>
        </p>
        <div class="text-right">
            <a href="https://github.com/RocketModPlugins/AdvancedGodVanish" class="btn btn-primary">Source Code</a>
            <a href="https://ldm-community.github.io/pluginlist/plugins/AdvancedGodVanish.html" class="btn btn-success">View</a>
        </div>
    </div>
</div>
```

### 2.2 字段提取规则

| 字段 | CSS 选择器 | 提取方式 |
|---|---|---|
| `name` | `h5.card-title#plugintitle` | 文本内容 |
| `slug` | `a.btn.btn-primary[href*="github.com/"]` | href 路径末尾段（如 `AdvancedGodVanish`） |
| `author` | `div.card-footer a[href*="github.com/"]` | 不含 `releases` 的第一个 `a` 的文本 |
| `description` | `p.card-text` | 文本内容（截断 280 字） |
| `repoUrl` | `a.btn.btn-primary` | href 完整 URL |
| `tags` | `span.badge` | 多个 badge 文本（如 `Open Source` / `Unmaintained`） |
| `latestVersion` | **不提取** | 主页 HTML 无此字段 |
| `updatedAtIso` | **不提取** | 主页 HTML 无此字段 |

### 2.3 解析器实现（cheerio + Node 20）

```typescript
import * as cheerio from 'cheerio';

interface RawCommunityPlugin {
  name: string;
  slug: string;
  author: string;
  description: string;
  repoUrl: string;
  tags: string[];
}

function parseLdmCommunityPluginlist(html: string): RawCommunityPlugin[] {
  const $ = cheerio.load(html);
  const plugins: RawCommunityPlugin[] = [];

  $('div.card').each((_, el) => {
    const card = $(el);
    const name = card.find('h5.card-title#plugintitle').text().trim();
    if (!name) return;  // 跳过非 plugin card（如 discord-card）

    const sourceCodeLink = card.find('a.btn.btn-primary').first();
    const repoUrl = sourceCodeLink.attr('href') ?? '';
    const slug = repoUrl.split('/').pop() ?? name;

    const authorLink = card.find('div.card-footer a[href*="github.com/"]').first();
    const author = authorLink.text().trim() || 'Unknown';

    const description = card.find('p.card-text').text().trim().slice(0, 280);
    const tags = card.find('span.badge').map((_, b) => $(b).text().trim()).get();

    plugins.push({ name, slug, author, description, repoUrl, tags });
  });

  return plugins;
}
```

**依赖**：`cheerio@^1.0.0`（MIT，Node 原生，2MB）—— 比手写 HTML 解析器稳定，比 jsdom 轻量 5x。

> ⚠️ `cheerio` 是**新增依赖**——需在 `manager-server/package.json` 加 `cheerio` + lockfile。

---

## 3. 字段映射表（与 Phase 1 `CommunityPlugin` 接口对齐）

| Phase 1 字段 | 数据源 | endpoint | 取值规则 |
|---|---|---|---|
| `slug` | HTML | — | `repoUrl.split('/').pop()` |
| `name` | HTML | — | 原文 |
| `author` | HTML | — | 原文 |
| `description` | HTML | — | 截断 280 字 |
| `repoUrl` | HTML | — | 原文 |
| `latestVersion` | **GitHub API** | `/repos/{owner}/{repo}/releases/latest` | `tag_name`；404 = 无 release → `'unknown'` |
| `updatedAtIso` | **GitHub API** | `/repos/{owner}/{repo}` | `pushed_at`（普适，所有仓库都有） |

**双源融合策略**：
- **第一源（HTML 解析）**：必跑，25 条一次性，确定 `slug` / `repoUrl` / `name` / `author` / `description`
- **第二源（GitHub API 批量）**：按 HTML 解析结果，对每个 repo 调 2 个 endpoint
  - `GET /repos/{owner}/{repo}` → `pushed_at`（`updatedAtIso`）
  - `GET /repos/{owner}/{repo}/releases/latest` → `tag_name`（`latestVersion`）；404 = 无 release tag → 降级 `'unknown'`
- 失败降级：单仓库 GitHub API 失败不影响列表展示；该条 `latestVersion='unknown'` + `updatedAtIso=fetchedAtIso` 占位
- 5min 进程内缓存复用——5min 内 0 GitHub API 调用

---

## 3.1 GitHub API 调用范式（核心）

### 3.1.1 端点

| 端点 | 用途 | 返回字段 | 频率 |
|---|---|---|---|
| `GET https://api.github.com/repos/{owner}/{repo}` | 仓库元数据 | `pushed_at` / `default_branch` / `description` | 25 次/全量 |
| `GET https://api.github.com/repos/{owner}/{repo}/releases/latest` | 最新 release | `tag_name` / `published_at` / `name` | 25 次/全量 |
| `GET https://api.github.com/rate_limit` | 限流查询 | `resources.core.remaining` / `reset` | 1 次/全量（可选） |

**端点固定头部**（必带）：
```
Accept: application/vnd.github+json
X-GitHub-Api-Version: 2022-11-28
User-Agent: unturned-manager
```

**鉴权头部**（可选，提高限流到 5000/h）：
```
Authorization: Bearer <GITHUB_TOKEN>
```

### 3.1.2 限流策略

| 模式 | 限流 | 25 仓库 × 2 端点 = 50 调用 | 可行性 |
|---|---|---|---|
| 匿名（无 token） | 60/h | 恰好够 1 次全量刷新（剩余 10 给其他 API 路径） | ⚠️ 5min 缓存下完全够用；Sprint 5 实机验证 |
| PAT 鉴权（user token） | 5000/h | 100 次/全量，零压力 | ✅ 推荐生产环境配置 |
| GitHub App 鉴权 | 5000/h（按 app 维度） | 100 次/全量，零压力 | 进阶，不在 Phase 1 范围 |

**Phase 1 策略**（用户拍板 2026-08-12）：
- **必走**：用户在 LdmPage「插件来源」Tab 顶部配置 GitHub PAT（Personal Access Token，**classic 即可，public_repo 权限**，无需任何写权限）
- **fallback**：用户未配 PAT 时，匿名 60/h 限流——5min 缓存内只跑 1 次，足够
- **PAT 存储位置**：**LdmPage 页面本地状态**（React useState + localStorage 兜底），**不动 settingsStorage**——理由：PAT 只服务 LDM 社区插件列表，不属于「系统级设置」，不污染 SettingsPage 的 Steam WebAPI Key 域
- **后端透传**：每次 `LdmPluginSourceService.listCommunityPlugins()` 调用从请求头 `X-GitHub-PAT` 读取 PAT（不持久化在后端）—— 用户改 PAT 立即生效，无需重启面板
- **配置 UI**（在 LdmPage「插件来源」Tab 顶部，详见 Phase 1 文档 §7）：
  - `<Input type="password">` 输入 PAT
  - 「测试连通性」按钮 → 调 `POST /api/ldm/community-plugins/test-pat` → 返回限流状态
  - 当前限流显示：`5000/h` / `60/h` / `受限`

### 3.1.3 429 / 403 限流响应处理

GitHub API 限流触发返回：

```http
HTTP/1.1 403 Forbidden
{
  "message": "API rate limit exceeded for <ip>.",
  "documentation_url": "https://docs.github.com/rest/overview/resources-in-the-rest-api#rate-limiting"
}
```

**处理**：
```typescript
if (res.status === 403) {
  const remaining = res.headers.get('x-ratelimit-remaining');
  const reset = res.headers.get('x-ratelimit-reset');  // Unix epoch seconds
  if (remaining === '0') {
    // 限流命中——使用 stale 缓存兜底
    throw new AppError('community-source-rate-limited',
      `GitHub API 限流，${reset} 后重置`, 429);
  }
}
```

**响应头部字段**：
- `x-ratelimit-limit`：总配额（60 或 5000）
- `x-ratelimit-remaining`：剩余调用次数
- `x-ratelimit-reset`：重置时间（Unix epoch 秒）
- `x-ratelimit-used`：已用次数

### 3.1.4 并发控制

25 仓库 × 2 端点 = 50 次 GitHub API 调用。**全串行**延迟 = 50 × 200ms = 10s（超 10s timeout）；**全并发** = 200ms 总延迟但会瞬间打满 60/h 限流。

**推荐**：分批并发 + 5s 内跑完

```typescript
const BATCH_SIZE = 5;        // 每批 5 个仓库并发
const PER_REQUEST_TIMEOUT_MS = 5_000;

async function fetchGitHubMetadata(plugins: RawCommunityPlugin[]): Promise<CommunityPlugin[]> {
  const results: CommunityPlugin[] = [];
  for (let i = 0; i < plugins.length; i += BATCH_SIZE) {
    const batch = plugins.slice(i, i + BATCH_SIZE);
    const enriched = await Promise.all(batch.map(async (raw) => {
      try {
        const [repoData, latestRelease] = await Promise.all([
          fetchRepo(raw.author, raw.slug),
          fetchLatestRelease(raw.author, raw.slug).catch(() => null),  // 404 = 无 release
        ]);
        return mapToCommunityPlugin(raw, repoData, latestRelease);
      } catch (err) {
        // 单仓库失败——降级 unknown + 占位
        return mapToCommunityPluginFallback(raw);
      }
    }));
    results.push(...enriched);
  }
  return results;
}
```

**性能**：
- 25 / 5 = 5 批 × 200ms = **总延迟 ~1s**（远低于 10s timeout）
- 50 调用 / 5min 缓存 = 60 calls/h 限流刚好用满一次

### 3.1.5 完整调用示例（PAT 由调用方参数传入，不持久化）

> **架构决策**（2026-08-12）：PAT **不进** `settingsStorage`——用户在前端 `LdmPage`「插件来源」Tab 顶部配置 + localStorage 持有；每次请求通过 `X-GitHub-PAT` 请求头透传到后端，后端 `LdmPluginSourceService.listCommunityPlugins(pat: string | null)` 把 PAT 作为参数传到 `fetchRepo` / `fetchLatestRelease`。**后端无状态**，改 PAT 立即生效，无需重启面板。

```typescript
import { logger } from '../../utils/logger.js';
import { httpClient } from '../../utils/httpClient.js';

const GITHUB_API_BASE = 'https://api.github.com';
const COMMON_HEADERS = {
  'Accept': 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'unturned-manager',
};

/**
 * 构造带 PAT 的请求头。
 * @param pat 用户从 X-GitHub-PAT 请求头透传过来（前端 localStorage 持有）；null = 匿名
 */
function buildGithubHeaders(pat: string | null): Record<string, string> {
  const headers: Record<string, string> = { ...COMMON_HEADERS };
  if (pat) headers['Authorization'] = `Bearer ${pat}`;
  return headers;
}

async function fetchRepo(
  owner: string,
  repo: string,
  pat: string | null,
): Promise<RepoResponse> {
  const res = await httpClient.get(`${GITHUB_API_BASE}/repos/${owner}/${repo}`, {
    headers: buildGithubHeaders(pat),
    timeout: 5_000,
  });
  if (res.status === 403 && res.headers['x-ratelimit-remaining'] === '0') {
    throw new AppError('community-source-rate-limited',
      `GitHub API 限流，${res.headers['x-ratelimit-reset']} 后重置`, 429);
  }
  if (!res.ok) throw new Error(`GitHub /repos 返回 HTTP ${res.status}`);
  return res.body as RepoResponse;
}

async function fetchLatestRelease(
  owner: string,
  repo: string,
  pat: string | null,
): Promise<ReleaseResponse | null> {
  const res = await httpClient.get(`${GITHUB_API_BASE}/repos/${owner}/${repo}/releases/latest`, {
    headers: buildGithubHeaders(pat),
    timeout: 5_000,
  });
  if (res.status === 404) return null;  // 仓库无 release
  if (res.status === 403 && res.headers['x-ratelimit-remaining'] === '0') {
    throw new AppError('community-source-rate-limited',
      `GitHub API 限流，${res.headers['x-ratelimit-reset']} 后重置`, 429);
  }
  if (!res.ok) throw new Error(`GitHub /releases/latest 返回 HTTP ${res.status}`);
  return res.body as ReleaseResponse;
}

/** Service 入口：路由层从请求头 X-GitHub-PAT 读取后传入 */
async function listCommunityPlugins(pat: string | null): Promise<CommunityPlugin[]> {
  const rawPlugins = await fetchHtmlList();          // 公开 API（cheerio 解析）
  return await enrichWithGitHub(rawPlugins, pat);    // 5 仓库/批并发（见 §3.1.4）
}

interface RepoResponse {
  pushed_at: string;        // ISO 8601
  default_branch: string;
  description: string;
}
interface ReleaseResponse {
  tag_name: string;
  published_at: string;
  name: string;
}
```

### 3.1.6 测试连通性按钮（LdmPage「插件来源」Tab 顶部）

```typescript
// POST /api/ldm/community-plugins/test-pat
// 请求：{ pat: string }
// 响应：{ ok: boolean, rateLimit: { limit, remaining, reset } | null, error: string | null }

async function testGithubPat(pat: string): Promise<{
  ok: boolean;
  rateLimit: { limit: number; remaining: number; reset: number } | null;
  error: string | null;
}> {
  const res = await httpClient.get(`${GITHUB_API_BASE}/rate_limit`, {
    headers: {
      ...COMMON_HEADERS,
      'Authorization': `Bearer ${pat}`,
    },
    timeout: 5_000,
  });
  if (!res.ok) return { ok: false, rateLimit: null, error: `HTTP ${res.status}` };
  const data = res.body;
  return {
    ok: true,
    rateLimit: {
      limit: data.resources.core.limit,
      remaining: data.resources.core.remaining,
      reset: data.resources.core.reset,
    },
    error: null,
  };
}
```

UI 展示：「✓ 限流 5000/h，剩余 5000（重置于 5 小时后）」

### 3.1.7 Phase 1 决策矩阵（用户问 GitHub API）

| 用户场景 | Phase 1 行为 |
|---|---|
| 配了 PAT（public_repo 权限） | 5000/h 限流，每次 25 仓库全量跑 GitHub API；`latestVersion` 真实显示 release tag |
| 未配 PAT | 60/h 限流，每次 25 仓库全量跑 GitHub API；`latestVersion` 真实显示 release tag（缓存兜底 5min 内 0 调用） |
| PAT 无效（401/403） | 抛 `github-pat-invalid` 错误码；UI 提示「Token 无效，请检查 public_repo 权限」 |
| 撞限流（403 + x-ratelimit-remaining=0） | 抛 `community-source-rate-limited`；stale 缓存兜底 |
| 仓库无 release（404 on /releases/latest） | 该条 `latestVersion='unknown'`；`updatedAtIso` 仍可拿（`/repos/` 端点） |
| 仓库不存在（404 on /repos/） | 跳过该条，warn log |
| GitHub API 整体 5xx | 抛 `community-source-unreachable`；stale 缓存兜底 |

---

## 4. 25 个插件清单（Phase 1 缓存种子数据）

> 抓取时间：2026-08-12T20:30Z · 后续 5min 缓存内复用此表

| # | slug | name | author | 主页状态 |
|---|---|---|---|---|
| 1 | `AdvancedGodVanish` | AdvancedGodVanish | RocketModPlugins | Unmaintained |
| 2 | `AntiSuicide` | AntiSuicide | RocketModPlugins | Unmaintained |
| 3 | `AppleAdminControl` | AppleAdminControl | XanderCodes | — |
| 4 | `AppleVote` | AppleVote | XanderCodes | — |
| 5 | `AdvancedCosmetics` | AdvancedCosmetics | F-Plugins | — |
| 6 | `JoinLeaveMessages` | JoinLeaveMessages | F-Plugins | — |
| 7 | `RustResources` | RustResources | F-Plugins | — |
| 8 | `Teleporting` | Teleporting | F-Plugins | — |
| 9 | `FeexRanks` | FeexRanks | RocketModPlugins | Unmaintained |
| 10 | `IsAbusing` | IsAbusing | RocketModPlugins | Unmaintained |
| 11 | `JoinLeaveMessages` | JoinLeaveMessages | RocketModPlugins | Unmaintained（**与 #6 同 slug，重复**） |
| 12 | `Kits` | Kits | RocketModPlugins | Unmaintained |
| 13 | `MessageAnnouncer` | MessageAnnouncer | RocketModPlugins | Unmaintained |
| 14 | `PlayerInfoLib` | PlayerInfoLib | RocketModPlugins | Unmaintained |
| 15 | `LDM_RealisticJump` | RealisticJump | aniloztrk | — |
| 16 | `SimpleDeathMessages` | SimpleDeathMessages | RocketModPlugins | Unmaintained |
| 17 | `TPA` | TPA | RocketModPlugins | Unmaintained |
| 18 | `Vaults` | Vaults | RocketModPlugins | Unmaintained |
| 19 | `Votifier` | Votifier | RocketModPlugins | Unmaintained |
| 20 | `ZaupClearInventoryLib` | ZaupClearInventoryLib | RocketModPlugins | Unmaintained |
| 21 | `ZaupFeast` | ZaupFeast | RocketModPlugins | Unmaintained |
| 22 | `ZaupHomeCommand` | ZaupHomeCommand | RocketModPlugins | Unmaintained |
| 23 | `ZaupShop` | ZaupShop | RocketModPlugins | Unmaintained |
| 24 | `ZaupUconomyEssentials` | ZaupUconomyEssentials | RocketModPlugins | Unmaintained |
| 25 | `uEssentials` | uEssentials | TH3AL3X (fork of leonardosnt) | — |

**注意**：
- 6# 与 11# 同 slug `JoinLeaveMessages`——F-Plugins 和 RocketModPlugins 各自维护一份。
- 主页 HTML 解析需按「slug + author」去重，避免 F-Plugins 列表 + RocketModPlugins 列表各计一次。

---

## 5. 性能预算

| 指标 | 实测 | 预算 |
|---|---|---|
| 拉取延迟 | 287ms | ≤ 1s |
| HTML 体积 | 54KB | ≤ 100KB |
| 解析时间（cheerio） | 估 ≤ 50ms | ≤ 200ms |
| 25 插件解析后内存 | 估 ≤ 100KB | ≤ 1MB |
| 5min 缓存命中后端到端 | 估 ≤ 5ms | ≤ 50ms |

---

## 6. 错误降级

| 场景 | 行为 | 错误码 |
|---|---|---|
| 拉取超时（> 10s） | 抛 `community-source-unreachable` | 502 |
| 拉取 HTTP 500/502/503 | 抛 `community-source-unreachable` | 502 |
| HTML 结构变化（无 `h5.card-title`） | 抛 `community-source-malformed` | 502 |
| 部分 plugin 解析失败（缺字段） | 跳过该条，warn log；正常返回剩余 | — |
| 解析全空（0 plugins） | 仍返回 `{ plugins: [], stale: false }` | 200（不视为错误） |
| 缓存空 + 上游不可达 | 抛 `community-source-unreachable` | 502 |
| 缓存有 + 上游不可达 | 返回 stale 缓存 | 200 + `stale: true` |

---

## 7. 缓存策略

复用 `WorkshopMetadataService.browseMods` 5min 进程内 Map 模式：

```typescript
const COMMUNITY_CACHE_TTL_MS = 5 * 60 * 1000;
const COMMUNITY_FETCH_TIMEOUT_MS = 10_000;

type CommunityCacheEntry = {
  plugins: CommunityPlugin[];
  expiresAt: number;
  fetchedAtIso: string;
};

let communityCache: CommunityCacheEntry | null = null;

export function __resetCommunityCacheForTest(): void {
  communityCache = null;
}
```

---

## 8. 风险与待验证项

| 风险 | 缓解 | 验证方法 |
|---|---|---|
| LDM-Community 改 HTML 结构（class 改名） | 解析失败 → 抛 `community-source-malformed` + stale 兜底 | 单测覆盖 class 缺失场景 |
| LDM-Community 下线 | stale 缓存兜底最多 5min 后报错 | 监控 |
| 国内访问 ldm-community.github.io 慢（CDN 节点问题） | 10s timeout 兜底；5min 缓存命中 0 HTTP | 实机验证（Sprint 5 Linux UAT） |
| 主页插件数持续增长（25 → 50+） | cheerio 解析 50 个 card ≤ 200ms 无压力 | 性能单测 |
| 重复 slug（JoinLeaveMessages × 2） | 按 `slug::author` 去重 | 单测 #1 验证 |
| 主页 HTML 含不在 Bootstrap 模板的特殊内容 | `__resetCommunityCacheForTest` 钩子便于排查 | — |

---

## 10. 关联文档

- **设计文档**：`docs/architecture/ldm-integration-design.md` §11.1 G1 + §12.2 Phase 1
- **详细规格**：`claudedocs/workflow_sprint5_ldm_phase1.md` §5（`LdmPluginSourceService` 详细规格）
- **活参考（HTTP 客户端）**：`claudedocs/reference_api_spec.md`（查 `httpClient.get` 用法）
- **上游 URL**：`https://ldm-community.github.io/pluginlist/`
- **HTML 真源**：GitHub `LDM-Community/pluginlist` 仓（具体路径待核实）

---

*版本：v0.1 调研报告 · 2026-08-12*
