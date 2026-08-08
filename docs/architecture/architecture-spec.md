# unturned-manager 系统架构规格书

> C4 模型 · 组件图粒度 · 不含 Docker 部署拓扑（部署拓扑单独成文）
> 产出日期：2026-08-06
> 前置审查：system-architect / backend-architect / security-engineer 三方交叉验证

---

## 目录

1. [系统上下文 (C4 Level 1)](#1-系统上下文-system-context)
2. [容器图 (C4 Level 2)](#2-容器图-container)
3. [后端组件图 (C4 Level 3a)](#3-后端组件图-backend)
4. [前端组件图 (C4 Level 3b)](#4-前端组件图-frontend)
5. [模块接口契约](#5-模块接口契约)
6. [关键数据流](#6-关键数据流)
7. [数据库 Schema](#7-数据库-schema)
8. [安全架构](#8-安全架构)
9. [横切关注点](#9-横切关注点)

---

## 1. 系统上下文 (System Context)

### 1.1 图

```
                         ┌──────────────────────────┐
                         │     Steam WebAPI          │
                         │  (steamcommunity.com)     │
                         │                           │
                         │  · IPublishedFileService  │
                         │    GetDetails/QueryFiles   │
                         │  · WebAPI Key 主路径       │
                         │  · ?xml=1 已废弃           │
                         └────────────┬─────────────┘
                                      │ HTTPS (按需拉取, 本地 LRU 缓存)
                                      │
┌──────────────┐  HTTPS + WSS (JWT)   │
│   浏览器       │◄───────────────────┐│
│   (服主)      │                    ││
│              │────────────────────┼┘
└──────────────┘                    │
      │                              │
      │ 仪表盘 / 控制台 / Mod 管理    │
      │ 玩家管理 / 配置编辑 / 文件浏览 │
      │                              │
      ▼                              ▼
┌──────────────────────────────────────────────────────────┐
│                                                          │
│                    unturned-manager                      │
│                 (自托管 Web 管理面板)                      │
│                                                          │
│   ┌────────────┐  ┌──────────────┐  ┌────────────────┐  │
│   │ React SPA      │  │ Express + ws  │  │   SQLite       │  │
│   │ (Vite + TW4 +  │  │ (后端容器)     │  │   (单文件数据库) │  │
│   │  shadcn/ui)     │  │               │  │                │  │
│   └────────────┘  └──────────────┘  └────────────────┘  │
│                                                          │
└──────┬──────────────┬──────────────────┬─────────────────┘
       │              │                  │
       │ RCON (TCP)   │ 文件 IO (共享卷)   │ child_process/spawn
       │ A2S (UDP)    │                  │
       │ stdout pipe  │                  │
       │              │                  │
       ▼              ▼                  ▼
┌──────────────┐ ┌──────────────┐ ┌──────────────────┐
│ U3DS 进程     │ │ 服务端文件系统  │ │    SteamCMD       │
│ (× N 实例)   │ │              │ │                  │
│              │ │ Servers/<ID>/ │ │ 安装/更新 U3DS    │
│ · 每实例独立  │ │ · Server/    │ │ 下载 Workshop 内容 │
│   状态机      │ │ · Workshop/  │ │                  │
│ · 独立端口    │ │ · Logs/      │ │ 生命周期约束：     │
│ · 独立 RCON   │ │ · Rocket/    │ │ 写 content/ 前必须 │
│              │ │ · openmod/   │ │ STOPPED；staging  │
│              │ │              │ │ 下载可不停服 (§1.4) │
│ A2S: 游戏端口+1│ │ · Bundles/   │ └──────────────────┘
└──────────────┘ └──────────────┘
```

### 1.2 外部系统详表

| 外部系统 | 通信方向 | 协议 | 用途 | 约束 |
|---|---|---|---|---|
| **浏览器** | 双向 | HTTPS (REST) + WSS | 管理面板 UI | 单用户 JWT 认证 |
| **U3DS 进程 × N** | 双向 | TCP (RCON) + UDP (A2S) + stdout pipe | 运行时命令、玩家查询、控制台输出、状态检测 | 每实例独立状态机、独立端口、独立 RCON 连接 |
| **服务端文件系统** | 单向读/写 | 本地文件 IO | 配置文件 CRUD、Mod 列表、日志 tail、文件浏览 | 写入受生命周期门控（§4.6 重启流水线） |
| **SteamCMD** | 单向 spawn | child_process | 安装/更新 U3DS 二进制、下载 Workshop 内容 | 写 `content/1110390/` 或 validate 前 U3DS 必须 STOPPED；下载到 staging（`Workshop/staging/`）可不停服（§1.4） |
| **Steam WebAPI** | 单向拉取 | HTTPS | Workshop Mod 元数据 | WebAPI Key 主路径（`IPublishedFileService`）；`?xml=1` 已废弃 |

### 1.3 RCON 链路详解

```
Panel ──► 自动探测 ──► ① OpenMod Valve Source RCON (rcon-srcds)
              │             端口：openmod.yaml → rcon.port（默认 25545）
              │             认证：SteamID:密码 格式
              │
              ├── 失败 (2s 超时) ──► ② RocketMod Telnet RCON (net 模块)
              │                         端口：游戏端口 + 2（默认 27017）
              │                         认证：login <密码>\r\n
              │
              └── 成功 ──► 缓存模式 60s ──► 后续命令直接复用
                            60s 过期 ──► 重新探测
                            连续 3 次 ping 失败 ──► DEGRADED 状态
```

### 1.4 文件写入生命周期门控

| 写操作 | 安全时机 | 不安全时的行为 |
|---|---|---|
| WorkshopDownloadConfig.json | U3DS 实例 STOPPED（§4.6 流水线） | 拒绝写入，返回 409 |
| Commands.dat | U3DS 实例 STOPPED | 接受写入，UI 提示"需重启生效" |
| Config.txt | 任意（U3DS 运行时只读） | 接受写入，UI 提示可能需重启 |
| 插件配置 (openmod/*.yaml) | 任意（OpenMod reload 实验性） | 接受写入，UI 提示 reload 或重启 |
| 日志文件 | 只读，永不写入 | — |
| Workshop/ 内容（`content/1110390/`、validate、U3DS 二进制） | SteamCMD 写入时 U3DS 必须 STOPPED | 拒绝启动 SteamCMD |
| Workshop/ staging（`Workshop/staging/`） | 任意（U3DS 运行中不扫描 staging） | 允许下载；应用前必须走重启流水线 |

---

## 2. 容器图 (Container)

> Docker 部署拓扑不在本文档范围（用户指示"docker先不管"）。此处描述的是应用层容器——前端 SPA 和后端服务的进程边界。
> 技术栈详见 [CLAUDE.md §2](../../CLAUDE.md#2-技术栈铁律钉死的)，本节只描述应用层容器边界。
>
> **API 契约层（已实现）**：`shared/schemas/` 用 Zod 定义 API schema → `z.infer` 派生 TS 类型 → `zod-openapi` 生成 OpenAPI 3.0 规范 → Swagger UI 托管在 `/api/docs`。前后端共用同一 schema 真相源，后端自动校验入参，前端 `react-hook-form + zod` 复用校验逻辑。

```
┌─────────────────────────────────────────────────────────┐
│                    用户浏览器                             │
│                 (React SPA 运行环境)                      │
│                                                         │
│  ┌───────────────────────────────────────────────────┐  │
│  │              frontend (React 18 SPA)              │  │
│  │                                                   │  │
│  │  构建：Vite (dev) / nginx 静态托管 (prod)          │  │
│  │  路由：react-router-dom v6                         │  │
│  │  样式：Tailwind CSS 4 + shadcn/ui (slate+emerald)  │  │
│  │  动画：Motion (framer-motion v13, ADR-0001)        │  │
│  │  表单：react-hook-form + zod                        │  │
│  │  状态：AuthContext + WebSocketContext (Zustand风格) │  │
│  │                                                   │  │
│  │  HTTP client: axios (JWT 注入 / 401 拦截)          │  │
│  │  WebSocket client: 浏览器原生 WebSocket             │  │
│  └────────────────────┬──────────────────────────────┘  │
│                       │ HTTPS + WSS                     │
└───────────────────────┼─────────────────────────────────┘
                        │
┌───────────────────────┼─────────────────────────────────┐
│  后端服务器            │                                  │
│                       ▼                                  │
│  ┌───────────────────────────────────────────────────┐  │
│  │              backend (Node.js 20 + Express 4)     │  │
│  │                                                   │  │
│  │  ┌─────────┐ ┌──────────┐ ┌────────────────────┐ │  │
│  │  │ REST    │ │WebSocket │ │ 中间件               │ │  │
│  │  │ routes  │ │gateway   │ │ · JWT 验证           │ │  │
│  │  │         │ │          │ │ · 速率限制            │ │  │
│  │  │ Express │ │ ws       │ │ · 安全头              │ │  │
│  │  │ Router  │ │ Server   │ │ · 请求日志            │ │  │
│  │  └────┬────┘ └────┬─────┘ └────────────────────┘ │  │
│  │       │           │                               │  │
│  │       ▼           ▼                               │  │
│  │  ┌─────────────────────────────────────────────┐  │  │
│  │  │            核心域层 (Core Domain)             │  │  │
│  │  │                                             │  │  │
│  │  │  ServerManager  ConfigService  FilesService  │  │  │
│  │  │  SteamCmdManager  WorkshopMetadataService    │  │  │
│  │  │  LogStreamer  AuthService                    │  │  │
│  │  └──────────────────┬──────────────────────────┘  │  │
│  │                     │                              │  │
│  │                     ▼                              │  │
│  │  ┌─────────────────────────────────────────────┐  │  │
│  │  │         基础设施层 (Infrastructure)           │  │  │
│  │  │                                             │  │  │
│  │  │  ProcessSupervisor  RconManager  A2SClient  │  │  │
│  │  │  FileLockProvider                           │  │  │
│  │  └─────────────────────────────────────────────┘  │  │
│  │                                                   │  │
│  └───────────────────────┬───────────────────────────┘  │
│                          │                               │
│  ┌───────────────────────┴───────────────────────────┐  │
│  │              SQLite (better-sqlite3)              │  │
│  │  · servers  · users  · config_snapshots           │  │
│  │  · workshop_mods  · audit_logs                    │  │
│  └───────────────────────────────────────────────────┘  │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

---

## 3. 后端组件图 (Backend)

### 3.1 分层架构

```
┌─────────────────────────────────────────────────────┐
│                   API 层                             │
│                                                     │
│  Express Routes   WebSocket Gateway   WsBroadcaster │
│  (REST 端点)      (ws 升级 + JWT 认证)  (事件广播)     │
│                                                     │
│  Middleware: JWT验证 | 速率限制 | 安全头 | 请求日志    │
└────────────────────────┬────────────────────────────┘
                         │ 依赖方向 ↓
┌────────────────────────┴────────────────────────────┐
│                  核心域层                             │
│                                                     │
│  ┌──────────────┐  ┌──────────────┐                 │
│  │ServerManager │  │ConfigService │                 │
│  │(聚合根)       │  │              │                 │
│  │              │  │ Commands.dat │                 │
│  │ 五态状态机    │  │ Config.txt   │                 │
│  │ activeOp     │  │ Workshop.json│                 │
│  │ 重启流水线    │  │ openmod.yaml │                 │
│  │ 编排器        │  │ Rocket *.xml │                 │
│  └──────┬───────┘  └──────┬───────┘                 │
│         │                 │                          │
│  ┌──────┴───────┐  ┌──────┴──────────┐              │
│  │FilesService  │  │SteamCmdManager  │              │
│  │              │  │                 │              │
│  │ 文件浏览/上传 │  │ app_update      │              │
│  │ 删除/重命名   │  │ 1110390         │              │
│  │ 路径穿越防护  │  │ 子进程生命周期   │              │
│  └──────────────┘  └─────────────────┘              │
│                                                     │
│  ┌──────────────────────┐  ┌────────────────────┐   │
│  │WorkshopMetadataService│  │   AuthService      │   │
│  │                      │  │                    │   │
│  │ Steam ?xml=1 拉取    │  │ JWT sign/verify    │   │
│  │ 元数据解析 + LRU 缓存 │  │ refresh token 轮换 │   │
│  │ WebAPI Key 第二档    │  │ 密码 Argon2id hash │   │
│  └──────────────────────┘  └────────────────────┘   │
│                                                     │
│  ┌──────────────────────┐                           │
│  │    LogStreamer       │                           │
│  │                      │                           │
│  │ 双路日志采集：        │                           │
│  │ · 文件 tail 轮询     │                           │
│  │ · stdout pipe 流式   │                           │
│  │ 凭证脱敏 → WsBroadcaster                         │
│  └──────────────────────┘                           │
└────────────────────────┬────────────────────────────┘
                         │ 依赖方向 ↓
┌────────────────────────┴────────────────────────────┐
│                基础设施层                             │
│                                                     │
│  ┌────────────────┐  ┌──────────────┐               │
│  │ProcessSupervisor│  │ RconManager  │               │
│  │                │  │              │               │
│  │ spawn/kill     │  │ OpenMod 优先  │               │
│  │ 进程存活检测    │  │ RocketMod回落 │               │
│  │ 优雅关停/强制杀 │  │ 自动探测+缓存 │               │
│  │ 崩溃回调        │  │ 命令注入防护  │               │
│  └────────────────┘  └──────────────┘               │
│                                                     │
│  ┌────────────────┐  ┌──────────────────┐           │
│  │  A2SClient     │  │ FileLockProvider │           │
│  │                │  │                  │           │
│  │ UDP 查询       │  │ 跨模块文件锁注册  │           │
│  │ 玩家数/地图    │  │ 按路径加锁/解锁  │           │
│  │ 版本/延迟      │  │ 超时自动释放     │           │
│  └────────────────┘  └──────────────────┘           │
└─────────────────────────────────────────────────────┘
```

### 3.2 模块职责单行定义

| 模块 | 层 | 一句话职责 | 关键约束 |
|---|---|---|---|
| **ServerManager** | 核心域 | 服务端生命周期编排 + 五态状态机 + 操作互斥 | 聚合根，不直接 spawn 进程（委托 ProcessSupervisor） |
| **ConfigService** | 核心域 | 配置文件语义读写 + 备份-写-恢复 | 只处理 5 种已知格式，保留未知键 |
| **FilesService** | 核心域 | 通用文件浏览/上传/删除 | 无文件格式知识，路径白名单 + realpath 校验 |
| **SteamCmdManager** | 核心域 | SteamCMD 安装/更新子进程管理 | 写 content/ 前校验 STOPPED；staging 下载可不停服 |
| **WorkshopMetadataService** | 核心域 | Steam Workshop Mod 元数据拉取 + 缓存 | WebAPI Key（IPublishedFileService）主路径 |
| **AuthService** | 核心域 | JWT 签发/校验/刷新 + 密码哈希 | access token 15min + refresh token httpOnly cookie |
| **LogStreamer** | 核心域 | 双路日志采集 + 凭证脱敏 + 推送 | 单向：文件/stdout → WsBroadcaster，禁止反向 |
| **WsBroadcaster** | API 层 | WebSocket 事件广播 + 连接管理 | 实现 IBroadcaster 接口，含 JWT 认证 |
| **RconManager** | 基础设施 | RCON 连接管理 + 命令执行 + 自动探测 | 凭证 AES-GCM 存储，命令参数清洗控制字符 |
| **A2SClient** | 基础设施 | Valve A2S_INFO 查询 | 只读，UDP，超时 3s |
| **ProcessSupervisor** | 基础设施 | 进程 spawn/monitor/kill | ServerHelper.sh 生命周期，崩溃回调 |
| **FileLockProvider** | 基础设施 | 文件级互斥锁注册表 | ConfigService 和 FilesService 共享同一实例 |

---

## 4. 前端组件图 (Frontend)

### 4.1 页面路由树

```
/                          → Dashboard (仪表盘)
/:serverId/console         → Console (控制台)
/:serverId/mods            → Mods (Mod 管理)
/:serverId/players         → Players (玩家管理)
/:serverId/config/commands → Config (Commands.dat 编辑)
/:serverId/config/gameplay → Config (Config.txt 编辑) [v1.1]
/:serverId/config/workshop → Config (Workshop.json 编辑) [v1.1]
/:serverId/files           → Files (文件管理)
/:serverId/server-setup    → Server Setup (安装与管理)
/settings                  → System Settings [P1]
/login                     → Login (登录页)
```

### 4.2 组件树（按页面）

```
App
├── AuthProvider (JWT 状态 + 自动刷新)
├── WebSocketProvider (ws 连接管理, 按 serverId 多路复用)
├── Sidebar ($5:29)
│   ├── NavItem: Dashboard (LayoutDashboard)
│   ├── NavItem: Console (Terminal)
│   ├── NavItem: Mods (Package)
│   ├── NavItem: Players (Users)
│   ├── NavItem: Config (Settings)
│   ├── NavItem: Files (FolderOpen)
│   ├── NavItem: Server Setup (Server)
│   └── NavItem: Settings (Sliders) [P1]
│
├── Dashboard/
│   ├── StatCard ($5:34) × 4    (recharts: 在线玩家 / CPU / RAM / Mod 数)
│   ├── AreaChart               (24h 玩家趋势)
│   ├── BarChart                (资源使用)
│   └── QuickActions            (Button $5:52 Primary)
│
├── Console/
│   ├── ServerTabBar            (多 ServerID 切换)
│   ├── ConsoleToolbar          (预设命令: Say/Save/Players/Kick/Day/Shutdown)
│   ├── ConsoleOutput           (react-window 虚拟滚动 + ANSI 着色)
│   └── ConsoleInput            (↑↓ 翻历史 + 危险指令 ConfirmDialog)
│
├── Mods/
│   ├── ModGrid
│   ├── ModCard ($14:16695)     (封面/标题/作者/评分/FileID/启用开关)
│   ├── AddModDialog            (URL/ID 输入 + Steam 预览)
│   ├── ModDetailDialog         (大封面/完整描述/依赖/文件大小/标签)
│   ├── PendingBar              (待应用变更数 + [Apply & Restart])
│   └── ApplyPipeline           (进度条: 广播→保存→关机→重启→完成)
│
├── Players/
│   └── PlayerTable ($17:17601) (@tanstack/react-table)
│       ├── 列: Avatar / Name / SteamID / Character / Ping / Online / Actions
│       └── 操作: [Kick] [Ban] [Teleport] + ConfirmDialog ($12:16436)
│
├── Config/
│   ├── ConfigTabBar            (Commands / Config.txt / Workshop / OpenMod / RocketMod)
│   └── CommandsDatEditor       (分组表单: 身份/地图/权限/安全/参数/日志/投票)
│       └── 字段控件: Input ($17:17965) / Select ($17:17966) / Switch ($17:17967/8) / Checkbox ($17:17969)
│
├── Files/
│   ├── TopBar                  (标题 + 面包屑 Path Bar)
│   ├── Toolbar                 (刷新/上传/新建文件夹/搜索)
│   ├── FileGrid                (卡片瀑布流)
│   │   └── FileCard ($21:19780) × N
│   ├── StatusBar               (选中数 / 总大小)
│   ├── ContextMenu             (右键: 新建/删除/重命名/下载/复制路径)
│   └── PermissionsDialog       (ACL 编辑)
│
├── ServerSetup/
│   ├── Tab: 安装 (SteamCMD 安装进度 + U3DS 下载进度)
│   ├── Tab: 启动/停止 (Server 卡片 × N: Start/Stop/Restart + 状态灯)
│   ├── Tab: 更新 (app_update 一键更新 + 日志 tail)
│   └── Tab: 日志 (安装/启动/SteamCMD/系统 分类)
│
└── Settings/ [P1]
    ├── Card: 账户安全           (改密码/二步验证/登出)
    ├── Card: 安全配置           (凭据加密/速率限制/CSP)
    ├── Card: 网页设置           (主题/语言/默认页)
    ├── Card: 面板日志           (级别/滚动大小/导出)
    └── Card: 游戏默认值          (默认端口/难度/视角)
```

### 4.3 共享组件清单（Figma ID → 代码路径）

| Figma ID | Figma 名 | shadcn/ui 对位 | 自定义？ |
|---|---|---|---|
| `5:29` | Sidebar | — | ✅ 自实现 |
| `5:34` | StatCard | Card 包装 | ✅ 自实现 |
| `5:39` | Card | shadcn Card | ❌ 直接用 |
| `5:52` | Button Set | shadcn Button variant | ❌ 直接用 |
| `5:62` | Badge Set | shadcn Badge 改造 | ✅ 自定义 variant |
| `12:16436` | ConfirmDialog | shadcn AlertDialog | ✅ 封装 |
| `12:16476` | ToolbarBtn | shadcn Button ghost | ✅ 封装 |
| `14:16695` | ModCard | Card 包装 | ✅ 自实现 |
| `17:17754` | Toast | shadcn Toast variant | ✅ 自定义 variant |
| `17:17965` | Input | shadcn Input | ❌ 直接用 |
| `17:17966` | Select | shadcn Select | ❌ 直接用 |
| `17:17967/8` | Switch | shadcn Switch (受控) | ❌ 直接用，不拆 ON/OFF |
| `17:17969` | Checkbox | shadcn Checkbox | ❌ 直接用 |
| `20:19444` | ConfigDialog | shadcn Dialog | ✅ 封装 |
| `21:19780` | FileCard | Card 包装 | ✅ 自实现 |

### 4.4 Hooks 清单

| Hook | 用途 | 依赖 |
|---|---|---|
| `useAuth` | JWT 状态、登录/登出/刷新 | AuthContext |
| `useServer(serverId)` | 服务端状态 GET 轮询 + WS 增量合并 | IServerManager |
| `useConsole(serverId)` | WS 控制台收发封装 | WebSocketContext |
| `useLogs(serverId)` | WS 日志流封装 | WebSocketContext |
| `useConfig(serverId)` | Config CRUD + dirty tracking | IConfigService |
| `useMods(serverId)` | Mod 列表 + pending changes | WorkshopMetadataService |
| `useFiles(serverId, path)` | 文件浏览 + 上传进度 | IFilesService |
| `usePlayers(serverId)` | 玩家列表轮询 | A2S + RCON Players |

---

## 5. 模块接口契约

> 所有接口定义在 `shared/contracts/` 目录。使用 branded types 防止原始类型混淆。
> **`shared/schemas/`（已实现）**：Zod schema → `z.infer` 派生 TS 类型 → `zod-openapi` 生成 OpenAPI 3.0 规范。运行时校验替代手写参数检查，前后端共用同一 schema。

### 5.1 共享类型 (`shared/types/branded.ts`)

```typescript
// Branded types — 编译期类型安全，运行时是原始 string/number
// 是整个 shared/ 包的类型系统基础，防止原始类型混淆（如把 WorkshopFileId 当 ServerId 传）
type ServerId = string & { readonly __brand: 'ServerId' };
type SteamId64 = string & { readonly __brand: 'SteamId64' };
type WorkshopFileId = string & { readonly __brand: 'WorkshopFileId' };
type ModId = number & { readonly __brand: 'ModId' };
type Port = number & { readonly __brand: 'Port' };
```

### 5.1a 领域数据类型 (`shared/types/domain.ts`)

```typescript
// 服务端配置
interface ServerConfig {
  id: ServerId;
  name: string;
  gamePort: Port;
  ownerSteamId: SteamId64;
  installDir: string;            // U3DS 安装根目录
  rconPassword?: string;          // 明文传入，内部 AES-GCM 加密存储
}

// Commands.dat 解析结果
// 保留未知键是 CLAUDE.md §4.3 硬约束——面板不能删除不认识的指令
interface CommandsDatRecord {
  known: Map<KnownCommandKey, string>;     // 已知字段：Port / Map / Mode / Name 等
  unknown: Map<string, string>;            // 未知键完整保留 → 写回时原样输出
  comments: string[];                       // # 和 ; 开头的注释行，保留位置
}

// Config.txt 解析结果（继承 happy-forging-zephyr 的 section/comment/known 模型）
interface ConfigTxtRecord {
  sections: ConfigSection[];
}
interface ConfigSection {
  name: string;                              // 段名（如 "Browser"、"_unlabeled"）
  entries: ConfigEntry[];
}
interface ConfigEntry {
  key: string;
  value: string | null;                      // null = 使用默认值
  comment: string | null;                    // 紧邻该行的 > 注释
  known: boolean;                            // false → 前端渲染通用文本框 + ⚠ 标记
  type?: 'string' | 'bool' | 'int';          // known=false 时自动推断
}

// WorkshopDownloadConfig.json
interface WorkshopConfig {
  File_IDs: WorkshopFileId[];
  Should_Monitor_Updates: boolean;
  Query_Cache_Max_Age_Seconds: number;
  Max_Query_Retries: number;
  Use_Cached_Downloads: boolean;
  Shutdown_Update_Detected_Timer: number;
  Shutdown_Update_Detected_Message: string;
  Shutdown_Kick_Message: string;
}

// A2S 查询结果
interface A2SInfo {
  players: number;
  maxPlayers: number;
  map: string;
  version: string;
  latency: number;               // ms
}

// Workshop Mod 元数据
interface WorkshopModMeta {
  fileId: WorkshopFileId;
  title: string;
  author: string;
  description: string;
  previewUrl?: string;
  fileSize?: number;
  updatedAt?: string;
  tags?: string[];
}

// 文件条目
interface FileEntry {
  name: string;
  path: string;                  // 相对路径
  isDirectory: boolean;
  size: number;
  modifiedAt: string;
}

interface FilePermissions {
  owner: 'read' | 'write' | 'none';
  group: 'read' | 'write' | 'none';
  other: 'read' | 'write' | 'none';
}

// SteamCMD 状态
interface SteamCmdStatus {
  isInstalled: boolean;
  version?: string;
  installPath?: string;
  lastChecked?: string;
}
```

### 5.2 状态机类型 (`shared/types/state.ts`)

```typescript
enum ServerState {
  STOPPED = 'STOPPED',
  STARTING = 'STARTING',
  RUNNING = 'RUNNING',
  DEGRADED = 'DEGRADED',
  STOPPING = 'STOPPING',
}

type ActiveOperation =
  | { type: 'none' }
  | { type: 'manual_start'; startedAt: string }
  | { type: 'manual_restart'; startedAt: string }
  | { type: 'manual_stop'; startedAt: string }
  | { type: 'mod_apply'; startedAt: string; modIds: string[] }
  | { type: 'steamcmd_update'; startedAt: string }
  | { type: 'initial_setup'; startedAt: string };

enum RconProtocol {
  OPENMOD = 'openmod',
  ROCKETMOD = 'rocketmod',
  UNREACHABLE = 'unreachable',
}

// RCON 连接级状态（与 ServerState 是不同层级的概念）
// RconManager 回调此状态 → ServerManager 消费后决定是否将 ServerState 转为 DEGRADED
enum RconConnectionState {
  CONNECTED = 'connected',
  DISCONNECTED = 'disconnected',
  DEGRADED = 'degraded',    // 连续 3 次 ping 失败，尝试重连中
}
```

### 5.3 IServerManager (`shared/contracts/server.ts`)

```typescript
interface IServerManager {
  // 查询
  getState(serverId: ServerId): ServerState;
  getActiveOperation(serverId: ServerId): ActiveOperation;
  listServers(): Promise<ServerConfig[]>;

  // 服务端创建/配置（首次设置 RCON 密码等）
  createServer(config: ServerConfig): Promise<void>;
  configureServer(serverId: ServerId, patch: Partial<ServerConfig>): Promise<void>;

  // 生命周期操作
  start(serverId: ServerId): Promise<void>;
  stop(serverId: ServerId, reason: string): Promise<void>;
  restart(serverId: ServerId, reason: string): Promise<void>;
  forceStop(serverId: ServerId): Promise<void>;

  // Mod 变更流水线（编排 ConfigService + RconManager + ProcessSupervisor）
  applyModChanges(serverId: ServerId, modIds: WorkshopFileId[]): Promise<void>;

  // SteamCMD 更新流水线
  updateServerBinaries(installDir: string): Promise<void>;
}
```

### 5.4 IConfigService (`shared/contracts/config.ts`)

```typescript
interface IConfigService {
  // Commands.dat — 保留未知键，按行解析/序列化
  readCommandsDat(serverId: ServerId): Promise<CommandsDatRecord>;
  writeCommandsDat(serverId: ServerId, config: CommandsDatRecord, expectedVersion?: number): Promise<void>;

  // Config.txt — 通用 Key-Value + 注释保留
  readConfigTxt(serverId: ServerId): Promise<ConfigTxtRecord>;
  writeConfigTxt(serverId: ServerId, entries: ConfigTxtRecord, expectedVersion?: number): Promise<void>;

  // WorkshopDownloadConfig.json — 面板只写 File_IDs + Should_Monitor_Updates（CLAUDE.md §4.4）
  // 其他字段只读展示；写前自动备份（原子操作，调用者无感知）
  readWorkshopConfig(serverId: ServerId): Promise<WorkshopConfig>;
  writeWorkshopFileIds(serverId: ServerId, fileIds: WorkshopFileId[], expectedVersion?: number): Promise<void>;

  // 显式备份（Mod 流水线等需在写前独立备份的场景）
  backup(serverId: ServerId, filePath: string): Promise<string>;  // 返回备份路径

  // OpenMod / RocketMod 插件配置
  readOpenModConfig(serverId: ServerId, pluginId: string): Promise<Record<string, unknown>>;
  writeOpenModConfig(serverId: ServerId, pluginId: string, config: Record<string, unknown>): Promise<void>;
  readRocketModConfig(serverId: ServerId, pluginName: string): Promise<Record<string, unknown>>;
  writeRocketModConfig(serverId: ServerId, pluginName: string, config: Record<string, unknown>): Promise<void>;
}
```

### 5.5 IRconManager (`shared/contracts/rcon.ts`)

```typescript
interface IRconManager {
  connect(serverId: ServerId): Promise<void>;
  disconnect(serverId: ServerId): void;
  execute(serverId: ServerId, command: string): Promise<string>;
  getProtocol(serverId: ServerId): RconProtocol;
  isReachable(serverId: ServerId): boolean;
  destroy(): Promise<void>;  // 关闭所有 TCP 连接，移除心跳定时器

  // 回调注册（非 EventEmitter，类型安全）
  onStateChange(callback: (serverId: ServerId, state: RconConnectionState) => void): void;
}

// RconManager 内部责任：
// · 自动探测 OpenMod → RocketMod 回落
// · 凭证 AES-GCM 解密后使用，绝不记录到日志
// · execute() 入参清洗：去除 \r \n \0 及所有 < 0x20 的控制字符
// · 60s 协议缓存 + 30s 心跳 ping
// · 连续 3 次 ping 失败 → 回调 onStateChange(serverId, DISCONNECTED)
```

### 5.6 IProcessSupervisor (`shared/contracts/process.ts`)

```typescript
interface IProcessSupervisor {
  spawn(serverId: ServerId, command: string, args: string[]): Promise<number>; // 返回 PID
  gracefulShutdown(serverId: ServerId, timeoutMs?: number): Promise<void>;     // 默认 30s，发送关闭信号
  waitForExit(serverId: ServerId, timeoutMs: number): Promise<void>;           // 等待进程自然退出，超时 throw
  forceKill(serverId: ServerId): void;
  isRunning(serverId: ServerId): boolean;
  destroy(): Promise<void>;          // 杀死所有管理的子进程，移除所有监听器

  // stdout 输出 → LogStreamer 消费
  onStdout(serverId: ServerId, callback: (line: string) => void): void;
  // 进程异常退出 → ServerManager 消费
  onCrash(callback: (serverId: ServerId, exitCode: number | null) => void): void;
}
```

### 5.7 IBroadcaster (`shared/contracts/broadcast.ts`)

```typescript
type ServerEvent =
  | { type: 'state_change'; serverId: ServerId; from: ServerState; to: ServerState }
  | { type: 'console_line'; serverId: ServerId; line: string; source: 'stdout' | 'file' }
  | { type: 'rcon_status'; serverId: ServerId; protocol: RconProtocol; reachable: boolean }
  | { type: 'player_join'; serverId: ServerId; playerName: string; steamId: SteamId64 }
  | { type: 'player_leave'; serverId: ServerId; playerName: string; steamId: SteamId64 }
  | { type: 'mod_apply_progress'; serverId: ServerId; stage: string; remainingSeconds?: number }
  | { type: 'file_changed'; serverId: ServerId; path: string }
  | { type: 'steamcmd_progress'; stage: string; percent?: number };

interface IBroadcaster {
  broadcast(event: ServerEvent): void;
  register(ws: WebSocket, serverIds: ServerId[]): void;     // 订阅指定 serverId 的事件
  unregister(ws: WebSocket): void;
  destroy(): Promise<void>;          // 关闭所有 ws 连接，移除心跳定时器
}

// WsBroadcaster 是 IBroadcaster 的唯一实现，位于 API 层。
// 核心域层只依赖 IBroadcaster 接口。
// WebSocket 升级时通过 JWT 验证（verifyClient 回调），
// 验证失败拒绝连接。
```

### 5.8 IFilesService (`shared/contracts/files.ts`)

```typescript
interface IFilesService {
  listDirectory(serverId: ServerId, relativePath: string): Promise<FileEntry[]>;
  readFile(serverId: ServerId, relativePath: string, encoding?: BufferEncoding): Promise<Buffer>;
  writeFile(serverId: ServerId, relativePath: string, content: Buffer): Promise<void>;
  deleteEntry(serverId: ServerId, relativePath: string): Promise<void>;
  createDirectory(serverId: ServerId, relativePath: string): Promise<void>;
  renameEntry(serverId: ServerId, relativePath: string, newName: string): Promise<void>;
  getPermissions(serverId: ServerId, relativePath: string): Promise<FilePermissions>;

  // 流式上传（大文件 > 1MB）
  createUploadStream(serverId: ServerId, relativePath: string, size: number): WritableStream;
}

// 安全约束（实现层强制执行，接口层标注）：
// 1. 所有路径必须通过 fs.realpath() 解析后再做前缀匹配
// 2. 白名单路径前缀：Servers/<ID>/Server/ | Workshop/ | Logs/ | Rocket/ | openmod/ | Bundles/
// 3. 拒绝包含 \x00 的路径，拒绝 symlink 出白名单的路径
// 4. 已知敏感字段（GSLT/Password/Login_Token/RCON Password）在通用读取时替换为 [REDACTED]
```

### 5.9 其他模块接口

```typescript
// shared/contracts/auth.ts
interface IAuthService {
  login(username: string, password: string): Promise<{ accessToken: string; refreshToken: string }>;
  refresh(refreshToken: string): Promise<{ accessToken: string; refreshToken: string }>;
  logout(refreshJti: string): Promise<void>;
  validateAccessToken(token: string): JwtPayload | null;
}

// shared/contracts/a2s.ts
interface IA2SClient {
  query(serverId: ServerId): Promise<A2SInfo>;
  destroy(): Promise<void>;  // 关闭 UDP socket
  // 返回：{ players: number, maxPlayers: number, map: string, version: string, latency: number }
  // 超时 3s，UDP 协议，只读
}

// shared/contracts/filelock.ts
interface IFileLockProvider {
  acquire(path: string, owner: string, timeoutMs?: number): Promise<void>;  // 默认 10s 超时
  release(path: string, owner: string): void;
  isLocked(path: string): boolean;
  // ConfigService 和 FilesService 共享同一实例，按文件路径互斥
}

// shared/contracts/steamcmd.ts
interface ISteamCmdManager {
  getStatus(): Promise<SteamCmdStatus>;            // 安装状态/路径/版本
  install(installDir: string): Promise<void>;      // 下载 SteamCMD 本身
  updateU3DS(installDir: string): Promise<void>;   // app_update 1110390 validate
  // 生命周期：updateU3DS 内部先检查所有 U3DS 实例是否 STOPPED，否则拒绝
}

// shared/contracts/workshop.ts
interface IWorkshopMetadataService {
  getModDetails(modId: WorkshopFileId): Promise<WorkshopModMeta | null>;
  searchMods(query: string): Promise<WorkshopModMeta[]>;
  refreshCache(modId: WorkshopFileId): Promise<void>;
  // WebAPI Key（IPublishedFileService/GetDetails）主路径；?xml=1 已废弃
  // 缓存：DB-backed LRU，stale-while-revalidate（600s 后尝试刷新但不驱逐旧数据）
}

// shared/contracts/logstream.ts
interface ILogStreamer {
  startStreaming(serverId: ServerId): void;
  stopStreaming(serverId: ServerId): void;
  // 内部：tail 文件 + 消费 ProcessSupervisor.onStdout（通过 PTY 伪终端采集，
  // PTY 二进制自举参考 .research/GameServerManager/start.sh 第 36–60 行）
  // 输出：通过 IBroadcaster.broadcast({type:'console_line',...})
  // 安全：所有输出经过双重凭证脱敏——已知密钥精确匹配 + 正则模式匹配
}
```
### 5.10 REST API 端点约定

所有 REST 端点遵循以下约定：

**URL 模式**：`/api/servers/:serverId/<resource>`（全局端点用 `/api/<resource>`）

**状态码语义**：
| 状态码 | 语义 |
|---|---|
| 200 | 成功（GET/PUT） |
| 201 | 创建成功（POST） |
| 202 | 已接受，异步处理中（start/restart/mod apply） |
| 400 | 请求参数校验失败 |
| 401 | 未认证（JWT 过期/无效） |
| 403 | 已认证但权限不足（Owner 专属指令） |
| 404 | 资源不存在（ServerID 无效） |
| 409 | 操作冲突（activeOperation 非 none / 乐观锁 version 不匹配） |
| 500 | 服务端内部错误（不暴露堆栈） |

**响应格式**：
```typescript
// 成功
{ "data": T }

// 错误
{ "error": { "code": string, "message": string, "detail"?: string } }
```

**端点清单**（§6 数据流中引用的核心端点）：

| 方法 | 路径 | 用途 | 对应接口 |
|---|---|---|---|
| POST | `/api/auth/login` | 登录 | IAuthService.login |
| POST | `/api/auth/refresh` | 刷新 token | IAuthService.refresh |
| POST | `/api/auth/logout` | 注销 | IAuthService.logout |
| GET | `/api/servers` | 列出所有服务端 | IServerManager.listServers |
| POST | `/api/servers` | 创建服务端 | IServerManager.createServer |
| PATCH | `/api/servers/:id` | 配置服务端 | IServerManager.configureServer |
| POST | `/api/servers/:id/start` | 启动 | IServerManager.start |
| POST | `/api/servers/:id/stop` | 停止 | IServerManager.stop |
| POST | `/api/servers/:id/restart` | 重启 | IServerManager.restart |
| POST | `/api/servers/:id/mods/apply` | 应用 Mod 变更 | IServerManager.applyModChanges |
| POST | `/api/servers/:id/rcon/execute` | 执行 RCON 命令 | IRconManager.execute |
| GET | `/api/servers/:id/config/commands` | 读 Commands.dat | IConfigService.readCommandsDat |
| PUT | `/api/servers/:id/config/commands` | 写 Commands.dat | IConfigService.writeCommandsDat |
| GET | `/api/servers/:id/config/txt` | 读 Config.txt | IConfigService.readConfigTxt |
| PUT | `/api/servers/:id/config/txt` | 写 Config.txt | IConfigService.writeConfigTxt |
| GET | `/api/servers/:id/config/workshop` | 读 Workshop 配置 | IConfigService.readWorkshopConfig |
| PUT | `/api/servers/:id/config/workshop` | 写 Workshop File IDs | IConfigService.writeWorkshopFileIds |
| GET | `/api/servers/:id/files` | 文件浏览 | IFilesService.listDirectory |
| POST | `/api/servers/:id/files/upload` | 文件上传 | IFilesService.createUploadStream |
| GET | `/api/steamcmd/status` | SteamCMD 状态 | ISteamCmdManager.getStatus |
| POST | `/api/steamcmd/update` | 更新 U3DS | ISteamCmdManager.updateU3DS |
| GET | `/api/workshop/mods/:fileId` | Mod 详情 | IWorkshopMetadataService.getModDetails |

---

## 6. 关键数据流

### 6.1 服务端启动序列

```
POST /api/servers/:id/start
        │
        ▼
  ServerManager.start(id)
        │
        ├─ check activeOperation.type === 'none'  （否则 409 Conflict）
        ├─ state → STARTING
        ├─ IBroadcaster.broadcast({type:'state_change', to:STARTING})
        │
        ├─ IProcessSupervisor.spawn(id, './ServerHelper.sh',
        │     ['+InternetServer/' + id, '-ThreadedConsole'])
        │
        ├─ poll: A2SClient.query(id) 每 3s 直到返回有效响应
        │     │
        │     ├─ 60s 内成功 ──► state → RUNNING
        │     │                 IBroadcaster.broadcast({type:'state_change', to:RUNNING})
        │     │
        │     └─ 60s 超时 ──► state → STARTING (进程存活但 A2S/RCON 不可达)
        │                    UI 显示 "服务器启动超时，可能正在下载 Mod"
        │
        └─ RconManager.connect(id)
              │
              ├─ 成功 ──► RconManager.onStateChange → ServerManager
              │           state → RUNNING (如果还没到)
              │
              └─ 失败 ──► state 保持 RUNNING (进程在跑)
                          rconReachable = false
```

### 6.2 Mod 变更 + 重启流水线

```
POST /api/servers/:id/mods/apply   { fileIds: [...] }
        │
        ▼
  ServerManager.applyModChanges(id, modIds)
        │
        ├─ check activeOperation === 'none'  （否则 409）
        ├─ activeOperation = {type:'mod_apply', startedAt, modIds}
        │
        ├─ ① ConfigService.backup(id, 'WorkshopDownloadConfig.json')
        │     → 备份到面板数据目录，返回备份路径
        │
        ├─ ② ConfigService.writeWorkshopFileIds(id, newIds)
        │
        ├─ ③ RconManager.execute(id, 'Say "服务器将在 60 秒后重启以应用 Mod 变更"')
        │     IBroadcaster.broadcast({type:'mod_apply_progress', stage:'broadcasting', remaining:60})
        │
        ├─ ④ 每隔 10s 广播一次倒计时，共 5 次（60→50→40→30→20→10）
        │
        ├─ ⑤ RconManager.execute(id, 'Save')
        │
        ├─ ⑥ RconManager.execute(id, 'Shutdown 10 "Mod 变更重启"')
        │     state → STOPPING
        │
        ├─ ⑦ ProcessSupervisor.waitForExit(id, 30s)
        │     │
        │     ├─ 正常退出 → state → STOPPED
        │     └─ 30s 超时 → ProcessSupervisor.forceKill(id) → state → STOPPED
        │
        ├─ ⑧ ProcessSupervisor.spawn(id, ...)  （走 §6.1 启动序列）
        │
        └─ ⑨ RCON 恢复 → RconManager.execute(id, 'Say "Mod 变更已应用"')
              activeOperation = {type:'none'}
              IBroadcaster.broadcast({type:'mod_apply_progress', stage:'completed'})
```

### 6.3 控制台日志流（双路合并 + 凭证脱敏）

```
  ┌─────────────────────┐    ┌──────────────────────┐
  │ ProcessSupervisor   │    │ 文件系统               │
  │ onStdout(line)      │    │ Servers/<ID>/Logs/    │
  └────────┬────────────┘    └──────────┬────────────┘
           │                            │
           │ stdout 行 (实时)            │ fs.watch / 定时 read (轮询)
           │                            │
           ▼                            ▼
  ┌──────────────────────────────────────────────────┐
  │              LogStreamer                         │
  │                                                  │
  │  ① 合并两路为单一事件流（按时间戳排序）            │
  │  ② 凭证脱敏管道：                                 │
  │     - 匹配 /7656119\d{10}:[^\s]+/ → SteamID:[REDACTED]
  │     - 匹配 /login\s+\S+/i → "login [REDACTED]"
  │     - 匹配 /GSLT\s+\S+/i → "GSLT [REDACTED]"
  │     - 匹配 /Login_Token\s+\S+/i → "Login_Token [REDACTED]"
  │  ③ 限制频率：最多 100 行/秒，超出则批量合并          │
  │  ④ 最多保留最近 500 行缓冲区                       │
  └──────────────────────┬───────────────────────────┘
                         │
                         ▼
  IBroadcaster.broadcast({type:'console_line', serverId, line, source:'stdout'|'file'})
                         │
                         ▼
  WsBroadcaster → 根据 serverId 路由 → 对应 ws 连接 → 浏览器 ConsoleOutput
```

### 6.4 RCON 命令执行（含安全防护）

```
POST /api/servers/:id/rcon/execute   { command: "Kick 76561198... Griefing" }
        │
        ▼
  RconManager.execute(id, rawCommand)
        │
        ├─ ① 解析命令名和参数（按空格拆分）
        │
        ├─ ② 危险指令检查（cmdName in DANGEROUS_COMMANDS）
        │     → 已在前端 ConfirmDialog 确认，后端再次验证
        │
        ├─ ③ Owner 专属指令检查（cmdName in OWNER_ONLY_COMMANDS）
        │     → 验证 JWT 身份是否匹配该 serverId 的 Owner SteamID64
        │     → 不匹配返回 403
        │
        ├─ ④ 参数清洗（IRconManager 实现层负责）
        │     args = args.map(stripControlCharacters)
        │     // 移除 \r \n \0 及所有 charCode < 0x20
        │
        ├─ ⑤ 命令拼接（Telnet fallback 时逐字节构建，不插 \r\n）
        │
        └─ ⑥ 发送 + 等待响应
              │
              ├─ 10s 超时 → reject + 前端显示 "命令超时"
              └─ 成功 → 返回响应文本
```

---

## 7. 数据库 Schema

### 7.1 DDL

```sql
-- 服务端实例
CREATE TABLE servers (
  id          TEXT PRIMARY KEY,              -- ServerID, e.g. "MyServer"
  name        TEXT NOT NULL DEFAULT '',       -- 显示名称
  game_port   INTEGER NOT NULL DEFAULT 27015,
  state       TEXT NOT NULL DEFAULT 'STOPPED', -- STOPPED|STARTING|RUNNING|DEGRADED|STOPPING
  rcon_protocol TEXT,                         -- 'openmod'|'rocketmod'|null
  rcon_port   INTEGER,
  rcon_password_enc TEXT,                     -- AES-GCM 加密的 RCON 密码
  owner_steam_id TEXT,                        -- 服主 SteamID64
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 用户表（v1 单用户，v2 多用户扩展预留）
CREATE TABLE users (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  username    TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,               -- Argon2id
  is_admin    INTEGER NOT NULL DEFAULT 1,    -- v1 始终为 1
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- JWT refresh token 黑名单（注销 + 轮换）
CREATE TABLE refresh_tokens (
  jti         TEXT PRIMARY KEY,              -- JWT ID
  user_id     INTEGER NOT NULL REFERENCES users(id),
  expires_at  TEXT NOT NULL,
  revoked_at  TEXT,                           -- null = 有效
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 配置文件快照（乐观锁版本追踪 + 回滚）
CREATE TABLE config_snapshots (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  server_id   TEXT NOT NULL REFERENCES servers(id),
  file_path   TEXT NOT NULL,                 -- 相对路径, e.g. "Server/Commands.dat"
  content     TEXT NOT NULL,
  version     INTEGER NOT NULL,              -- 乐观锁版本号 = 修改次数
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Workshop Mod 元数据缓存
CREATE TABLE workshop_mods (
  file_id     TEXT PRIMARY KEY,              -- Steam Workshop File ID
  title       TEXT NOT NULL DEFAULT '',
  author      TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  preview_url TEXT,
  file_size   INTEGER,
  updated_at_steam TEXT,                     -- Steam 上的更新时间
  cached_at   TEXT NOT NULL DEFAULT (datetime('now')),  -- 本地缓存时间
  raw_xml     TEXT                            -- 废弃字段：原 ?xml=1 响应（保留兼容）
);

-- 审计日志（危险操作全记录）
CREATE TABLE audit_logs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  server_id   TEXT,                          -- 可为 null（全局操作）
  action      TEXT NOT NULL,                 -- 'server.start' | 'server.stop' | 'mod.apply' | ...
  actor       TEXT NOT NULL DEFAULT 'admin', -- v2 改为 user_id
  detail      TEXT,                          -- JSON 格式的额外信息
  ip_address  TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 索引
CREATE INDEX idx_servers_state ON servers(state);
CREATE INDEX idx_config_snapshots_server_file ON config_snapshots(server_id, file_path);
CREATE INDEX idx_audit_logs_server ON audit_logs(server_id, created_at);
CREATE INDEX idx_audit_logs_action ON audit_logs(action, created_at);
```

### 7.2 迁移策略

- 使用 `better-sqlite3` 的 `user_version` PRAGMA 进行 schema 版本管理
- 迁移脚本放在 `manager-server/src/db/migrations/`，命名格式 `NNN-description.sql`
- 首次启动时自动执行所有未执行的迁移
- 所有迁移在事务内执行

---

## 8. 安全架构

### 8.1 认证链路

```
登录
  │
  ├─ POST /api/auth/login { username, password }
  │     → Argon2id 验证
  │     → 签发 access_token (JWT, 15min, 存在内存，不落 localStorage)
  │     → 签发 refresh_token (JWT, 7d, httpOnly + Secure + SameSite=Strict cookie)
  │
  ├─ 每次请求
  │     → Authorization: Bearer <access_token>
  │     → Express 中间件验证签名 + 过期
  │     → 过期 → 前端用 refresh_token cookie 换新的 access_token
  │
  ├─ WebSocket 升级
  │     → 查询参数 ?token=<access_token>
  │     → ws verifyClient 回调验证
  │     → 失败 → 拒绝连接
  │
  └─ 注销
        → refresh_token 的 jti 写入 refresh_tokens 表 (revoked_at = now)
        → 浏览器清除 cookie
```

### 8.2 凭证存储

| 凭证类型 | 存储方式 | 算法 |
|---|---|---|
| 用户密码 | `users.password_hash` | Argon2id (OWASP 推荐参数) |
| RCON 密码 (OpenMod) | `servers.rcon_password_enc` | AES-256-GCM, 密钥来自环境变量 |
| RCON 密码 (RocketMod) | 同上 | 同上 |
| Steam WebAPI Key (可选) | 同 AES-256-GCM | 同上 |
| GSLT | `Commands.dat` 中明文（U3DS 读取需要），Files 页读取时替换为 `[REDACTED]` | — |

### 8.3 速率限制（Express 中间件）

| 端点 | 限制 | 窗口 |
|---|---|---|
| POST /api/auth/login | 5 次 | 15 分钟（同一 IP） |
| POST /api/servers/:id/rcon/execute | 2 次/秒 | 1 秒（同一 session） |
| POST /api/servers/:id/files/upload | 3 并发 | — |
| GET /api/workshop/mods/:id | 1 次/60秒 | 60 秒（同一 mod ID，命中缓存） |
| 全局 | 100 次/秒 | 1 秒（同一 IP） |

### 8.4 安全头（Express + 反向代理双层）

```
Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' ws: wss:
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Strict-Transport-Security: max-age=31536000; includeSubDomains
Referrer-Policy: strict-origin-when-cross-origin
```

### 8.5 输入校验

| 输入 | 校验规则 |
|---|---|
| ServerID | `/^[A-Za-z0-9_-]{1,64}$/` |
| SteamID64 | `/^7656119\d{10}$/` |
| Workshop File ID | 正整数, 1–999999999999 |
| 文件路径 | 拒绝 `\x00`, 拒绝 `..` 穿越, fs.realpath 解析后做白名单前缀匹配 |
| RCON 命令参数 | 剥离 `\r` `\n` `\0` 及所有 charCode < 0x20 |
| YAML/XML 文件 | 最大 1MB, js-yaml DEFAULT_SCHEMA (无 !!js/*), fast-xml-parser 禁用 DTD |

### 8.6 Owner 专属指令鉴权（后端强制，非仅前端隐藏）

```
OWNER_ONLY_COMMANDS = ['Owner', 'Cheats', 'Shutdown']

RconManager.execute(serverId, command):
  cmdName = command.split(/\s+/)[0].toLowerCase()
  if cmdName in OWNER_ONLY_COMMANDS:
    if jwt.steamId !== servers.get(serverId).owner_steam_id:
      return 403 Forbidden
```

---

## 9. 横切关注点

### 9.1 日志

- 后端日志：pino（结构化 JSON），级别由环境变量 `LOG_LEVEL` 控制
- 审计日志：所有状态变更 + 危险操作写入 `audit_logs` 表
- RCON 凭证绝不出现在任何日志中（构造认证调用时不 log 参数）
- 日志滚动：pino 内置 transport 按天切分，保留 30 天

### 9.2 错误处理

- Express 全局错误处理器：捕获所有未处理异常，返回统一 `{ error, code, detail? }` JSON
- RCON 超时：10s → reject → 前端 "命令超时"
- 文件操作失败：返回具体错误 + 建议操作（权限不足 / 磁盘满 / 路径不存在）
- 进程崩溃：ProcessSupervisor.onCrash → ServerManager 状态机处理 → audit_log 记录
- 绝不暴露堆栈跟踪给前端（生产环境 `NODE_ENV=production`）

### 9.3 依赖注入

- 使用手动 DI（不引入框架）——在 `manager-server/src/composition-root.ts` 中集中组装
- 核心域层只依赖接口（存在 `shared/contracts/`），实现注入在 API 层入口
- 模块依赖关系（→ = 依赖）：

```
ServerManager → ProcessSupervisor, RconManager, A2SClient, ConfigService, IBroadcaster
ConfigService → FileLockProvider
FilesService → FileLockProvider, IFileAccessProvider (本地实现)
SteamCmdManager → ProcessSupervisor
WorkshopMetadataService → (HTTP client, 独立无依赖)
AuthService → (better-sqlite3, 独立无依赖)
LogStreamer → ProcessSupervisor.onStdout, IBroadcaster
RconManager → A2SClient (端口探测), FileLockProvider (凭证文件锁)
WsBroadcaster → (实现 IBroadcaster, 无业务依赖)
ProcessSupervisor → (child_process, 独立无依赖)
A2SClient → (UDP socket, 独立无依赖)
```

### 9.4 测试策略

| 层 | 工具 | 覆盖要求 |
|---|---|---|
| 基础设施层 | Jest | 单元测试：模块接口的所有公开方法 |
| 核心域层 | Jest | ServerManager 状态机所有转换路径、ConfigService 往返测试 |
| API 层 | Jest + supertest | 所有 HTTP 端点 + WebSocket 升级流程 |
| 前端 | Vitest + Playwright | 每个 P0 页面至少一个 E2E 冒烟用例 |
| 安全 | Fuzz 测试 | RCON 命令注入、路径穿越的自动化攻击向量 |

> 具体测试方法（录制回放、mock 策略）见实现计划。A2S/RconManager 测试不依赖真 U3DS 进程。

---

> **本文档是 `docs/architecture/` 的核心文件。**  
> 与 `design-system-mapping.md`（设计系统映射）并列为架构层两大权威来源。  
> 任何架构变更必须先改本文档、再改代码。PR 评审以本文档为基准。
