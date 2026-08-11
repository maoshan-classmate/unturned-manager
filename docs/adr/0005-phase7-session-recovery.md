# ADR-0005：Phase 7 — 终端会话恢复（1:1 复刻 GSM3 TerminalSessionManager）

- **状态**：草案（2026-08-11）
- **承接**：ADR-0004 §4 实施分期末尾「未来 Phase（待评估）」第 1 条
- **触发**：用户 2026-08-11 拍板「Phase 0-6 全部做完了吗？出 Phase 7」+「参考 GSM3 怎么做」+「1:1 复刻 GSM3（生产验证）」

---

## 1. 决策摘要

**Phase 7 = 1:1 复刻 GSM3 `TerminalSessionManager` 全量能力**。

GSM3 这块代码已经过生产验证（`.research/GameServerManager` 是参考仓），本项目不重新设计，**只做本地化适配**（TS 风格 / DI 风格 / 路径 / 类型对齐本项目规范）。

---

## 2. GSM3 证据

### 2.1 `TerminalSessionManager.ts` 全文结构（GSM3 服务端核心）

**位置**：`.research/GameServerManager/server/src/modules/terminal/TerminalSessionManager.ts`

```typescript
// ─── 类型 ───
interface PersistedTerminalSession {
  id: string;
  name: string;
  workingDirectory: string;
  createdAt: string;          // ISO 8601
  lastActivity: string;       // ISO 8601
  isActive: boolean;
}

interface TerminalSessionsConfig {
  sessions: PersistedTerminalSession[];
  lastUpdated: string;
}

// ─── 存储路径 ───
this.configDir = path.join(process.cwd(), 'data');
this.configPath = path.join(this.configDir, 'terminal-sessions.json');

// ─── 公共 API ───
class TerminalSessionManager {
  async initialize(): Promise<void>;
  async saveSession(sessionData: { id; name; workingDirectory; createdAt: Date; lastActivity: Date; isActive: boolean }): Promise<void>;
  async updateSessionName(sessionId: string, newName: string): Promise<void>;
  async removeSession(sessionId: string): Promise<void>;
  getSavedSessions(): PersistedTerminalSession[];
  getSession(sessionId: string): PersistedTerminalSession | undefined;
  async cleanupExpiredSessions(): Promise<void>;          // 7 天硬编码
  async setSessionActive(sessionId: string, isActive: boolean): Promise<void>;
  getConfigPath(): string;                                // 调试用
}
```

**关键实现**（逐条抄录）：

#### 2.1.1 串行 mutationQueue 防并发写

`.research/GameServerManager/server/src/modules/terminal/TerminalSessionManager.ts:31,98-105`

```typescript
private mutationQueue: Promise<void> = Promise.resolve();

private enqueueMutation<T>(mutation: () => Promise<T>): Promise<T> {
  const operation = this.mutationQueue.then(mutation);
  this.mutationQueue = operation.then(
    () => undefined,
    () => undefined
  );
  return operation;
}
```

> **1:1 抄到本项目 `SessionManager`**——所有写操作走串行队列，JSON 整体读写无并发损坏风险。

#### 2.1.2 原子写（临时文件 + rename）

`.research/GameServerManager/server/src/modules/terminal/TerminalSessionManager.ts:107-125`

```typescript
private async saveConfig(): Promise<void> {
  this.config.lastUpdated = new Date().toISOString();
  const tempPath = path.join(
    this.configDir,
    `.${path.basename(this.configPath)}.${process.pid}.${randomUUID()}.tmp`
  );
  try {
    await fs.writeFile(tempPath, JSON.stringify(this.config, null, 2), 'utf-8');
    await fs.rename(tempPath, this.configPath);
  } catch (error) {
    await fs.rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
}
```

> **1:1 抄到本项目**——同目录临时文件 + `rename` 原子替换；错误时清临时文件。

#### 2.1.3 JSON 损坏降级

`.research/GameServerManager/server/src/modules/terminal/TerminalSessionManager.ts:81-96`

```typescript
private async loadConfig(): Promise<void> {
  try {
    const data = await fs.readFile(this.configPath, 'utf-8');
    this.config = JSON.parse(data);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      await this.saveConfig();          // 首次运行建空文件
    } else {
      throw error;                       // 其他错误向上抛
    }
  }
}
```

> **1:1 抄到本项目**——文件不存在建空配置；解析错误**不**降级（向上抛，让面板启动失败而非用脏数据）。

#### 2.1.4 7 天过期清理

`.research/GameServerManager/server/src/modules/terminal/TerminalSessionManager.ts:228-249`

```typescript
async cleanupExpiredSessions(): Promise<void> {
  await this.enqueueMutation(async () => {
    const now = new Date();
    const expirationThreshold = 7 * 24 * 60 * 60 * 1000; // 7 天硬编码
    const initialLength = this.config.sessions.length;
    this.config.sessions = this.config.sessions.filter(session => {
      const lastActivity = new Date(session.lastActivity);
      const timeDiff = now.getTime() - lastActivity.getTime();
      return timeDiff < expirationThreshold;
    });
    const removedCount = initialLength - this.config.sessions.length;
    if (removedCount > 0) {
      await this.saveConfig();
    }
  });
}
```

> **1:1 抄到本项目**——7 天硬编码（用户已确认）。

### 2.2 服务端 `TerminalManager` 调用 SessionManager 的位置

| 调用 | 行号 | 触发场景 |
|---|---|---|
| `new TerminalSessionManager(logger)` | `TerminalManager.ts:243` | 构造时 |
| `await this.sessionManager.initialize()` | `TerminalManager.ts:266` | 启动时 |
| `await this.sessionManager.removeSession(sessionId)` | `TerminalManager.ts:993` | 显式关会话 |
| `await this.sessionManager.saveSession({...isActive:true})` | `TerminalManager.ts:1030` | promoteAttempt（PTY spawn 成功提交） |
| `await this.sessionManager.removeSession(attempt.id)` | `TerminalManager.ts:1056` | promote 失败回滚 |
| `setSessionActive(session.id, false)` | `TerminalManager.ts:2962` | PTY 退出 |
| `setSessionActive(sessionId, true)` | `TerminalManager.ts:3057` | PTY 重连 |
| `getSavedSessions()` | `TerminalManager.ts:3281` | 路由层响应 |
| `updateSessionName` | `TerminalManager.ts:3181` | 重命名会话 |
| `cleanupExpiredSessions()` | `TerminalManager.ts:257` | **被注释掉，没启用** |

### 2.3 路由层（`.research/GameServerManager/server/src/routes/terminal.ts:44`）

```typescript
const savedSessions = terminalManager.getSavedSessions();
```

> 单点返回 savedSessions 列表，前端合并 `activeSessions` + `savedSessions`。

### 2.4 前端 `TerminalPage.tsx:875-908`

```typescript
const response = await apiClient.getTerminalSessions();
const activeSessions = response.data.activeSessions || [];
const savedSessions = response.data.savedSessions || [];

const activeSessionIds = new Set(activeSessions.map((s: any) => s.id));
const uniqueSavedSessions = savedSessions.filter((s: any) => !activeSessionIds.has(s.id));

const sessionData = [...activeSessions, ...uniqueSavedSessions];
```

> 前端拉一次合并去重。点 saved 项 → 走 `createRuntime(session.id, 'disconnected')`，GSM3 把 disconnected 状态用作「保留 tab 但不可交互」。

---

## 3. 本项目本地化适配清单

### 3.1 整体本地化

| 维度 | GSM3 做法 | 本项目本地化 |
|---|---|---|
| 文件路径 | `path.join(process.cwd(), 'data')` | `path.join(config.dataDir, 'terminal-sessions.json')`（用 `config.dataDir`，与现有 settings K-V 同目录） |
| 日志库 | `winston` | `pino`（本项目 §9.1） |
| 类型风格 | TS class + interface | **不变**——GSM3 已 TS，直接搬 |
| DI 风格 | `TerminalManager` 构造时 `new TerminalSessionManager(logger)` | 改成 `composition-root.ts` 集中构造，注入到 `ServerManager` |
| ID 生成 | `randomUUID()`（GSM3 用 `crypto.randomUUID` 临时文件名） | 同款 |
| 7 天硬编码 | `7 * 24 * 60 * 60 * 1000` | **不变**——GSM3 同款 |
| 写时机 `lastActivity` 刷新 | GSM3 没主动刷新（只在 saveSession 时写） | **本地化**：PTY 每收到 stdout/input 调 `touchActivity` 节流 5 秒 1 次（GSM3 没这个细化，但行为合理） |

### 3.2 `id` 字段语义本地化

- **GSM3**：1 实例多 tab，会话 id 是 `randomUUID()`（每个 tab 唯一）
- **本项目**：1 实例 1 PTY（`terminalSessionId = serverId`），会话 id 直接复用 serverId
- **影响**：去掉 `updateSessionName`（GSM3 多 tab 需要重命名，单 PTY 用 serverId 即可；用户编辑 name 的需求走 ConsolePage UI 单独提）

### 3.3 路由形态本地化

- **GSM3**：`routes/terminal.ts:44` 直接返回
- **本项目**：抽 `createSessionsRouter(sessionManager, ptyManager)` 工厂函数（与现有 `createXxxRouter` 风格统一）

---

## 4. 模块与契约

### 4.1 新增模块

| 模块 | 职责 | 依赖 | destroy |
|---|---|---|---|
| **SessionManager** | 1:1 抄 GSM3 `TerminalSessionManager`，加 `touchActivity` 方法 | DB（不依赖）、fs、pino logger、config.dataDir | — |

**位置**：`manager-server/src/modules/sessions/SessionManager.ts`

### 4.2 新增契约（`shared/contracts/sessions.ts`）

```typescript
import type { ServerId } from '../types/branded.js';

/** GSM3 字段对齐——本地化：id = serverId（1 实例 1 PTY） */
export interface PersistedTerminalSession {
  id: ServerId;
  name: string;
  workingDirectory: string;
  createdAt: string;
  lastActivity: string;
  isActive: boolean;
}

export interface ISessionManager {
  initialize(): Promise<void>;
  saveSession(data: Omit<PersistedTerminalSession, never>): Promise<void>;
  setSessionActive(id: ServerId, isActive: boolean): Promise<void>;
  /** 本地化新增：节流刷新 lastActivity（5 秒 1 次） */
  touchActivity(id: ServerId): Promise<void>;
  removeSession(id: ServerId): Promise<void>;
  getSavedSessions(): PersistedTerminalSession[];
  getSession(id: ServerId): PersistedTerminalSession | undefined;
  cleanupExpiredSessions(): Promise<number>;  // 本地化返回删除条数
}
```

### 4.3 新增 REST 端点（`manager-server/src/routes/sessions.ts`）

```typescript
createSessionsRouter(sessionManager: ISessionManager, ptyManager: IPtyManager): Router
// GET /api/sessions → { active: PersistedTerminalSession[], saved: PersistedTerminalSession[] }
//   active = ptyManager.isRunning(id) && saved.find(id) ? {...saved, isActive:true} : []
//   saved  = sessionManager.getSavedSessions().filter(id NOT IN active)
// （对齐 GSM3 routes/terminal.ts:44 形态）
```

### 4.4 依赖注入（`composition-root.ts`）

```typescript
const sessionManager = new SessionManager(logger);
const serverManager = new ServerManager(
  db,
  new ServerDiscovery(),
  ptyManager,
  configService,
  broadcaster,
  workshopApply,
  sessionManager,    // 新增：ServerManager 在 startPty/onExit 调 SessionManager
);
```

### 4.5 ServerManager 接线（对齐 GSM3 TerminalManager 调用点）

| GSM3 行 | 触发 | 本项目对应 |
|---|---|---|
| `TerminalManager.ts:1030` saveSession(isActive:true) | promoteAttempt（PTY spawn 成功） | `ServerManager.startPty` spawn bash 成功后调 `sessionManager.saveSession({...isActive:true})` |
| `TerminalManager.ts:1056` removeSession（回滚） | promote 失败 | `ServerManager.startPty` 失败分支 catch 里调 `sessionManager.removeSession(serverId)` |
| `TerminalManager.ts:2962` setSessionActive(false) | PTY 退出 | `ServerManager.startPty` 注册的 `ptyManager.onExit` 回调里调 `sessionManager.setSessionActive(serverId, false)` |
| `TerminalManager.ts:3057` setSessionActive(true) | PTY 重连 | **本项目不需要**——PTY 退出后用户需重启实例才有 PTY，不存在「会话重连」概念 |

### 4.6 PtyManager 接线（PTY 活动节流刷新）

GSM3 没这层。本地化：在 `ServerManager.pipePtyOutput` 注册的 `ptyManager.onData` 回调里，**同时**调 `sessionManager.touchActivity(serverId)`（节流 5 秒）。

### 4.7 前端变更

- 新增 `useSessionManager()` hook：拉一次 `/api/sessions` → 返回 `{ active, saved }`
- `ConsolePage` 顶部加「切换终端」下拉（对齐 GSM3 多 tab 形态的极简版）：active 直接切换；saved 项点开 → toast `这个终端已经断开，点「启动」重新打开`（owner 直白语言，不用「PTY」技术词）

---

## 5. 数据流

### 5.1 启动场景

```
用户：实例 MyServer 启动
ServerManager.start('MyServer')
  → startPty → spawn bash 成功（pty.pid 返回）
  → sessionManager.saveSession({
      id: 'MyServer',
      name: '终端 - MyServer',
      workingDirectory: installDir,
      createdAt: now,
      lastActivity: now,
      isActive: true,
    })

用户：进 ConsolePage
GET /api/sessions → { active: [MyServer], saved: [] }
```

### 5.2 面板重启场景（GSM3 核心价值）

```
面板启动
  → SessionManager.initialize() 读 data/terminal-sessions.json → 全部 isActive=false
  → 用户进 ConsolePage
  → GET /api/sessions
    → active = ptyManager.isRunning('MyServer') → false（PTY 都死）→ active = []
    → saved  = 全 JSON 记录 → [MyServer, OtherServer]
    → 返回 { active: [], saved: [MyServer, OtherServer] }
  → 前端展示 saved 列表，点 MyServer → toast「PTY 已退出，请启动新实例」
```

### 5.3 后台清理（GSM3 注释掉的——本项目启用）

```
SessionManager.cleanupExpiredSessions()（启动后每 24 小时跑一次）
  → 过滤 lastActivity > 7 天的会话 → saveConfig
```

> **GSM3 `TerminalManager.ts:257` 这行被注释掉**——本项目启用：每 24 小时跑一次。

---

## 6. 数据库 Schema

**无变更**——单 JSON 文件存储，不动 SQLite。

---

## 7. 风险与回退

| 风险 | 缓解 |
|---|---|
| JSON 文件并发写损坏 | GSM3 同款 mutationQueue 串行 + 临时文件 + rename 原子写 |
| 面板运行时手工编辑 `terminal-sessions.json` 解析失败 | GSM3 同款：ENOENT 建空，其他错误向上抛 |
| `touchActivity` 5 秒节流写太频繁 | 接受：节流目的是减 fs.write 频次 |

---

## 8. 完成定义验证清单

```bash
# 1. grep 验证零 PTY 输出录制残留（不录 PTY 输出的承诺不破）
grep -rn "jsonl\|PTY 输出\|console_line 持久化" manager-server/src/modules/sessions/
# 应 0 命中

# 2. 单测
npx vitest run manager-server/src/modules/sessions/SessionManager.test.ts
# 覆盖（每条对应 GSM3 公共方法）：
#   initialize / saveSession / setSessionActive / touchActivity 节流
#   removeSession / cleanupExpiredSessions 7 天 / JSON 损坏降级
#   mutationQueue 串行（两个 saveSession 并发不损坏文件）

# 3. e2e
npx playwright test e2e/session-recovery.spec.ts
# 用例 1：实例 start → 退出页面 → 重新进 → saved 列表含此实例 + toast「这个终端已经断开，点启动重新打开」
# 用例 2：实例 start → 面板 docker 重启 → 重新进 → 同上
# 用例 3：实例 start → 等 8 天（mock 时间）→ 触发 cleanup → 列表为空
# 用例 4：PTY stdout 输出 5 秒+ 后 lastActivity 刷新（节流验证）

# 4. 与 GSM3 字段一致性
grep -E "PersistedTerminalSession|createdAt|lastActivity|isActive|workingDirectory" \
  manager-server/src/modules/sessions/SessionManager.ts \
  .research/GameServerManager/server/src/modules/terminal/TerminalSessionManager.ts
# 应两侧字段完全一致

# 5. architecture-spec.md 同步更新
# §3.2 模块表新增 SessionManager
# §5.10 REST 端点表新增 GET /api/sessions
# §7 DB 无变更（标注「Phase 7 不动 SQLite，会话存 data/terminal-sessions.json」）
```

---

## 9. 实施分期

PRD 极简（基本是抄），按 2 子期：

```
Phase 7.1：后端 1:1 抄录（约 1 天）
  - SessionManager.ts 整体照抄 GSM3（5 个文件证据全部移植）
  - touchActivity 节流本地化新增
  - ServerManager 3 处接线（saveSession on success / removeSession on fail / setSessionActive on exit）
  - PtyManager pipePtyOutput 加 touchActivity 节流
  - GET /api/sessions 端点（对齐 GSM3 routes/terminal.ts:44 形态）
  - 24 小时 cleanup cron（GSM3 注释掉的，本项目启用）
  DoD：实例 start 后 data/terminal-sessions.json 含记录；面板重启后 GET 拉到 saved 列表

Phase 7.2：前端 saved 列表 UI（约 0.5 天）
  - useSessionManager hook
  - ConsolePage 顶部「切换终端」下拉
  - 点 saved 项 → toast
  DoD：e2e 全过
```

总估时 **约 1.5 工作日**。

---

## 10. 不做（用户拍板 + GSM3 不做）

- ~~PTY 输出 JSONL 录制~~（GSM3 不做 → 本项目不做）
- ~~崩溃前最后一帧回放 / 历史回放 UI / 导出 txt / 命令搜索~~
- ~~多 tab 终端~~（留 Phase 8/9）
- ~~updateSessionName~~（GSM3 多 tab 需要，本项目 1 实例 1 PTY 不需要）

---

## 11. 替代方案（考虑过但否决）

| 方案 | 否决理由 |
|---|---|
| **JSONL 录 PTY 输出 + 回放** | 用户「1:1 复刻 GSM3」即否决 |
| **SQLite 存会话元数据** | GSM3 单 JSON，10 条记录用 SQLite 过度 |
| **不上 JSON，启动时扫目录** | 丢失 lastActivity/name 等元数据；JSON 成本极低 |

---

*草案日期：2026-08-11*
*GSM3 证据文件：*
- `.research/GameServerManager/server/src/modules/terminal/TerminalSessionManager.ts`（核心实现 1:1 抄录源）
- `.research/GameServerManager/server/src/modules/terminal/TerminalManager.ts`（行 243/266/993/1030/1056/2962/3057/3181/3281，ServerManager 接线对照表）
- `.research/GameServerManager/server/src/routes/terminal.ts:44`（路由形态参考）
- `.research/GameServerManager/client/src/pages/TerminalPage.tsx:875-908`（前端合并去重逻辑参考）
- `.research/GameServerManager/server/src/index.ts:677`（data 目录路径参考）

*关联：ADR-0004（PTY 终端控制）、ADR-0003 B2（目录扫描真源）*