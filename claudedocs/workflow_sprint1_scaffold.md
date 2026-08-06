# Sprint 1 实现工作流：项目脚手架

> 生成日期：2026-08-07
> 输入：`docs/architecture/architecture-spec.md`（1163 行，经 5 轮三 agent 交叉审查）
> 策略：systematic · depth=normal · focus=quality
> 不含 Docker（用户指示暂缓）

---

## 前置条件

| 条件 | 状态 |
|---|---|
| 架构 spec 完成并审查通过 | ✅ `docs/architecture/architecture-spec.md` |
| 设计系统映射完成 | ✅ `docs/architecture/design-system-mapping.md` |
| 技术栈锁定 | ✅ `CLAUDE.md` §2（pino / Argon2id / undici 已统一） |
| Sprint 0 完成 | ✅ CLAUDE.md + docs/ + 11 份 claudedocs/ |

---

## Sprint 1 目标

产出可运行的空壳应用——前端能渲染 Sidebar + 一个占位页面，后端能启动 Express + ws 并响应 `/api/health`，数据库能迁移。

**不包含**：业务逻辑（模块实现、RCON 连接、配置读写）——那些是 Sprint 2。

---

## 阶段总览

```
Phase 0: 仓库初始化
  │
  ├──► Phase 1: shared/ 共享层 ←── 无依赖，可最先开始
  │
  ├──► Phase 2: 数据库层 ←── 依赖 Phase 1（类型定义）
  │
  ├──► Phase 3: 后端骨架 ←── 依赖 Phase 1, 2
  │
  ├──► Phase 4: 前端骨架 ←── 依赖 Phase 1（可并行于 Phase 2, 3）
  │
  └──► Phase 5: 质量基础设施 ←── 依赖 Phase 3, 4
         │
         └──► Phase 6: 集成验证 ←── 依赖全部
```

---

## Phase 0: 仓库初始化

**目标**：建目录、装依赖、配 tsconfig。

### Task 0.1: 创建目录结构

```
unturned-manager/
├── manager-server/
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       ├── index.ts
│       ├── config.ts
│       ├── composition-root.ts
│       ├── db/
│       │   └── migrations/
│       ├── routes/
│       ├── modules/
│       │   ├── auth/
│       │   ├── server/
│       │   ├── config/
│       │   ├── files/
│       │   ├── steamcmd/
│       │   ├── workshop/
│       │   ├── logstream/
│       │   ├── rcon/
│       │   ├── a2s/
│       │   └── process/
│       ├── middleware/
│       └── utils/
├── manager-web/
│   ├── package.json
│   ├── vite.config.ts
│   ├── tailwind.config.ts
│   ├── tsconfig.json
│   ├── index.html
│   └── src/
│       ├── main.tsx
│       ├── App.tsx
│       ├── index.css
│       ├── api/
│       ├── contexts/
│       ├── hooks/
│       ├── pages/
│       ├── components/
│       │   ├── layout/
│       │   ├── ui/          (shadcn 生成)
│       │   └── shared/
│       └── types/
└── shared/
    ├── types/
    │   ├── branded.ts
    │   ├── state.ts
    │   └── domain.ts
    └── contracts/
        ├── server.ts
        ├── config.ts
        ├── rcon.ts
        ├── process.ts
        ├── broadcast.ts
        ├── files.ts
        ├── auth.ts
        ├── a2s.ts
        ├── filelock.ts
        ├── steamcmd.ts
        ├── workshop.ts
        └── logstream.ts
```

### Task 0.2: 初始化三个 package.json

**manager-server/package.json** 依赖：
- `express` · `ws` · `better-sqlite3` · `rcon-srcds` · `@fabricio-191/valve-server-query` · `fast-xml-parser` · `js-yaml` · `jsonwebtoken` · `pino` · `argon2`
- Dev: `typescript` · `@types/express` · `@types/ws` · `@types/better-sqlite3` · `@types/jsonwebtoken` · `tsx` · `vitest`

**manager-web/package.json** 依赖：
- `react` · `react-dom` · `react-router-dom` · `@tanstack/react-table` · `recharts` · `lucide-react` · `react-hook-form` · `zod` · `axios` · `zustand`
- Dev: `vite` · `@vitejs/plugin-react` · `typescript` · `tailwindcss` · `postcss` · `autoprefixer` · `vitest` · `@playwright/test`

**shared/package.json**：
- 纯 TypeScript 类型包，零运行时依赖
- 被 backend 和 frontend 通过 TypeScript project references 引用

### Task 0.3: TypeScript 配置

- 根 `tsconfig.json`（project references）
- `manager-server/tsconfig.json`（target: ES2022, module: NodeNext）
- `manager-web/tsconfig.json`（target: ES2022, module: ESNext, jsx: react-jsx）
- `shared/tsconfig.json`（target: ES2022, module: NodeNext, declaration: true）

### Phase 0 质量门

| 检查项 | 命令 | 标准 |
|---|---|---|
| 依赖安装成功 | `npm install`（三个目录各自） | 零错误 |
| TypeScript 编译 | `tsc --noEmit`（三个目录各自） | 零错误（允许"无源文件"警告） |

---

## Phase 1: shared/ 共享层

**目标**：定义全部类型和接口，不写任何实现代码。

**依赖**：Phase 0

### Task 1.1: Branded Types (`shared/types/branded.ts`)

```typescript
export type ServerId = string & { readonly __brand: 'ServerId' };
export type SteamId64 = string & { readonly __brand: 'SteamId64' };
export type WorkshopFileId = string & { readonly __brand: 'WorkshopFileId' };
export type Port = number & { readonly __brand: 'Port' };
```

### Task 1.2: 状态机类型 (`shared/types/state.ts`)

- `ServerState` enum（5 态）
- `ActiveOperation` discriminated union（7 变体）
- `RconProtocol` enum（3 变体）
- `RconConnectionState` enum（3 变体）

### Task 1.3: 领域数据类型 (`shared/types/domain.ts`)

- `ServerConfig` / `CommandsDatRecord` / `ConfigTxtRecord` / `ConfigSection` / `ConfigEntry`
- `WorkshopConfig` / `A2SInfo` / `WorkshopModMeta` / `FileEntry` / `FilePermissions` / `SteamCmdStatus`

### Task 1.4: 模块接口契约 (`shared/contracts/*.ts`)

12 个接口文件，每个文件一个 interface + 相关类型：

| # | 文件 | 接口 | 关键方法 |
|---|---|---|---|
| 1 | `server.ts` | `IServerManager` | start/stop/restart/forceStop/applyModChanges/createServer/configureServer/updateServerBinaries |
| 2 | `config.ts` | `IConfigService` | read/write CommandsDat, ConfigTxt, Workshop, OpenMod, RocketMod; backup |
| 3 | `rcon.ts` | `IRconManager` | connect/disconnect/execute/destroy/onStateChange |
| 4 | `process.ts` | `IProcessSupervisor` | spawn/gracefulShutdown/waitForExit/forceKill/isRunning/destroy |
| 5 | `broadcast.ts` | `IBroadcaster` | broadcast/register/unregister/destroy; ServerEvent 类型 |
| 6 | `files.ts` | `IFilesService` | listDirectory/readFile/writeFile/deleteEntry/createDirectory/renameEntry/createUploadStream |
| 7 | `auth.ts` | `IAuthService` | login/refresh/logout/validateAccessToken |
| 8 | `a2s.ts` | `IA2SClient` | query/destroy |
| 9 | `filelock.ts` | `IFileLockProvider` | acquire/release/isLocked |
| 10 | `steamcmd.ts` | `ISteamCmdManager` | getStatus/install/updateU3DS |
| 11 | `workshop.ts` | `IWorkshopMetadataService` | getModDetails/searchMods/refreshCache |
| 12 | `logstream.ts` | `ILogStreamer` | startStreaming/stopStreaming |

### Task 1.5: shared/index.ts 统一导出

### Phase 1 质量门

| 检查项 | 命令 | 标准 |
|---|---|---|
| 编译通过 | `cd shared && tsc --noEmit` | 零错误 |
| 无 `any` | `grep -r ": any" shared/` | 零匹配（CLAUDE.md §2.5 禁用） |
| 接口覆盖率 | 对照 `architecture-spec.md` §5 手工检查 | 12/12 接口已定义 |

---

## Phase 2: 数据库层

**目标**：SQLite schema 创建 + 迁移系统 + 连接管理。

**依赖**：Phase 0, Phase 1

### Task 2.1: 数据库连接 (`manager-server/src/db/connection.ts`)

- `better-sqlite3` 初始化
- WAL 模式开启
- 外键约束开启
- 导出单例 `getDb()` 函数

### Task 2.2: 迁移系统 (`manager-server/src/db/migrate.ts`)

- 读取 `manager-server/src/db/migrations/` 目录
- 按文件名排序执行（`NNN-description.sql`）
- 用 `PRAGMA user_version` 追踪已执行迁移
- 所有迁移在事务内执行
- 首次启动自动迁移

### Task 2.3: DDL 迁移脚本

`manager-server/src/db/migrations/001-initial-schema.sql`：
- 6 张表：`servers` / `users` / `refresh_tokens` / `config_snapshots` / `workshop_mods` / `audit_logs`
- 4 个索引：`idx_servers_state` / `idx_config_snapshots_server_file` / `idx_audit_logs_server` / `idx_audit_logs_action`

### Task 2.4: 首次启动种子数据 (`manager-server/src/db/seed.ts`)

- 检测 `users` 表是否为空 → 创建默认 admin 用户
- 密码通过环境变量 `ADMIN_PASSWORD` 传入，Argon2id 哈希

### Phase 2 质量门

| 检查项 | 命令 | 标准 |
|---|---|---|
| 迁移可执行 | 启动 `manager-server/src/index.ts` → 检查 SQLite 文件 | 6 张表 + 4 个索引全部创建 |
| 幂等迁移 | 重启应用 → 检查 | `user_version` 未变化，无重复建表错误 |
| 种子数据 | 检查 `users` 表 | 有 1 行 admin 用户，密码已哈希 |
| WAL 模式 | `PRAGMA journal_mode;` | 返回 `wal` |

---

## Phase 3: 后端骨架

**目标**：Express + ws 可启动，中间件就位，依赖注入容器就位，无业务逻辑的空路由。

**依赖**：Phase 0, Phase 1, Phase 2

### Task 3.1: 配置 (`manager-server/src/config.ts`)

```typescript
// 环境变量读取 + 校验（缺必填项 → 启动失败并输出明确错误）
export const config = {
  port: parseInt(process.env.SERVER_PORT || '3001'),
  host: process.env.HOST || '0.0.0.0',
  logLevel: process.env.LOG_LEVEL || 'info',
  jwtSecret: process.env.JWT_SECRET,     // 必填
  encryptionKey: process.env.ENCRYPTION_KEY, // 必填，AES-256-GCM 用
  dbPath: process.env.DB_PATH || './data/unturned-manager.db',
  dataDir: process.env.DATA_DIR || './data',
};
```

### Task 3.2: 日志 (`manager-server/src/utils/logger.ts`)

- pino 初始化，结构化 JSON
- `LOG_LEVEL` 环境变量控制
- 生产环境不输出到 console（仅文件 transport）

### Task 3.3: Express 中间件塔

按以下顺序注册（`manager-server/src/index.ts`）：

1. `helmet`（安全头，CSP 先宽松后收紧）
2. `cors`（从环境变量读取 origin）
3. `express.json({ limit: '10mb' })`
4. 请求日志 middleware（pino-http）
5. `/api/health` → 200 `{ status:'ok', uptime, version }`
6. JWT 验证 middleware（`authenticateToken`）→ 挂载到所有 `/api/*` 路由
7. 速率限制 middleware（按 §8.3 配置）
8. 全局错误处理器 → `{ error: { code, message } }`（不暴露堆栈）

### Task 3.4: 依赖注入容器 (`manager-server/src/composition-root.ts`)

按照 architecture-spec.md §9.3 的依赖关系图，创建所有 12 个模块的**桩实现**（stub）：

- 每个模块返回一个符合 shared/contracts 接口的对象
- 桩实现的方法体为 `throw new Error('Not implemented: <module>.<method>')` 或返回空数据
- 仅在 Sprint 2 逐步替换为真实实现

```typescript
// 示例桩
export function buildContainer(db: Database): AppContainer {
  const fileLock = createFileLockProviderStub();
  const a2sClient = createA2SClientStub();
  const rconManager = createRconManagerStub();
  const processSupervisor = createProcessSupervisorStub();
  const broadcaster = createBroadcasterStub();
  const configService = createConfigServiceStub();
  const filesService = createFilesServiceStub();
  const steamCmdManager = createSteamCmdManagerStub();
  const workshopMeta = createWorkshopMetadataServiceStub();
  const authService = createAuthServiceStub(db);
  const logStreamer = createLogStreamerStub();
  const serverManager = createServerManagerStub();

  return { ... };
}
```

> 注意：`AuthService` 是唯一在 Sprint 1 就需要真实实现的模块（因为有 `authenticateToken` 中间件依赖它）。

### Task 3.5: REST 路由骨架

按 architecture-spec.md §5.10 端点清单创建路由文件，每个路由文件挂桩实现：

| 路由文件 | 路径前缀 | 端点 |
|---|---|---|
| `routes/auth.ts` | `/api/auth` | POST login / refresh / logout |
| `routes/servers.ts` | `/api/servers` | GET list / POST create / PATCH :id / POST :id/start / :id/stop / :id/restart |
| `routes/mods.ts` | `/api/servers/:id/mods` | POST apply |
| `routes/rcon.ts` | `/api/servers/:id/rcon` | POST execute |
| `routes/config.ts` | `/api/servers/:id/config` | GET/PUT commands / txt / workshop |
| `routes/files.ts` | `/api/servers/:id/files` | GET list / POST upload |
| `routes/steamcmd.ts` | `/api/steamcmd` | GET status / POST update |
| `routes/workshop.ts` | `/api/workshop` | GET mods/:fileId |

### Task 3.6: WebSocket 网关 (`manager-server/src/ws/`)

- `ws.Server` 初始化，挂载到 HTTP server
- `verifyClient` 回调：从 `?token=<JWT>` 解析并验证 JWT
- 连接成功 → 注册到 `WsBroadcaster`（桩实现）
- 连接断开 → 清理

### Task 3.7: AuthService（唯一 Sprint 1 真实实现）

- `POST /api/auth/login`：验证 Argon2id 密码 → 签发 JWT access_token (15min) + refresh_token (7d, httpOnly cookie)
- `POST /api/auth/refresh`：验证 refresh token → 签发新 access_token
- `POST /api/auth/logout`：将 refresh token 的 jti 写入 `refresh_tokens` 黑名单
- `authenticateToken` 中间件：从 `Authorization: Bearer` 头提取并验证 access_token

### Task 3.8: 优雅关闭 (`manager-server/src/index.ts` shutdown handler)

```
SIGTERM/SIGINT →
  ① 关闭 HTTP server（停止接受新请求）
  ② 关闭 WebSocket server（断开所有连接）
  ③ 依次 destroy()（反向依赖序）：
     Broadcaster → RconManager → A2SClient → ProcessSupervisor
  ④ 关闭 SQLite 连接
  ⑤ process.exit(0)
```

### Phase 3 质量门

| 检查项 | 命令 | 标准 |
|---|---|---|
| 启动成功 | `cd backend && tsx src/index.ts` | "listening on :3001" 日志 |
| health | `curl localhost:3001/api/health` | 200 `{status:"ok"}` |
| 登录流程 | `curl -X POST localhost:3001/api/auth/login -H 'Content-Type: application/json' -d '{"username":"admin","password":"..."}'` | 200 `{accessToken, refreshToken}` |
| 认证保护 | `curl localhost:3001/api/servers`（无 token） | 401 |
| ws 认证 | 用无效 token 连 ws | 连接被拒绝 |
| 优雅关闭 | 发送 SIGTERM | 无未处理异常，进程正常退出 |
| 无 `any` | `grep -r ": any" manager-server/src/` | 零匹配 |
| ts 编译 | `tsc --noEmit` | 零错误 |

---

## Phase 4: 前端骨架

**目标**：React SPA 可启动，路由就位，Sidebar 渲染，shadcn 主题生效，空占位页面。

**依赖**：Phase 0, Phase 1（可与 Phase 2, 3 并行）

### Task 4.1: Vite + React + shadcn/ui 初始化

- `npm create vite@latest frontend -- --template react-ts`
- `npx shadcn-ui@latest init`（slate 主题，CSS 变量模式）
- `tailwind.config.ts`：确认 slate 色系 + emerald-500 点睛 + Inter 字体
- `index.css`：`@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap')`

### Task 4.2: 路由 + Layout（`manager-web/src/App.tsx`）

- react-router-dom v6 BrowserRouter
- 路由表（所有页面先用占位组件）：
  - `/` → `DashboardPlaceholder`
  - `/login` → `LoginPage`（Sprint 1 真实实现）
  - `/:serverId/console` → `Placeholder`
  - `/:serverId/mods` → `Placeholder`
  - `/:serverId/players` → `Placeholder`
  - `/:serverId/config/commands` → `Placeholder`
  - `/:serverId/files` → `Placeholder`
  - `/:serverId/server-setup` → `Placeholder`
  - `/settings` → `Placeholder`

### Task 4.3: Sidebar 组件 (`components/layout/Sidebar.tsx`)

- 对应 Figma 组件 `5:29`
- 260px 宽，`bg-slate-950`
- NavItem 列表（图标 + 文字）：
  - Dashboard (LayoutDashboard) / Console (Terminal) / Mods (Package) / Players (Users) / Config (Settings) / Files (FolderOpen) / Server Setup (Server) / Settings (Sliders)
- active 态：emerald-500 高亮 + 左侧 3px 指示条
- 底部：登出按钮

### Task 4.4: AuthProvider + LoginPage

- `AuthContext`：access token 存在内存（闭包变量），refresh 通过 httpOnly cookie 自动
- `LoginPage`：用户名 + 密码表单 → POST /api/auth/login → 存储 token → 跳转 `/`
- axios 拦截器：请求注入 `Authorization: Bearer`，401 自动调 refresh

### Task 4.5: WebSocketProvider

- `WebSocketContext`：管理 ws 连接生命周期
- 连接 URL：`wss://<host>/ws?token=<JWT>`
- 断线重连：指数退避 1s→2s→4s→8s→封顶 30s
- 按 `serverId` 多路复用事件

### Task 4.6: shadcn 组件安装

按 `design-system-mapping.md` §4.1 映射，安装以下 shadcn 组件：

```
button · card · badge · input · select · switch · checkbox
alert-dialog · dialog · toast · table · tabs · separator
```

### Task 4.7: 通用布局组件

- `TopBar`：64px 高，显示当前页面标题 + ServerID 切换器
- `StatCard`（`$5:34`）：Card 包装，图标 + 数值 + 标签
- `ConfirmDialog`（`$12:16436`）：AlertDialog 封装

### Phase 4 质量门

| 检查项 | 命令 | 标准 |
|---|---|---|
| 启动成功 | `cd frontend && npm run dev` | Vite 启动，浏览器能打开 |
| 路由 | 逐个访问 8 个路由 | 无 404，Sidebar 始终渲染 |
| 登录 | 访问任意页面 → 重定向 `/login` → 输入凭据 → 跳回原页面 | JWT 存储正确 |
| shadcn 主题 | 目视检查 | slate 深色 + emerald-500 + Inter 字体 |
| 响应式 | 缩小浏览器窗口 | Sidebar 折叠为图标（或 hamburger） |
| 无 `any` | `grep -r ": any" manager-web/src/` | 零匹配 |
| ts 编译 | `tsc --noEmit` | 零错误 |

---

## Phase 5: 质量基础设施

**目标**：lint、format、typecheck、test 全部可运行并通过空壳代码。

**依赖**：Phase 3, Phase 4

### Task 5.1: ESLint + Prettier

- 根目录 `.eslintrc.json`：TypeScript 规则，no-any error，no-unused-vars warn
- `.prettierrc`：统一格式配置
- `package.json` scripts：`lint` / `format` / `format:check`

### Task 5.2: 前端 Vitest 配置

- `vitest.config.ts`
- 写 2 个示例测试：
  - `Sidebar.test.tsx`：渲染 8 个 NavItem
  - `LoginPage.test.tsx`：表单提交流程

### Task 5.3: 后端 Vitest 配置

- `vitest.config.ts`
- 写 2 个示例测试：
  - `health.test.ts`：GET /api/health → 200
  - `auth.test.ts`：无效凭据 → 401

### Task 5.4: Playwright E2E 配置

- `playwright.config.ts`
- 写 1 个冒烟测试：
  - 访问 `/login` → 输入凭据 → 跳转 `/` → 看到 Dashboard 占位文字

### Phase 5 质量门

| 检查项 | 命令 | 标准 |
|---|---|---|
| Lint | `npm run lint`（根目录，检查全部） | 零错误，零警告 |
| Format | `npm run format:check` | 零不符合 |
| 前端测试 | `cd frontend && npx vitest run` | 2 个示例测试通过 |
| 后端测试 | `cd backend && npx vitest run` | 2 个示例测试通过 |
| E2E | `npx playwright test` | 1 个冒烟测试通过 |
| Typecheck（全仓） | 根目录 `tsc --noEmit` | 零错误 |

---

## Phase 6: 集成验证

**目标**：前端连后端全链路通过，确认脚手架可作为 Sprint 2 的起点。

**依赖**：Phase 0–5 全部

### Task 6.1: 前后端联调

- 启动后端（`tsx manager-server/src/index.ts`）
- 启动前端 dev server（`npm run dev`）
- 浏览器访问 → 登录 → 跳转 Dashboard → 看到 Sidebar + 占位内容
- 浏览器 DevTools → Network 标签 → 确认 `/api/health` 和 `/api/servers` 正常返回

### Task 6.2: Sprint 1 完成检查清单

对照 CLAUDE.md §5.4（每个功能 PR 必须带的 5 件套）：

| 检查项 | Sprint 1 状态 |
|---|---|
| OpenAPI 片段 | 暂不需要（Sprint 1 无持久化 API） |
| 数据库迁移脚本 | ✅ `001-initial-schema.sql` |
| RCON 录制回放测试 | 暂不需要（Sprint 2 才引入 RCON） |
| Storybook | 暂不需要（Sprint 2+ 按需引入） |
| 参考文档更新 | ✅ CLAUDE.md 技术栈统一 |

### Task 6.3: 生成 Sprint 1 关闭报告模板

---

## 依赖关系图

```
Phase 0 ──┬── Phase 1 ──┬── Phase 2 ──┬── Phase 3 ──┬── Phase 5 ──┬── Phase 6
           │             │             │             │             │
           │             │             └── Phase 4 ──┘             │
           │             │             (与 2,3 并行)              │
           │             │                                        │
           └── 独立于后续所有 ──────────────────────────────────────┘
```

### 可并行化的 Task 组

| 并行组 | Tasks | 条件 |
|---|---|---|
| A | Phase 2 + Phase 4 | Phase 1 完成后立即开始，互不依赖 |
| B | Phase 3 内部的 stub 实现 | 所有 stub 实现彼此独立，可并行创建 |
| C | Phase 5 前后端测试 | 前端 vitest 和后端 vitest 互不依赖 |

---

## 预估工时

| Phase | 内容 | 预估 |
|---|---|---|
| Phase 0 | 仓库初始化 | 0.5h |
| Phase 1 | shared/ 类型 + 接口 | 2h |
| Phase 2 | 数据库 + 迁移 | 1.5h |
| Phase 3 | 后端骨架（含 AuthService 真实实现） | 3h |
| Phase 4 | 前端骨架（含 LoginPage + Sidebar） | 3h |
| Phase 5 | 质量基础设施 | 1h |
| Phase 6 | 集成验证 | 0.5h |
| **合计** | | **~11.5h** |

---

> **本文档是工作流计划，不是代码。** 下一步：用 `/sc:implement` 按 Phase 顺序执行。
> 每个 Phase 内的 Task 应独立 PR 提交，PR 标题前缀 `feat(scaffold):`。
> Sprint 1 完成标志：`Phase 6 全部检查项通过` → 合并到 main → 进入 Sprint 2。
