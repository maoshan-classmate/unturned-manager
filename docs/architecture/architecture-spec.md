# unturned-manager 架构规格

> **文档类型**：架构规格（C4 模型，现状记录）
> **产出日期**：2026-08-11
> **适用范围**：后端模块实现、前端页面实现、跨层契约变更的基准
> **读取顺序**：`CLAUDE.md` → 本文档 → `design-system-mapping.md` → `claudedocs/reference_*.md`

---

## 0. 阅读指南

本文档用 **C4 模型**组织，从系统整体逐层下沉到组件与契约：

| 层级 | 章节 | 回答的问题 |
|---|---|---|
| Level 1 系统上下文 | §1 | 系统边界在哪？和哪些外部系统交互？ |
| Level 2 容器 | §2 | 系统由哪些可部署单元组成？用什么技术栈？ |
| Level 3a 后端组件 | §3 | 后端有哪些模块？各自职责与依赖？ |
| Level 3b 前端组件 | §4 | 前端有哪些页面、组件、hooks？ |
| 模块接口契约 | §5 | 各接口的方法签名与数据形状？ |
| 关键数据流 | §6 | 启动、Mod 流水线、日志、命令怎么走？ |
| 数据库 | §7 | 持久化了什么？真源在哪？ |
| 安全 | §8 | 认证、凭证、校验、命令鉴权怎么守？ |
| 横切关注点 | §9 | 日志、错误、DI、测试的全局约定 |

**真源原则**：本文档是架构层的权威来源之一（与 `design-system-mapping.md` 并列）。架构变更必须先改本文档、再改代码。文档描述的是 **当前系统的事实状态**——以代码、契约文件、ADR 为对照基准。

---

## 1. 系统上下文（Level 1）

### 1.1 系统图

```
  ┌─────────────┐        ┌──────────────────────────────────────┐
  │  浏览器用户   │  HTTP  │            unturned-manager           │
  │  (owner)    │◄──────►│             Web 管理面板              │
  └─────────────┘   WS   └───────┬──────────┬──────────┬─────────┘
                                 │          │          │
                    持久 PTY bash │  子进程    │  HTTPS   │  文件系统
                    (node-pty)   │  (spawn)  │          │  (共享卷)
                                 ▼          ▼          ▼
                       ┌──────────────┐ ┌─────────┐ ┌─────────────────────┐
                       │ U3DS 服务端   │ │ SteamCMD│ │ U3DS 安装目录        │
                       │ AppID 1110390│ │         │ │ + Servers/<ServerID>/│
                       └──────────────┘ └─────────┘ └─────────────────────┘
```

**关键交互线**：

- **U3DS 服务端** ⇄ 面板：**持久 PTY bash 双向链路**（`node-pty` + WS `terminal_input` 入站 / `console_line` 出站）。每个运行中的实例对应一个永驻 bash PTY 进程；bash 是 U3DS 的父进程，U3DS 崩溃时 bash 回提示符、终端仍可交互。
- **SteamCMD** ⇄ 面板：子进程 spawn（`ProcessSupervisor`），所有长任务（安装 / 更新 / 下载 / 检查 / 重装）异步启动，返回 jobId，进度经 WS `steamcmd_progress` 推送。
- **Steam WebAPI** ⇄ 面板：HTTPS 实时查询创意工坊元数据（`IPublishedFileService`），需要用户配置的 WebAPI Key。
- **共享卷文件系统** ⇄ 面板：`config.installDir`（全局 U3DS 安装根目录，默认 `/opt/unturned`）下的 `Servers/<ServerID>/` 目录树是实例身份与配置的真源。

> **AppID 唯一真源**：`U3DS_SERVER=1110390` / `UNTURNED_GAME=304930` 定义在 `shared/constants.ts`（`STEAM_APP_IDS`），
> 前后端统一 `import { STEAM_APP_IDS } from "@unturned-manager/shared"`。禁止在模块内手写 appid 字面量。

### 1.2 外部系统表

| 外部系统 | 交互方式 | 交互内容 |
|---|---|---|
| **U3DS 服务端**（Unturned 专用服务端，AppID `1110390` = `STEAM_APP_IDS.U3DS_SERVER`） | 持久 PTY bash（`node-pty`，cwd = installDir） | 启动（1s 后写入 `startCommand`）、停止（PTY 写 `Save` + `Shutdown 30` + ctrl+c）、命令执行（WS `terminal_input` 直达 stdin）、控制台输出（PTY stdout 经 `console_line` 推送）。U3DS 是 TTY-only 进程，PTY 模拟让它的 ANSI 色彩/进度条正常输出 |
| **SteamCMD** | 子进程 spawn（`ProcessSupervisor`） | 安装 U3DS（`+app_update 1110390`）、更新二进制、下载创意工坊内容到 staging（`+workshop_download_item 304930`——Workshop 归属游戏本体，非服务端工具）、检查更新、重装 SteamCMD。所有操作异步启动 + jobId 关联 |
| **Steam WebAPI** | HTTPS（`fetch`，直连不走代理） | 创意工坊搜索/详情/批量元数据（`QueryFiles` + `GetDetails`，appid=`304930` = 游戏本体） |
| **共享卷文件系统** | 直接读写（`fs`） | `Servers/<ServerID>/` 目录树、`Workshop/steamapps/workshop/content/304930/` 已装 Mod、`Workshop/staging/` 下载暂存、`Logs/*.log` 日志 |
| **浏览器用户**（owner） | HTTP + WebSocket | 面板页面、实例启停、终端交互、配置编辑、Mod 管理 |

### 1.3 命令通道：PTY 终端 owner-trust 模型

面板与 U3DS 之间的**唯一命令通道**是持久 PTY 终端：

- 入站：前端 `Terminal`（xterm.js）的键盘输入经 WS `terminal_input` 事件 → 后端 `PtyManager.write(serverId, data)` → PTY stdin，原样透传不做命令解析。
- 出站：PTY stdout（按行切分）经 WS `console_line` 事件推给前端，xterm.js 原生渲染 ANSI 转义序列。
- **owner-trust**：WS 连接建立时 `verifyClient` 校验 access token（JWT 有效即视为 owner 本人在用终端），此后终端内的任意命令直接放行。危险指令（如 `Shutdown`、`Ban`）的二次确认由**前端** `ConfirmDialog` 拦截，后端不做命令级鉴权。

### 1.4 文件写入生命周期门控

面板写 U3DS 相关文件时，按「运行时读取 vs 启动时读取」区分停服要求：

| 文件 | 面板操作 | 停服要求 | 说明 |
|---|---|---|---|
| `WorkshopDownloadConfig.json` 的 `File_IDs` | apply 流水线内原子写（带备份） | **是** | 写完后走「Mod 变更 + 重启流水线」（§6.2），重启后服务端读取生效 |
| `Workshop/staging/`（SteamCMD 下载落点） | `steamcmd download-workshop` | **否** | U3DS 只加载 `content/304930/`，不扫描 staging；下载可不停服 |
| `Workshop/steamapps/workshop/content/304930/`（已装 Mod） | apply 流水线移动 staging 内容 | **是** | 写入运行中服务端直接读取的位置有覆盖风险；进程停后方可移动 |
| `Commands.dat` / `Config.txt` | 配置页编辑 | 面板不主动停服 | U3DS 启动时读取；编辑后由用户自行决定何时重启生效 |
| U3DS 二进制 / `validate` | SteamCMD 更新 | **是** | 覆盖正在运行的二进制有风险 |

---

## 2. 容器图（Level 2）

### 2.1 容器图

```
                 ┌───────────────────────────────────────────────┐
                 │                  unturned-manager              │
                 │  ┌───────────────────┐   ┌───────────────────┐ │
   HTTPS/WS      │  │   Panel Web       │   │   Panel Server    │ │
   ─────────────►│  │   (React SPA)     │◄──►│ (Node.js + Express)│ │
   浏览器用户      │  │   :5173 (dev)    │HTTP│   :3001           │ │
                 │  └───────────────────┘ WS └─────────┬─────────┘ │
                 │                                     │ node-pty   │
                 │                                     ▼            │
                 │                           U3DS PTY bash 进程      │
                 └───────────────────────────────────────────────┘
                      │                        │              │
                 Steam WebAPI             SteamCMD        共享卷文件系统
```

- **Panel Web**：React 18 单页应用，Vite 构建。开发模式由 Vite dev server 托管，`/api` 与 `/ws` 代理到 Panel Server；生产模式由 Panel Server 静态托管构建产物。
- **Panel Server**：Node.js 20 + Express 4，承载 REST API、WebSocket 网关、PTY 进程管理、SQLite 持久化。HTTP 长任务统一 202 异步语义（返回 jobId / terminalSessionId）。
- **共享契约层**：`shared/` 包（TypeScript）承载前后端共用的 branded types、领域类型、Zod schema、接口契约与 OpenAPI 派生。

### 2.2 技术栈

| 层 | 技术 |
|---|---|
| 前端框架 | React 18 + TypeScript + Vite |
| 前端 UI | Tailwind CSS 4 + shadcn/ui（基于 `@base-ui/react`）+ Motion（framer-motion v13） |
| 前端组件/图表 | `@tanstack/react-table`（DataTable）、recharts（Dashboard 图表）、lucide-react（图标） |
| 前端表单 | react-hook-form + zod（zod schema 放页面同级 `xxxSchema.ts`） |
| 前端终端 | xterm.js（`console/Terminal.tsx`） |
| 后端框架 | Node.js 20 + Express 4 + TypeScript |
| 进程/终端 | `node-pty`（PTY 模拟）+ `ws`（WebSocket 双向） |
| 数据库 | better-sqlite3（同步 API）+ `user_version` PRAGMA 迁移 |
| 配置解析 | 面板自有行解析（Commands.dat / Config.txt / WorkshopDownloadConfig.json） |
| 认证/安全 | argon2（Argon2id）、jsonwebtoken、helmet、cors |
| 日志 | pino（结构化 JSON） |
| 契约 | zod + zod-openapi——`shared/schemas/` 定义 Zod schema，派生 TS 类型 + OpenAPI 3.0 |
| 测试 | Vitest（后端单元 + supertest API）、Vitest（前端）+ Playwright（e2e） |

---

## 3. 后端组件图（Level 3a）

### 3.1 分层

```
┌──────────────────────── API 层 ────────────────────────┐
│  routes/ (工厂函数)  │  middleware/  │  ws/gateway.ts   │
│  createAuthRouter    │  auth /       │  WsBroadcaster   │
│  createServersRouter │  validate /   │  (IBroadcaster)  │
│  createModsRouter    │  asyncHandler │                  │
│  createModBrowseRouter│  errorHandler │                  │
│  createConfigRouter  │  noCache      │                  │
│  createFilesRouter   │               │                  │
│  createSteamCmdRouter│               │                  │
│  createWorkshopRouter│               │                  │
│  createSettingsRouter│               │                  │
└───────────────────────────┬────────────────────────────┘
                            │ constructor 注入
┌─────────────────────── 核心域层 ────────────────────────┐
│  ServerManager（聚合根）                                 │
│  ConfigService │ FilesService │ AuthService │ LogStreamer│
│  SteamCmdManager │ WorkshopMetadataService             │
│  WorkshopAcfService │ WorkshopApplyService │ WorkshopDeleteService │
│  ServerDiscovery │ VdfParser │ pathResolver │ startScript│
│  settingsStorage │（辅助）                                 │
└───────────────────────────┬────────────────────────────┘
                            │ constructor 注入
┌─────────────────────── 基础设施层 ──────────────────────┐
│  PtyManager（node-pty，TTY 模拟）                        │
│  ProcessSupervisor（非 PTY 子进程，服务 SteamCMD）         │
│  FileLockProvider（配置文件并发锁）                        │
│  db/（connection / migrate / seed）│ utils/（logger、AppError、cryptoBox） │
└────────────────────────────────────────────────────────┘
```

### 3.2 模块表

> 每个模块是 `class`，实现 `shared/contracts/` 中对应的 `I*` 接口；依赖全部经 `composition-root.ts` 手动构造注入。有状态模块实现 `destroy()`。

| 模块 | 职责 | 依赖 | destroy |
|---|---|---|---|
| **ServerManager** | 聚合根。实例生命周期（start/stop/restart/forceStop）、4 态状态机、Mod 应用流水线、目录扫描加载、startCommand 持久化 | ServerDiscovery、PtyManager、ConfigService、IBroadcaster、WorkshopApplyService（可选）、DB | 无（PTY 由 PtyManager 统一 destroy） |
| **PtyManager** | PTY 进程生命周期管理（node-pty 封装）。spawn 永驻 bash、write 透传 stdin、resize、kill/forceKill、onData（按行切分）、onExit、waitExit | node-pty | ✅ destroy 全部 PTY 进程 |
| **ProcessSupervisor** | 非 PTY 子进程管理——服务 SteamCMD（execFile/进程）。spawn、gracefulShutdown、waitForExit（返回退出码）、forceKill、onStdout、onCrash | child_process | ✅ |
| **FileLockProvider** | 配置文件并发写锁（acquire/release/isLocked），配合乐观锁 mtime | — | — |
| **ConfigService** | `Commands.dat` / `Config.txt` / `WorkshopDownloadConfig.json` 配置读写。乐观锁（expectedMtime）+ 备份 + 回滚 | FileLockProvider | — |
| **FilesService** | 服务器文件浏览/读写/删除/重命名/建目录/权限/上传流（`IFilesService`），路径白名单防穿越 | FileLockProvider | — |
| **AuthService** | JWT 认证：login/refresh/logout/changePassword/validateAccessToken。密码 Argon2id，refresh token 轮换 | DB | — |
| **SteamCmdManager** | SteamCMD 长任务：install U3DS / update U3DS / downloadWorkshopItem（staging）/ checkUpdate / reinstall / setInstallPath。全异步返回 jobId | ProcessSupervisor、IBroadcaster、activeProbe（延迟绑定 → ServerManager） | — |
| **WorkshopMetadataService** | Steam WebAPI 元数据：getModDetails / browseMods / batchGetDetails。**0 缓存**，每次实时查 WebAPI | DB（读 WebAPI Key） | — |
| **WorkshopAcfService** | acf 真源维护：parse / write / listItems / listStagingItems / addItem / removeItem / backup / rollback。每次实时读盘解析 | ConfigService | — |
| **WorkshopApplyService** | apply 流水线：staging acf → content acf 合并 + `mv` staging 内容 → 同步 File_IDs，任一失败全回滚 | WorkshopAcfService、ConfigService、IBroadcaster | — |
| **WorkshopDeleteService** | Mod 删除：acf 删项 + content 目录删 + File_IDs 同步 | WorkshopAcfService、ConfigService | — |
| **LogStreamer** | 日志文件 tail（`Servers/<ID>/Logs/*.log`，500ms 轮询）+ 凭证脱敏 + 速率限制（100 行/秒）→ `console_line` 广播 | IBroadcaster、ProcessSupervisor | — |
| **ServerDiscovery**（辅助） | 目录扫描真源：扫 `installDir/Servers/`，`Commands.dat` 存在性 = 实例成立。纯同步 | fs | — |
| **VdfParser**（辅助） | VDF 文件解析（acf） | — | — |
| **settingsStorage**（辅助） | settings K-V 读写（AES-256-GCM 加密 + startCommand 明文），供 ServerManager / AuthService / 路由内部使用 | DB、cryptoBox | — |
| **SessionManager** | 终端会话持久化（ADR-0005 Phase 7.1）：单 JSON 文件 + mutationQueue 串行 + 临时文件 rename 原子写 + 7 天过期清理 + touchActivity 节流刷新。面板重启后保留已开过的终端列表 | DB（不依赖）、pino logger、fs、config.dataDir（被 ServerManager 调用：PTY spawn/exit 时调 saveSession / setSessionActive） | — |

### 3.3 路由层

所有路由是工厂函数 `createXxxRouter(deps): Router`，统一 `{ data }` / `{ error }` 响应，`authenticateToken` 保护业务端点，`validate(schema)` 做 zod 输入校验，`asyncHandler` 消除 try/catch。挂载见 §5.10。

### 3.4 WebSocket 网关（WsBroadcaster）

- `verifyClient` 校验 `?token=<access_token>`；无 token / 无效 → 401 拒绝。
- 建连后客户端 **5 秒内必须发 `subscribe`**，否则关闭（code 1008）。
- 订阅模型：`serverIds` + `eventTypes` 双过滤；`serverIds: []` + `eventTypes: null` = 接收全部。
- 入站消息仅两类：`subscribe`、`terminal_input`（写入对应 PTY stdin）。
- 心跳保活：每 30s ping，未回 pong 的死连接 terminate。
- `broadcast` 按订阅过滤路由到对应 WS 连接。

---

## 4. 前端组件图（Level 3b）

### 4.1 路由树

`App.tsx`（BrowserRouter；未认证 → LoginPage；认证后套 AppLayout = Sidebar + main）：

```
/login                          → LoginPage（未认证时的唯一入口）
/                               → DashboardPage（实例列表 + 统计）
/:serverId/console              → ConsolePage（xterm.js 终端）
/:serverId/mods                 → ModsPage（创意工坊浏览 + 已下载管理）
/:serverId/config/commands      → ConfigPage（Commands.dat / Config.txt / Workshop Tab）
/:serverId/files                → FilesPage（文件浏览器）
/:serverId/server-setup         → ServerSetupPage（安装引导 + 实例控制 + 计划任务）
/:serverId/settings             → SettingsPage（WebAPI Key / 改密）
```

### 4.2 组件分层

```
components/
├── layout/       Sidebar（全局导航）
├── shared/       跨页复用业务组件：PageState / DataTable / SearchInput / ConfirmDialog /
│                 Dialog / Dropdown / TabBar / Card / ConfigField / ConfigSection /
│                 ConfigToggle / PaginationBar / PasswordInput
├── ui/           shadcn/ui 原生包装：button / input / card / label / select / switch / alert / sonner
├── console/      Terminal（xterm.js 终端渲染 + 键盘输入 → WS terminal_input）
├── mods/         ModCard / ModCardSkeleton / ModDetailDialog
├── server-setup/ U3dsCard / SteamCmdCard / ServerControlCard / CreateServerDialog /
│                 LaunchCommandsDialog / ScheduledTaskDialog / ScheduledTasksCard / SteamCmdPathDialog
├── stats/        StatCard
└── pages/        LoginPage / DashboardPage / ConsolePage / ModsPage / ConfigPage /
                  FilesPage / ServerSetupPage / SettingsPage（+ loginSchema.ts）
```

**铁律**：同一 JSX 模式 ≥3 次提取到 `shared/`；页面必须用 `<PageState>` 包裹；表单必须 react-hook-form + zod；样式走 Tailwind class，禁止手写 hex 色值。

### 4.3 Hooks 与 Context

| Hook / Context | 职责 |
|---|---|
| `useServer()` | 实例列表。挂载拉一次 + 手动 refresh（不轮询）；订阅 WS `state_change` 实时更新单个实例状态；addServer/removeServer/updateServer 走真实 API |
| `useServerActions()` | 实例 start / stop / restart，错误抛后端中文 message |
| `useConsole(serverId)` | 控制台输出缓冲（最多 500 行）+ 命令发送（WS `terminal_input`，拼 `\r`）+ `sendTerminalInput`（xterm 原始输入）+ 退避重连 |
| `useConsoleHistory()` | 命令历史（↑↓ 翻页） |
| `useSteamCmdProgress({ jobId })` | SteamCMD 进度订阅（独立 WS + jobId 过滤 + 退避重连） |
| `AuthContext` | JWT 会话：登录/恢复/注销，`useAuth()` null-guard |
| `WebSocketContext` | WS 事件总线：`subscribe(listener) => unsubscribe`；挂载即建连，5s 内发 subscribe；WS 401 退避重连 |

---

## 5. 模块接口契约

> 契约定义在 `shared/contracts/`（接口）与 `shared/types/`（类型），前后端共用。以下为摘要——精确签名以源码为准。

### 5.1 领域类型

**Branded types**（`shared/types/branded.ts`）：`ServerId`、`SteamId64`、`WorkshopFileId`、`Port`——编译期类型安全，运行时是原始 string/number。

**ServerConfig**（`shared/types/domain.ts`）：

```typescript
interface ServerConfig {
  id: ServerId;              // ServerID，对应 Servers/<ServerID> 目录名
  name: string;
  gamePort: Port;            // 游戏监听端口
  ownerSteamId: SteamId64;   // 服主 SteamID64
  installDir: string;        // 全局 U3DS 安装根目录
  startCommand?: string;     // U3DS 启动命令；留空 = 探测生成默认模板
}
```

**配置解析结果**：`CommandsDatRecord`（`known` / `unknown` / `comments`——保留未知键）、`ConfigTxtRecord`（`sections: Record<string, ConfigSection>`）、`WorkshopConfig`（`File_IDs` / `Should_Monitor_Updates` / 计时器字段）。

**Workshop 类型**：`WorkshopModMeta`（含 `authorName`、`voteScore`）、`WorkshopAcf` / `WorkshopAcfItem`（`fileId` / `timeupdated` / `size` / `manifest`）。

### 5.2 状态机（`shared/types/state.ts`）

```typescript
enum ServerState {
  STOPPED = "STOPPED",
  STARTING = "STARTING",
  RUNNING = "RUNNING",
  STOPPING = "STOPPING",
}

type ActiveOperation =
  | { type: "none" }
  | { type: "manual_start"; startedAt: string }
  | { type: "manual_restart"; startedAt: string }
  | { type: "manual_stop"; startedAt: string }
  | { type: "mod_apply"; startedAt: string; modIds: string[] }
  | { type: "steamcmd_update"; startedAt: string }
  | { type: "initial_setup"; startedAt: string };
```

- **转换**：`STOPPED → STARTING → RUNNING → STOPPING → STOPPED`。
- **决定性状态由 PTY 进程存活驱动**：bash 活 = STARTING / RUNNING / STOPPING；bash 死 = STOPPED。无中间模糊态。
- **`activeOperation` 竞态门控**：非 `none` 时，start/stop/restart/applyModChanges 返回 409，防「自动重启 + 手动重启」并发。
- `steamcmd_update` / `initial_setup` 变体为保留分支（当前无写入点）。

### 5.3 IServerManager（`shared/contracts/server.ts`）

```typescript
interface IServerManager {
  getState(serverId: ServerId): ServerState;
  getActiveOperation(serverId: ServerId): ActiveOperation;
  listServers(): Promise<ServerConfig[]>;
  listServersSync(): string[];
  listActiveServerIds(): ServerId[];   // 状态非 STOPPED 的实例

  createServer(config: ServerConfig): Promise<void>;
  configureServer(serverId: ServerId, patch: Partial<ServerConfig>): Promise<void>;
  removeServer(serverId: ServerId): Promise<void>;

  start(serverId: ServerId): Promise<{ terminalSessionId: string; pid: number }>;
  stop(serverId: ServerId, reason: string): Promise<void>;
  restart(serverId: ServerId, reason: string): Promise<void>;
  forceStop(serverId: ServerId): Promise<void>;

  applyModChanges(serverId: ServerId, modIds: WorkshopFileId[]): Promise<void>;
  updateServerBinaries(installDir: string): Promise<void>;
}
```

### 5.4 IConfigService（`shared/contracts/config.ts`）

- `readCommandsDat` / `writeCommandsDat(serverId, config, expectedMtime?)`——乐观锁：mtime 不一致抛 `config_conflict`。
- `readConfigTxt` / `writeConfigTxt`；`readWorkshopConfig` / `writeWorkshopFileIds`（面板只写 File_IDs）。
- `backup(serverId, filePath): Promise<string>` / `rollback(serverId, filePath, backupPath)`。

### 5.5 IPtyManager（`shared/contracts/pty.ts`）

```typescript
type PtyKey = ServerId | string;   // ServerId（实例）或 jobId（SteamCMD 长任务）

interface IPtyManager {
  spawn(serverId: PtyKey, file: string, args: string[], options?): Promise<number>;  // → PID
  write(serverId: PtyKey, data: string): void;   // 同步，原样写入 stdin，不自动加 \r
  resize(serverId: PtyKey, cols: number, rows: number): void;
  kill(serverId: PtyKey): Promise<void>;         // SIGTERM → 等 5s → SIGKILL 兜底
  forceKill(serverId: PtyKey): void;             // SIGKILL 立即
  isRunning(serverId: PtyKey): boolean;
  onData(serverId: PtyKey, cb: (line: string) => void): void;   // 单行回调（内部按 \n 切分）
  onExit(serverId: PtyKey, cb: ({ exitCode, signal }) => void): void;
  waitExit(serverId: PtyKey, timeoutMs: number): Promise<boolean>;
  destroy(): Promise<void>;
}
```

### 5.6 IProcessSupervisor（`shared/contracts/process.ts`）

- `spawn(key: ServerId | string, command, args, cwd?): Promise<number>`——非 PTY 子进程。
- `gracefulShutdown(key, timeoutMs?)`、`waitForExit(key, timeoutMs): Promise<number | null>`（返回退出码，null = 无进程）、`forceKill`、`isRunning`、`onStdout`、`onCrash`、`destroy`。

### 5.7 IBroadcaster 与事件（`shared/contracts/broadcast.ts`）

```typescript
type ServerEvent =
  | { type: "state_change"; serverId; from: ServerState; to: ServerState }
  | { type: "console_line"; serverId; line: string; source: "stdout" | "file" }
  | { type: "player_join"; serverId; playerName: string; steamId: SteamId64 }
  | { type: "player_leave"; serverId; playerName: string; steamId: SteamId64 }
  | { type: "mod_apply_progress"; serverId; stage: string; remainingSeconds?: number }
  | { type: "file_changed"; serverId; path: string }
  | { type: "steamcmd_progress"; stage: string; percent?: number; jobId?: string; latestVersion?: string };

interface IBroadcaster {
  broadcast(event: ServerEvent): void;
  register(ws, serverIds): void;
  unregister(ws): void;
  destroy(): Promise<void>;
}
```

> `player_join` / `player_leave` / `file_changed` 为契约中的保留变体（当前无广播点）。另两类消息 `subscribed`（建连确认回执）与 `error`（消息错误 / PTY 不可用）由 ws 网关运行时发出，未纳入上述类型 union。

### 5.8 WS 客户端消息（`shared/contracts/ws.ts`）

```typescript
type ClientWsMessage =
  | { type: "subscribe"; serverIds: ServerId[]; eventTypes: string[] | null }
  | { type: "terminal_input"; serverId: ServerId; data: string };  // xterm 原始输入 → PTY stdin
```

### 5.9 其他接口

| 接口 | 要点 |
|---|---|
| `IServerDiscovery` | `scanSync(installDir): DiscoveredServer[]`——目录扫描真源，纯同步 |
| `IAuthService` | `login` / `refresh` / `logout(refreshJti)` / `validateAccessToken` / `changePassword(userId, current, new)` |
| `ISteamCmdManager` | `getStatus` / `setInstallPath` / `installU3DS(dir): Promise<jobId>` / `updateU3DS(dir): Promise<jobId>` / `downloadWorkshopItem(dir, ids, serverId?): Promise<jobId>` / `checkUpdate(dir?): Promise<jobId>` / `reinstall(dir?): Promise<jobId>` |
| `IWorkshopMetadataService` | `getModDetails(id): Promise<WorkshopModMeta \| null>` / `browseMods(query, sort, range, type, page, pageSize): Promise<BrowseResult>` / `batchGetDetails(ids)`——0 缓存，实时查 WebAPI |
| `IWorkshopAcfService` | `parse` / `write` / `listItems` / `listStagingItems` / `parseStagingItem` / `addItem` / `removeItem` / `backup` / `rollback` |
| `IWorkshopApplyService` | `applyStaged(serverId)`——staging → content 移动 + acf 合并 + File_IDs 同步，失败全回滚 |
| `IWorkshopDeleteService` | `deleteMod(serverId, fileId): Promise<ModDeleteResult>`——acf + content + File_IDs 三处同步 |
| `IFilesService` | `listDirectory` / `readFile` / `writeFile` / `deleteEntry` / `createDirectory` / `renameEntry` / `getPermissions` / `createUploadStream` |
| `IFileLockProvider` | `acquire(path, owner, timeoutMs?)` / `release` / `isLocked` |
| `ILogStreamer` | `startStreaming(serverId)` / `stopStreaming(serverId)` |

**Mod 枚举**：`ModSort`（popular / rated / published / updated / subscribed / relevance）、`ModTimeRange`（day / week / month / months3 / months6 / year / all）、`ModSearchType`（text / id）。

### 5.10 REST 端点表

> 统一 `{ data }` 成功 / `{ error: { code, message } }` 失败。长任务端点（SteamCMD、实例启停）返回 **202** + jobId / terminalSessionId。

| 前缀 | 端点 | 语义 |
|---|---|---|
| `/api/auth` | `POST /login` | 登录 → `{ accessToken, refreshToken }` |
| | `POST /refresh` | refresh token 换新对 |
| | `POST /logout` | 注销（jti 入黑名单） |
| | `POST /change-password` | 修改密码（authenticateToken 保护） |
| `/api/servers` | `GET /` | 实例列表（目录扫描真源） |
| | `POST /` | 创建实例（写 Commands.dat 即成立） |
| | `PATCH /:id` | 更新配置（startCommand → settings K-V；身份字段 → Commands.dat） |
| | `DELETE /:id` | 删除实例（先 stop → 删目录 → 删 startCommand K-V） |
| | `POST /:id/start` | **202** `{ terminalSessionId, pid }` |
| | `POST /:id/stop` | **202**（PTY Save + Shutdown + ctrl+c） |
| | `POST /:id/restart` | **202** |
| `/api/servers/:id/mods` | `GET /downloaded` | 已下载列表（主 acf + staging acf 合并 + `applied` 状态） |
| | `POST /download` | **202** `{ jobId }` 下载到 staging |
| | `POST /apply` | **202** `{ operationId }` 应用 + 重启流水线 |
| | `DELETE /:fileId` | 删除 Mod（U3DS 须 STOPPED） |
| | `GET /acf` | acf 真源列表 |
| `/api/mods` | `GET /search` | 创意工坊浏览/搜索（QueryFiles + GetDetails） |
| | `GET /:fileId` | 单个 Mod 详情 |
| | `POST /batch-details` | 批量补元数据 |
| `/api/servers/:id/config` | `GET/PUT /commands` | Commands.dat（乐观锁 expectedMtime） |
| | `GET/PUT /txt` | Config.txt |
| | `GET/PUT /workshop` | WorkshopDownloadConfig.json（PUT 只写 File_IDs） |
| `/api/servers/:id`（files） | `GET /` `GET /content` `POST /upload` `POST /files/raw` `GET /files/raw` `POST /mkdir` `DELETE /` `PUT /rename` | 文件浏览/读写/二进制上传下载/建目录/删除/重命名 |
| `/api/steamcmd` | `GET /status` | SteamCMD 状态 |
| | `POST /install-u3ds` | **202** `{ jobId }` 安装 U3DS |
| | `POST /update` | **202** `{ jobId }` 更新 U3DS 二进制 |
| | `POST /download-workshop` | **202** `{ jobId }` 下载 Workshop 到 staging |
| | `POST /check-update` | **202** `{ jobId }` 检查更新（结果经 WS 推 latestVersion） |
| | `POST /reinstall` | **202** `{ jobId }` 重装 SteamCMD |
| | `PATCH /install-path` | 设置 SteamCMD 安装路径（内存态） |
| `/api/workshop` | `GET /mods/:fileId` `GET /browse` | 旧版浏览端点（兼容） |
| `/api/settings` | `POST /webapi-key` `GET /webapi-key` `DELETE /webapi-key` | WebAPI Key 加密存取 |
| `/api/sessions` | `GET /` | 终端会话列表（ADR-0005 Phase 7）：返回 `{ active: 活跃会话, saved: 已断开会话 }`，前端 ConsolePage 用 saved 渲染「历史终端」按钮组（点击 toast「这个终端已经断开，点启动重新打开」） |
| `/api/health` | `GET /` | 健康检查（无需认证） |

---

## 6. 关键数据流

### 6.1 启动序列

```
POST /api/servers/:id/start
        │
        ▼
ServerManager.start(id)
        │
        ├─ activeOperation === 'none'（否则 409）
        ├─ 已在 RUNNING/STARTING → 幂等返回已有会话
        │
        ├─ activeOperation = {type:'manual_start'}
        ├─ state → STARTING（广播 state_change）
        │
        └─ startPty(id)
             │
             ├─ 生成/复用 startCommand：
             │   未配置 → detectStartScript(installDir)
             │   （优先 ServerHelper.sh，回落 ExampleServer.sh）
             │   → chmod +x → `./<script> +InternetServer/<id> -ThreadedConsole`
             │
             ├─ spawn 永驻 PTY bash（/bin/bash, cwd=installDir）
             │   → 返回 pid，terminalSessionId = serverId
             │
             ├─ 注册 onData → console_line 广播（PTY stdout → xterm.js）
             ├─ 注册 onExit → bash 退出 → STOPPED + 崩溃重启判定
             ├─ sessionEpoch 自增（防过期 1s timer 误写新会话）
             │
             └─ 立即返回 { terminalSessionId, pid }
                     │
                     ▼
              HTTP 202 立即响应（不等 U3DS 就绪）
                     │
              （1s 后，异步）
                     │
              setTimeout:
                ├─ sessionEpoch 归属校验（过期则丢弃）
                ├─ state 仍是 STARTING
                ├─ PTY 仍在跑
                └─ pty.write(id, `${startCommand}\r`)
                   → state → RUNNING（广播 state_change）
```

前端拿到 `terminalSessionId` 跳转控制台页，`ConsolePage` 的 `Terminal` 立即挂上 WS `console_line` 订阅，全程无阻塞等待。

**崩溃重启守卫**：bash 退出（exitCode ≠ 0）且非主动停止类操作（manual_stop / manual_restart / mod_apply）期间 → 5 秒后自动 `startInternal` 拉起；`exitCode === 0` 或实例已删除 → 不重启。

### 6.2 Mod 变更 + 重启流水线

```
POST /api/servers/:id/mods/apply   { fileIds: [...] }
        │
        ▼
ServerManager.applyModChanges(id, fileIds)
  （前置：activeOperation === 'none' 且 state === RUNNING，否则 409）
        │
        ├─ activeOperation = {type:'mod_apply', modIds}
        │
        ├─ ① 备份 WorkshopDownloadConfig.json（backup，失败降级 warn）
        │    广播 mod_apply_progress {stage:'backing_up'}
        │
        ├─ ② 写新 File_IDs（writeWorkshopFileIds）
        │
        ├─ ③ PTY 写 'Say "服务器将在 60 秒后重启以应用 Mod 变更"\r'
        │    广播 {stage:'broadcasting', remainingSeconds:60}
        │
        ├─ ④ 依次广播倒计时 {stage:'countdown', remainingSeconds:50/40/30/20/10}
        │
        ├─ ⑤ PTY 写 'Save\r'（强制刷玩家数据到磁盘）
        │
        ├─ ⑥ PTY 写 'Shutdown 10 "Mod 变更重启"\r'
        │    广播 {stage:'shutting_down', remainingSeconds:10}
        │
        ├─ ⑦ 等 PTY 退出（waitExit 30s；超时 forceKill + stopRequested 置位防误判）
        │    state → STOPPED
        │
        ├─ ⑦.5 WorkshopApplyService.applyStaged（进程已停，零冲突）：
        │    ├─ 备份 acf（可选）
        │    ├─ 解析 staging acf → 拿 staging mod 元数据
        │    ├─ acf.addItem（每个新 mod，自带备份+回滚）
        │    ├─ mv staging/content/<id>/ → content/<id>/（跨设备降级 cp -r + rm）
        │    ├─ 重新读 acf → 最新 File_IDs
        │    ├─ writeWorkshopFileIds
        │    └─ 任一失败 → 全回滚（acf + Config 备份）
        │
        ├─ ⑧ startInternal（spawn 新 bash → 1s 塞 startCommand → RUNNING）
        │
        └─ ⑨ PTY 写 'Say "Mod 变更已应用"\r'
              activeOperation = {type:'none'}
              广播 {stage:'completed'}
```

**下载 ≠ 生效**：新 Mod 的下载（`POST /mods/download`）走 SteamCMD 落到 staging，可不停服；只有 apply 流水线（以上 9 步）才让 Mod 生效，且必须重启。

### 6.3 控制台日志流（双路合并 + 凭证脱敏）

```
  ┌─────────────────────┐        ┌──────────────────────┐
  │  PtyManager.onData   │        │  LogStreamer         │
  │  (PTY stdout, 按行)   │        │  (文件 tail, 500ms)   │
  └─────────┬───────────┘        └──────────┬───────────┘
            │                              │
            │ source='stdout'              │ source='file'
            │                              │ 凭证脱敏管道：
            │                              │   /7656119\d{10}:[^\s]+/ → SteamID:[REDACTED]
            │                              │   /login\s+\S+/i  → login [REDACTED]
            │                              │   /GSLT\s+\S+/i   → GSLT [REDACTED]
            │                              │   /Login_Token\s+\S+/i → Login_Token [REDACTED]
            │                              │   /Password\s+\S+/i → Password [REDACTED]
            │                              │ 速率限制：≤100 行/秒
            ▼                              ▼
  ┌─────────────────────────────────────────────────────┐
  │              IBroadcaster.broadcast                 │
  │           {type:'console_line', serverId, line,     │
  │            source:'stdout'|'file'}                  │
  └──────────────────────┬──────────────────────────────┘
                         │ 按 serverId 路由订阅
                         ▼
               对应 WS 连接 → 前端 ConsolePage
               （stdout 路渲染到 xterm.js，ANSI 原生解析）
```

控制台页主要消费 PTY stdout 路（实时终端输出）；文件 tail 路提供 `Logs/*.log` 的持久日志流（实例未运行时也能看历史日志）。

### 6.4 命令执行（PTY owner-trust）

```
前端 xterm.js 键盘输入 / 命令输入框
        │
        ▼
WS {type:'terminal_input', serverId, data}      ← sendCommand 拼 `\r`，sendTerminalInput 原样
        │
        ▼
WsBroadcaster 校验 JWT（verifyClient 已过）→ 契约合法即受理
        │
        ▼
PtyManager.write(serverId, data)   →  PTY stdin（原样透传，不解析、不校验命令）
        │
        ▼
U3DS 执行（控制台命令）→ 输出经 PTY stdout → console_line 回显前端
```

- **无角色检查、无后端 428 二次确认**——JWT 有效 = owner 本人在终端，可执行任意命令。
- 危险指令（`Shutdown`、`Ban`、`Slay` 等）由前端 `ConsolePage` 的 `ConfirmDialog` 拦截，用户确认后才发出。
- `PtyManager.write` 不自动加 `\r`：命令输入框拼接 `\r` 让 bash 解析；xterm 原始输入原样透传（PTY 自回显）。

---

## 7. 数据库 Schema

### 7.1 真源与持久化边界

- **实例身份真源 = 目录扫描**：`<installDir>/Servers/<ServerID>/Server/Commands.dat` 存在性。实例不落库。
- **运行时状态 = 内存**：ServerManager 维护 in-memory Map；面板启动不吸附真实进程，一律 STOPPED。
- **SQLite 只存 3 表**：用户、refresh token 黑名单、settings K-V。

### 7.2 DDL（当前 schema）

```sql
-- 用户表（单用户系统，is_admin 恒为 1）
CREATE TABLE users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,                -- Argon2id
  is_admin      INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- JWT refresh token 黑名单（注销 + 轮换）
CREATE TABLE refresh_tokens (
  jti         TEXT PRIMARY KEY,               -- JWT ID
  user_id     INTEGER NOT NULL REFERENCES users(id),
  expires_at  TEXT NOT NULL,
  revoked_at  TEXT,                           -- null = 有效
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 全局加密 K-V（AES-256-GCM 加密值 + 明文复用列）
CREATE TABLE settings (
  key        TEXT PRIMARY KEY,
  value_enc  TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### 7.3 settings K-V 约定

| key | 值形态 | 加密 | 消费方 |
|---|---|---|---|
| `steam_webapi_key` | WebAPI Key | AES-256-GCM（`cryptoBox.encrypt`，三段 hex `iv:tag:ct`，密钥来自 `ENCRYPTION_KEY`） | WorkshopMetadataService / settings 路由 |
| `startCommand:<ServerID>` | U3DS 启动命令字符串 | **明文**（复用 `value_enc` 列，语义不加密——命令非凭证） | ServerManager（restoreStartCommand / configureServer / removeServer） |

### 7.4 迁移策略

- better-sqlite3 `user_version` PRAGMA 做版本管理；迁移脚本在 `manager-server/src/db/migrations/`，命名 `NNN-description.sql`。
- 首次启动自动执行全部未执行迁移；每份迁移在事务内执行、幂等（`IF NOT EXISTS` / `DROP IF EXISTS`）。
- 现状迁移序列：`001-initial-schema` → `002-add-install-dir` → `003-add-settings` → `004-drop-mod-cache-tables` → `005-drop-servers-tables`（收敛到 3 表）。

### 7.5 终端会话存储（ADR-0005 Phase 7，JSON 文件不落 SQLite）

- **路径**：`<config.dataDir>/terminal-sessions.json`
- **结构**：`{ sessions: PersistedTerminalSession[], lastUpdated: ISO 8601 }`
- **写入策略**：mutationQueue 串行 + 临时文件 + `rename` 原子写
- **保留期**：7 天未活动自动清理（`cleanupExpiredSessions`，启动时每 24 小时跑一次）
- **生命周期**：PTY spawn 成功后 `saveSession`、PTY 退出后 `setSessionActive(false)`、实例删除后 `removeSession`、面板优雅关闭时批量置 inactive
- **不入 SQLite**：会话数量小（1 实例 1 会话），JSON 文件读写成本低；与 settings 表职责分离（settings 是凭证，sessions 是元数据）

---

## 8. 安全架构

### 8.1 认证链路

```
登录
  ├─ POST /api/auth/login { username, password }
  │     → Argon2id 验证
  │     → 签发 access_token（JWT, 15min）
  │     → 签发 refresh_token（JWT, 7d，JSON body 返回，前端存 localStorage）
  │
  ├─ 每次请求
  │     → Authorization: Bearer <access_token>
  │     → Express 中间件（authenticateToken）验证签名 + 过期
  │     → 过期 → 前端读 localStorage 的 refresh_token，POST /auth/refresh 换新 token 对
  │
  ├─ WebSocket 升级
  │     → 查询参数 ?token=<access_token>
  │     → verifyClient 校验，失败 401 拒绝
  │
  └─ 注销
        → refresh_token 的 jti 写入 refresh_tokens 表（revoked_at = now）
```

### 8.2 凭证存储

| 凭证类型 | 存储方式 | 算法/格式 |
|---|---|---|
| 用户密码 | `users.password_hash` | Argon2id |
| Steam WebAPI Key | `settings` K-V（`steam_webapi_key`） | AES-256-GCM（`iv:tag:ct` 三段 hex，密钥 = `ENCRYPTION_KEY` env） |
| GSLT | `Commands.dat` 明文（U3DS 读取需要）；Files 页读取时替换为 `[REDACTED]` | — |
| startCommand | `settings` K-V（`startCommand:<ServerID>`）明文 | 命令串非凭证，不加密 |

**硬约束**：日志脱敏管道（§6.3）确保 `SteamID:密码`、`login`、`GSLT`、`Login_Token`、`Password` 后接的敏感串绝不出现在日志/前端。ENCRYPTION_KEY / JWT_SECRET 等 secrets 从环境变量来，`.env*` git 忽略。

### 8.3 HTTP 安全头与中间件

- `helmet` 默认安全头 + `noCache`（全局 `no-store`）。
- Content-Security-Policy **关闭**（`helmet({ contentSecurityPolicy: false })`）——xterm.js 终端需要内联样式/脚本。
- `cors`（`origin: config.corsOrigin`，`credentials: true`）。
- 静态资源：`/assets/` 内容哈希文件名长缓存（`max-age=31536000, immutable`），其余 `no-cache`；SPA fallback 回 `index.html`。

### 8.4 输入校验

| 输入 | 校验规则 |
|---|---|
| ServerID | `/^[A-Za-z0-9_-]+$/`（zod `serverIdPattern`——id 会拼进启动命令与文件路径，防注入/穿越） |
| SteamID64 | `/^7656119\d{10}$/` |
| Workshop File ID | 正整数 |
| 文件路径 | 拒绝 `\x00`、拒绝 `..` 穿越；`realpath` 解析后白名单前缀匹配（`resolveValidatedPath`） |
| 请求体 | JSON `10mb` 限制、octet-stream raw `100mb` 限制 |

### 8.5 命令鉴权（owner-trust）

- 命令执行唯一通道是 PTY 终端（§6.4）：WS `verifyClient` 校验 access token 即视为 owner 本人，终端命令放行。
- 危险指令二次确认在前端 `ConfirmDialog`（`Shutdown`、`Ban` 等），后端不做命令级门控。
- 面板**不提供**「前端执行任意命令」的 REST 接口——命令只能经 WS `terminal_input` 到 PTY stdin。

---

## 9. 横切关注点

### 9.1 日志

- pino 结构化 JSON，级别由 `LOG_LEVEL` env 控制；请求日志 `logger.debug({ method, url })`。
- 凭证/密钥绝不出现在任何日志（脱敏管道 + 打印规范）。
- 非生产环境挂 pino-pretty（彩色 + 时间戳）；生产环境纯结构化 JSON（不做文件轮转）。

### 9.2 错误处理

- **AppError** 统一错误类：`code`（kebab-case）+ 中文 `message` + `status`。业务错误必须 `throw new AppError(...)`，禁止裸抛 `Error`。
- Express 全局错误处理器（`errorHandler`，注册在路由之后）：AppError → `{ error: { code, message } }`；其余 → 记日志 + `500 { error: { code: 'internal_error', message: '服务器内部错误' } }`。
- 生产环境不暴露堆栈跟踪。
- 实例操作冲突（`operation-conflict` 409）、U3DS 未装引导（`start-script-not-found` 409）、实例不存在（`server-not-found` 404）等错误码在路由层直接映射为可展示的中文 message。

### 9.3 依赖注入

- **手动构造注入**（无框架），集中在 `manager-server/src/composition-root.ts`（`buildContainer(db)`）。
- 核心域层只依赖 `shared/contracts/` 接口，实现注入在 API 层入口。
- 依赖关系（→ = 依赖）：

```
ServerManager → ServerDiscovery, PtyManager, ConfigService, IBroadcaster, WorkshopApplyService, DB
ConfigService → FileLockProvider
FilesService → FileLockProvider
SteamCmdManager → ProcessSupervisor, IBroadcaster, activeProbe(延迟绑定 → ServerManager)
WorkshopMetadataService → DB
WorkshopAcfService → ConfigService
WorkshopApplyService → WorkshopAcfService, ConfigService, IBroadcaster
WorkshopDeleteService → WorkshopAcfService, ConfigService
LogStreamer → IBroadcaster, ProcessSupervisor
AuthService → DB
WsBroadcaster →（实现 IBroadcaster，无业务依赖）
PtyManager → node-pty
ProcessSupervisor → child_process
```

- **SteamCmdManager 的 activeProbe 延迟绑定闭包**：SteamCmdManager 需要 ServerManager 的 `listActiveServerIds`（更新 U3DS 前置检查），但 ServerManager 构造依赖 workshopApply 而 SteamCmdManager 又依赖 ServerManager——用「先声明 `let serverManager`，activeProbe 在闭包内解引用，构造完成后再赋值」打破构造循环。
- 生产代码无 `getDb()` 全局单例调用（db 经 constructor 注入）。

### 9.4 测试策略

| 层 | 工具 | 覆盖要求 |
|---|---|---|
| 后端单元 | Vitest | 模块接口公开方法、状态机转换路径、ConfigService 往返、PTY 命令链路断言 PTY writes（`Save\r` / `Shutdown 30\r`，不连真服务） |
| 后端 API | Vitest + supertest | HTTP 端点 + WebSocket 升级/订阅/terminal_input |
| 前端单元 | Vitest | 组件渲染、hooks |
| E2E | Playwright | 每个改到的功能至少一个冒烟用例（登录 → 实例列表 → 启停 → 配置 → Mod 流程） |
| 契约 | zod + OpenAPI | API 边界 schema 校验 |

---

## 10. 文档生命周期

- 本文档是 `docs/architecture/` 的核心文件，与 `design-system-mapping.md`（设计系统映射）并列为架构层两大权威来源。
- 任何架构变更必须先改本文档、再改代码；PR 评审以本文档为基准。
- 配套活参考：`claudedocs/reference_config_files.md`（配置文件字段）、`claudedocs/reference_console_commands.md`（控制台命令）、`claudedocs/research_verification_tracker.md`（未验证项）。
- 技术决策记录在 `docs/adr/`；`docs/external-resources.md` 索引外部官方文档。

---

*最近修订：2026-08-11——全面改写为 Phase 0-6 落地后的现状规格（PTY 持久终端 owner-trust 命令通道、4 态状态机、目录扫描真源、3 表 DB、202 异步化）。*
