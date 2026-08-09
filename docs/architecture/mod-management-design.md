# Unturned Mod 管理系统 — 完整设计规格（v2.4 · 生产质量版）

> **版本**：v2.4（2026-08-09，实现完成）
> **v1 → v2 变更**：砍掉所有后端缓存 / 补 DST 三源合一哲学 / 加 acf 维护模块 / 接入 React Query
> **v2 → v2.1 变更**（老板拍板）：ModsPage = 单 Tab（Steam 创意工坊浏览）+ 下载入口；已下载 Mod 的启用/禁用/删除/配置复用 Config > Workshop Tab（已有 `WorkshopTab` 组件，不新建）
> **v2.1 → v2.2 变更**（老板拍板）：下载成功只弹 Toast（如 `Hawaii 下载成功`），**不调 `router.push`、不引导跳转、不弹第二条 toast.info**。Toast 即全部反馈，用户自主决定下一步。
> **v2.2 → v2.3 变更**：全部 Phase A-F 实现完成并通过验证——后端 73 单测 + 16 API e2e；前端 29 单测 + 5 浏览器 UI e2e；typecheck 前后端 0 错误。
> **v2.3 → v2.4 变更**：浏览链路改为**单次 QueryFiles**（不再调 GetDetails/GetPlayerSummaries，避免叠加超时）；评分星精确填充（2.7 分=2满+0.7部分）；列表/详情**不展示作者与 ID**；每页默认 12 条。
> **设计原则**：DST 三源合一状态模型（WebAPI 元数据 + acf 真源 + File_IDs 启用列表）；零后端缓存；前端 React Query 防抖；acf 同步维护；**最小化用户打扰**；浏览单次调用避免超时
> **状态**：✅ **已实现**（2026-08-09）
> **核心参考**：DST 全链路分析 `claudedocs/research_dst_mod_reference_2026-08-08.md`

---

## 0. v1 → v2 关键变更

| 项 | v1（已废弃） | v2（本次） | 理由 |
|---|---|---|---|
| **后端缓存 `browseMods`** | 60s LRU + stale-while-revalidate | **0 缓存** | DST 哲学：真源唯一，缓存会引入一致性风险；单用户命中率 < 5% |
| **后端缓存 `getModDetails`** | 600s fresh + 1h stale | **0 缓存** | 同上；用户切详情弹窗 < 1s 间隔，无需缓存 |
| **`workshop_mods` 表** | 缓存元数据 | **删除** | 派生数据 = 一致性问题源；WebAPI 是真源 |
| **`workshop_creators` 表** | 缓存作者名 | **删除** | 同上；v2.4 起**不查作者名**（对齐 DST：作者字段仅内部持有 SteamID，不展示） |
| **acf 处理** | "只读" | **同步维护** | Mod 管理的核心闭环，U3DS 启动读 acf |
| **前端防抖** | 手动 useState | **React Query** | 自动 staleTime + 同 queryKey 复用 |
| **8 个用户报告问题** | 散点修复 | **ModsPage 单 Tab 改造 + Config > Workshop Tab 复用** | ModsPage 只负责"浏览 + 下载入口"；已下载 Mod 的启用/禁用/删除/配置复用 Config > Workshop Tab（已有组件，不新建） |
| **`VDF` 解析** | 假设有第三方库 | **200 行自写** | DST 验证可行；零依赖 |
| **MVP 概念** | 有 | **没有——按生产质量全量交付** | 用户明确指示 |

---

## 1. 现状证据

### 1.1 已存在的资产

| 资产 | 位置 | 用途 |
|---|---|---|
| `WorkshopMetadataService` | `manager-server/src/modules/workshop/WorkshopMetadataService.ts` | 已有 `browseMods`，**已重写**（v2.4：单次 QueryFiles + 45s timeout） |
| `SteamCmdManager.downloadWorkshopItem()` | `manager-server/src/modules/steamcmd/SteamCmdManager.ts:155-213` | **已实现**下载到 staging（带脚本生成 + 进度广播） |
| `IWorkshopMetadataService` 契约 | `shared/contracts/workshop.ts` | **已定稿**（v2.4 无 authorName） |
| `apiClient` | `manager-web/src/api/client.ts` | 复用 |
| `sonner` 依赖 | `manager-web/package.json:43` | **已装**并已挂 `<Toaster />` |
| `ModsPage` | `manager-web/src/pages/ModsPage.tsx` | **已重写**（v2.4：单 Tab + 单次 QueryFiles + 评分精确星） |
| `ModCard` | `manager-web/src/components/mods/ModCard.tsx` | **已改**（shadcn variant + 订阅数展示 + 精确评分星，不展示作者/ID） |
| `shadcn Button` | `manager-web/src/components/ui/button.tsx` | **已存在**，5 variant × 6 size |
| `Dialog` | `manager-web/src/components/shared/Dialog.tsx` | **已存在**（22 行） |
| `PageState` | `manager-web/src/components/shared/PageState.tsx` | **已存在**（四态容器） |

### 1.2 缺失的资产

| 缺失 | 必须新建 | 位置 |
|---|---|---|
| **VDF/acf 解析器** | ✅ 新建 `WorkshopAcfService` | `manager-server/src/modules/workshop/WorkshopAcfService.ts` |
| **staging→content 移动 + acf 同步 + File_IDs 同步** | ✅ 新建 `WorkshopApplyService` | `manager-server/src/modules/workshop/WorkshopApplyService.ts` |
| **shadcn sonner wrapper** | ✅ 新建 `manager-web/src/components/ui/sonner.tsx` + 挂 `<Toaster />` | `App.tsx` |
| **Mod 详情弹窗** | ✅ 新建 `ModDetailDialog.tsx` | `manager-web/src/components/mods/` |
| **ModCard 骨架** | ✅ 新建 `ModCardSkeleton.tsx` | `manager-web/src/components/mods/` |
| **删除端点 + 服务** | ✅ 新建 `WorkshopDeleteService` | `manager-server/src/modules/workshop/` |
| **Zod schema** | ✅ 新建 `mod.schema.ts` | `shared/schemas/` |
| **@tanstack/react-query** | ❌ 已在 `manager-web/package.json` 依赖里（zustand 同包族） | 复用 |

### 1.3 8 个用户报告问题 → 解决方案映射

| # | 问题 | v2 方案 |
|---|---|---|
| 1 | 作者字段取值错误（SteamID64） | v2.4：**列表/详情不展示作者字段**（对齐 DST，避免 GetPlayerSummaries 叠加超时） |
| 2 | 作者/ID 样式无差异 | v2.4：**列表/详情不展示作者与 ID**（只显示订阅数 + 评分星） |
| 3 | 介绍里有 `[h1] [EN]` 残留 | 前端 `stripBbcode()` 兜底工具函数（browse 单次 QueryFiles 返回 description） |
| 4 | 详情按钮样式错误 | 删 `style={{}}` 内联 + 走 shadcn `Button variant="outline"`（有边框） |
| 5 | "订阅"逻辑错误 | 重命名 + 改逻辑：调 `POST /api/servers/:id/workshop/download` → 9 步流水线 → Toast `Hawaii 下载成功` |
| 6 | 详情按钮跳转外链 | 改弹窗：shadcn Dialog 包装 + `ModDetailDialog` 组件 + "在 Steam 中打开" 兜底链接 |
| 7 | 首次加载超时 | 单次 QueryFiles + 45s timeout（国内网络冷启动 20-40s）+ React Query staleTime 防抖 + **0 后端缓存** |
| 8 | Loading 范围错误 | 拆三态：服务器 loading（Header） + 浏览 loading（卡片网格 6 个 skeleton） + 已安装 loading（无感）；**页面壳始终渲染** |

---

## 2. 系统架构图

### 2.1 模块关系（C4 Level 3a · 后端）

```
┌──────────────────────────────────────────────────────────┐
│                       API 层 (Express)                   │
│  ┌─────────────────────────────────────────────────────┐  │
│  │ routes/mod-browse.ts（v2.3 全局浏览）                 │  │
│  │  GET    /api/mods/search                            │  │
│  │  GET    /api/mods/:fileId                           │  │
│  │  POST   /api/mods/batch-details                     │  │
│  │ routes/mods.ts（服务器操作）                          │  │
│  │  GET    /:id/mods/downloaded                         │  │
│  │  POST   /:id/mods/download                           │  │
│  │  POST   /:id/mods/apply                              │  │
│  │  DELETE /:id/mods/:fileId                            │  │
│  │  GET    /:id/mods/acf                                │  │
│  │  WS     steamcmd_progress / download_completed       │  │
│  └────────────────────┬────────────────────────────────┘  │
│                       │ 依赖 ↓                            │
└───────────────────────┼──────────────────────────────────┘
                        │
┌───────────────────────┼──────────────────────────────────┐
│  核心域层（重写 + 新增）  ▼                                  │
│  ┌──────────────────────────┐  ┌────────────────────────┐ │
│  │WorkshopMetadataService   │  │WorkshopAcfService ★    │ │
│  │（重写：去缓存）           │  │（新建：VDF 解析 + 维护） │ │
│  │  · getModDetails()       │  │  · parse(serverId)      │ │
│  │  · browseMods()          │  │  · listItems()          │ │
│  │  · batchGetDetails()     │  │  · addItem()            │ │
│  │  · getAuthorName() ★     │  │  · removeItem()         │ │
│  │  · stripBbcode()         │  │  · backup() / rollback  │ │
│  └────────────┬─────────────┘  └────────┬───────────────┘ │
│               │                         │                 │
│               │    ┌────────────────────┘                 │
│               │    │                                      │
│  ┌────────────▼────▼────────────┐  ┌────────────────────┐ │
│  │WorkshopApplyService ★       │  │WorkshopDeleteService★│ │
│  │（新建：staging→content 流水线）│  │（新建：acf 删 + 目录删）│ │
│  │  · applyStaged(serverId)    │  │  · deleteMod()      │ │
│  │    ① 备份 Config + acf       │  │    ① acf 删项        │ │
│  │    ② 解析 staging/acf        │  │    ② 删 content/目录  │ │
│  │    ③ acf.addItem()           │  │    ③ 删 File_IDs     │ │
│  │    ④ 原子写 content/acf      │  │    ④ 备份回滚机制     │ │
│  │    ⑤ mv staging/content      │  │                      │ │
│  │    ⑥ 更新 File_IDs           │  │                      │ │
│  │    ⑦ WS 推 download_completed│  │                      │ │
│  │    ⑧ 任一失败→全部回滚       │  │                      │ │
│  └────────────┬────────────────┘  └────────┬─────────────┘ │
│               │                            │               │
│  ┌────────────▼────────────────────────────▼─────────────┐ │
│  │SteamCmdManager（已存在 · 复用）                          │ │
│  │  · downloadWorkshopItem() — 已实现 staging 下载          │ │
│  │  · updateU3DS() — 不动                                  │ │
│  └────────────────────────────┬────────────────────────────┘ │
└───────────────────────────────┼──────────────────────────────┘
                                │
┌───────────────────────────────▼──────────────────────────────┐
│  基础设施层                                                  │
│  · ProcessSupervisor（spawn steamcmd 复用）                  │
│  · IBroadcaster（WS 事件广播）                                │
│  · better-sqlite3（删 2 表后剩 4 表）                        │
└──────────────────────────────────────────────────────────────┘
```

### 2.2 前端组件图（C4 Level 3b）

> **关键设计决策（v2.1 修正）**：模组页面 = **Steam 创意工坊浏览**（查询 + 下载入口），**已下载 Mod 的管理（启用/禁用/删除/配置）复用 Config > Workshop Tab**（已有 `WorkshopTab` 组件，`ConfigPage.tsx:208-216`，不新建）。两个页面职责清晰分离。

```
ModsPage（单 Tab：Steam 创意工坊浏览）
├── TopBar（标题"模组管理" + 当前 query 摘要）
├── FilterBar
│   ├── SearchInput[复用]（按 Mod 名称搜索）
│   ├── Dropdown<ModSort>[复用]（popular/rated/published/updated/subscribed/relevance）
│   ├── Dropdown<ModTimeRange>[复用]（day/week/month/months3/months6/year/all）
│   ├── Dropdown<pageSize>[复用]（12/15/30/48，默认 12）
│   └── [搜索] Button[shadcn default variant]
├── ModGrid（grid-cols-3）
│   └── ModCard[重写] ← 单 variant：browse
│       ├── 预览图 + 标题 + 订阅数（不展示作者/ID）+ 精确评分星
│       ├── 操作：[下载] Button[shadcn default]  [详情] Button[shadcn outline]
│       └── 或 ModCardSkeleton[新建] × 6（loading 时）
├── PaginationBar[复用]
└── ModDetailDialog[新建]（shadcn Dialog 包装）
    ├── 大封面图（previewUrl）
    ├── 标题 / 大小 / 更新时间（不展示作者/ID）
    ├── 完整描述（BBCode 已 strip）
    ├── Tags（chips）
    ├── 操作区：[下载] [在 Steam 中打开]
    └── 关闭按钮

ConfigPage > WorkshopTab（已有，不改组件结构；只接新端点）
├── 状态：File_IDs ∩ acf → UnifiedMod[]
├── 行内操作：[启用/禁用] [更新] [删除]（DELETE 端点新增）
└── 底部 [保存配置] 按钮 → 调 /api/servers/:id/mods/apply 触发完整流水线
    ├── ConfigService 写 File_IDs
    ├── RCON Save + Shutdown 30
    ├── WorkshopApplyService.applyStaged（staging → content + acf 合并 + 回滚）
    ├── ProcessSupervisor.spawn
    └── A2S 轮询直到就绪
```

### 2.3 数据流：用户点"下载"按钮

```
用户点 ModCard 上的 [下载] 按钮
  │
  ▼
ModsPage.handleDownload(fileId)
  │   · serverId 从 useServer 拿第一个真实服务器（浏览用全局 /api/mods，下载才需要 serverId）
  │ toast.loading('下载中...')
  │
  ▼
POST /api/servers/:id/mods/download { fileId }
  │
  ▼
routes/mods.ts → SteamCmdManager.downloadWorkshopItem(installDir, [fileId])
  │   · spawn steamcmd +workshop_download_item 1110390 <id>
  │   · 下载到 staging/Server/<ID>/Workshop/staging/
  │   · WS 推 steamcmd_progress（实时进度）
  │   · 完成 → staging/appworkshop_1110390.acf 自动生成
  │
  ▼
[响应] { success: true, fileId, acfItem: { size, timeupdated, manifest } }
  │
  ▼
前端收到响应
  │   · toast.success('Hawaii 下载成功')  ← 全部反馈，结束
  │
  ▼
用户主动切到 Config > Workshop Tab（按需）
  │   · 看到新行（File_IDs 已含 fileId，或 staging 状态单独标记）
  │   · 用户点 [保存配置]（或 [应用]）按钮
  │
  ▼
POST /api/servers/:id/mods/apply
  │  body: { fileIds: ["1753134636", ...] }  ← ConfigPage 把当前所有 fileId 提交
  │
  ▼
ServerManager.applyModChanges(serverId, fileIds)  ← 走 architecture-spec §6.2
  │
  ▼
POST /api/servers/:id/mods/apply
  │
  ▼
ServerManager.applyModChanges(serverId, newFileIds)   ← 走 architecture-spec §6.2
  │
  ├─ ① ConfigService.backup(WorkshopDownloadConfig.json)
  ├─ ② ConfigService.writeWorkshopFileIds(newIds)
  ├─ ③ RCON "Say 服务器将在 60 秒后重启"
  ├─ ④ RCON "Save"
  ├─ ⑤ RCON "Shutdown 30 Mod 变更重启"
  ├─ ⑥ waitForExit(30s)
  │
  ├─ ⑦ **WorkshopApplyService.applyStaged(serverId)**   ← 新增
  │     ├─ 备份 acf → .bak.<UTC-ISO>
  │     ├─ 解析 staging/appworkshop_1110390.acf
  │     ├─ WorkshopAcfService.addItem(serverId, fileId, meta)
  │     ├─ 原子写 content/.../appworkshop_1110390.acf
  │     ├─ mv staging/content/1110390/<id>/ → content/1110390/<id>/
  │     ├─ 失败任一步 → 全部回滚（acf 备份 + Config 备份）
  │     └─ WS 推 mod_apply_progress { stage: 'moving' }
  │
  ├─ ⑧ ProcessSupervisor.spawn（启动新进程）
  ├─ ⑨ A2S 轮询直到就绪
  └─ ⑩ RCON "Say Mod 变更已应用"
        WS 推 mod_apply_progress { stage: 'completed' }
```

---

## 3. API 端点契约

### 3.1 端点清单（v2.3 — 拆两层：全局浏览 + 服务器操作）

> **v2.3 架构修正**：Steam 创意工坊浏览是**全局操作**（只需 WebAPI Key + AppID，不依赖服务器实例）。  
> 原设计把浏览端点错误挂到 `/api/servers/:id/mods/*`（导致无 serverId 时 404）。  
> 现拆两层——**浏览走 `/api/mods`（全局）**，**服务器操作走 `/api/servers/:id/mods`**。

**全局浏览层（`/api/mods`，纯 Steam API 代理）**：

| # | 方法 | 路径 | 用途 | 入参 Zod Schema | 响应 Schema |
|---|---|---|---|---|---|
| 1 | GET | `/api/mods/search` | 浏览/搜索 Steam 工坊 | `ModSearchQuerySchema` | `ModSearchResultSchema` |
| 2 | GET | `/api/mods/:fileId` | 单个 Mod 详情（实时） | path: `fileId` | `ModInfoSchema` |
| 3 | POST | `/api/mods/batch-details` | 批量补元数据（已下载列表用） | `ModBatchDetailsRequestSchema` | `z.array(ModInfoSchema)` |

**服务器操作层（`/api/servers/:id/mods`，依赖服务器实例）**：

| # | 方法 | 路径 | 用途 | 入参 Zod Schema | 响应 Schema |
|---|---|---|---|---|---|
| 4 | GET | `/api/servers/:id/mods/downloaded` | 已下载 Mod 列表（acf 扫描） | — | `z.array(DownloadedModSchema)` |
| 5 | POST | `/api/servers/:id/mods/download` | 下载到 staging（同步） | `ModDownloadRequestSchema` | `ModDownloadResultSchema` |
| 6 | POST | `/api/servers/:id/mods/apply` | 应用 Mod 变更 + 重启流水线 | `ModApplyRequestSchema` | `ModOperationResponseSchema` |
| 7 | DELETE | `/api/servers/:id/mods/:fileId` | 删除 Mod（acf + content + File_IDs） | path: `fileId` | `ModDeleteResponseSchema` |
| 8 | GET | `/api/servers/:id/mods/acf` | 读 acf 列表（acf 真源） | — | `z.array(WorkshopAcfItemSchema)` |
| 9 | WS | `mod_download_progress` / `mod_download_completed` / `mod_apply_progress` | 实时事件推送 | — | 见 §3.4 |

### 3.2 路径规范

- **全局浏览**：`/api/mods`（`routes/mod-browse.ts`，`createModBrowseRouter`）
- **服务器操作**：`/api/servers/:id/mods`（`routes/mods.ts`，`createModsRouter`）
- 两端都需 JWT（`authenticateToken`）

**废弃**：
- `GET /workshop/mods/:fileId`（v1 端点，在 `routes/workshop.ts`）—— 由 `GET /api/mods/:fileId` 替代
- `POST /:id/apply`（stub）—— 由 `POST /api/servers/:id/mods/apply` 替代

### 3.3 Zod Schema（`shared/schemas/mod.schema.ts`）

```typescript
import { z } from 'zod';

/** 排序：Steam 官方 EPublishedFileQueryType 6 种 + 搜索相关度 */
export const ModSortSchema = z.enum([
  'popular', 'rated', 'published', 'updated', 'subscribed', 'relevance',
]);

/** 时间范围：Steam QueryFiles days 参数（仅 popular 生效） */
export const ModTimeRangeSchema = z.enum([
  'day', 'week', 'month', 'months3', 'months6', 'year', 'all',
]);

/** 搜索类型 */
export const ModSearchTypeSchema = z.enum(['text', 'id']);

/** 单个 Mod 元数据（WebAPI GetDetails/QueryFiles 响应统一格式） */
export const ModInfoSchema = z.object({
  fileId: z.string().regex(/^\d{1,19}$/, 'Workshop File ID 必须为 1-19 位数字'),
  title: z.string().min(1).max(200),
  author: z.string().describe('SteamID64 数字串（列表/详情不展示，仅内部使用）'),
  description: z.string().default('').describe('已 strip BBCode 的纯文本'),
  previewUrl: z.string().url().optional(),
  fileSize: z.number().int().nonnegative().optional(),
  subscriptions: z.number().int().nonnegative().optional(),
  voteScore: z.number().min(0).max(5).optional(),
  votesUp: z.number().int().nonnegative().optional(),
  votesDown: z.number().int().nonnegative().optional(),
  tags: z.array(z.object({ tag: z.string(), displayName: z.string() })).default([]),
  timeCreated: z.number().int().optional(),
  timeUpdated: z.number().int().optional(),
});

/** acf 中已下载 Mod 的本地状态 */
export const DownloadedModSchema = z.object({
  fileId: z.string(),
  localSize: z.number().int().nonnegative().default(0),
  installedAt: z.string().datetime().optional(),
  timeupdated: z.number().int().optional(),
  manifest: z.string().optional(),
});

/** acf 真源条目（VDF 解析结果） */
export const WorkshopAcfItemSchema = z.object({
  fileId: z.string(),
  timeupdated: z.number().int(),
  size: z.number().int().nonnegative(),
  manifest: z.string().optional(),
});

/** 已启用 Mod 合并展示对象（File_IDs ∩ acf ∩ WebAPI 元数据） */
export const UnifiedModSchema = ModInfoSchema.extend({
  enabled: z.boolean().default(false),
  downloadState: z.enum(['not_downloaded', 'downloaded', 'downloading', 'error']).default('not_downloaded'),
  localSize: z.number().int().nonnegative().optional(),
  hasUpdate: z.boolean().default(false),
});

/** 搜索请求 */
export const ModSearchQuerySchema = z.object({
  q: z.string().default(''),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(12),
  sort: ModSortSchema.default('popular'),
  range: ModTimeRangeSchema.default('week'),
  type: ModSearchTypeSchema.default('text'),
});

export const ModSearchResultSchema = z.object({
  total: z.number().int().nonnegative(),
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1),
  rows: z.array(ModInfoSchema),
});

/** 下载请求 */
export const ModDownloadRequestSchema = z.object({
  fileId: z.string().regex(/^\d{1,19}$/),
});

/** 下载响应（同步等待 steamcmd 退出） */
export const ModDownloadResultSchema = z.object({
  success: z.boolean(),
  fileId: z.string(),
  modTitle: z.string().optional(),
  acfItem: WorkshopAcfItemSchema.optional(),
  error: z.string().optional(),
});

/** 批量元数据请求 */
export const ModBatchDetailsRequestSchema = z.object({
  fileIds: z.array(z.string().regex(/^\d{1,19}$/)).min(1).max(100),
});

/** Apply 请求 */
export const ModApplyRequestSchema = z.object({
  fileIds: z.array(z.string().regex(/^\d{1,19}$/)).min(0),
});

/** 操作响应（异步） */
export const ModOperationResponseSchema = z.object({
  operationId: z.string(),
  status: z.enum(['queued', 'running', 'completed', 'failed']),
});

/** 删除响应 */
export const ModDeleteResponseSchema = z.object({
  success: z.boolean(),
  fileId: z.string(),
  removedFrom: z.array(z.enum(['acf', 'content', 'file_ids'])),
});

/** WS 事件 schema */
export const ModDownloadProgressEventSchema = z.object({
  type: z.literal('mod_download_progress'),
  serverId: z.string(),
  fileId: z.string(),
  stage: z.enum(['spawned', 'downloading', 'verifying', 'completed', 'failed']),
  percent: z.number().min(0).max(100).optional(),
});

export const ModDownloadCompletedEventSchema = z.object({
  type: z.literal('mod_download_completed'),
  serverId: z.string(),
  fileId: z.string(),
  success: z.boolean(),
  acfItem: WorkshopAcfItemSchema.optional(),
  error: z.string().optional(),
});

export const ModApplyProgressEventSchema = z.object({
  type: z.literal('mod_apply_progress'),
  serverId: z.string(),
  stage: z.enum(['broadcasting', 'saving', 'stopping', 'moving', 'starting', 'ready', 'failed']),
  remainingSeconds: z.number().int().optional(),
  message: z.string().optional(),
});
```

### 3.4 契约（`shared/contracts/workshop.ts`）

```typescript
import type { WorkshopFileId, ServerId } from '../types/branded.js';
import type { WorkshopModMeta } from '../types/domain.js';

export type ModSort = 'popular' | 'rated' | 'published' | 'updated' | 'subscribed' | 'relevance';
export type ModTimeRange = 'day' | 'week' | 'month' | 'months3' | 'months6' | 'year' | 'all';
export type ModSearchType = 'text' | 'id';

export interface BrowseResult {
  mods: WorkshopModMeta[];
  total: number;
  page: number;
  pageSize: number;
}

export interface WorkshopAcfItem {
  fileId: string;
  timeupdated: number;
  size: number;
  manifest?: string;
}

export interface ModDownloadResult {
  success: boolean;
  fileId: WorkshopFileId;
  modTitle?: string;
  acfItem?: WorkshopAcfItem;
  error?: string;
}

export interface IWorkshopMetadataService {
  /** 单个 Mod 详情——实时调 Steam API，0 缓存 */
  getModDetails(modId: WorkshopFileId): Promise<WorkshopModMeta | null>;

  /** 浏览/搜索 Steam 工坊——单次 QueryFiles 调用，0 缓存 */
  browseMods(
    query: string,
    sort: ModSort,
    timeRange: ModTimeRange,
    searchType: ModSearchType,
    page: number,
    pageSize: number,
  ): Promise<BrowseResult>;

  /** 批量补元数据——已下载列表显示用 */
  batchGetDetails(fileIds: WorkshopFileId[]): Promise<WorkshopModMeta[]>;
}

export interface IWorkshopAcfService {
  /** 读盘 + 解析 acf 文件——每次都重新读，0 缓存 */
  parse(serverId: ServerId): Promise<WorkshopAcf>;

  /** 原子写 acf + 自动备份 */
  write(serverId: ServerId, acf: WorkshopAcf): Promise<void>;

  /** 列出全部已下载 mod */
  listItems(serverId: ServerId): Promise<WorkshopAcfItem[]>;

  /** 添加 mod（apply 流水线内调用） */
  addItem(serverId: ServerId, fileId: WorkshopFileId, meta: WorkshopAcfItem): Promise<void>;

  /** 删除 mod（delete 端点调用） */
  removeItem(serverId: ServerId, fileId: WorkshopFileId): Promise<void>;

  /** 手动备份 acf（apply 流水线前置） */
  backup(serverId: ServerId): Promise<string>;

  /** 失败回滚 */
  rollback(serverId: ServerId, backupPath: string): Promise<void>;
}

export interface IWorkshopApplyService {
  /** 移动 staging → content 流水线（apply 流水线内调用） */
  applyStaged(serverId: ServerId): Promise<void>;
}

export interface IWorkshopDeleteService {
  /** 删除 Mod（acf + content + File_IDs 三处同步） */
  deleteMod(serverId: ServerId, fileId: WorkshopFileId): Promise<void>;
}

export interface WorkshopAcf {
  appid: string;
  items: Map<WorkshopFileId, WorkshopAcfItem>;
}
```

### 3.5 端点 → 服务映射

```
# 全局浏览（/api/mods）
GET    /api/mods/search                        → IWorkshopMetadataService.browseMods
GET    /api/mods/:fileId                       → IWorkshopMetadataService.getModDetails
POST   /api/mods/batch-details                 → IWorkshopMetadataService.batchGetDetails

# 服务器操作（/api/servers/:id/mods）
GET    /api/servers/:id/mods/downloaded        → IWorkshopAcfService.listItems + batchGetDetails 合并
POST   /api/servers/:id/mods/download          → SteamCmdManager.downloadWorkshopItem
                                                    + getModDetails（拿 modTitle）
POST   /api/servers/:id/mods/apply             → ServerManager.applyModChanges
                                                    + IWorkshopApplyService.applyStaged
DELETE /api/servers/:id/mods/:fileId           → IWorkshopDeleteService.deleteMod
GET    /api/servers/:id/mods/acf               → IWorkshopAcfService.listItems
```

---

## 4. 关键模块设计

### 4.1 `WorkshopAcfService` — VDF 解析 + acf 维护（核心新增）

**模块结构**：
```
manager-server/src/modules/workshop/
├── WorkshopAcfService.ts          (核心实现)
├── WorkshopAcfService.test.ts     (单元测试)
├── VdfParser.ts                   (VDF 解析器, 200 行自写)
└── VdfParser.test.ts              (VDF 解析器测试)
```

**VDF 解析器设计**：

输入示例（`appworkshop_1110390.acf` 真实结构）：
```vdf
"AppWorkshop"
{
    "appid"        "1110390"
    "WorkshopItemsInstalled"
    {
        "1753134636"
        {
            "timeupdated"        "1722612345"
            "size"                "12345678"
            "manifest"            "4567890123456789"
        }
    }
}
```

**解析器契约**：
```typescript
class VdfParser {
  /** 解析 VDF 文本为嵌套对象 */
  static parse(text: string): VdfNode;
  /** 序列化嵌套对象为 VDF 文本（保留原格式） */
  static serialize(node: VdfNode): string;
}

type VdfNode = VdfValue | VdfObject;
type VdfValue = string;
interface VdfObject {
  [key: string]: VdfNode;
}
```

**关键实现细节**：
- 引号字符串解析：支持 `\"` 转义
- 嵌套深度跟踪：用栈结构而非递归
- 注释行忽略：`//` 和 `/* */`
- 字段顺序保留：使用 `Map` 而非普通对象（VDF 字段顺序敏感）
- 大小写不敏感 key：U3DS 用 `"WorkshopItemsInstalled"`，SteamCMD 用 `"workshopitemsinstalled"` 都能识别——但**以 SteamCMD 输出为准**

**单元测试覆盖**：
1. 简单键值：`"key" "value"` → `{key: 'value'}`
2. 嵌套对象：3 层嵌套解析 + 序列化
3. 转义引号：`"key" "val\"ue"` → `{key: 'val"ue'}`
4. 注释：行内 `//` 和块 `/* */`
5. 空对象：`"key" {}`
6. 真实 acf 文件 fixture
7. 字段顺序保持
8. 错误处理：未闭合引号 / 未闭合大括号

### 4.2 `WorkshopApplyService` — staging → content 流水线（核心新增）

**调用上下文**：在 `ServerManager.applyModChanges` 流水线内、U3DS 已 STOPPED 时调用。

**9 步流程**（其中 1-3 已在 SteamCmdManager，4-9 在新模块）：

```typescript
class WorkshopApplyService implements IWorkshopApplyService {
  async applyStaged(serverId: ServerId): Promise<void> {
    const stagingDir = path.join(this.installRoot, 'Servers', serverId, 'Workshop', 'staging');
    const contentDir = path.join(this.installRoot, 'Servers', serverId, 'Workshop', 'steamapps', 'workshop', 'content', U3DS_APPID);
    const acfPath = path.join(this.installRoot, 'Servers', serverId, 'Workshop', 'steamapps', 'workshop', `appworkshop_${U3DS_APPID}.acf`);

    // ① 备份 acf
    const acfBackupPath = await this.acfService.backup(serverId);

    // ② 备份 WorkshopDownloadConfig.json（ConfigService.backup 已有）
    const configBackupPath = await this.configService.backup(serverId, 'WorkshopDownloadConfig.json');

    try {
      // ③ 解析 staging acf
      const stagingAcf = await this.parseStagingAcf(stagingDir);

      // ④-⑤ 合并到 content acf（原子写）
      const currentAcf = await this.acfService.parse(serverId);
      for (const [fileId, item] of stagingAcf.items) {
        currentAcf.items.set(fileId, item);
      }
      await this.acfService.write(serverId, currentAcf);

      // ⑥ mv staging/content/<id>/ → content/<id>/
      for (const fileId of stagingAcf.items.keys()) {
        const src = path.join(stagingDir, 'steamapps', 'workshop', 'content', U3DS_APPID, fileId);
        const dst = path.join(contentDir, fileId);
        await fs.promises.rename(src, dst);  // rename 原子, 跨设备用 cp + rm
      }

      // ⑦ 更新 File_IDs
      const newFileIds = Array.from(currentAcf.items.keys());
      await this.configService.writeWorkshopFileIds(serverId, newFileIds);

      // ⑧ WS 推 mod_apply_progress { stage: 'moving' → 'completed' }
      this.broadcaster.broadcast({
        type: 'mod_apply_progress',
        serverId,
        stage: 'completed',
      });

    } catch (err) {
      // ⑨ 失败 → 全部回滚
      await this.acfService.rollback(serverId, acfBackupPath);
      await this.configService.rollbackWorkshopConfig(serverId, configBackupPath);
      this.broadcaster.broadcast({
        type: 'mod_apply_progress',
        serverId,
        stage: 'failed',
        message: err instanceof Error ? err.message : 'unknown',
      });
      throw err;
    }
  }
}
```

**跨设备处理**：`fs.rename` 跨文件系统会失败——降级为 `cp -r + rm`：
```typescript
async moveDir(src: string, dst: string): Promise<void> {
  try {
    await fs.promises.rename(src, dst);
  } catch (err) {
    if (err instanceof Error && 'code' in err && err.code === 'EXDEV') {
      // 跨设备：用 cp -r 然后 rm
      await execFile('cp', ['-r', src, dst]);
      await fs.promises.rm(src, { recursive: true });
    } else {
      throw err;
    }
  }
}
```

### 4.3 `WorkshopMetadataService` — 重写（去缓存）

**删除**：
- `CACHE_FRESH_MS` / `CACHE_STALE_MS` 常量
- `dbGet` / `dbUpsert` / `refreshInBackground` / `toModMeta` 私有方法
- `searchMods` 公开方法（DST 也没本地搜索，实时走 WebAPI）
- `refreshCache` 公开方法

**保留 + 改写**：
- `browseMods` — 45s timeout + **单次 QueryFiles**（全字段，不二次 GetDetails）
- `getModDetails` — 45s timeout + 实时调 GetDetails，**0 缓存**
- `getSteamWebApiKey` 内部辅助保留

**浏览链路（v2.4 — 单次 QueryFiles）**：
- `browseMods` 只调一次 `QueryFiles`（返回 title/creator/description/preview/vote_data 全字段），**不二次调 GetDetails**——避免两阶段叠加超时
- **不查作者名**（GetPlayerSummaries）——作者字段显示 SteamID，列表/详情不展示
- 评分：`vote_data.score`（0-1）×5 → `voteScore`（0-5），前端精确星填充

**WebAPI 调用规范**：
- 所有 fetch 加 `signal: AbortSignal.timeout(45_000)`（国内网络访问 Steam 冷启动实测需 20-40s）
- `QueryFiles` 请求加 `return_vote_data=true`（拿评分）
- 错误统一抛 `AppError('workshop-upstream-error' | 'workshop-key-missing' | 'workshop-timeout', ...)`
- Key 缺失时明确抛 `workshop-key-missing` 503，前端提示去 Settings 配

**`batchGetDetails`**：仅已下载列表用，批量 GetDetails 补元数据（不查作者名）。

### 4.4 `WorkshopDeleteService` — 删除 Mod（核心新增）

**4 步流程**：
```typescript
async deleteMod(serverId: ServerId, fileId: WorkshopFileId): Promise<void> {
  // ① 备份 acf
  const acfBackup = await this.acfService.backup(serverId);

  try {
    // ② acf 删项
    await this.acfService.removeItem(serverId, fileId);

    // ③ 删 content/<id>/ 目录
    const contentDir = path.join(
      this.installRoot, 'Servers', serverId,
      'Workshop', 'steamapps', 'workshop', 'content',
      U3DS_APPID, fileId,
    );
    if (fs.existsSync(contentDir)) {
      await fs.promises.rm(contentDir, { recursive: true, force: true });
    }

    // ④ 更新 File_IDs
    const currentAcf = await this.acfService.parse(serverId);
    const newFileIds = Array.from(currentAcf.items.keys());
    await this.configService.writeWorkshopFileIds(serverId, newFileIds);

  } catch (err) {
    await this.acfService.rollback(serverId, acfBackup);
    throw err;
  }
}
```

**约束**：
- **必须 U3DS STOPPED**（删除 staging/content 目录与 U3DS 读文件冲突）—— 在 routes 层校验 activeOperation
- **必须二次确认**（`ConfirmDialog` 复用）—— 危险操作

### 4.5 `SteamCmdManager.downloadWorkshopItem` — 改造

**已存在**（`SteamCmdManager.ts:155-213`）—— **只改一处**：

下载完成后回传 `modTitle` 给路由层（用于 toast 显示）：

```typescript
// 当前实现：下载完成只 broadcast 'completed'
// 改造后：下载完成时再调一次 getModDetails 拿 title（实时，不缓存）
// 失败时回传 error 字符串
```

或者更简单：**下载完成只回传 `acfItem`（已包含 size/timeupdated/manifest）**—— `modTitle` 留给前端从缓存的 browse 列表中取（用户在 browse tab 点下载，title 已在 list state 里）。

**实际方案**：路由层在调 `downloadWorkshopItem` 之前已经从 `browseMods` 拿到完整 `ModInfo`—— 直接把 `modTitle` 传给前端即可：

```typescript
// routes/mods.ts
router.post('/:id/mods/download', async (req, res) => {
  const { fileId } = req.body;
  // 1. 先查元数据（实时，0 缓存）
  const meta = await workshopMeta.getModDetails(fileId);
  if (!meta) throw new AppError('mod-not-found', 'Mod 元数据未找到', 404);

  // 2. 调下载（已存在）
  await steamCmd.downloadWorkshopItem(installDir, [fileId]);

  // 3. 解析 staging acf 拿最新 size
  const acfItem = await workshopAcf.parseStagingItem(serverId, fileId);

  res.json({
    data: {
      success: true,
      fileId,
      modTitle: meta.title,
      acfItem,
    },
  });
});
```

---

## 5. 前端组件设计

### 5.1 改造现有 `ModCard`（不新建组件，遵守三行原则）

> **v2.1 修正**：ModCard 只服务 ModsPage（单 Tab 浏览），**只有 `browse` 一种 variant**。已下载 Mod 的启用/禁用/删除在 Config > Workshop Tab 走 DataTable 行内操作（已有），不抽 ModCard 多 variant——三行原则。

**Props 改造**（单 variant，v2.4 不展示作者/ID）：
```typescript
interface ModCardProps {
  fileId: string;
  title: string;
  description: string;
  previewUrl?: string;
  fileSize?: number;
  subscriptions?: number;
  timeUpdated?: number;
  tags?: Array<{ tag: string; displayName: string }>;
  loading?: boolean;
  onDownload?: (fileId: string) => void;
  onDetails?: (fileId: string) => void;
}
```

**按钮走 shadcn variant**（**删除所有内联 style**）：
```typescript
// ❌ 错误（v1）
<Button style={{ backgroundColor: '#22C55E', color: 'white' }}>下载</Button>
<Button className="border-slate-500 text-slate-400">详情</Button>

// ✅ 正确（v2.4）
<Button variant="default" size="sm"><Plus size={12}/> 下载</Button>
<Button variant="outline" size="sm"><Eye size={12}/> 详情</Button>
```

**v2.4：列表不展示作者/ID，只显示订阅数**：

```typescript
// ModCard.tsx 渲染（只显示订阅数，不展示作者/ID）
{subscriptions != null && subscriptions > 0 && (
  <div className="flex items-center gap-1 mt-1.5 text-xs text-slate-500">
    <Users size={11} />
    {subscriptions.toLocaleString()} 订阅
  </div>
)}
```

**评分精确星填充**（问题 5：2.7 分 = 2 满星 + 0.7 部分填充）：

```typescript
// ModCard.tsx 评分星——精确填充，不整渲染
{voteScore != null && (
  <div className="flex items-center gap-0.5 shrink-0">
    {Array.from({ length: 5 }).map((_, i) => {
      const fill = Math.min(Math.max(voteScore - i, 0), 1);
      return (
        <div key={i} className="relative" style={{ width: 12, height: 12 }}>
          <Star size={12} className="text-slate-700 absolute inset-0" />
          <div className="absolute inset-0 overflow-hidden" style={{ width: `${fill * 100}%` }}>
            <Star size={12} className="text-amber-500" />
          </div>
        </div>
      );
    })}
  </div>
)}
```

**BBCode strip 工具函数**：
```typescript
// lib/utils.ts 新增
export function stripBbcode(text: string): string {
  if (!text) return '';
  return text
    // 1. 移除 [tag=value]...[/tag] 完整对（含值）
    .replace(/\[(\w+)(?:=[^\]]*)?\]([\s\S]*?)\[\/\1\]/g, '$2')
    // 2. 移除孤立开标签
    .replace(/\[\/?\w+(?:=[^\]]*)?\]/g, '')
    // 3. 解码 HTML 实体
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    // 4. 折叠空白
    .replace(/\s+/g, ' ')
    .trim();
}
```

**单元测试覆盖**：
- `[h1]xxx[/h1]` → `xxx`
- `[EN]` 孤立标签 → `''`
- `[b]bold[/b] [i]italic[/i]` → `bold italic`
- `[url=http://...]text[/url]` → `text`
- 嵌套 `[b]bold [i]italic[/i][/b]` → `bold italic`
- HTML 实体 `&amp;` → `&`
- 真实 Steam 描述 fixture（含 `[h1]` `[EN]` `[img]` 等）

### 5.2 新建 `ModDetailDialog`

**Props**：
```typescript
interface ModDetailDialogProps {
  open: boolean;
  onClose: () => void;
  mod: ModInfo | null;  // null 时显示 loading
  loading?: boolean;
  onDownload?: (fileId: string) => void;
}
```

**结构**：
```
┌────────────────────────────────────────┐
│ ┌────────────────────────────────────┐ │
│ │      previewUrl (16:9 大图)          │ │
│ └────────────────────────────────────┘ │
│ title (大号)                            │
│ ──────────────────────────────────────  │
│ 文件大小: 12.3 MB                       │
│ 订阅数: 12,345                          │
│ 评分: ★★★☆☆ 3.2 (精确填充星)          │
│ 更新时间: 2026-08-05                    │
│ ──────────────────────────────────────  │
│ Tags:                                  │
│   [server] [map] [weapons]            │
│ ──────────────────────────────────────  │
│ 完整介绍:                              │
│ Lorem ipsum dolor sit amet...          │
│ ──────────────────────────────────────  │
│         [下载]  [在 Steam 中打开]  [关闭]  │
└────────────────────────────────────────┘
```

**使用 `components/shared/Dialog.tsx`**——项目已有 22 行的 `Dialog` 组件，**不新建 shadcn 包装**。

### 5.3 新建 `ModCardSkeleton`

**复用模式**：6 个并排显示，与 ModCard 等高。

```typescript
export function ModCardSkeleton() {
  return (
    <div className="rounded-lg overflow-hidden border border-slate-700 bg-slate-800">
      <div className="h-[140px] bg-slate-700 animate-pulse" />
      <div className="p-4 pt-3 space-y-2">
        <div className="h-4 w-3/4 bg-slate-700 rounded animate-pulse" />
        <div className="h-3 w-1/2 bg-slate-700 rounded animate-pulse" />
        <div className="h-3 w-full bg-slate-700 rounded animate-pulse" />
        <div className="flex gap-2 mt-3">
          <div className="h-7 w-16 bg-slate-700 rounded animate-pulse" />
          <div className="h-7 w-16 bg-slate-700 rounded animate-pulse" />
        </div>
      </div>
    </div>
  );
}
```

### 5.4 新建 shadcn `sonner` wrapper

**当前状态**：`package.json:43` 已装 `sonner: ^2.0.7`，但 `components/ui/` 下没有包装文件。

**新建 `components/ui/sonner.tsx`**：
```typescript
import { Toaster as Sonner } from 'sonner';

export function Toaster() {
  return (
    <Sonner
      theme="dark"
      position="bottom-right"
      toastOptions={{
        style: {
          background: '#1E293B',
          border: '1px solid #334059',
          color: '#F1F5FB',
        },
      }}
    />
  );
}
```

**挂载到 `App.tsx`**：在根布局挂一次，全局可用。

### 5.5 重写 `ModsPage` — 单 Tab（Steam 创意工坊浏览）

> **v2.1 修正**：ModsPage 只承担"Steam 创意工坊浏览 + 下载入口"两个职责，已下载 Mod 的管理走 Config > Workshop Tab。**没有 TabBar**，**没有"已下载/已启用"两个 tab**。

**状态架构**：
```typescript
// 搜索 & 筛选
const [searchInput, setSearchInput] = useState('');
const [searchQuery, setSearchQuery] = useState('');
const [sort, setSort] = useState<ModSort>('popular');
const [timeRange, setTimeRange] = useState<ModTimeRange>('week');
const [page, setPage] = useState(1);
const [pageSize, setPageSize] = useState(12);

// 下载操作
const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({});

// 详情弹窗
const [detailFileId, setDetailFileId] = useState<string | null>(null);
```

**数据流用 React Query**（**前端防抖，不在后端缓存**）：
```typescript
// browse: 60s staleTime（同 query 60s 内不重新打，纯前端防抖）
const { data: browseData, isLoading: browseLoading, error: browseError, refetch } = useQuery({
  queryKey: ['mods', 'browse', searchQuery, sort, timeRange, page, pageSize],
  queryFn: () => apiClient.get('/mods/search', { params: { q: searchQuery, sort, range: timeRange, page, pageSize } }),
  staleTime: 60_000,  // 纯前端防抖
  retry: 1,
});

// detail: 0 staleTime（每次进弹窗都拉新，0 缓存语义）
const { data: detailData, isLoading: detailLoading } = useQuery({
  queryKey: ['mods', 'detail', detailFileId],
  queryFn: () => apiClient.get(`/mods/${detailFileId}`),
  enabled: !!detailFileId,
  staleTime: 0,
  retry: 0,
});
```

**为什么 browse 60s、detail 0s**：
- `browse`：用户切排序/翻页频繁，60s 防抖避免重复打 Steam（**只是前端层防抖**）
- `detail`：用户进详情弹窗后，要么改弹窗要么关弹窗，0s 实时拉保证看到最新
- 后端 0 缓存（v2.0 决策），前端 staleTime 是**唯一**防抖层

**Loading 范围**（**核心问题 8 的修复**）：
```tsx
return (
  <div className="flex flex-col h-full">
    {/* 顶部：永远渲染（不等任何数据） */}
    <TopBar title="模组管理" />
    <FilterBar
      searchInput={searchInput} onSearchInputChange={setSearchInput}
      onSearch={handleSearch}
      sort={sort} onSortChange={handleSortChange}
      timeRange={timeRange} onTimeRangeChange={handleTimeRangeChange}
      pageSize={pageSize} onPageSizeChange={handlePageSizeChange}
    />

    {/* 卡片网格：loading 时只显示 6 个 skeleton，页面壳不消失 */}
    <div className="flex-1 overflow-auto">
      {browseLoading && !browseData ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 p-4">
          {Array.from({ length: 6 }).map((_, i) => <ModCardSkeleton key={i} />)}
        </div>
      ) : browseError && !browseData ? (
        <EmptyState error={browseError.message} onRetry={refetch} />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 p-4">
          {(browseData?.rows ?? []).map((m) => (
            <ModCard
              key={m.fileId} {...m}
              loading={actionLoading[m.fileId]}
              onDownload={handleDownload}
              onDetails={(id) => setDetailFileId(id)}
            />
          ))}
        </div>
      )}
    </div>

    {/* 分页 */}
    <PaginationBar page={page} pageSize={pageSize} total={browseData?.total ?? 0} onPageChange={setPage} />

    {/* 详情弹窗 */}
    <ModDetailDialog
      open={!!detailFileId}
      mod={detailData}
      loading={detailLoading}
      onClose={() => setDetailFileId(null)}
      onDownload={handleDownload}
    />
  </div>
);
```

**下载按钮逻辑**（Toast 即全部反馈，不调 router.push、不引导跳转）：
```typescript
// serverId 从 useServer 拿第一个真实服务器（浏览用全局 /api/mods，下载才需要 serverId）
const handleDownload = async (fileId: string) => {
  setActionLoading((prev) => ({ ...prev, [fileId]: true }));
  try {
    const res = await apiClient.post(`/servers/${serverId}/mods/download`, { fileId });
    const { modTitle, success } = res.data.data;
    if (success) {
      toast.success(`${modTitle ?? 'Mod'} 下载成功`);  // 全部反馈，结束
    } else {
      toast.error('下载失败');
    }
  } catch (err) {
    toast.error(err instanceof Error ? err.message : '下载失败');
  } finally {
    setActionLoading((prev) => { const next = { ...prev }; delete next[fileId]; return next; });
  }
};
```

---

## 6. 数据库迁移

### 6.1 删表迁移 `004-drop-mod-cache-tables.sql`

```sql
-- 004: 删除不再使用的缓存表（DST 哲学：真源唯一）
-- 原因：
--   - workshop_mods 是 WebAPI 元数据的派生缓存，与真源 Steam API 一致性无法保证
--   - workshop_creators 同样问题
--   - acf 文件是真源，acf 解析即时进行
--   - WebAPI Key 配置已迁移到 settings 表

DROP TABLE IF EXISTS workshop_mods;
DROP TABLE IF EXISTS workshop_creators;

-- 保留的表（4 个）：
--   - servers        服务端实例
--   - users          用户
--   - refresh_tokens JWT 刷新
--   - config_snapshots 配置文件快照
--   - audit_logs     审计
--   - settings       WebAPI Key 等
```

**无新增表**——acf 走文件读，元数据走 Steam API 实时。

### 6.2 迁移策略

- `migrations/004-drop-mod-cache-tables.sql`——新文件
- 迁移由 `db/migrate.ts` 自动执行（已有机制）
- 幂等：`DROP TABLE IF EXISTS`
- **数据丢失风险**：无——`workshop_mods` 是缓存，重启后 `browseMods` 重新拉取；`workshop_creators` 同理
- **回滚**：如需回滚，从 001 迁移的对应 DDL 重建表结构（数据不可恢复）

---

## 7. 实施阶段（按生产质量全量交付）

### Phase A：基础设施（共享类型 + DB 迁移）

| # | 任务 | 产出 |
|---|---|---|
| A1 | `shared/schemas/mod.schema.ts` Zod schema | 9 个端点的入参/响应 schema |
| A2 | `shared/contracts/workshop.ts` 扩展 | `IWorkshopAcfService` / `IWorkshopApplyService` / `IWorkshopDeleteService` 三个新接口 |
| A3 | `migrations/004-drop-mod-cache-tables.sql` | 删 2 表 |
| A4 | `WorkshopMetadataService` 砍缓存 + 单次 QueryFiles + 45s timeout | 9 个老测试更新 |
| A5 | `VdfParser.ts` 200 行自写 | 解析/序列化 + 8 个单测 |

### Phase B：核心模块

| # | 任务 | 产出 |
|---|---|---|
| B1 | `WorkshopAcfService.ts` | parse/write/listItems/addItem/removeItem/backup/rollback + 单测 |
| B2 | `WorkshopApplyService.ts` | 9 步流水线（含跨设备 rename 处理） + 单测 |
| B3 | `WorkshopDeleteService.ts` | 4 步删除（含 U3DS STOPPED 校验） + 单测 |

### Phase C：API 层

| # | 任务 | 产出 |
|---|---|---|
| C1 | `routes/mods.ts` 重写 | 8 个 REST 端点 + Zod 校验 + AppError 统一错误 |
| C2 | `composition-root.ts` 注入新模块 | 3 个新服务接进 DI 容器 |
| C3 | WS 事件 schema 注册 | 3 个 mod_* 事件进 IBroadcaster 联合类型 |

### Phase D：前端基础设施

| # | 任务 | 产出 |
|---|---|---|
| D1 | `components/ui/sonner.tsx` + 挂 `<Toaster />` | 全局 toast 可用 |
| D2 | `lib/utils.ts` 加 `stripBbcode` | 工具函数 + 8+ 个单测 |
| D3 | 安装/配置 `@tanstack/react-query`（如未装）| QueryClient Provider |

### Phase E：前端 UI

| # | 任务 | 产出 |
|---|---|---|
| E1 | `ModCard` 改造（shadcn variant + 订阅数展示 + 精确评分星）| 单一 browse variant：下载/详情两个按钮 |
| E2 | `ModDetailDialog.tsx` 新建 | 详情弹窗 |
| E3 | `ModCardSkeleton.tsx` 新建 | 骨架屏 |
| E4 | `ModsPage.tsx` 重写 | 单 Tab（Steam 浏览）+ React Query + Loading 拆态 + Toast 反馈（**不调 router.push**）|
| E5 | `ConfigPage.tsx` WorkshopTab 接线 | DELETE 端点 + apply 流水线触发（**已有组件结构不动**，只接新端点）|

### Phase F：联调与验证

| # | 任务 |
|---|---|
| F1 | typecheck 零错误（前端 + 后端 + shared） |
| F2 | 单元测试全绿：VDF 解析器 / acf 服务 / apply 流水线 / BBCode strip |
| F3 | 集成测试：browse → download → apply → delete 完整链路 |
| F4 | 手动冒烟：装/启动前后端、点 8 个原问题点逐个验证 |
| F5 | 文档更新：`claudedocs/reference_console_commands.md` 加 Mod 命令；`docs/architecture/mod-management-design.md` 本文档 |
| F6 | 提交：3 个提交（Phase A-C 后端 / D-E 前端 / F 验证+文档） |

---

## 8. 验收标准（生产质量门槛）

### 8.1 功能验收（8 个用户问题逐个验证）

| # | 问题 | 验证步骤 | 预期结果 |
|---|---|---|---|
| 1 | 作者字段不展示 | 打开 Mods 页 → 任意 mod 卡片 | 卡片不显示作者 SteamID64，也不显示昵称 |
| 2 | 元数据展示 | 同上 | 仅显示订阅数一项 + 精确评分星，不展示作者/ID |
| 3 | 介绍无 BBCode 残留 | 同上 | 卡片介绍是纯文本，无 `[h1]` `[EN]` |
| 4 | 详情按钮样式 | 同上 | 按钮走 shadcn outline variant（有边框），hover 有反馈 |
| 5 | 下载按钮 + Toast | 点 [下载] 按钮 | 弹 `Hawaii 下载成功` 1.5s 后消失；staging 目录有新文件 |
| 6 | 详情弹窗 | 点 [详情] 按钮 | 弹窗显示完整 mod 信息（缩略图/大小/评分/完整介绍，不展示作者/ID） |
| 7 | 首次加载响应 | 冷启动 + 立即进 Mods 页 | 单次 QueryFiles 快速返回；页面壳立即可见，卡片区不长时间死等 |
| 8 | Loading 范围 | 冷启动进 Mods 页 | 标题/筛选栏立即可见；卡片区显示 6 个 skeleton |

### 8.2 质量门槛（CLAUDE.md §6 + development.md）

- [ ] `tsc --noEmit` 零错误（前后端 + shared）
- [ ] ESLint 零警告
- [ ] 单测覆盖：改到的所有文件行覆盖率 ≥ 80%
- [ ] 集成测试：browse → download → apply → delete 全链路
- [ ] 没引入 `any`
- [ ] 没提交密钥
- [ ] `.research/` 未动
- [ ] 所有 ADR / 设计文档同步更新

### 8.3 性能指标

| 指标 | 目标 | 验证方法 |
|---|---|---|
| browse 首次响应（冷启动） | < 45s（单次 QueryFiles，国内网络 20-40s） | curl 计时 |
| browse 二次响应（warm） | < 2s（单次 QueryFiles） | curl 计时 |
| browse 三次响应（60s 内同 query） | < 200ms（React Query 缓存命中） | `console.time()` |
| getModDetails 响应 | < 1.5s | curl 计时 |
| download 响应 | < 60s（取决于 SteamCMD 下载速度） | curl 计时 |
| delete 响应 | < 500ms | curl 计时 |

---

## 9. 风险与待验证项

| 风险 | 缓解 | 验证方法 |
|---|---|---|
| QueryFiles 冷启动慢（国内网络访问 Steam 20-40s） | 45s 超时 + 前端 React Query 60s staleTime | 实机多次浏览测耗时 |
| 跨设备 `fs.rename` 失败 | 检测 `EXDEV` → 降级 `cp -r + rm` | 在 Docker 容器 + 主机挂载卷场景测试 |
| SteamCMD 进程崩溃留下脏 staging | 启动时清理 staging 目录 | 实机测试 |
| acf 备份失败 → 写入失败回滚无备份 | 写入前 acf 必须存在且备份成功 | 单元测试覆盖 |
| U3DS 在 apply 流水线中途意外启动 | 流水线在 ServerManager 层校验 activeOperation | 单元测试 |

---

## 10. 待评审项

1. **`workshop_mods` / `workshop_creators` 删表** —— ✅ **已同意**
2. **`@tanstack/react-query` 引入**（用于前端防抖）—— ✅ **已同意**
3. **VDF 解析器自写**（200 行，零依赖）—— ✅ **已同意**
4. **acf 维护纳入生产**（不只是 P2）—— ✅ **已同意**
5. ~~**ModsPage 改三 Tab**~~ → **v2.1 修正**：ModsPage = 单 Tab（Steam 工坊浏览）+ 下载入口；已下载 Mod 的启用/禁用/删除/配置在 Config > Workshop Tab（已有 `WorkshopTab` 组件）

---

*版本：v2.4（生产质量 · 已实现） · 创建 2026-08-09*
