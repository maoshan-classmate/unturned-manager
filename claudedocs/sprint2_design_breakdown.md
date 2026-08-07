# Sprint 2 设计拆解 — 从脚手架到可运行 MVP

> 产出：`/sc:design --think-hard`  
> 输入：`docs/architecture/architecture-spec.md`  
> 日期：2026-08-07  
> 状态：📐 设计阶段（待审批后 `/sc:implement`）

---

## 0. 现状基线

### 0.1 已完成（Sprint 1）

| 层 | 模块 | 状态 |
|---|---|---|
| 后端 | `AuthService` (JWT + Argon2id) | ✅ 真实实现 |
| 后端 | Express + ws 启动 + 优雅关闭 | ✅ |
| 后端 | 8 个路由文件（全挂 stub） | ⚠️ 骨架 |
| 后端 | DI 容器 (`composition-root.ts`, 11 stub) | ⚠️ 骨架 |
| 前端 | `LoginPage` (shadcn/ui + Motion + RHF + Zod) | ✅ |
| 前端 | `Sidebar` (Figma 5:29 1:1) | ✅ |
| 前端 | 8 个 `Placeholder` 页面 | ❌ 未实现 |
| 共享 | 12 个接口契约 (`shared/contracts/`) | ✅ |
| 共享 | Branded types + Domain types | ✅ |

### 0.2 12 模块实现矩阵

| 模块 | 层 | Sprint 2 优先级 |
|---|---|---|
| `AuthService` | 核心域 | ✅ Done |
| `ProcessSupervisor` | 基础设施 | 🔴 P0 — 启动服务器的前提 |
| `ServerManager` | 核心域 | 🔴 P0 — 聚合根，编排一切 |
| `ConfigService` | 核心域 | 🔴 P0 — Dashboard 需要读 Commands.dat |
| `RconManager` | 基础设施 | 🟡 P1 — Console 页面依赖 |
| `A2SClient` | 基础设施 | 🟡 P1 — Dashboard StatCard 依赖 |
| `FilesService` | 核心域 | 🟡 P1 — Files 页面依赖 |
| `WsBroadcaster` | API 层 | 🟡 P1 — 实时推送依赖 |
| `LogStreamer` | 核心域 | 🟢 P2 — Console 增强 |
| `SteamCmdManager` | 核心域 | 🟢 P2 — Server Setup 依赖 |
| `WorkshopMetadataService` | 核心域 | 🟢 P2 — Mods 页面依赖 |
| `FileLockProvider` | 基础设施 | 🟢 P2 — ConfigService 并发 |

---

## 1. Sprint 2 目标

> **一句话**：让 Dashboard 和 Console（两个 P0 页面）能跑真数据，ServerManager 能启动/停止 U3DS 进程。

### 1.1 范围定义

```
Sprint 2 = 基础设施层 (4 模块) + 核心域层 (3 模块) + 前端 (2 页面)
         = 7 后端模块 + 2 前端页面 + 数据库 DDL
```

### 1.2 不包括

- ❌ Mods 页面（需要 Steam WebAPI → Sprint 3）
- ❌ Files 页面（需要 FilesService 真实实现 → Sprint 3）
- ❌ Server Setup（需要 SteamCMD → Sprint 4）
- ❌ Players 页面（需要 A2S 真实实现 → Sprint 3）
- ❌ Config 编辑（需要 ConfigService 写入路径 → Sprint 3）
- ❌ Docker 部署

---

## 2. 模块实现顺序（依赖拓扑）

```
                        ┌─────────────────┐
                        │   AuthService   │  ← Sprint 1 ✅
                        └────────┬────────┘
                                 │
              ┌──────────────────┼──────────────────┐
              │                  │                  │
              ▼                  ▼                  ▼
    ┌─────────────────┐ ┌──────────────┐ ┌─────────────────┐
    │ ProcessSupervisor│ │ RconManager  │ │ FileLockProvider│
    │  (spawn/kill)    │ │ (RCON 连接)   │ │  (文件互斥锁)    │
    └────────┬────────┘ └──────┬───────┘ └────────┬────────┘
             │                 │                   │
             ▼                 ▼                   ▼
    ┌──────────────────────────────────────────────────────┐
    │                  Wave 2: 核心域层                      │
    │                                                      │
    │  ┌──────────────────┐  ┌──────────────────┐          │
    │  │  ServerManager   │  │  ConfigService   │          │
    │  │  (聚合根)         │──│  (Commands.dat   │          │
    │  │  五状态机         │  │   只读路径)       │          │
    │  │  start/stop/      │  └────────┬─────────┘          │
    │  │  restart          │           │                    │
    │  └────────┬──────────┘           │                    │
    │           │                      │                    │
    └───────────┼──────────────────────┼────────────────────┘
                │                      │
                ▼                      ▼
    ┌──────────────────────────────────────────────────────┐
    │                  Wave 3: API 层 + 前端                 │
    │                                                      │
    │  ┌──────────────────┐  ┌────────────────────────┐    │
    │  │  WsBroadcaster   │  │  前端页面                │    │
    │  │  (ws 事件广播)    │  │  · Dashboard            │    │
    │  └──────────────────┘  │  · Console               │    │
    │                        └─────────────────────────┘    │
    └──────────────────────────────────────────────────────┘
```

**依赖规则**：下层不依赖上层。基础设施层 4 模块之间无相互依赖。

---

## 3. Wave 1: 基础设施层（3 天）

### 3.1 ProcessSupervisor — `manager-server/src/modules/process/`

**职责**：spawn/kill U3DS 进程，存活检测，崩溃回调

```
ProcessSupervisor.ts
├── spawn(serverId, command, args) → PID
│     · child_process.spawn(), stdio: ['ignore', 'pipe', 'pipe']
│     · 维护 Map<ServerId, ChildProcess>
│     · 进程退出时自动触发 onCrash 回调
│
├── gracefulShutdown(serverId, timeoutMs=30000)
│     · 发送 SIGTERM → waitForExit(25s) → forceKill
│
├── forceKill(serverId)
│     · process.kill('SIGKILL')
│
├── isRunning(serverId) → boolean
│     · process.killed === false && exitCode === null
│
├── onStdout(serverId, callback)
│     · child.stdout.on('data', ...) → readline → callback(line)
│
├── onCrash(callback)
│     · child.on('exit', ...) → callback(serverId, exitCode)
│
└── destroy()
      · kill all managed children
```

**关键约束**：
- 不实现 PTY（伪终端采集留给 LogStreamer，Sprint 3）
- 不对命令做任何 Shell 解析（不用 `shell: true`）
- 崩溃后不自动重启（重启逻辑在 ServerManager 状态机）

### 3.2 RconManager — `manager-server/src/modules/rcon/`

**职责**：RCON 连接管理与命令执行（OpenMod 优先 → RocketMod 回落）

```
RconManager.ts
├── connect(serverId)
│     · 读 openmod.yaml → rcon.port (默认 25545)
│     · 尝试 Valve Source RCON (rcon-srcds) 连接
│     · 2s 超时 → 回落 Telnet RCON (游戏端口+2)
│     · 凭证格式：OpenMod = "SteamID:密码", Rocket = "login 密码\r\n"
│     · 缓存协议模式 60s
│
├── execute(serverId, command) → response string
│     · 参数清洗：strip \r\n\0 + charCode<0x20
│     · 危险指令检查（Shutdown/Ban/Slay/Cheats）
│     · 10s 超时
│
├── disconnect(serverId)
├── getProtocol(serverId) → RconProtocol
├── isReachable(serverId) → boolean
│
├── onStateChange(callback)
│     · 30s 心跳 ping → 连续 3 次失败 → DISCONNECTED
│
└── destroy()
```

**测试策略**（CLAUDE.md §5.4）：RCON 助手用录制回放测，不连真服务端。

### 3.3 A2SClient — `manager-server/src/modules/a2s/`

**职责**：Valve A2S_INFO UDP 查询（玩家数、地图、版本、延迟）

```
A2SClient.ts
├── query(serverId) → A2SInfo
│     · @fabricio-191/valve-server-query
│     · UDP 端口 = 游戏端口 + 1
│     · 超时 3s
│     · 返回 {players, maxPlayers, map, version, latency}
│
└── destroy()
```

**注意**：UDP 不需要"连接"，每次 query 独立发包。

### 3.4 FileLockProvider — `manager-server/src/modules/filelock/`

**职责**：文件级互斥锁注册表（ConfigService + FilesService 共享）

```
FileLockProvider.ts
├── acquire(path, owner, timeoutMs=10000)
│     · Map<path, {owner, acquiredAt}>
│     · 已锁 → 等待 timeoutMs → 仍锁 → throw
│
├── release(path, owner)
│     · 验证 owner 匹配 → 删除 Map entry
│
└── isLocked(path) → boolean
```

**注意**：v1 仅进程内互斥（单进程 Express），不需要跨进程锁。

---

## 4. Wave 2: 核心域层（3 天）

### 4.1 ServerManager — `manager-server/src/modules/server/`

**职责**：服务端生命周期编排 + 五状态机 + 操作互斥

**状态转换图**（架构规格书 §5.2）：

```
                 ┌─────────┐
          start  │ STOPPED │
        ┌──────►│         │◄─────────┐
        │       └────┬─────┘          │
        │            │ stop/forceStop │
        ▼            │  (进程退出)     │
   ┌─────────┐      │                │
   │STARTING │      │           ┌─────────┐
   │         │──────┘           │STOPPING │
   └────┬────┘   A2S 就绪       │         │
        │        (60s 内)       └────▲────┘
        │            │               │
        ▼            ▼               │
   ┌─────────┐  ┌──────────┐        │
   │ RUNNING │  │ DEGRADED │────────┘
   │         │──│          │ RCON 断
   └─────────┘  └──────────┘  (3 ping fail)
```

```
ServerManager.ts
├── 状态存储：Map<ServerId, {state, activeOp, config}>
├── 数据库：servers 表 CRUD
│
├── listServers() → ServerConfig[]
├── createServer(config) → void             // INSERT servers 表
├── configureServer(id, patch) → void       // UPDATE servers 表
│
├── start(id) → 202 Accepted
│     · 检查 activeOperation === 'none'（否则 409）
│     · state → STARTING
│     · broadcast({type:'state_change', to:STARTING})
│     · ProcessSupervisor.spawn(id, './ServerHelper.sh', [...])
│     · 轮询 A2SClient.query(id) 每 3s，最多 60s
│     · 成功 → state → RUNNING + RconManager.connect(id)
│     · 超时 → state → STARTING (进程存活但 A2S 不可达)
│
├── stop(id, reason) → 202 Accepted
│     · RconManager.execute(id, 'Save')
│     · RconManager.execute(id, `Shutdown 10 "${reason}"`)
│     · state → STOPPING
│     · ProcessSupervisor.waitForExit(id, 30s)
│     · 成功 → state → STOPPED
│
├── restart(id, reason) → stop → 等退出 → start
│
├── forceStop(id) → SIGKILL → state → STOPPED
│
└── 状态查询：getState(id) / getActiveOperation(id)
```

**关键竞态防护**（`activeOperation`）：
```typescript
if (current.activeOperation.type !== 'none') {
  return 409 Conflict  // 前端必须显示"操作进行中"
}
```

### 4.2 ConfigService — `manager-server/src/modules/config/`

**职责**：配置文件语义读写（先只实现只读路径，写路径 Sprint 3）

```
ConfigService.ts
├── readCommandsDat(serverId) → CommandsDatRecord
│     · 文件路径：Servers/<ID>/Server/Commands.dat
│     · 解析：每行 "Key Value" / "Key"（开关）
│     · # 和 ; 开头 → 注释行
│     · known 字段映射到已知键枚举
│     · unknown 字段保留（CLAUDE.md §4.3 硬约束）
│
├── readConfigTxt(serverId) → ConfigTxtRecord
│     · 通用 Key-Value 解析
│     · 段（section）识别
│
├── readWorkshopConfig(serverId) → WorkshopConfig
│     · JSON.parse(WorkshopDownloadConfig.json)
│
├── 写路径（Sprint 3 实现）：
│     writeCommandsDat / writeWorkshopFileIds / backup
│
└── 临时：所有写方法 throw 501 Not Implemented
```

**Commands.dat 解析器设计**：

```
输入行 → 类型判断：
  · 空行/纯空格 → 跳过（输出时保留）
  · ^[#;] → comment（保留原样）
  · ^(\w+)\s+(.+)$ → knownKey? {key, value} : unknownKey {key, value}
  · ^(\w+)$ → flagKey（开关型指令如 Whitelisted/Cheats/Gold）
```

### 4.3 WsBroadcaster — `manager-server/src/ws/`

**职责**：IBroadcaster 接口唯一实现，WebSocket 事件广播 + 连接管理

```
WsBroadcaster.ts (增强现有 gateway.ts)
├── broadcast(event: ServerEvent)
│     · 遍历所有连接的 ws client
│     · 按 serverId 过滤订阅
│     · JSON.stringify → ws.send()
│
├── register(ws, serverIds)
│     · Map<WebSocket, Set<ServerId>>
│
├── unregister(ws)
│     · ws.close() + 清理 Map
│
└── init(server, authService)
      · server.on('upgrade', ...) → ws 升级
      · verifyClient: JWT 验证（?token=xxx 查询参数）
```

---

## 5. Wave 3: 前端页面（3 天）

### 5.1 Dashboard 页面 — `/`

**Figma 设计**：页面 `2:2` 🎨 Dashboard（架构规格书 §4.2 组件树）

```
Dashboard/
├── StatCard ($5:34) × 4
│   · 服务器状态 (Running/Stopped/Degraded)
│   · 在线玩家数 (A2S players)
│   · CPU 使用率 (来自 ProcessSupervisor OS stats)
│   · 已装 Mod 数 (WorkshopDownloadConfig.File_IDs.length)
│
├── AreaChart (recharts)
│   · 24h 玩家趋势（来源：A2S 定时轮询 + 内存缓存）
│
├── BarChart (recharts)
│   · 资源使用（来源：ProcessSupervisor 内存/CPU）
│
└── QuickActions
    · [启动] [停止] [重启] 按钮
    · Button Primary ($5:52)
```

**数据流**：
```
Dashboard mount
  → GET /api/servers → 获取所有 serverId
  → 选第一个 serverId
  → GET /api/servers/:id (ServerState + activeOp)
  → A2S query → 玩家数
  → WS connect → 订阅 state_change / console_line 事件
  → 3s 轮询 A2S 更新 StatCard
```

**实现要点**：
- StatCard 复用 `Card` + 自定义内部布局
- 图表用 recharts（已钉死 §2.1）
- 启动/停止按钮依赖 ServerManager API → 202 异步处理
- Loading 骨架屏 + 错误状态（无服务器/服务器不可达）

### 5.2 Console 页面 — `/:serverId/console`

**Figma 设计**：页面 `2:3` 🎨 Console

```
Console/
├── ServerTabBar
│   · 多 ServerID 切换 Tab
│   · 每个 Tab: Server 名 + 状态灯 (green/red/yellow)
│
├── ConsoleToolbar
│   · 预设命令按钮：Say / Save / Players / Kick / Day / Shutdown
│   · 危险指令 (Shutdown) 需要 ConfirmDialog ($12:16436)
│
├── ConsoleOutput
│   · 虚拟滚动 (react-window 或 @tanstack/react-virtual)
│   · 行级别渲染：ANSI 转义 → 颜色 span
│   · 来源标记：stdout 青色 vs file 灰色
│   · 自动滚底 + 手动上滚时暂停
│
└── ConsoleInput
    · Input + 发送按钮
    · ↑↓ 历史命令翻页
    · 发送前清洗（危险指令二次确认）
```

**数据流**：
```
Console mount
  → WS connect (订阅 console_line 事件)
  → 初始加载：GET /api/servers/:id/console/history (最近 500 行)
  → 用户输入 → POST /api/servers/:id/rcon/execute { command }
  → 响应显示在输出区（前缀 >）
```

**实现要点**：
- ConsoleOutput 缓冲区限制 500 行（前端再限制）
- 自动滚底：`useEffect` + `scrollIntoView`
- ANSI 着色：正则匹配 `\x1b[...m` → 映射到 Tailwind 颜色类
- 命令历史：`useRef<string[]>` 本地存储

---

## 6. 数据库 DDL（Wave 1 首日）

架构规格书 §7.1 定义的完整 DDL，按迁移顺序：

```
migrations/
├── 001-create-servers.sql
│     CREATE TABLE servers (...)
│
├── 002-create-users.sql
│     CREATE TABLE users (...)         ← AuthService 已用
│     CREATE TABLE refresh_tokens (...)
│
├── 003-create-config.sql
│     CREATE TABLE config_snapshots (...)
│
├── 004-create-workshop.sql
│     CREATE TABLE workshop_mods (...)
│
└── 005-create-audit.sql
      CREATE TABLE audit_logs (...)
      CREATE INDEX idx_...
```

**迁移执行**：`migrate.ts` 已存在，只需创建 `.sql` 文件。

**注意**：`users` 表可能已在 Sprint 1 创建（seed.ts 用了它）。检查现有 DB，只运行缺失的迁移。

---

## 7. Sprint 2 任务清单

### Wave 1: 基础设施 (P0)

| ID | 任务 | 模块 | 文件 | 估时 |
|---|---|---|---|---|
| W1.1 | DDL 迁移脚本 | db | 5 个 .sql | 2h |
| W1.2 | ProcessSupervisor 实现 | process | 1 file | 4h |
| W1.3 | ProcessSupervisor 单元测试 | process | 1 test | 2h |
| W1.4 | RconManager 实现（含自动探测） | rcon | 2 files | 5h |
| W1.5 | A2SClient 实现 | a2s | 1 file | 1h |
| W1.6 | FileLockProvider 实现 | filelock | 1 file | 1h |
| **小计** | | | | **15h** |

### Wave 2: 核心域 (P0)

| ID | 任务 | 模块 | 文件 | 估时 |
|---|---|---|---|---|
| W2.1 | ServerManager 状态机 | server | 2 files | 6h |
| W2.2 | ConfigService 只读路径 | config | 2 files | 4h |
| W2.3 | WsBroadcaster 增强 | ws | 1 file | 3h |
| W2.4 | ServerManager 集成测试 | server | 1 test | 2h |
| **小计** | | | | **15h** |

### Wave 3: 前端 (P0)

| ID | 任务 | 页面 | 文件 | 估时 |
|---|---|---|---|---|
| W3.1 | Dashboard 页面 (StatCard × 4 + 图表) | Dashboard | 4 files | 6h |
| W3.2 | Console 页面 (Toolbar + Output + Input) | Console | 3 files | 6h |
| W3.3 | useServer + useConsole hooks | hooks | 2 files | 2h |
| W3.4 | E2E 冒烟测试 | e2e | 2 tests | 2h |
| **小计** | | | | **16h** |

### 总计：**46h (~9 个工作日)**

---

## 8. 风险与缓解

| 风险 | 概率 | 缓解 |
|---|---|---|
| U3DS 无实机可用，ProcessSupervisor 无法验证 | 中 | Mock 模式：`NODE_ENV=test` 时 spawn 假进程 (`sleep infinity`) |
| OpenMod RCON 端口不确定 | 低 | 自动探测 + 配置文件读取，2s 超时回落 |
| Commands.dat 未知键丢失 | 中 | 解析器保留 unknown Map → 输出时原样写回 |
| `rcon-srcds` 库 API 变更 | 低 | 固定版本号，Sprint 1 已验证基础连通 |

---

## 9. 完成定义 (DoD)

- [ ] `tsc --noEmit` 零错误
- [ ] `vitest` 后端模块覆盖率 ≥ 80%（改到的文件）
- [ ] `playwright` Dashboard + Console 各 1 个 E2E 冒烟
- [ ] `composition-root.ts` 中 Sprint 2 实现的模块从 stub 替换为真实实现
- [ ] 所有 REST 端点返回正确状态码（不暴露堆栈）
- [ ] 无 `any` 类型引入
- [ ] Serena 记忆更新：`architecture-decisions` + `sessions/2026-08-07-sprint2-design`

---

*本文件是 Sprint 2 实现的唯一设计权威。实现时以此为基准，偏差 > 10% 需更新本文档。*
