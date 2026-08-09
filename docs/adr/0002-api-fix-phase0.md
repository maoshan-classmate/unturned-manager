# ADR-0002: Sprint 2 后端 API 修复 Phase 0 设计

> **状态**：待评审 · **日期**：2026-08-08 · **驱动源**：`claudedocs/reference_api_spec.md` 源码审计 8 条断裂 + Phase 0 路线
> **前置 ADR**：ADR-0001（Motion 动画库；与本 ADR 无关）
> **本 ADR 不做**：架构重构、不调换库、改测试框架 / 部署拓扑
> **本 ADR 解决**：让现有代码真正能跑通主流程，对前端"看起来跑得起来"变"真的跑得起来"

---

## 1. 决策摘要（TL;DR）

| 决策点 | 选择 | 拒绝方案 | 理由 |
|---|---|---|---|
| 数据模型序列化 | **Zod schema 字段统一用 `Record<string,string>` 替换 `Map`** | 改造 `Map<>` → JSON 序列化 | C4 根因；JSON 标准不支持 Map |
| Commands.dat 写校验 | Zod schema 端 `Record` 化 + 路由层 `record.parsed` | 不校验直接透传 | C3 根因；500 风暴 |
| `/rcon/execute` 路径 | **保留 `/execute` + 新增 `/rcon/execute` 别名** | 改前端路径 | C1 修复最小代价 |
| 文件二进制上传 | **`multipart/form-data` 替代 JSON base64** | 改 `createUploadStream` 流式 | C7；流式留在 Sprint 5 |
| Zod 校验接入 | 路由工厂 `createXxxRouter` 注入 `validate(schema)` 中间件 | 每路由手写 if 检查 | 与 `.claude/rules/backend-development.md` 对齐 |
| 错误处理 | **全局 `AppError` + `asyncHandler` 中间件** | 当前 `try/catch + status: 500` 烂摊 | 路线 §9.2 落地 |
| WS 协议 | **前端建连后 1 秒内发 `subscribe` 消息** | 改 URL query 参数化 | C8；订阅关系是动态的 |
| WS token | **accessToken（短期 15min）** | 沿用 refreshToken | 当前是巧合（同 secret），需主动修 |

---

## 2. 数据模型迁移（解决 C3/C4/C2）

### 2.1 Commands.dat

#### 现状

```typescript
// shared/types/domain.ts
interface CommandsDatRecord {
  known: Map<string, string>;
  unknown: Map<string, string>;
  comments: string[];
}
```

**问题**：JSON.stringify(Map) → `{}`，前端拿不到数据（C4）。前端 ConfigPage 当普通对象写进来，后端 `serializeCommandsDat` 对 `record.known` 做 `for...of` 抛 TypeError（C3）。

#### 改造目标

```typescript
// 方案 A（推荐）：map→Record
interface CommandsDatRecord {
  known: Record<string, string>;
  unknown: Record<string, string>;
  comments: string[];
}

// Zod schema 同步
export const CommandsDatRecordSchema = z.object({
  known: z.record(z.string(), z.string()),
  unknown: z.record(z.string(), z.string()),
  comments: z.array(z.string()),
});
```

#### 影响面

| 文件 | 改动 |
|---|---|
| `shared/types/domain.ts` | `Map<>` → `Record<>` |
| `shared/schemas/config.schema.ts` | `z.map` → `z.record` |
| `manager-server/src/modules/config/ConfigService.ts` | 第 148-218 行：解析/序列化循环改成 `Object.entries` |
| `manager-web/src/pages/ConfigPage.tsx` | 第 90-150 行：把对象当成 Record 读写，不再 `new Map()` |
| `manager-server/src/routes/config.ts` | 第 19-26 行的 `req.body` 透传前先 `WriteCommandsDatSchema.safeParse` |

### 2.2 Config.txt

#### 现状

```typescript
interface ConfigTxtRecord {
  sections: ConfigSection[];   // 后端：数组
}
// 前端 ConfigPage.tsx:106 用法：sections['浏览器']  // ← map 用法
```

**问题**：后端数组 vs 前端 map → 永远是默认值（C2）。

#### 改造目标（两选一，倾向 A）

**方案 A：后端改为 Record**（贴合前端现状）

```typescript
interface ConfigTxtRecord {
  sections: Record<string, ConfigSection>;  // key=section name
}
```

**方案 B：前端改为数组**（贴合后端现状）

```typescript
const sections = data.data.sections; // ConfigSection[]
sections.find(s => s.name === 'Browser')?.entries.forEach(...)
```

**推荐 A**——`Config.txt` 段名天然唯一（重复以最后一个为准），Record 表达力更强；前端少改。

#### 影响面

| 文件 | 改动 |
|---|---|
| `shared/types/domain.ts` | `sections: ConfigSection[]` → `Record<string, ConfigSection>` |
| `shared/schemas/config.schema.ts` | `z.array` → `z.record(z.string(), ConfigSectionSchema)` |
| `manager-server/src/modules/config/ConfigService.ts` | parseConfigTxt 解析时按段名 `sections[name] = currentSection` |
| `manager-web/src/pages/ConfigPage.tsx` | 不动（已经是 map 写法） |

---

## 3. 端点路径修复

### 3.1 新增 `/rcon/execute` 别名（解决 C1）

**新增路由**：`manager-server/src/routes/rcon.ts`

```typescript
// 与 /:id/execute 行为一致
router.post('/:id/rcon/execute', authenticateToken, validate(RconExecuteSchema), async (req, res, next) => {
  return rconExecuteHandler(req, res, next);  // 抽成函数复用
});
```

**DoD**：PlayersPage `fetch('/api/servers/MyServer/rcon/execute')` 不再 404。

### 3.2 文件二进制上传切换到 multipart（解决 C7）

#### 现状

```typescript
// routes/files.ts:38-53
router.post('/:id/upload', async (req, res) => {
  const { path: relativePath, content } = req.body;
  const data = new TextEncoder().encode(String(content));  // ← 破坏二进制
  await filesService.writeFile(...);
});
```

前端 FilesPage.tsx:186 base64 后端 `String()` → 只剩 7-bit ASCII，二进制 .unity3d 无法上传。

#### 改造目标

| 形态 | endpoint | content-type | 接受 |
|---|---|---|---|
| **现有 JSON 文本** | `POST /api/servers/:id/upload` | `application/json` | `{path, content: string}` for 文本 |
| **新增二进制** | `POST /api/servers/:id/files/raw` | `multipart/form-data` | `path` (text) + `file` (binary) |

```typescript
// 新路由，使用 multer 或 busboy 解析 multipart
import multer from 'multer';
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } });

router.post('/:id/files/raw',
  authenticateToken,
  upload.single('file'),
  validate(RawUploadSchema),  // Zod 校验 path
  async (req, res, next) => {
    try {
      const buffer = req.file!.buffer;
      await filesService.writeFile(req.params.id as never, req.body.path, new Uint8Array(buffer));
      res.json({ data: { message: '文件已上传', size: buffer.length } });
    } catch (err) { next(err); }
  });
```

**DoD**：上传 5MB `.unity3d` 文件不破坏（前端 FilesPage 改用 `FormData`）。

**注**：multer 是新依赖 → 在 `manager-server/package.json` 加入。Sprint 5 的 `createUploadStream` 流式上传延后（≥1MB 分块），Phase 0 一次性 100MB 缓冲够用。

### 3.3 新增端点清单（Phase 0）

| # | 方法 | 路径 | 用途 | 状态码 |
|---|---|---|---|---|
| 1 | POST | `/api/servers/:id/rcon/execute` | 与 `/execute` 相同（别名） | 200 / 401 / 403 / 428 / 500 |
| 2 | POST | `/api/servers/:id/files/raw` | 二进制文件上传 | 200 / 400 / 401 / 403 / 413 |
| 3 | GET | `/api/servers/:id/files/raw` | 二进制文件下载 | 200 / 401 / 403 / 404 |
| 4 | GET | `/api/servers/:id/players` | 在线玩家列表（解析 RCON Players 输出） | 200 / 404 / 500 |
| 5 | POST | `/api/servers/:id/mods/apply` | Mod 变更应用 + 重启流水线（原 ADR 写 `/apply`，落地时归入 mods 路由组更精准） | 200 / 401 / 403 / 500 |

#### Players 端点设计

```typescript
// 接口（前端 PlayersPage.tsx:46,63 在用，但走错端点）
interface PlayersResponse {
  data: {
    serverId: ServerId;
    players: Array<{
      name: string;
      steamId: SteamId64;
      character: string;
      ping: number;
      timeOnline: string;  // '2h 35m' 格式
    }>;
    fetchedAt: string;  // ISO 时间戳
  };
}

// 解析策略：参考 reference_console_commands.md §11
// RCON Players 输出格式：
//   Player Name (SteamID) | Character Name | Ping | Time Online
// 解析失败 → 返回空数组 + reason 字段，前端降级显示"显示原始输出"
```

---

## 4. Zod schema 接入（解决 §2.1 + 准备全量校验）

### 4.1 校验中间件

**新文件**：`manager-server/src/middleware/validate.ts`

```typescript
import type { Request, Response, NextFunction } from 'express';
import type { ZodSchema } from 'zod';
import { AppError } from '../utils/AppError.js';

export function validate(schema: ZodSchema, source: 'body' | 'query' | 'params' = 'body') {
  return (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      const issues = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
      return next(new AppError('validation_failed', `请求参数校验失败: ${issues}`, 400));
    }
    req[source] = result.data;  // 类型收窄 + 净化
    next();
  };
}
```

### 4.2 asyncHandler 中间件

**新文件**：`manager-server/src/middleware/asyncHandler.ts`

```typescript
import type { RequestHandler } from 'express';

export const asyncHandler =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
```

### 4.3 全局错误中间件

**新建**：`manager-server/src/middleware/errorHandler.ts`

```typescript
import type { ErrorRequestHandler } from 'express';
import { AppError } from '../utils/AppError.js';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof AppError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message } });
    return;
  }
  logger.error({ err }, '未捕获错误');
  const message = config.nodeEnv === 'development' ? err.message : '服务器内部错误';
  res.status(500).json({ error: { code: 'internal_error', message } });
};
```

**AppError 已有后端源代码样板**（`.claude/rules/backend-development.md`），**但实际没建文件**——Phase 0 一起补。

### 4.4 接入策略

每个 `createXxxRouter` 内：

```typescript
router.post('/:id/upload', authenticateToken, validate(WriteFileSchema, 'body'), asyncHandler(uploadHandler));
```

**Phase 0 接入清单**（最小集）：

| 路由 | schema |
|---|---|
| `POST /auth/login` | `LoginSchema` (新建：`username` + `password` non-empty) |
| `POST /auth/refresh` | `RefreshSchema` (新建：`refreshToken`) |
| `POST /auth/logout` | `LogoutSchema` (新建：`refreshJti` optional) |
| `POST /servers` | `CreateServerSchema`（已有） |
| `PATCH /servers/:id` | `ConfigureServerSchema`（已有） |
| `POST /servers/:id/start` | 无 body，跳过 |
| `POST /servers/:id/stop` | `StopServerSchema`（已有） |
| `POST /servers/:id/restart` | `RestartServerSchema`（已有） |
| `POST /servers/:id/rcon/execute` | `RconExecuteSchema`（已有） |
| `POST /servers/:id/mods/apply` | `ApplyModsSchema`（已有） |
| `GET /servers/:id/config/commands` | 无 body |
| `PUT /servers/:id/config/commands` | `WriteCommandsDatSchema`（待改） |
| `GET /servers/:id/config/txt` | 无 body |
| `PUT /servers/:id/config/txt` | `WriteConfigTxtSchema`（待改） |
| `GET /servers/:id/config/workshop` | 无 body |
| `PUT /servers/:id/config/workshop` | `WriteWorkshopFileIdsSchema`（已有） |
| `GET /servers/:id` | query: `path` Zod string |
| `GET /servers/:id/content` | query: `path` Zod string |
| `POST /servers/:id/upload` | `WriteFileSchema`（已有） |
| `POST /servers/:id/files/raw` | `RawUploadSchema`（新建） |
| `POST /servers/:id/mkdir` | `CreateDirectorySchema`（已有） |
| `DELETE /servers/:id` | query: `path` Zod string |
| `PUT /servers/:id/rename` | `RenameEntrySchema`（已有） |
| `POST /steamcmd/update` | `SteamCmdUpdateSchema`（已有） |

---

## 5. WebSocket 订阅协议（解决 C8）

### 5.1 现状

```typescript
// gateway.ts:53 — broadcast 已经按订阅路由
broadcast(event: ServerEvent): void {
  const serverId = 'serverId' in event ? (event as { serverId: string }).serverId : null;
  for (const [ws, subscriptions] of wsSubscriptions) {
    if (ws.readyState !== WebSocket.OPEN) continue;
    if (serverId && !subscriptions.has(serverId)) continue;  // ← 订阅为空，所以**所有事件都被吞了**
    ws.send(data);
  }
}
```

### 5.2 新协议

**客户端 → 服务端**（连接建立 1 秒内）：

```json
{
  "type": "subscribe",
  "serverIds": ["MyServer", "MyServer2"],
  "eventTypes": ["state_change", "console_line", "mod_apply_progress"]
}
```

| 字段 | 必填 | 说明 |
|---|---|---|
| `type` | ✅ | 固定 `"subscribe"` |
| `serverIds` | ✅ | 空数组 = 接收全服事件 |
| `eventTypes` | ❌ | 不传 = 接收所有事件类型 |

**服务端 → 客户端**（订阅确认）：

```json
{
  "type": "subscribed",
  "serverIds": ["MyServer"],
  "eventTypes": ["state_change", "console_line", "mod_apply_progress"]
}
```

**服务端 → 客户端**（错误）：

```json
{
  "type": "error",
  "code": "invalid_message",
  "message": "消息格式错误"
}
```

### 5.3 gateway 改动

```typescript
// gateway.ts:37 — 在 connection 时挂 message 处理器
this.wss.on('connection', (ws, req) => {
  wsSubscriptions.set(ws, { serverIds: new Set(), eventTypes: null });

  let subscribed = false;
  const SUBSCRIBE_TIMEOUT = setTimeout(() => {
    if (!subscribed) {
      ws.close(1008, 'Subscribe timeout');
    }
  }, 5000);

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.type === 'subscribe') {
        const subs = wsSubscriptions.get(ws)!;
        subs.serverIds = new Set(msg.serverIds ?? []);
        subs.eventTypes = msg.eventTypes ? new Set(msg.eventTypes) : null;
        subscribed = true;
        clearTimeout(SUBSCRIBE_TIMEOUT);
        ws.send(JSON.stringify({
          type: 'subscribed',
          serverIds: msg.serverIds ?? [],
          eventTypes: msg.eventTypes ?? [],
        }));
        logger.info({ serverIds: msg.serverIds, eventTypes: msg.eventTypes }, 'WS 客户端已订阅');
      } else {
        ws.send(JSON.stringify({ type: 'error', code: 'invalid_message', message: '未知消息类型' }));
      }
    } catch {
      ws.send(JSON.stringify({ type: 'error', code: 'invalid_json', message: '消息非 JSON' }));
    }
  });

  ws.on('close', () => {
    clearTimeout(SUBSCRIBE_TIMEOUT);
    wsSubscriptions.delete(ws);
  });
});
```

### 5.4 broadcast 改造

```typescript
broadcast(event: ServerEvent): void {
  const payload = JSON.stringify({ ...event, ts: Date.now() });
  for (const [ws, subs] of wsSubscriptions) {
    if (ws.readyState !== WebSocket.OPEN) continue;
    if (subs.serverIds.size > 0 && event.serverId && !subs.serverIds.has(event.serverId)) continue;
    if (subs.eventTypes && !subs.eventTypes.has(event.type)) continue;
    ws.send(payload);
  }
}
```

### 5.5 前端改动

**新文件**：`manager-web/src/contexts/WebSocketContext.tsx` 替换原文件

```typescript
useEffect(() => {
  if (!accessToken || !isAuthenticated) return;
  const ws = new WebSocket(`ws://${window.location.host}/ws?token=${accessToken}`);

  ws.onopen = () => {
    // 1. 按当前路由订阅当前 serverId + 关心的事件
    const serverIds = currentServerId ? [currentServerId] : [];
    ws.send(JSON.stringify({
      type: 'subscribe',
      serverIds,
      eventTypes: ['state_change', 'console_line', 'mod_apply_progress'],
    }));
  };

  ws.onmessage = (e) => {
    const data = JSON.parse(e.data);
    if (data.type === 'console_line') setLines((l) => [...l, data]);
    // ... 其他事件分发到对应 store
  };

  return () => ws.close();
}, [accessToken, isAuthenticated, currentServerId]);
```

**Token 修正**：构造 URL 用 **accessToken** 而非 refreshToken（已有 reference_api_spec.md §4 安全缺陷提示）。

### 5.6 LogStreamer 接线

**`manager-server/src/index.ts` 在 `db 加载 + container.build` 完成后**：

```typescript
// 给每个已加载的 ServerID 启动日志流
for (const serverId of container.serverManager.listServersSync()) {
  container.logStreamer.startStreaming(serverId);
}
```

> 注：`listServers()` 是 async 但 ListServers 已知服务 ID 集合，**先增 `listServersSync(): string[]`**（读 in-memory `servers` Map）—— 见 ServerManager.ts:104 改动一行的成本。

---

## 6. 时序图（按主流程）

### 6.1 start 流程（包含 C1+C5+C6+C8 修复后）

```
前端                                            后端                         U3DS
 │                                               │                            │
 │ WebSocket 连接 (/ws?token=<accessToken>)      │                            │
 │─────────────────────────────────────────────>│                            │
 │ ws.subscribe {serverIds:["X"], eventTypes:[…]}│                            │
 │─────────────────────────────────────────────>│                            │
 │<─{type:"subscribed"} ─────────────────────────│                            │
 │                                               │                            │
 │ POST /servers (createServer)                  │                            │
 │  body: ServerConfig {id,name,gamePort,…}      │                            │
 │─────────────────────────────────────────────>│                            │
 │  Zod 校验通过                                  │                            │
 │  db INSERT                                    │                            │
 │  activeOp = none                              │                            │
 │  state = STOPPED                              │                            │
 │  rconManager.register(...)                    │                            │
 │  auditLog('server.create')                    │                            │
 │<─201 {data:{message:"创建成功"}}─────────────│                            │
 │                                               │                            │
 │ POST /servers/X/start                         │                            │
 │─────────────────────────────────────────────>│                            │
 │  activeOp = manual_start                      │                            │
 │  state → STARTING                             │                            │
 │  broadcast(state_change)                      │                            │
 │  processSupervisor.spawn(X, ServerHelper.sh,  │                            │
 │    ["+InternetServer/X","-ThreadedConsole"])  │                            │
 │──────────────────────────────────────────────────────────────────────────>│
 │                                               │ stdout 行 → LogStreamer.sanitize
 │                                               │       → broadcast(console_line)
 │ ws.onmessage {type:"console_line",…}          │<───────────────────────────│
 │<──────────────────────────────────────────────│                            │
 │                                               │ pollA2S(...) 每 3s          │
 │                                               │<─A2S_INFO─────────────────│
 │ 30s 内成功                                     │                            │
 │  state → RUNNING                              │                            │
 │  broadcast(state_change)                      │                            │
 │<─{state_change: STOPPED→RUNNING}──────────────│                            │
 │ ws.state_change 合并到 store                  │                            │
 │                                               │                            │
 │ rconManager.connect(X)                        │                            │
 │  OpenMod 优先，2s 超时→RocketMod fallback      │                            │
 │                                               │                            │
 │  activeOp = none                              │                            │
 │<─202 {data:{message:"正在启动"}}──────────────│                            │
```

### 6.2 console_line 接收时序

```
前端 (ConsolePage.tsx)                   后端 (gateway + LogStreamer)                  U3DS 进程
 │                                        │                                              │
 │ useConsole(X): 创建 WS                 │                                              │
 │ ws.open + ws.subscribe                 │                                              │
 │ ──────────────────────────────────────>│ ws.onmessage {type:"subscribe"}              │
 │ <──────────────────────────────────────│ ws.send({type:"subscribed"})                 │
 │                                        │                                              │
 │                                        │ LogStreamer.startStreaming(X)（index.ts 启动）│
 │                                        │ processSupervisor.onStdout(X, line => {      │
 │                                        │   sanitize(line) → broadcast(console_line)   │
 │                                        │ })                                           │
 │                                        │                                              │
 │                                        │ processSupervisor 已 spawn → child.stdout    │
 │                                        │ ──────────────────────────────────────────> │
 │                                        │ <─────────────────────"Server is starting…" │
 │                                        │ 行级 readline → onStdout line => sanitize    │
 │                                        │ broadcast({type:'console_line', line, src})  │
 │ ws.onmessage console_line              │ ──────────────────────────────────────────> │
 │ <──────────────────────────────────────│                                              │
 │ setLines(prev => [...prev, line])      │                                              │
 │                                        │                                              │
 │ 用户输入 "Players"                       │                                              │
 │ Click [Send]                            │                                              │
 │ POST /servers/X/rcon/execute            │                                              │
 │  body: {command:"Players", confirmed:false}
 │ ──────────────────────────────────────>│  Zod → RconExecuteSchema 校验通过             │
 │                                        │  rconManager.execute(X, "Players")           │
 │                                        │  危险指令？NO → 直接执行                     │
 │                                        │ <────────────────────"Player1 (765…) | …"   │
 │ <─{data:{output:"Player1 (765…) | …"}}──│                                              │
 │                                        │                                              │
 │ 用户输入 "Shutdown 5 测试"              │                                              │
 │ Click [Send] → ConfirmDialog → 二次确认 │                                              │
 │ POST /servers/X/rcon/execute            │                                              │
 │  body: {command:"Shutdown 5 测试", confirmed:true}
 │ ──────────────────────────────────────>│  危险指令 ∈ DANGEROUS_COMMANDS               │
 │                                        │  confirmed=true → 通过                        │
 │                                        │  Owner 专属？YES → user.role≠admin → 403     │
 │<─403 {error:{code:"owner_only"}}───────│  (或 rconManager.execute)                    │
```

---

## 7. OpenAPI 3.0 增量

> 现有 `shared/schemas/` 已用 `zod-openapi` 自动生成。本节定义 Phase 0 新增/变更的 schema。

### 7.1 字段类型变更

```typescript
// 改前
export const CommandsDatRecordSchema = z.object({
  known: z.map(z.string(), z.string()),         // ❌ JSON.stringify → {}
  unknown: z.map(z.string(), z.string()),
  comments: z.array(z.string()),
});

// 改后
export const CommandsDatRecordSchema = z.object({
  known: z.record(z.string(), z.string()),      // ✅ Record 在 JSON 是普通对象
  unknown: z.record(z.string(), z.string()),
  comments: z.array(z.string()),
});
```

### 7.2 新增 schema

```typescript
// shared/schemas/player.schema.ts
export const PlayerSchema = z.object({
  name: z.string(),
  steamId: z.string().regex(/^7656119\d{10}$/),
  character: z.string(),
  ping: z.number().int().nonnegative(),
  timeOnline: z.string(),
});

export const PlayersResponseSchema = z.object({
  data: z.object({
    serverId: z.string(),
    players: z.array(PlayerSchema),
    fetchedAt: z.string(),
  }),
});

// shared/schemas/upload.schema.ts
export const RawUploadRequestSchema = z.object({
  path: z.string().min(1),
  // multipart 文件由 multer 单独处理
});

// shared/schemas/ws.schema.ts
export const WsSubscribeSchema = z.object({
  type: z.literal('subscribe'),
  serverIds: z.array(z.string()).default([]),
  eventTypes: z.array(z.string()).optional(),
});
```

---

## 8. 安全检查（替换现有 + Phase 0 新增）

| 检查项 | 现状 | Phase 0 |
|---|---|---|
| accessToken 校验 | 通过 `authenticateToken` middleware | ✅ 保留 |
| 危险指令门控 | `routes/rcon.ts` 428 + audit_log | ✅ 保留，新增 `/rcon/execute` 别名同步门控 |
| Owner 专属指令 | routes/rcon.ts:50-60 | ✅ 保留 |
| RCON 凭证脱敏 | `RconManager.execute` 内部 | ✅ 已实现 |
| **请求参数 Zod 校验** | ❌ 部分路由手写校验 | ✅ 全量接入 |
| **AppError 统一类** | ❌ 文件不存在 | ✅ 新建 `utils/AppError.ts` |
| **路径穿越防护（Files）** | FilesService `validatePath()` realpath | ✅ 保留 + Zod path 校验 |
| **WS 鉴权** | `verifyClient` 检验 accessToken | ✅ 保留；改成 accessToken |
| **WS 订阅超时** | ❌ 无 | ✅ 5 秒未 subscribe → close 1008 |

---

## 9. 验收清单（DoD）

- [ ] `tsc --noEmit` 全量零错误
- [ ] `npm test`（新增 vitest 配置）下列用例通过：
  - [ ] AppError 异常 → 统一 JSON 输出
  - [ ] Zod 校验失败 → 400 + 详细信息
  - [ ] 危险指令未 confirmed → 428
  - [ ] 危险指令 confirmed 后 → 200 + audit_log 写入
  - [ ] Owner 专属指令非 admin → 403
  - [ ] WS 5 秒内不 subscribe → 连接断开
  - [ ] WS subscribe 后正常收到 broadcast 事件
- [ ] curl 冒烟：login → 创建服 → 启动 → 控制台 WS 收 console_line → 停止 → 注销
- [ ] 前端 console.warn 无「未订阅」「订阅为空」
- [ ] curl `/rcon/execute` 与 `/execute` 行为一致
- [ ] curl `/files/raw` 上传 5MB `.unity3d` 不破坏（SHA256 比对）
- [ ] 文档同步更新：`reference_api_spec.md` §7 DoD + `architecture-spec.md` §5 REST API 表格

---

## 10. 风险与回退

| 风险 | 影响 | 回退方案 |
|---|---|---|
| Zod schema 字段类型变更牵动多处 | 中 | shared/ 一处改，TypeScript 报错指明所有影响点 |
| WS 协议变动影响前端 | 中 | 同时给前端 PR，超时机制 5s 够宽松 |
| multer 大文件阻塞 | 低（100MB 限制） | Phase 0 限制 ≤ 100MB；超出返 413 |
| AppError 全量改造 | 中 | 渐进式改造，先在新建端点用，旧端点逐个迁移 |

---

## 11. 工期估算（P7 骨干单文件模块修补）

| 阶段 | 工作 | 估计 |
|---|---|---|
| 1.1 | `shared/types/domain.ts` + `shared/schemas/*.ts` 改 Record | 0.5h |
| 1.2 | `ConfigService.ts` 解析器适配 Record（~30 行改动） | 1h |
| 1.3 | `routes/config.ts` 接入 Zod | 0.5h |
| 1.4 | 前端 `ConfigPage.tsx` 不需改（已是 map 用法） | 0h |
| 2.1 | `routes/rcon.ts` 抽函数 + 新增 `/rcon/execute` 别名 | 0.5h |
| 2.2 | `routes/files.ts` 新增 `/files/raw` 路由（multer） | 1h |
| 2.3 | 新增 `routes/players.ts` （解析 Players 输出） | 1.5h |
| 3.1 | 新建 `utils/AppError.ts` + `middleware/asyncHandler.ts` + `middleware/validate.ts` + `middleware/errorHandler.ts` | 1h |
| 3.2 | 所有路由接入 Zod + asyncHandler + errorHandler | 2h |
| 4.1 | `gateway.ts` subscribe 协议 + 5s timeout + 事件类型过滤 | 2h |
| 4.2 | `index.ts` 启动时调 `logStreamer.startStreaming()` | 0.5h |
| 4.3 | `manager-web/src/contexts/WebSocketContext.tsx` 改成 accessToken + 发出 subscribe | 1.5h |
| 5.1 | 新增 `vitest.config.ts` + 关键单测 | 2h |
| 5.2 | 文档更新：`reference_api_spec.md` + `architecture-spec.md` REST API 表格 | 1h |
| **合计** | | **~13.5h** |

**兜底**：如果某模块改造牵动面超出预期（如 WS 协议前端需协同），立刻派给前 P7 + 前 P7 + 测试 P7 三人并行（4-5h 收口）。

---

## 12. 与现有 ADR 的关系

| 现有 ADR | 是否冲突 | 处理 |
|---|---|---|
| ADR-0001（Motion） | 否 | 不改 |
| ADR-9（后端 12 模块 3 层） | 否 | 维持 |
| ADR-17（RCON 双协议凭证分离） | 否 | 不改 |
| ADR-19（ServerManager 竞态防护） | 否 | 当前 activeOperation 机制保留 |
| ADR-22（DEGRADED 接线） | 否 | RCON 心跳保留；LogStreamer 接线时不动 RCON 状态机 |

---

## 13. 后续路径

Phase 0（本文档）完成后 → 进 Phase 1（RCON 凭证 AES-GCM 闭环）/ Phase 2（Mod apply 流水线）/ Phase 3（SteamCMD + Workshop WebAPI 替换 `/xml=1`）。这些已在 `claudedocs/reference_api_spec.md` §6 列出，本 ADR 不展开。

---

## 14. 已知技术债（Phase 0 显式延后清单）

> **本节专门跟踪"本次设计**主动放弃**"的项，目的是让债务**可见、可追溯、可触发**——而不是让它消失在文档之外。**
>
> 每项标明：为什么不做、何时复审、谁负责拍板、用什么信号决定动手。

### 14.1 [Files] 上传断点续传（HTTP 标准）

**决策**：Phase 0 不做，**靠 multer 一次性 100MB 内存缓冲**。

**为什么不做**：
- 主部署形态 = 本地 Docker Compose + 同主机浏览器：千兆局域网，传输中断 < 1% 概率
- Mod 单文件大多 5–50MB，100MB 缓冲 + 一次性 multipart 提交足够；典型传输 5 秒完事
- 实现真正的 HTTP 续传（HEAD 查 offset + PATCH chunk + POST finalize）成本 ≈ 4h，且要前端配套改造 + 端到端测试

**复审触发条件**（任一即动手）：
- [ ] 用户报真实跨公网部署场景（远程服务器 + 异地管理面板），且出现 ≥ 50MB 失败案例
- [ ] 用户开始上传 ≥ 1GB 大地图包，且 mmap 内存吃紧触发 OOM
- [ ] **跨公网部署**成为产品定位（CLAUDE.md §1 调整）

**届时端点设计预留**（Phase 0 IFilesService 接口已留口子，复用即可）：

| 端点 | 方法 | 用途 |
|---|---|---|
| `/api/servers/:id/files/raw` | `HEAD` | 查上传进度，返回 `X-Upload-Offset` |
| `/api/servers/:id/files/raw` | `PATCH` | 续传单 chunk（16MB 推荐） |
| `/api/servers/:id/files/raw` | `POST /finalize` | 原子 rename `.part` → 目标文件 |
| `/api/servers/:id/files/raw` | `GET` | 同时支持 Range 下载 |

**负责人拍板**：技术债复审时由产品+SRE 共同决定；当前归"已知但可接受"。

---

### 14.2 [Files] 下载 Range 支持（HTTP 标准）

**决策**：Phase 0 顺手加（成本 10 行），不主动延后。

**怎么加（代码示例）**：

```typescript
// routes/files.ts — GET /:id/files/raw
router.get('/:id/files/raw', authenticateToken, asyncHandler(async (req, res) => {
  const relPath = String(req.query.path);
  const absPath = await filesService.validatePath(req.params.id as never, relPath);
  const stat = await fs.promises.stat(absPath);

  // Range 头解析
  const range = req.headers.range;
  if (range) {
    const match = /^bytes=(\d+)-(\d+)?$/.exec(range);
    if (match) {
      const start = parseInt(match[1], 10);
      const end = match[2] ? parseInt(match[2], 10) : Math.min(start + 16 * 1024 * 1024, stat.size - 1);
      res.status(206);
      res.setHeader('Content-Range', `bytes ${start}-${end}/${stat.size}`);
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Content-Length', end - start + 1);
      fs.createReadStream(absPath, { start, end }).pipe(res);
      return;
    }
  }

  // 普通下载
  res.setHeader('Content-Length', stat.size);
  res.setHeader('Accept-Ranges', 'bytes');
  fs.createReadStream(absPath).pipe(res);
}));
```

**为什么这条不算"延后"**：是 **HTTP 标准的轻量增强**，零额外状态、不需要客户端协议升级、零前端改动——**顺手做掉是投资的 ROI**。本节留条目的目的：**让评审者看到我们考虑过这条边界**。

---

### 14.3 [Workshop] SteamCMD `+workshop_download_item` 不支持断点续传

**决策**：Phase 0 不做（属于 SteamCMD 工具能力，不在本面板控制范围）。

**为什么不做**：
- SteamCMD 的 `+workshop_download_item` 走 Steam 内容分发网络，本身有内部重试机制
- 中断后用同一命令重启会自动跳过已下载的 chunk（.acf 文件记录）
- 面板层再做一层断点续传收益极低，且与 §14.1 不同：SteamCMD 子进程是面板 spawn 出去的，超出 HTTP 层语义

**复审触发条件**：SDK 升级后 SteamCMD 行为变化时。

---

### 14.4 [Other] 待 Phase 0 完成后再评估（轻量债）

| 项 | 当前 | 触发复审 |
|---|---|---|
| 启动 RCON 失败时自动重试 | 当前单次 connect，失败则 throw | 服务端启动 30s 内 RCON 偶发不可达 → 加重试 |
| A2S 轮询自适应间隔 | 固定 3s（ServerManager.ts:21） | 服务器多时 A2S 风暴 |
| workshop 目录大文件 .acf 解析 | 当前未做；`research_dst_mod_reference_2026-08-08.md` §3 给出方案 | Mod 数量 > 50 后台实时刷新需求出现 |

---

## 15. Phase 0 接口 ↔ 前端页面映射（端点落地清单）

> **本节列出 Phase 0 修复/新增的每一个 REST 端点 + WS 事件，钉到前端具体代码行号**。
> 
> 查询方式：顺着下表的"前端消费点"列直接打开对应文件，找到对应行即可看到前端如何调它——**避免评审时翻包**。

### 15.1 REST 端点 ↔ 前端消费点

| # | 方法 + 路径 | 前端页面 / Hook | 关键消费行 | 修复前状态 | 修复后状态 |
|---|---|---|---|---|---|
| 1 | `POST /api/auth/login` | `pages/LoginPage.tsx` | 通过 `useAuth().login()` → `contexts/AuthContext.tsx:48` | ✅ 可用 | ✅ 接 Zod `LoginSchema` |
| 2 | `POST /api/auth/refresh` | `contexts/AuthContext.tsx:36`（session 恢复） + `api/client.ts:30`（401 拦截） | 同上 | ✅ 可用 | ✅ 接 Zod `RefreshSchema` |
| 3 | `POST /api/auth/logout` | `contexts/AuthContext.tsx:57` | 同上 | ✅ 可用 | ✅ 接 Zod `LogoutSchema` |
| 4 | `GET /api/servers` | `hooks/useServer.ts:30`（5s 轮询） | Dashboard / Console / Files / Mods / Players / Config / ServerSetup 全部用 | ✅ 可用 | ✅ 接 Zod query 不需要（无 body） |
| 5 | `POST /api/servers` | `pages/ServerSetupPage.tsx:46` handleCreate | 创建新实例表单 | ⚠️ 脏数据直入库 | ✅ Zod `CreateServerSchema` |
| 6 | `PATCH /api/servers/:id` | （前端未直接调用） | 待前后端协调 | ⚠️ 僵尸端点 | ✅ 接 Zod `ConfigureServerSchema` |
| 7 | `POST /api/servers/:id/start` | `hooks/useServer.ts:59` + `DashboardPage.tsx:36` + `ServerSetupPage.tsx:36` | 启动按钮 | ⚠️ A2S bug 必失败 | ✅ 路径不变；状态机已就绪（仅需日志接线） |
| 8 | `POST /api/servers/:id/stop` | `hooks/useServer.ts:67` + `DashboardPage.tsx:37` + `ServerSetupPage.tsx:37` | 停止按钮 | ✅ 路径正确 | ✅ 接 Zod `StopServerSchema` |
| 9 | `POST /api/servers/:id/restart` | `hooks/useServer.ts:75` + `DashboardPage.tsx:38` + `ServerSetupPage.tsx:38` | 重启按钮 | ✅ 路径正确 | ✅ 接 Zod `RestartServerSchema` |
| 10 | `POST /api/servers/:id/execute` | `hooks/useConsole.ts:101` | 控制台命令发送 | ✅ 可用 | ✅ 接 Zod `RconExecuteSchema` + asyncHandler |
| 11 | `POST /api/servers/:id/rcon/execute` 🆕 | `pages/PlayersPage.tsx:46`（Players 列表）+ `:63`（Kick/Ban） | 玩家操作 | ❌ **404**（C1） | ✅ **新增别名，行为与 `/execute` 完全一致** |
| 12 | `POST /api/servers/:id/mods/apply` | `pages/ConfigPage.tsx:182` `handleApplyConfirm` | Config · Workshop Tab「应用变更」按钮 | ❌ 前端不调 | ✅ 接 Zod `ApplyModsSchema`，已闭环（实际路径 `/mods/apply`，归入 mods 路由组） |
| 13 | `GET /api/servers/:id/config/commands` | `pages/ConfigPage.tsx:90` | Config · Commands Tab | ⚠️ 返回 Map → `{}` | ✅ **改 Record** + Zod 校验（修复 C4） |
| 14 | `PUT /api/servers/:id/config/commands` | `pages/ConfigPage.tsx:141` | Config · Commands 保存 | ❌ for...of 抛 500 | ✅ **改 Record** + Zod `WriteCommandsDatSchema`（修复 C3） |
| 15 | `GET /api/servers/:id/config/txt` | `pages/ConfigPage.tsx:103` | Config · Txt Tab | ❌ 数组 vs map | ✅ **后端改 Record** + Zod（修复 C2） |
| 16 | `PUT /api/servers/:id/config/txt` | `pages/ConfigPage.tsx:143` | Config · Txt 保存 | ❌ 契约不符 | ✅ Zod `WriteConfigTxtSchema` |
| 17 | `GET /api/servers/:id/config/workshop` | `pages/ConfigPage.tsx:119` + `pages/ModsPage.tsx:36` | Config · Workshop Tab + Mods 加载 | ✅ 可用 | ✅ Zod query 不需要 |
| 18 | `PUT /api/servers/:id/config/workshop` | `pages/ConfigPage.tsx:152` + `pages/ModsPage.tsx:96` | Workshop File_IDs 保存 | ✅ 路径一致 | ✅ Zod `WriteWorkshopFileIdsSchema` |
| 19 | `GET /api/servers/:id`（files 域） | `pages/FilesPage.tsx:136` | 文件列表 | ✅ 可用 | ✅ Zod `ListDirectorySchema` (query) |
| 20 | `GET /api/servers/:id/content` | `pages/FilesPage.tsx:216` | 单文件读取 | ✅ 文本可用 | ✅ Zod path 校验 |
| 21 | `POST /api/servers/:id/upload` | `pages/FilesPage.tsx:164`（创建空文件）+ `:184`（文本上传 base64→atob） | 新建文件 / 文本上传 | ✅ 文本 OK | ✅ Zod `WriteFileSchema` |
| 22 | `POST /api/servers/:id/files/raw` 🆕 | （前端未调——待 FilesPage 改 FormData） | 二进制上传 | ❌ 二进制破坏（C7） | ✅ **新增 multipart 端点，FilesPage.tsx:177 FileReader.atob 改 FormData** |
| 23 | `GET /api/servers/:id/files/raw` 🆕 | （前端未调——待 FilesPage"下载"按钮） | 二进制下载 | ❌ 无下载 | ✅ **新增 Range 流式（顺手做）** |
| 24 | `POST /api/servers/:id/mkdir` | `pages/FilesPage.tsx:162` | 创建文件夹 | ✅ 可用 | ✅ Zod `CreateDirectorySchema` |
| 25 | `DELETE /api/servers/:id` | `pages/FilesPage.tsx:200` | 删除文件/目录 | ✅ 可用 | ✅ Zod path 校验 |
| 26 | `PUT /api/servers/:id/rename` | `pages/FilesPage.tsx:208` | 重命名 | ✅ 可用 | ✅ Zod `RenameEntrySchema` |
| 27 | `GET /api/servers/:id/players` 🆕 | （替代 `PlayersPage.tsx:46` 的 RCON hack） | 玩家列表 | ❌ 依赖 RCON 解析 | ✅ **新增端点**（PlayerSchema Zod）；前端 `PlayersPage.tsx:42 fetchPlayers` 改调此端点 |
| 28 | `GET /api/workshop/mods/:fileId` | `pages/ModsPage.tsx:48` + `:70` | Mod 元数据 | ❌ HTML 404（C6） | ⚠️ 路由存在，Phase 3 改造为 WebAPI Key |
| 29 | `GET /api/steamcmd/status` | `pages/ServerSetupPage.tsx:26` | SteamCMD 状态卡 | ⚠️ 路径探测局限 Linux | ✅ Phase 3 真 spawn 后状态更准（路由不动） |
| 30 | `POST /api/steamcmd/update` | `pages/ServerSetupPage.tsx:55` | U3DS 更新 | ❌ 假成功 | ✅ Zod `SteamCmdUpdateSchema`；Phase 3 改真 spawn |
| 31 | `GET /api/health` | （健康检查，无需消费） | ops 探针 | ✅ 可用 | — |

### 15.2 WS 事件 ↔ 前端消费点

| # | 事件类型 | 后端广播点 | 前端消费行 | 修复前状态 | 修复后状态 |
|---|---|---|---|---|---|
| 1 | `state_change` | `ServerManager.transition()`（已存在） | （前端**未订阅**——订阅集合永远空） | ❌ WS 收不到 | ✅ **前端 WebSocketContext.tsx 改用 accessToken + 发 subscribe**（修复 C8） |
| 2 | `console_line` | `LogStreamer.broadcastLine()`（已存在） | `hooks/useConsole.ts:52` | ❌ LogStreamer 未 startStreaming → 0 行 | ✅ **index.ts 启动时给每个 ServerID 调 `logStreamer.startStreaming()`** |
| 3 | `mod_apply_progress` | （未实现 — Phase 2） | `pages/ModsPage.tsx` 进度条（Sprint 5） | ❌ 缺失 | Phase 2 实现 |
| 4 | `rcon_status` | `RconManager.setState()`（已存在） | （前端未消费） | ⚠️ 待定 | 留 Phase 2 |
| 5 | `steamcmd_progress` | （未实现 — Phase 3） | `pages/ServerSetupPage.tsx:126` updateLogs（Sprint 5） | ❌ 缺失 | Phase 3 实现 |
| 6 | `player_join / leave` | （未实现） | （前端未消费） | ❌ | Sprint 5+ |
| 7 | `file_changed` | （未实现） | （前端未消费） | ❌ | Sprint 5+ |

### 15.3 前端代码改动清单（与 §15.1/§15.2 对应）

| 文件 | 改动 | 配套 ADR § |
|---|---|---|
| `contexts/AuthContext.tsx:48` | 无变（已 OK） | — |
| `contexts/WebSocketContext.tsx:23,28` | `localStorage.getItem('refreshToken')` → `accessToken`；建连后发 `subscribe` 消息 | §5.5 §5.6 |
| `hooks/useServer.ts` | 无变（路径 OK） | — |
| `hooks/useConsole.ts:101` | 无变（路径 OK） | — |
| `hooks/useConsole.ts:38,43` | `localStorage.getItem('refreshToken')` → `accessToken` | §5.5 |
| `pages/DashboardPage.tsx` | 无变 | — |
| `pages/ConsolePage.tsx:131` | `showConfirm !== command` 已 OK；二次确认流程完整 | — |
| `pages/ConfigPage.tsx:90-141` | Commands 收 `data.known ?? {}`（Record 已可工作）；保存改为普通对象 `{ known: {...}, unknown: {}, comments: [] }` | §2.1 |
| `pages/ConfigPage.tsx:103-150` | Txt 用 `sections['浏览器']` map 用法，**后端改 Record 后端到端通** | §2.2 |
| `pages/ConfigPage.tsx:152` | `filter((r) => r.status !== 'disabled')` 已合理 | — |
| `pages/ConfigPage.tsx:182` `handleApplyConfirm` | 已调 `POST /servers/:id/mods/apply`（C5 修复已闭环） | §3.4 |
| `pages/PlayersPage.tsx:42-46` | `fetchPlayers` 从 `POST /rcon/execute` 改 `GET /servers/:id/players` 拿结构化列表 | §3.3 |
| `pages/PlayersPage.tsx:63` | 行为不变（路径 `/rcon/execute` 已加别名） | §3.1 |
| `pages/FilesPage.tsx:136` | 无变 | — |
| `pages/FilesPage.tsx:177-188` | FileReader.atob 流程改 `FormData` + `POST /files/raw` | §3.2 |
| `pages/FilesPage.tsx:218` "下载"按钮（待新增） | 调 `GET /files/raw?path=...`；iframe 或 `window.location.href` 下载 | §14.2 |
| `pages/ServerSetupPage.tsx:46,55` | 无变（路径 OK，Zod 会拦截脏数据） | — |
| `pages/SettingsPage.tsx:22-36` | 改密码**假 setTimeout**需替换为 `POST /auth/change-password`（**Phase 0 新增端点 32**） | §3.5 |

### 15.4 新增端点补全（Settings 卡）

> §15.1 表格的 1–31 号端点是**修复/新增的接口**。但 Sprint 4 Settings 页 5 张卡片的设计里需要更多端点，§3.5 列出但§15.1 未列入。

| # | 方法 + 路径 | 用途 | 前端 | Phase |
|---|---|---|---|---|
| 32 | `POST /api/auth/change-password` | 改密码 | `SettingsPage.tsx:22 handleChangePassword` | **Phase 0 新增** |
| 33 | `POST /api/settings/webapi-key` | 设置 Steam WebAPI Key（页面已在用，待实现） | `SettingsPage.tsx`（待加） | Phase 3 配套 |
| 34 | `GET /api/audit-logs?limit=&action=` | 面板审计日志 | `SettingsPage.tsx` 面板日志 Card | **Phase 0 新增**（Settings 页 Card 5 数据源） |

### 15.5 落地验收映射

| 端点落地后，验证前端哪些功能恢复 | 端点 |
|---|---|
| **D1**: Dashboard 启动按钮不再卡 STARTING（30s 后报错回滚） | /servers/:id/start + ServerManager.pollA2S 已就绪 |
| **D2**: Console 输入命令，输出实时出现 | /execute + WS subscribe + LogStreamer 接线 |
| **D3**: Console WS 重连后订阅不丢 | WS subscribe 协议 |
| **D4**: Config·Commands 读取正确、保存不报错 | C3+C4 |
| **D5**: Config·Txt 读取正确、保存不报错 | C2 |
| **D6**: Config · Workshop 「应用变更」真正触发重启流水线 | C5 + POST /mods/apply |
| **D7**: Files 上传 .unity3d 不被破坏 | C7 + /files/raw multipart |
| **D8**: Players 表格非空（数据来自 GET /players） | 新增端点 |
| **D9**: Settings 改密码真正写到 DB | 新增端点 32 |

### 15.6 不在 Phase 0 范围（已标记技术债）

| 项 | 为什么不在 Phase 0 |
|---|---|
| 上传断点续传（HEAD + PATCH + POST finalize） | ADR §14.1，延后到 Sprint 5 跨公网 |
| `steamcmd_progress` WS 事件 | Phase 3 真 spawn 时实现 |
| `player_join / leave / file_changed` WS 事件 | Sprint 5+ |
| `FilesService.createUploadStream()` 流式实现 | Sprint 5 |

### 15.7 接口一致性校验表（避免"修了前面的忘了后面的"）

| 端点 | 对应 Zod schema | 对应 shared/types 字段 | 对应 Shared/Contracts 接口 | 全文搜索关键字 |
|---|---|---|---|---|
| POST /servers/:id/execute | `RconExecuteSchema` | — | `IRconManager.execute` | `rconManager.execute` |
| PUT /servers/:id/config/commands | `WriteCommandsDatSchema` | `CommandsDatRecord` | `IConfigService.writeCommandsDat` | `writeCommandsDat` |
| PUT /servers/:id/config/workshop | `WriteWorkshopFileIdsSchema` | `WorkshopConfig` | `IConfigService.writeWorkshopFileIds` | `writeWorkshopFileIds` |

> **校验时机**：
> - 每次改 §15.1 表格 → 同步改对应 Zod schema + 对应 Contracts 接口 + 对应 shared/types
> - 改 §15.2 表格 → 同步改 `IBroadcaster.ServerEvent` union
> - 改 §15.4 表格 → 同步在 `claudedocs/reference_api_spec.md` §6 列入 Phase 5+

---

*本 ADR 是 Phase 0 的设计总纲；具体每一项以"修改/新增为一份子 PR"落地，每个 PR 自带单测与 DoD 清单。*

> **维护规则**：任何"未来可能做但现在不做"的项，必须落到本节一栏，并标明：
> 1. 为什么不做（成本/概率/前置）
> 2. 何时复审（trigger 条件）
> 3. 何时动手（trigger 实际命中时）
>
> 隐藏的技术债 = 复利负债。显式的技术债 = 可审计、可调度的资源。


> **维护规则**：任何"未来可能做但现在不做"的项，必须落到本节一栏，并标明：
> 1. 为什么不做（成本/概率/前置）
> 2. 何时复审（trigger 条件）
> 3. 何时动手（trigger 实际命中时）
>
> 隐藏的技术债 = 复利负债。显式的技术债 = 可审计、可调度的资源。

