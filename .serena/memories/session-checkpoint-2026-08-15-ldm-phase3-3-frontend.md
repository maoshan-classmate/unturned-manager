## Session Checkpoint 2026-08-15 — LDM Phase 3-3 前端落地

> **承接**：Phase 2+3 后端 commit `f03ea3d`（4 commit：65e24c9 / 1f3f2c8 / 5cb7080 / f03ea3d）
> **本次会话范围**：Phase 3-3 前端闭环 + 后端补 2 端点（commit `f944bc8`）

---

## Commit 落档

| Commit | 内容 | 文件数 |
|---|---|---|
| `f944bc8` | Phase 3-3 前端：5 新组件 + CommunityCard 改造 + LdmPage Tab 2→4 + 后端补 /version + /modules-state 端点 + shared schema | 15 文件 +1404/-16 |

---

## 用户关键决策（下次会话沿用）

1. **FrameworkConfigTab 本 PR 带骨架 + LdmAboutCard**——用户拍板「本 PR 带骨架 + LdmAboutCard（推荐）」
2. **CommunityCard 双入口布局 = 标题旁加 Info 按钮**——用户拍板「标题旁加 Info 按钮（推荐）」，按钮区只保留「上传到此实例」
3. **Clipboard API 沿用项目惯例**——`navigator.clipboard.writeText` 裸调，失败由 sonner toast 反馈（不引入兜底）
4. **G5 守住**——CommunityPluginDetailDialog 仅显示 README 预览 + Releases 外链，不触发 .dll 下载
5. **界面文案合规**——按 `reference_ui_terms.md` 修正：LDM 状态→Mod 框架状态 / Rocket.Unturned→Mod 框架模块 / 首次启用 LDM 主框架→首次启用 Mod 框架；「关于 LDM」按表保留（品牌徽章）

---

## 后端补 2 端点（小改）

| 端点 | 后端方法 | 错误处理 | 备注 |
|---|---|---|---|
| `GET /api/servers/:id/ldm/version` | `commands.readLdmVersion(serverId)` | `server-not-running` 409 | LDM 版本（PTY 写空 `/rocket` 解析） |
| `GET /api/servers/:id/ldm/modules-state` | `commands.readModulesState(serverId)` | 同上 | Rocket.Unturned 模块加载状态（PTY 写 `/modules`） |

**Phase 2 后端已有方法**（Phase 2b 落档），**未暴露给前端路由**——Phase 3-3 补 2 GET + 4 单测（happy + server-not-running × 2 路径）

---

## 前端 5 新组件 + 1 改造 + 1 Tab 切换

### 1. `LdmStatusCard`（new）— InstalledTab 顶部
- 容器：`components/shared/Card`
- 数据：`useQuery(['ldm','status', serverId])` → `/status`
- 视觉：3 项状态徽章（主框架/配置目录/插件总数）+ 检测时间
- 复用：`Card`、Lucide icons、`formatDate`

### 2. `LdmAboutCard`（new）— FrameworkConfigTab 顶部
- 数据：并行 2 useQuery（`/version` + `/modules-state`）
- 视觉：主框架版本 `Rocket v<ver> for Unturned v<gameVer>` + 模块加载状态
- **失败处理**：axios 错误码路径 `err.response.data.error.code`（与 LaunchCommandsDialog 等组件惯例一致）—— `server-not-running` 时显示提示「实例未运行，无法读取版本信息」**不阻塞 UI**

### 3. `OnboardingSopCard`（new）— LdmPage 全局顶层
- 容器：`components/shared/InfoCard`（沿用 InstallStepsCard 模式）
- 默认展开（设计 §4 明确要求首次进入 LdmPage 时引导文案可见）
- 折叠状态：`useState(() => localStorage.getItem('ldm.onboardingDismissed') === 'true')`——`useState` 初始化函数读 localStorage，避免 useEffect 异步导致的初始渲染与测试预期不一致
- 复制命令按钮：cp 激活命令 + ServerHelper.sh 启动命令，2 个独立按钮
- 复制实现：`navigator.clipboard.writeText(cmd).then(success, error)` —— 沿用 FilesPage.tsx:494 惯例
- 错误测试坑：`Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } })` 重写只读 getter；`userEvent.click` 对 `@base-ui/react/button` 包装的 Button 有兼容问题，改用 `fireEvent.click` 同步触发

### 4. `CommunityPluginDetailDialog`（new）— 插件来源详情抽屉
- 容器：`components/shared/Dialog`（width=560，复用 `Dialog.Title` + `Dialog.Footer`）
- 数据：`useQuery(['ldm','plugin-detail', owner, repo])` → `/community-plugins/:owner/:repo`
- PAT 透传 header `X-GitHub-Pat`（与 listCommunityPlugins 同模式）
- 视觉：标题 + 3 列 Grid 元数据（作者/版本/更新时间）+ 介绍 + README 预览 + 「打开 GitHub Releases」外链 + 关闭
- **不触发下载**——守住 G5
- 错误处理：404 / 网络失败显示「详情读取失败」

### 5. `FrameworkConfigTab`（new 骨架）— 4 Tab 之一
- 顶部：`<LdmAboutCard>`
- 中/下部：Rocket.config.xml + Rocket.Unturned.config.xml 编辑器占位（编辑器本体留 Phase 4——依赖未实现的 GET 读端点）

### 6. `PermissionsTab`（new 骨架）— 4 Tab 之一
- 单张占位卡「权限组编辑器即将上线」

### 7. `CommunityCard`（改造）— 标题旁加 Info 按钮
- 新增 `onViewDetail: (slug: string) => void` prop
- 标题右侧 `<button>`（图标 Info size={12}），onClick → `onViewDetail(p.slug)`
- 「查看仓库」→ 「前往 Releases」（更准确，外链到 GitHub Releases 页而非仓库主页）

### 8. `LdmPage.tsx`（改造）— Tab 数 2→4
- `activeTab` 类型：`"installed" | "framework" | "permissions" | "source"`
- 顶层加 `useState<{owner: string; repo: string} | null>` 控制详情抽屉开关
- 顶层加 `onViewDetail = (slug) => setDetailSlug(slug.split('/'))`
- 渲染顺序：标题 → `<OnboardingSopCard>` → `<TabBar>` → 当前 Tab 内容 → `<CommunityPluginDetailDialog>`（顶层固定）

---

## 关键复用清单

| 对象 | 复用位置 |
|---|---|
| `Card` (shared) | LdmStatusCard / LdmAboutCard / FrameworkConfigTab |
| `InfoCard` (shared) | OnboardingSopCard |
| `Dialog` (shared) | CommunityPluginDetailDialog |
| `TabBar` (shared) | LdmPage 顶层 4 Tab |
| `PageState` (shared) | InstalledTab / SourceTab 列表状态 |
| `ConfirmDialog` (shared) | PluginCard 加载/卸载确认 |
| `formatDate` / `stripBbcode` / `errorMessage` | lib/utils.ts |
| `navigator.clipboard.writeText` | OnboardingSopCard（项目惯例） |

---

## 验证门槛最终态

- 前后端 + shared typecheck **0 错**
- 后端 LDM 路由单测 **18/18**（+4 新 for /version + /modules-state）
- 前端 LDM 新组件单测 **20/20**（LdmStatusCard 4 + LdmAboutCard 4 + OnboardingSopCard 6 + CommunityPluginDetailDialog 6）
- LdmPage.test.tsx **11/11**（10 旧 + 1 新「点查看详情 → onViewDetail 回调」）
- 全前端单测 **152/155**、全后端 **311/345**——剩余失败均为历史 backlog（PTY `\r→\n` 断言、steamCmdManager mock 串台、ItemListDialog），与本次改动无关

---

## 关键 bug 与修复（颗粒度清晰）

1. **axios 错误码读取路径**：原写 `(err as { code?: string }).code`（错），应为 `err.response.data.error.code`（与项目惯例一致）→ LdmAboutCard.server-not-running 提示能正常触发
2. **`Object.assign(navigator, { clipboard })` 失败**：`navigator.clipboard` 在 JSDOM 是只读 getter → 改 `Object.defineProperty(navigator, "clipboard", { configurable: true, value })`
3. **`userEvent.click` 对 `@base-ui/react/button` 包装的 Button 失效**：copy button 的 onClick 不触发 → 改 `fireEvent.click` 同步触发（writeText 调用即可同步断言）
4. **useState + useEffect 异步导致测试断言不一致**：原 `useState(true)` + `useEffect` 读 localStorage → 初始渲染折叠，useEffect 后展开，测试断言时序错位 → 改 `useState(() => localStorage.getItem(...) === 'true')` 初始化函数同步读
5. **`getByText(/复制/)` 多匹配**：复制按钮 aria-label + 容器 li 文字均含「复制」→ 改 `container.querySelector('button[aria-label="..."]')` 精确选择

---

## 界面文案合规自检

按 `reference_ui_terms.md` 检查本次新增用户可见文案：
- ✅ 「Mod 框架」「已装插件」「框架配置」「权限组」「插件来源」——顶层 Tab/标题
- ✅ 「Mod 框架状态」（非 LDM 状态）
- ✅ 「Mod 框架模块」（非 Rocket.Unturned）
- ✅ 「首次启用 Mod 框架」（非 LDM 主框架）
- ✅ 「关于 LDM」——**保留**（ui_terms 表：徽章可保留 LDM 品牌名）
- ✅ 「Rocket.config.xml 编辑器」——**保留文件名原文**（ui_terms 表：文件名保留原文便于 GitHub 查问题）

---

## 下次会话接手点

1. **Phase 4 需先实机验证 Phase 3**——`docs/architecture/ldm-integration-design.md` §12.7 升期门控第 4 项「实机验证」未做（Sprint 5）
2. **Phase 4 设计**（升级 +3-5 人天）：B4 单插件 reload + 插件搜索/筛选——需 `LdmPluginCommandsService.reloadPlugin(serverId, name)`（PTY `/rocket reload <name>`）+ `LdmDiscoveryService.searchPlugins(serverId, query)`
3. **LDM-Community 列表 hasReleases 字段**——用户拍板「先不管」留待下次会话评估（uEssentials 等活跃项目有 Release，老 RocketModPlugins 系列无 Release 仅 .sln）
4. **结构化编辑器本体**——依赖未实现的 GET 读端点（GET /rocket-config + GET /rocket-unturned-config + GET /permissions-config + GET /plugins/:name/config 读）；可与 Phase 4 并行或后置

---

## 历史遗留 Phase 1 fail（升期门控外的 backlog，不阻塞）

- PTY 写命令断言 `\r→\n` 联动——commit `0b1a882` 改了产品代码但测试断言未同步（ldmPluginCommandsService × 2 + serverManager × 3 fail）
- `steamCmdManager` mock 串台——`vi.clearAllMocks()` 不清 implementation 残留（3 fail）
- ItemListDialog / LoadoutItemDialog（前端 3 fail）
- 修复建议：构造函数注入 mock，避免共享全局 fakeXxx

---

## 关联文档

- `docs/architecture/ldm-integration-design.md` §12.4 Phase 3 设计稿
- `docs/architecture/ldm-phase2-design.md`（Phase 2 实施契约层）
- `docs/adr/0006-ldm-framework-integration.md`（ADR 边界决策）
- `.claude/rules/unturned-sop.md` §LDM（重启流水线 + G5 边界）
- `.serena/memories/session-checkpoint-2026-08-15-ldm-b1-upload.md`（2026-08-15 LdmPage B1 闭环 + InfoCard 抽取）
- `.serena/memories/session-checkpoint-2026-08-15-ldm-phase2-3.md`（Phase 2+3 后端）
- `claudedocs/reference_ui_terms.md`（界面文案术语对照表）