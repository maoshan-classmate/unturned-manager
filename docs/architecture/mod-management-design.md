# Unturned Mod 管理系统 — 完整设计规格

> **日期**：2026-08-08
> **来源**：DST 管理平台（`.research/dst-management-platform-api`）全链路分析 + 本项目现有代码审计
> **设计原则**：借鉴 DST 的三源合一状态模型和 Steam WebAPI 集成模式；前端组件适配 React/shadcn/ui/Tailwind CSS 4 技术栈
> **状态**：设计草案，待评审后进入实现

---

## 1. 差距分析：DST ↔ Unturned

### 1.1 技术栈差异

| 维度 | DST | 本项目 | 适配策略 |
|---|---|---|---|
| **框架** | Vue 3 + Vuetify 3 | React 18 + shadcn/ui + Tailwind CSS 4 | 组件用 React 重写，样式用 Tailwind |
| **表格** | VDataTable | @tanstack/react-table → DataTable（已有） | 复用 DataTable，补行操作菜单 |
| **分页** | VPagination（独立组件） | DataTable 内置分页 / 需独立 Pagination 组件 | **新增** Pagination 组件（卡片网格用） |
| **弹窗** | VDialog | Dialog（已有） | 复用 |
| **标签页** | VTabs | TabBar（已有） | 复用 |
| **加载态** | VSkeletonLoader | 需新增 Skeleton 组件 | **新增** ModCardSkeleton |
| **评分** | PreciseRating（自研） | 需新增 | **新增** StarRating |
| **富文本** | BBCode→HTML 解析器 | 需新增 | **新增** BBCodeRenderer（轻量） |
| **图片** | VImg（内置懒加载） | 标准 `<img>` + loading=lazy | 直接用 |
| **Chip** | VChip | 内联 `<span>` + Tailwind | 直接用 Tailwind class |
| **下拉选择** | VSelect | shadcn Select（需从 shadcn 官网复制） | **新增** ui/Select |
| **进度条** | 内联 progress bar | 需新增 | **新增** ProgressBar |
| **骨架屏** | VSkeletonLoader | 需新增 | **新增** Skeleton |

### 1.2 功能差异

| 功能 | DST | 本项目现状 | 动作 |
|---|---|---|---|
| Steam 搜索 | WebAPI QueryFiles/v1（分页+标签过滤） | ❌ 无（只支持按 ID 查询，且走已死的 `?xml=1`） | **新增** |
| Mod 详情 | WebAPI GetDetails/v1（批量补齐） | ❌ 无（`WorkshopMetadataService` 用 XML 全死） | **重写** |
| Mod 下载 | SteamCMD staging → 原子移动 → ACF 合并 | ❌ `SteamCmdManager` 是 skeleton | **重写** |
| 已下载列表 | 目录扫描 + ACF 解析 + WebAPI 元数据合并 | ❌ 无 | **新增** |
| 已启用列表 | modoverrides.lua 解析 | ✅ 读 WorkshopDownloadConfig.json File_IDs | **已有，需接线** |
| 启用/禁用 | 写 modoverrides.lua | ✅ 写 WorkshopDownloadConfig.json File_IDs | **已有，需接线** |
| Mod 配置 | modinfo.lua → 动态表单 → modoverrides.lua | ❌ 不做（Unturned 无此机制） | **不做** |
| 删除 Mod | ACF 删项 + 删目录 | ❌ 无 | **新增** |
| 下载进度 | 无实时推送 | — | **新增** WS `steamcmd_progress` |
| 权限门控 | hasPermission(roomID) | JWT role 中间件 | **已有** |

### 1.3 已可复用清单（本项目现有，不用写新代码）

| 现有组件/模块 | 位置 | 用于 Mod 系统的哪个场景 |
|---|---|---|
| `PageState` | `components/shared/PageState.tsx` | ModsPage 顶层三态包裹 |
| `TabBar` | `components/shared/TabBar.tsx` | 搜索/已下载/已启用 三 Tab |
| `SearchInput` | `components/shared/SearchInput.tsx` | Mod 搜索框 |
| `DataTable` | `components/shared/DataTable.tsx` | 已下载 Mod 表格视图 |
| `ConfirmDialog` | `components/shared/ConfirmDialog.tsx` | 删除确认、应用变更确认、重启确认 |
| `Dialog` | `components/shared/Dialog.tsx` | Mod 详情弹窗 |
| `Button` / `Input` | `components/ui/` | 各种按钮和输入框 |
| `Card` | `components/shared/Card.tsx` | 可选：ModCard 的外层容器 |
| `formatSize` | `lib/utils.ts` | 文件大小格式化 |
| `useServer` | `hooks/useServer.ts` | 获取 server 引用 |
| `apiClient` | `api/client.ts` | 所有 HTTP 请求 |
| `WebSocketContext` | `contexts/WebSocketContext.tsx` | 下载进度实时推送 |

---

## 2. 页面布局设计

### 2.1 三 Tab 结构

```
ModsPage
├── TopBar（标题 "模组管理" + [添加 Mod] 按钮）
├── TabBar（搜索工坊 | 已下载 | 已启用）
│
├── Tab 1: 搜索工坊（Steam Workshop 浏览器）
│   ├── SearchBar（文本搜索 + ID搜索切换 + 排序）
│   ├── ModCardGrid（响应式 grid-cols-1 sm:2 lg:3 xl:4）
│   │   └── ModCard × N（预览图 + 标题 + 作者 + 评分 + 下载按钮）
│   ├── Pagination（独立分页器）
│   └── ModDetailDialog（点击卡片展开详情弹窗）
│
├── Tab 2: 已下载（本地 Mod 管理）
│   ├── Toolbar（批量操作：预下载全部 / 批量启用 / 刷新）
│   ├── DataTable（预览 | 名称 | 大小 | ID | 状态 | 操作）
│   │   └── StatusBadge（已下载 / 需更新 / 下载中 / 错误）
│   │   └── RowActions（启用 / 更新 / 删除）
│   └── ConfirmDialog（删除确认）
│
└── Tab 3: 已启用（当前生效的 Mod）
    ├── Toolbar（[应用变更并重启] [批量禁用] [刷新]）
    ├── ModCardGrid（仅显示 File_IDs 中的 Mod）
    │   └── ModCard（带启用状态指示器）
    └── ApplyRestartDialog（确认→save→shutdown→move→start 流水线）
```

### 2.2 与 Figma 设计的关系

当前 Figma 已有一个 Mods 页面设计（Filter Bar + 卡片网格 + PendingBar）。本次设计在 Figma 基础上扩展为三 Tab 结构，但保留 Figma 已定义的视觉规范（暗色主题、色值、间距）。

---

## 3. API 端点设计

> 本系统的 Mod 元数据（搜索、详情）来自 **Steam 官方 WebAPI**（外部服务，Valve 提供）。  
> 我们的后端对前端暴露统一的 REST 接口，内部作为代理调用 Steam WebAPI，再加本地状态操作。

### 3.1 Steam 官方 WebAPI（外部，元数据来源）

#### 3.1.1 IPublishedFileService — 创意工坊物品服务

**官方文档**：https://partner.steamgames.com/doc/webapi/IPublishedFileService  
**第三方参考**（更易读的参数列表）：https://steamapi.xpaw.me/IPublishedFileService  

**认证要求**：所有接口必须带 `key` 参数（Steam WebAPI Key）。  
**Key 获取**：用户在 https://steamcommunity.com/dev/apikey 免费申请，与 Steam 账号绑定（匿名申请，即时生效）。  
**安全约束**：Key 只能在服务端使用，**绝不能暴露到浏览器**。Steam 官方文档原文：*"This API MUST be called from a secure server, and can never be used directly by clients."*

---

##### 接口 1：QueryFiles — 搜索/浏览工坊物品

> 来源：https://partner.steamgames.com/doc/webapi/IPublishedFileService#QueryFiles  
> 第三方参考：https://steamapi.xpaw.me/IPublishedFileService#QueryFiles

```
GET https://api.steampowered.com/IPublishedFileService/QueryFiles/v1/
```

**请求参数**（标注官方必填 `R`，可选 `O`）：

| 参数 | 类型 | 必填/可选 | 文档来源 | 说明 |
|---|---|---|---|---|
| `key` | string | **R** | 官方 §通用参数 | Steam WebAPI Key |
| `appid` | uint32 | **R** | 官方 | 消费此物品的 AppID。Unturned = `1110390` |
| `query_type` | enum | **R** | 官方 | 排序类型：`0`=按投票排序<br>参考 `EPublishedFileQueryType` |
| `page` | uint32 | **R** | 官方 | 页码（1-based）；如果传 `cursor` 则此参数被忽略 |
| `numperpage` | uint32 | O | 官方 | 每页返回条数。DST 使用 `36` |
| `search_text` | string | **R** | 官方 | 搜索关键词，匹配 title 或 description |
| `return_vote_data` | bool | **R** | 官方 | 是否返回评分数据（score / votes_up / votes_down） |
| `return_children` | bool | O | 官方 | 是否返回子依赖 Mod 列表 |
| `return_tags` | bool | O | 官方 | 是否返回标签列表 |
| `return_short_description` | bool | O | 官方 | 是否返回简短描述 |
| `return_metadata` | bool | O | 官方 | 是否返回元数据 |
| `requiredtags[i]` | string | O | xpaw | 按标签过滤，`requiredtags[0]=server` |
| `match_all_tags` | bool | O | 官方 | 是否必须匹配所有 requiredtags |
| `language` | int32 | O | 官方 | 语言 ID：`0`=英语, `6`=简体中文 |
| `ids_only` | bool | O | 官方 | 仅返回 ID 列表（不返回详情） |
| `totalonly` | bool | O | 官方 | 仅返回匹配总数 |
| `cache_max_age_seconds` | uint32 | O | xpaw | 允许返回过期缓存的秒数 |

**响应结构**（官方 `publishedfiledetails{}` 数组）：

```json
{
  "response": {
    "total": 1420,
    "publishedfiledetails": [
      {
        "publishedfileid": "1234567890",
        "title": "More Farming Mod",
        "file_size": "52428800",
        "file_url": "https://...",
        "preview_url": "https://steamuserimages-a.akamaihd.net/...",
        "file_description": "[b]Adds more...[/b]",
        "file_type": 0,
        "creator": "76561198XXXXXXXXX",
        "consumer_appid": 1110390,
        "creator_appid": 304930,
        "tags": [{ "tag": "server", "display_name": "Server" }],
        "vote_data": { "score": 0.84, "votes_up": 150, "votes_down": 12 },
        "time_created": 1609459200,
        "time_updated": 1700000000,
        "subscriptions": 5000
      }
    ]
  }
}
```

##### 接口 2：GetDetails — 查询指定物品详情（支持批量）

> 来源：https://partner.steamgames.com/doc/webapi/IPublishedFileService#GetDetails  
> 第三方参考：https://steamapi.xpaw.me/IPublishedFileService#GetDetails

```
GET https://api.steampowered.com/IPublishedFileService/GetDetails/v1/
```

**请求参数**：

| 参数 | 类型 | 必填/可选 | 文档来源 | 说明 |
|---|---|---|---|---|
| `key` | string | **R** | 官方 | Steam WebAPI Key |
| `publishedfileids[i]` | uint64[] | **R** | 官方 | Mod ID 列表，支持批量：<br>`publishedfileids[0]=123&publishedfileids[1]=456` |
| `language` | int32 | O | xpaw | 语言 ID |
| `return_tags` | bool | O | —— | 是否返回标签 |
| `return_children` | bool | O | —— | 是否返回子依赖 |

**响应结构**：与 QueryFiles 相同，返回 `publishedfiledetails[]` 数组。

**用途**：
- Tab 1 搜索时按 ID 精确查找单个 Mod
- Tab 2/3 本地 Mod 列表加载后，**批量补齐**元数据（title / previewUrl / fileSize / voteData）——对应 DST 的 `addDownloadedModInfo()` 模式


##### 接口 3：SteamCMD `workshop_download_item` — Workshop 文件下载

> 来源：https://developer.valvesoftware.com/wiki/SteamCMD  
> 相关：DST 下载模式参考 `.research/dst-management-platform-api/dst/mod.go:165-167`

这不是 HTTP API，是通过 `steamcmd` 命令行工具执行的下载操作：

```bash
steamcmd +force_install_dir <staging目录> +login anonymous +workshop_download_item 1110390 <fileId> +quit
```

**说明**：
- AppID `1110390`（Unturned）；DST 平台用 `322330`
- `+login anonymous`：匿名登录（Workshop 内容下载无需 Steam 账号）
- `+force_install_dir`：指定下载目标目录
- 下载完成后在目标目录生成 `steamapps/workshop/appworkshop_1110390.acf`（已安装物品清单文件）
- 本项目下载到 staging 目录（不停服），应用时移动到 `content/1110390/`（需停服）


### 3.2 我们的后端 API（内部，前端调用的 REST 接口）

> 所有端点挂在 `/api/servers/:id` 下，JWT 认证（复用现有 `authenticateToken` 中间件）。  
> 前 3 个端点是 **Steam WebAPI 代理**——后端程序调用 §3.1 的 Steam 接口，转换格式后返回给前端。  
> 后 4 个端点是 **本地操作**——文件系统扫描、SteamCMD spawn、SOP 重启流水线。

#### 3.2.1 搜索 Steam 工坊（代理 `QueryFiles`）

```
GET /api/servers/:id/mods/search?q=<关键词>&page=<页码>&pageSize=<每页条数>&searchType=text|id

Response 200:
{
  "data": {
    "total": 1420,
    "page": 1,
    "pageSize": 36,
    "rows": [
      {
        "fileId": "1234567890",
        "title": "More Farming Mod",
        "author": "AuthorName",
        "description": "Adds more farming...",
        "previewUrl": "https://steamuserimages-a.akamaihd.net/...",
        "fileSize": 52428800,
        "tags": [{ "tag": "server", "displayName": "Server" }],
        "voteScore": 4.2,
        "votesUp": 150,
        "votesDown": 12,
        "subscriptions": 5000,
        "timeCreated": 1609459200,
        "timeUpdated": 1700000000
      }
    ]
  }
}
```

**后端实现**：
- `searchType=text` → 调 Steam `QueryFiles/v1`（§3.1 接口 1），参数映射：
  - 本项目 `q` → Steam `search_text`
  - 本项目 `page` → Steam `page`
  - 本项目 `pageSize` → Steam `numperpage`
  - 固定 `appid=1110390`，`return_vote_data=true`，`return_tags=true`
  - 暂不传 `requiredtags`（Unturned 无标准服务端 tag，后续实机验证）
- `searchType=id` → 调 Steam `GetDetails/v1`（§3.1 接口 2）
- `key` 从 Settings 配置读取（数据库加密存储，复用 CryptoBox 方案）
- 响应中的 `publishedfiledetails[]` 映射为 `ModInfo[]`

#### 3.2.2 Mod 详情（代理 `GetDetails`）

```
GET /api/servers/:id/mods/:fileId

Response 200:
{ "data": { /* ModInfo 对象，同 §3.2.1 */ } }
```

**后端实现**：`WorkshopMetadataService.getModDetails()` 调 Steam `GetDetails/v1`（§3.1 接口 2），传单个 `publishedfileids[0]`。

#### 3.2.3 批量 Mod 元数据补全（代理 `GetDetails` 批量）

```
POST /api/servers/:id/mods/batch-details
Body: { "fileIds": ["123", "456", "789"] }

Response 200:
{ "data": [ /* ModInfo[] */ ] }
```

**后端实现**：调 Steam `GetDetails/v1`（§3.1 接口 2），一次传入多个 `publishedfileids[i]`。用途：Tab 2/3 加载本地 Mod 列表后，批量补齐标题、预览图、作者等元数据（对应 DST 的 `addDownloadedModInfo` 模式，参考 `.research/dst-management-platform-api/app/mod/utils.go:231-289`）。

#### 3.2.4 已下载列表（本地扫描 + ACF 解析）

```
GET /api/servers/:id/mods/downloaded

Response 200:
{
  "data": [
    {
      "fileId": "123",
      "localSize": 52428800,
      "installedAt": "2026-08-08T12:00:00Z",
      "downloadState": "ready" | "downloading" | "error"
    }
  ]
}
```

**后端实现**：
- 扫描 `Servers/<ID>/Workshop/steamapps/workshop/content/1110390/*` 目录
- 解析 `appworkshop_1110390.acf` 获取安装大小和时间（ACF 格式参考 `.research/dst-management-platform-api/utils/acf.go`）
- 返回纯本地数据（元数据由前端调 §3.2.3 batch-details 补齐）

#### 3.2.5 下载 Mod 到 staging（SteamCMD spawn）

```
POST /api/servers/:id/mods/download
Body: { "fileId": "123" }

Response 202:
{ "data": { "operationId": "download_123_1700000000", "status": "queued" } }
```

**后端实现**：
- `SteamCmdManager.downloadWorkshopItem(serverId, fileId)` spawn SteamCMD（§3.1 接口 3 的命令行）
- 下载到 `Servers/<ID>/Workshop/staging/`（不停服——U3DS 只 mount `content/1110390/`，不扫描 staging）
- 进度走 WS `steamcmd_progress` 事件推送
- 竞态门控：复用 `activeOperation` 机制

#### 3.2.6 应用 Mod 变更 + 重启流水线

```
POST /api/servers/:id/mods/apply
Body: { "fileIds": ["123", "456"] }

Response 202:
{ "data": { "operationId": "apply_1700000000", "status": "restarting" } }
```

**后端实现**：SOP 规定的完整流水线（详见 `CLAUDE.md` + `unturned-sop.md` §重启/改 Mod 流水线）：
1. 备份 `WorkshopDownloadConfig.json`
2. 原子写新 `File_IDs`
3. RCON `Save`（强制刷新玩家数据到磁盘）
4. RCON `Shutdown 30 <重启原因>`（30 秒优雅关服）
5. 等待进程退出
6. 移动 staging 内容 → `Workshop/steamapps/workshop/content/1110390/`
7. 重新 spawn 进程
8. 轮询 A2S_INFO 直到"服务端就绪"，超时 30 秒报错
9. WS 广播 `state_change` → `RUNNING`

#### 3.2.7 删除 Mod

```
DELETE /api/servers/:id/mods/:fileId

Response 200:
{ "data": { "message": "Mod 已删除" } }
```

**后端实现**：ACF 删项 + 删除 `content/1110390/<fileId>` 目录内容（参考 DST 的 `deleteMod`，`.research/dst-management-platform-api/dst/mod.go:632-686`）。

### 3.3 修改现有端点

| 端点 | 变更 |
|---|---|
| `GET /workshop/mods/:fileId` | **废弃**。替换为 `GET /api/servers/:id/mods/:fileId`（§3.2.2） |
| `PUT /:id/config/workshop` | **保留**，但不再由前端直接调用（由 apply 流水线内部调用，§3.2.6） |
| `POST /:id/apply` | **实现**（当前是 stub，`ServerManager.ts:326` 直接 throw） |

### 3.4 WebSocket 事件

| 事件 | 触发时机 | 数据结构 |
|---|---|---|
| `mod_download_progress` | SteamCMD 下载进行中 | `{ serverId, fileId, progress: 0-100, stage: 'downloading'\|'verifying' }` |
| `mod_download_complete` | 单个 Mod 下载完成 | `{ serverId, fileId, success: bool, error? }` |
| `mod_apply_progress` | apply 流水线各阶段 | `{ serverId, stage: 'saving'\|'stopping'\|'moving'\|'starting'\|'ready' }` |

---

## 4. 数据模型（shared/schemas/）

### 4.1 Zod Schema

```typescript
// shared/schemas/mod.schema.ts

import { z } from 'zod';

/** Steam Workshop Mod 元数据（WebAPI 返回） */
export const ModInfoSchema = z.object({
  fileId: z.string().describe('Steam Workshop 文件 ID'),
  title: z.string(),
  author: z.string(),
  description: z.string().default(''),
  previewUrl: z.string().optional(),
  fileSize: z.number().optional(),
  tags: z.array(z.object({
    tag: z.string(),
    displayName: z.string(),
  })).default([]),
  voteScore: z.number().min(0).max(5).default(0),
  votesUp: z.number().int().default(0),
  votesDown: z.number().int().default(0),
  subscriptions: z.number().int().default(0),
  timeCreated: z.number().optional(),
  timeUpdated: z.number().optional(),
});

export type ModInfo = z.infer<typeof ModInfoSchema>;

/** 已下载 Mod 本地状态 */
export const DownloadedModSchema = z.object({
  fileId: z.string(),
  localSize: z.number().default(0),
  installedAt: z.string().optional(),
  downloadState: z.enum(['ready', 'downloading', 'error']).default('ready'),
});

export type DownloadedMod = z.infer<typeof DownloadedModSchema>;

/** 合并后的完整 Mod 展示对象（元数据 + 本地状态 + 启用状态） */
export const UnifiedModSchema = ModInfoSchema.extend({
  localSize: z.number().default(0),
  downloadState: z.enum(['not_downloaded', 'downloading', 'downloaded', 'error']).default('not_downloaded'),
  enabled: z.boolean().default(false),
  hasUpdate: z.boolean().default(false),
});

export type UnifiedMod = z.infer<typeof UnifiedModSchema>;

/** 搜索请求 */
export const ModSearchQuerySchema = z.object({
  q: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(36),
  searchType: z.enum(['text', 'id']).default('text'),
});

export type ModSearchQuery = z.infer<typeof ModSearchQuerySchema>;

/** 搜索响应 */
export const ModSearchResultSchema = z.object({
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
  rows: z.array(ModInfoSchema),
});

export type ModSearchResult = z.infer<typeof ModSearchResultSchema>;

/** 下载请求 */
export const ModDownloadRequestSchema = z.object({
  fileId: z.string().min(1),
});

/** 批量元数据请求 */
export const ModBatchDetailsRequestSchema = z.object({
  fileIds: z.array(z.string()).min(1).max(100),
});

/** Apply 请求 */
export const ModApplyRequestSchema = z.object({
  fileIds: z.array(z.string()).min(0),
});

/** 操作响应 */
export const ModOperationResponseSchema = z.object({
  operationId: z.string(),
  status: z.enum(['queued', 'running', 'completed', 'failed']),
});

/** WebSocket 下载进度 */
export const ModDownloadProgressSchema = z.object({
  type: z.literal('mod_download_progress'),
  serverId: z.string(),
  fileId: z.string(),
  progress: z.number().min(0).max(100),
  stage: z.enum(['downloading', 'verifying']),
});

/** WebSocket apply 进度 */
export const ModApplyProgressSchema = z.object({
  type: z.literal('mod_apply_progress'),
  serverId: z.string(),
  stage: z.enum(['saving', 'stopping', 'moving', 'starting', 'ready']),
  message: z.string().optional(),
});
```

### 4.2 TypeScript 类型（从 Zod 派生）

所有类型由 Zod schema 通过 `z.infer` 派生，前端后端共用。

---

## 5. 前端组件规格

### 5.1 新增组件清单（7 个）

#### 5.1.1 `ModCard` — Mod 卡片

```
路径: manager-web/src/components/shared/ModCard.tsx

Props:
  mod: UnifiedMod
  variant: 'search' | 'downloaded' | 'enabled'
  onDownload?: (fileId: string) => void
  onEnable?: (fileId: string) => void
  onDisable?: (fileId: string) => void
  onDelete?: (fileId: string) => void
  onClickDetail?: (mod: UnifiedMod) => void
  selected?: boolean
  onSelect?: (fileId: string) => void

渲染:
  ┌─────────────────────────┐
  │ ┌─────────────────────┐ │
  │ │   预览图 (192×108)   │ │ ← 无预览图时显示 Package 图标占位
  │ └─────────────────────┘ │
  │ 标题（截断 1 行）        │
  │ 作者 · ⭐ 4.2           │
  │ [标签1] [标签2]          │ ← 最多 3 个 TagChip
  │ ─────────────────────── │
  │ 📦 50MB · 📥 5000      │
  │ [下载] [详情]            │ ← variant='search'
  │ [启用] [更新] [删除]     │ ← variant='downloaded'
  │ ☑ 已启用 | [禁用]       │ ← variant='enabled'
  └─────────────────────────┘

设计要求:
  - 自适应高度，不固定高度
  - pendingRemovals 时 opacity-50 + 红色边框
  - 选中时 ring-2 ring-emerald-500
  - transition-colors hover:ring-1 hover:ring-slate-600
```

#### 5.1.2 `Pagination` — 分页器

```
路径: manager-web/src/components/shared/Pagination.tsx

Props:
  total: number
  page: number
  pageSize: number
  onPageChange: (page: number) => void
  totalVisible?: number  // 默认 7

渲染:
  Total: 1420   [←] [1] [2] [3] ... [40] [→]

设计要求:
  - 复用 DataTable 的分页逻辑，提取为独立组件
  - 暗色主题适配
```

#### 5.1.3 `StarRating` — 星级评分

```
路径: manager-web/src/components/shared/StarRating.tsx

Props:
  score: number       // 0-5，支持小数
  maxStars?: number   // 默认 5
  size?: number       // 默认 14

渲染:
  ★★★★☆ 4.2

设计要求:
  - 用 lucide-react Star 图标（fill 模式）
  - 颜色: #F59E0B (amber-500)
```

#### 5.1.4 `BBCodeRenderer` — BBCode 渲染器

```
路径: manager-web/src/components/shared/BBCodeRenderer.tsx

Props:
  text: string

支持标签:
  [b] [i] [u] [h1-h6] [code] [color=xxx] [size=xxx]
  [img] [url] [list] [*]

渲染:
  将 BBCode 转换为 React JSX（纯正则替换，不引入第三方库）

设计要求:
  - 安全：无 dangerouslySetInnerHTML（用 JSX 逐段渲染）
  - 不支持 [table] [quote] 等复杂标签（大多数 Mod 描述不用）
```

#### 5.1.5 `StatusBadge` — 状态徽章

```
路径: manager-web/src/components/shared/StatusBadge.tsx

Props:
  state: 'downloaded' | 'downloading' | 'not_downloaded' | 'error'
        | 'enabled' | 'disabled' | 'needs_update'

渲染:
  <span className="text-xs px-2 py-0.5 rounded-full ...">
    ● 已下载
  </span>

色值映射:
  downloaded → #22C55E (emerald)
  downloading → #F59E0B (amber)
  not_downloaded → #64748B (slate)
  error → #EF4444 (red)
  enabled → #22C55E
  disabled → #64748B
  needs_update → #F59E0B
```

#### 5.1.6 `TagChip` — 标签粒

```
路径: manager-web/src/components/shared/TagChip.tsx

Props:
  label: string
  variant?: 'default' | 'highlight'

渲染:
  <span className="text-[10px] px-1.5 py-px rounded border border-slate-700 bg-slate-800 text-slate-400">
    server
  </span>
```

#### 5.1.7 `Skeleton` — 骨架屏

```
路径: manager-web/src/components/shared/Skeleton.tsx

Props:
  width?: number | string
  height?: number | string
  variant?: 'text' | 'rect' | 'circle'
  className?: string

渲染:
  <div className="animate-pulse bg-slate-700 rounded" style={{ width, height }} />

// 组合导出
export function ModCardSkeleton() {
  return (
    <div className="rounded-lg border border-slate-700 bg-slate-800 p-0 overflow-hidden">
      <Skeleton width="100%" height={108} />
      <div className="p-3 space-y-2">
        <Skeleton width="80%" height={14} />
        <Skeleton width="50%" height={10} />
        <Skeleton width="100%" height={8} />
      </div>
    </div>
  );
}
```

### 5.2 修改组件

#### 5.2.1 `ModsPage` — 重写

**当前**：单页面，卡片网格 + Add Dialog + PendingBar（229 行）

**重写后**：三 Tab 结构，每种视图独立数据流：

```typescript
// ModsPage.tsx 顶层状态
const [tab, setTab] = useState<'search' | 'downloaded' | 'enabled'>('search');

// 各 Tab 独立的数据模型
```

**删除的旧代码**：
- 内联 Mod 卡片 JSX → 替换为 `<ModCard>` 组件
- 内联 Add Dialog → 替换为 Search Tab 中的搜索框
- `fetchMods()` 调 `/config/workshop` + `/workshop/mods/:id` → 替换为 `/mods/downloaded` + `/mods/batch-details`

### 5.3 需新增的 shadcn/ui 组件

从 shadcn 官网复制以下组件到 `components/ui/`：

| 组件 | 用途 |
|---|---|
| `Select` | 搜索类型下拉（text/ID）、排序下拉 |
| `Badge` | 状态标签（可选，也可直接用 Tailwind span） |
| `Tooltip` | 截断标题的完整文本悬浮 |
| `DropdownMenu` | 每行操作菜单（启用/更新/删除） |
| `Progress` | 下载进度条 |

---

## 6. ModsPage 状态管理设计

### 6.1 搜索 Tab 状态

```typescript
const [searchQuery, setSearchQuery] = useState('');
const [searchType, setSearchType] = useState<'text' | 'id'>('text');
const [searchResult, setSearchResult] = useState<ModSearchResult | null>(null);
const [searchLoading, setSearchLoading] = useState(false);
const [searchError, setSearchError] = useState<string | null>(null);

// 分页
const [page, setPage] = useState(1);
const pageSize = 36; // 固定，与 DST 一致

// 详情弹窗
const [detailMod, setDetailMod] = useState<UnifiedMod | null>(null);
```

### 6.2 已下载 Tab 状态

```typescript
const [downloadedMods, setDownloadedMods] = useState<UnifiedMod[]>([]);
const [downloadedLoading, setDownloadedLoading] = useState(false);

// 批量操作
const [selectedMods, setSelectedMods] = useState<Set<string>>(new Set());
const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

// 下载进度
const [downloadProgress, setDownloadProgress] = useState<Map<string, number>>(new Map());
```

**数据流**：
```
1. GET /mods/downloaded → DownloadedMod[]（只有 fileId + localSize）
2. POST /mods/batch-details { fileIds } → ModInfo[]（WebAPI 元数据）
3. GET /config/workshop → File_IDs（判断 enabled/disabled）
4. 三源合并 → UnifiedMod[]
```

### 6.3 已启用 Tab 状态

```typescript
const [enabledMods, setEnabledMods] = useState<UnifiedMod[]>([]);
const [enableLoading, setEnableLoading] = useState(false);

// Apply 流水线
const [applyPending, setApplyPending] = useState(false);
const [applyStage, setApplyStage] = useState<string | null>(null);
```

---

## 7. 路由设计

### 7.1 后端路由（新增）

```typescript
// routes/mods.ts（重写现有文件——原文件仅含 POST /:id/apply stub）
export function createModsRouter(
  workshopMeta: IWorkshopMetadataService,
  steamCmdManager: ISteamCmdManager,
  configService: IConfigService,
  serverManager: IServerManager,
  broadcaster: IBroadcaster,
): Router {
  const router = Router();
  router.use(authenticateToken);

  router.get('/:id/mods/search', async (req, res) => { /* ... */ });
  router.get('/:id/mods/:fileId', async (req, res) => { /* ... */ });
  router.post('/:id/mods/batch-details', async (req, res) => { /* ... */ });
  router.get('/:id/mods/downloaded', async (req, res) => { /* ... */ });
  router.post('/:id/mods/download', async (req, res) => { /* ... */ });
  router.post('/:id/mods/apply', async (req, res) => { /* ... */ });
  router.delete('/:id/mods/:fileId', async (req, res) => { /* ... */ });

  return router;
}
```

### 7.2 挂载到 index.ts

```typescript
// index.ts
app.use('/api/servers', createModsRouter(
  container.workshopMeta,
  container.steamCmdManager,
  container.configService,
  container.serverManager,
  container.broadcaster,
));
```

注意：`/api/servers` 下已有 5 个 router（servers/mods/rcon/config/files）。`routes/mods.ts` 为**重写**——原文件仅含 `POST /:id/apply` 单端点（当前是 stub），重写后承载 §3.2 的全部 7 个 Mod 端点。

### 7.3 前端路由

无需修改——Mod 管理始终在 `/mods` 路径下，由 `ModsPage` 组件内部 TabBar 切换子视图。

---

## 8. 实现阶段

### Phase A：基础设施（共享类型 + shadcn 组件）

| # | 任务 | 产出 |
|---|---|---|
| A1 | `shared/schemas/mod.schema.ts` — Zod schema + TS 类型 | 前后端共用的类型定义 |
| A2 | 从 shadcn 官网复制 Select / Badge / Tooltip / DropdownMenu / Progress | `components/ui/` 新增 5 个组件 |
| A3 | 新增 7 个共享组件 | ModCard / Pagination / StarRating / BBCodeRenderer / StatusBadge / TagChip / Skeleton |

### Phase B：后端

| # | 任务 | 产出 |
|---|---|---|
| B1 | `WorkshopMetadataService` 重写（XML → WebAPI `GetDetails` / `QueryFiles`） | Mod 搜索/详情/批量补全可用 |
| B2 | `SteamCmdManager.downloadWorkshopItem()` + staging 机制 | 下载到 staging（不停服） |
| B3 | `routes/mods.ts` — 7 个新端点（Zod 校验 + asyncHandler） | API 可用 |
| B4 | `ServerManager.applyModChanges()` 实现（替代 stub） | apply 流水线完整 |
| B5 | WS `mod_download_progress` + `mod_apply_progress` 事件推送 | 实时进度 |

### Phase C：前端

| # | 任务 | 产出 |
|---|---|---|
| C1 | `ModsPage` 重写 — 三 Tab 结构 + 状态管理 | 页面可用 |
| C2 | 搜索 Tab（SearchBar + ModCardGrid + Pagination + ModDetailDialog） | 搜索可用 |
| C3 | 已下载 Tab（DataTable + StatusBadge + RowActions） | 本地管理可用 |
| C4 | 已启用 Tab（ModCardGrid + ApplyRestartDialog） | 流水线可用 |
| C5 | WS 订阅接线（下载进度 + apply 进度实时更新） | 实时推送可用 |

### Phase D：验证

| # | 任务 |
|---|---|
| D1 | typecheck 零错误 |
| D2 | 冒烟测试：搜索 → 下载 → 启用 → apply 流水线跑通 |
| D3 | 前端加载态/空态/错误态全覆盖 |

---

## 9. 色值与间距规范（对齐 Figma + DST）

| 元素 | 色值 | Tailwind class |
|---|---|---|
| ModCard 背景 | `#1E293B` | `bg-slate-800` |
| ModCard 边框 | `#334059` | `border-slate-700` |
| ModCard hover 环 | `#475569` | `ring-slate-600` |
| 预览图占位 | `#0F172A` | `bg-slate-950` |
| 高亮边框（选中） | `#22C55E` | `ring-emerald-500` |
| 评分星 | `#F59E0B` | `text-amber-500` |
| 标题文字 | `#F1F5FB` | `text-slate-100` |
| 次要文字 | `#94A3B8` | `text-slate-400` |
| ID/大小文字 | `#64748B` | `text-slate-500` |
| Filter Bar 背景 | `#172133` | `#172133`（无标准 Tailwind class） |

间距：页面 padding 24px、卡片间距 16px、卡片内部 padding 12px。

---

*创建日期：2026-08-08 · 基于 DST 全链路分析 + 本项目代码审计 · 待评审*
