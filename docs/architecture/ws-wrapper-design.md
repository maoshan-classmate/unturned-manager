# WS 包装层架构设计 — 应答确认协议 + 共享事件总线

> **类型**：架构设计  
> **触发**：`claudedocs/research_ws_socketio_decision_2026-08-12.md` §5 推荐的包装层细化  
> **前置决策**：保持 `ws` 不变，加 ~150-200 行轻量包装层  
> **状态**：✅ 已实现（2026-08-12，阶段 1-4 全部落地；实施偏差见 §10.1）

---

## 0. 设计目标

1. **补应答确认（ACK）语义**——用户 Q3 真实需求，让 `terminal_close`、`shutdown`、`save` 等命令能拿到服务端确认
2. **消除 3 处重写重连的代码重复**——升级全局 WS Provider 为事件订阅总线
3. **不引入新依赖**——保持 `ws` 不变
4. **不违反现有铁律**——不翻转 `CLAUDE.md §2` 和 `prohibitions.md`
5. **保持向后兼容**——现有 `subscribe`、`terminal_input` 协议不变

---

## 1. 范围

### 包含

- 服务端 ACK 协议实现（消息路由 + 超时 + 业务错误传播）
- 前端共享事件总线 Provider（升级 WebSocketContext）
- 现有客户端 hook 整合（终端 hook / SteamCMD 进度 hook）
- 共享契约扩展（新增请求消息 / 应答消息类型）
- 单测 + 端到端测试

### 不包含（明确边界）

- **房间抽象**——Q1 答案确认「一个实例 ≤1 个 Server」，YAGNI 不实现
- **多语言客户端**——Q2 答案无计划
- **集群广播**——Q4 答案单实例终态
- **历史消息缓存 / 消息去重**——独立技术债，单独 Sprint 评估
- **服务端历史回放**——超出本次设计范围

---

## 2. 应答确认协议（ACK）设计

### 2.1 设计原则

- **ACK 是可选语义**——不是所有消息都需要 ACK；业务侧按需选择
- **请求-应答 vs 事件-推送**——两种语义清晰区分，不混用
- **业务错误通过数据字段传递**——不抛异常，遵循项目内统一错误类约定

### 2.2 消息 Schema

#### 客户端 → 服务端：请求消息

```typescript
// shared/contracts/ws.ts 扩展
export type ClientWsMessage =
  | { type: "subscribe"; serverIds: ServerId[]; eventTypes: string[] | null }
  | { type: "terminal_input"; serverId: ServerId; data: string }
  // 新增：请求-应答模式消息
  | { type: "terminal_close"; serverId: ServerId; requestId: string }
  | { type: "save"; serverId: ServerId; requestId: string }
  | { type: "shutdown"; serverId: ServerId; requestId: string; delaySeconds: number };
```

**关键约束**：

- `requestId` 必须是 UUID v4（`crypto.randomUUID()` 生成）
- 同一连接内 `requestId` 必须唯一
- 服务端对每个 `requestId` **最多回一个**应答（不会重复）

#### 服务端 → 客户端：应答消息

```typescript
// shared/contracts/broadcast.ts 扩展
export type ServerEvent =
  | { type: "state_change"; ... }
  | { type: "console_line"; ... }
  // ... 现有事件不变
  // 新增：应答
  | {
      type: "ack";
      requestId: string;
      ok: boolean;
      payload?: unknown;       // 成功时的业务数据
      error?: { code: string; message: string };  // 失败时的业务错误
    };
```

**关键约束**：

- `ack` 是独立事件类型，不混入现有事件流
- 业务错误（PTY 不存在、ServerID 无效等）通过 `error` 字段传递，HTTP 状态码语义由前端按 `ok` 判断
- `payload` 类型由具体请求决定——共享契约层不约束，前端按 type 自行收窄

### 2.3 请求-应答生命周期

```
┌─────────┐                 ┌─────────┐                 ┌─────────┐
│ Frontend│                 │ Gateway │                 │ Business│
└────┬────┘                 └────┬────┘                 └────┬────┘
     │                            │                            │
     │ 1. send({type,requestId})  │                            │
     ├───────────────────────────►│                            │
     │                            │ 2. 路由到业务处理器         │
     │                            ├───────────────────────────►│
     │                            │                            │
     │                            │ 3. 业务返回 {ok,payload}    │
     │                            │◄───────────────────────────┤
     │                            │                            │
     │ 4. emit({type:"ack",...})  │                            │
     │◄───────────────────────────┤                            │
     │                            │                            │
```

**超时路径**：

```
┌─────────┐                 ┌─────────┐
│ Frontend│                 │ Gateway │
└────┬────┘                 └────┬────┘
     │                            │
     │ send({type, requestId})    │
     ├───────────────────────────►│
     │                            │ 30 秒内无业务返回
     │                            │
     │ request 端 Promise reject  │
     │ (本地超时处理)              │
     │                            │ 业务最终返回 → 服务端丢弃（无 listener）
```

**关键设计**：

- **超时由前端控制**——服务端不需要强制响应（业务可能异步）
- 服务端在 `requestId` 没有客户端监听时**静默丢弃**——避免内存泄漏
- 超时后服务端如果最终返回，不发 ack（业务实现可决定是否记录日志）

### 2.4 服务端实现要点

#### 路由层（gateway.ts）

```typescript
// 新增：请求处理器注册表
type RequestHandler = (payload: unknown) => Promise<{ ok: boolean; payload?: unknown; error?: { code: string; message: string } }>;
const requestHandlers = new Map<string /* message type */, RequestHandler>();

// 新增：注册接口
registerRequestHandler(type: string, handler: RequestHandler): void { ... }

// 消息路由（在 ws.on('message') 内）
async function routeMessage(ws: WebSocket, msg: ClientWsMessage): Promise<void> {
  if (msg.type === 'terminal_close' || msg.type === 'save' || msg.type === 'shutdown') {
    const handler = requestHandlers.get(msg.type);
    if (!handler) {
      sendAck(ws, msg.requestId, false, undefined, { code: 'unsupported_request', message: `未实现 ${msg.type}` });
      return;
    }
    try {
      const result = await handler(msg);
      sendAck(ws, msg.requestId, result.ok, result.payload, result.error);
    } catch (err) {
      // 业务异常 → 业务错误（500 语义）
      sendAck(ws, msg.requestId, false, undefined, {
        code: 'internal_error',
        message: err instanceof Error ? err.message : '未知错误',
      });
    }
    return;
  }
  // 现有消息类型处理保持不变
}
```

#### 业务模块注册（composition-root.ts）

```typescript
// 在 composition-root.ts 中：
wsBroadcaster.registerRequestHandler('terminal_close', (payload) => ptyManager.close(payload.serverId));
wsBroadcaster.registerRequestHandler('save', async (payload) => {
  ptyManager.write(payload.serverId, 'Save\r');
  // 等待 PTY 输出 'World saved' 信号（具体实现由 PtyManager 决定）
  await ptyManager.waitForMarker(payload.serverId, /World saved/, 30_000);
  return { ok: true };
});
wsBroadcaster.registerRequestHandler('shutdown', async (payload) => {
  ptyManager.write(payload.serverId, `Shutdown ${payload.delaySeconds} 维护重启\r`);
  await ptyManager.waitForProcessExit(payload.serverId, (payload.delaySeconds + 30) * 1000);
  return { ok: true };
});
```

### 2.5 前端实现要点

#### 请求方法（WebSocketContext 暴露）

```typescript
// 在 WebSocketContext 中新增
async function request<T = unknown>(
  msg: { type: string; requestId?: string; [key: string]: unknown },
  opts: { timeoutMs?: number } = {}
): Promise<{ ok: boolean; payload?: T; error?: { code: string; message: string } }> {
  const requestId = msg.requestId ?? crypto.randomUUID();
  const timeoutMs = opts.timeoutMs ?? 30_000;

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingRequests.delete(requestId);
      reject(new Error(`Request ${msg.type} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    pendingRequests.set(requestId, { resolve: (result) => {
      clearTimeout(timer);
      resolve(result);
    }, reject });

    send({ ...msg, requestId });
  });
}
```

#### Hook 使用示例（useConsole 改造）

```typescript
// useConsole 改造后
const { request } = useWebSocket();

// 关闭 PTY 等待确认
async function closeTerminal() {
  try {
    const result = await request({ type: 'terminal_close', serverId });
    if (result.ok) {
      // 关闭成功
    } else {
      // 显示业务错误
      toast.error(result.error?.message);
    }
  } catch (err) {
    // 超时
    toast.error('关闭终端超时');
  }
}
```

---

## 3. 共享事件总线设计

### 3.1 设计原则

- **单连接**——3 处独立 WS 连接合并为 1 个
- **向后兼容**——旧 `useWebSocket().connected` API 保留，新增 `subscribe` / `request`
- **事件分发**——onmessage 解析后按 type 分发给 listeners
- **共享重连**——单一指数退避定时器

### 3.2 Provider 接口升级

#### 旧 API（保留）

```typescript
const { connected } = useWebSocket();
```

#### 新 API（新增）

```typescript
const ws = useWebSocket();

// 订阅服务端事件
const unsubscribe = ws.subscribe('console_line', (msg) => {
  if (msg.serverId === currentServerId) {
    setLines(prev => [...prev, msg.line]);
  }
});

// 发起请求-应答
const result = await ws.request({ type: 'shutdown', serverId, delaySeconds: 10 });

// 取消订阅（组件卸载时）
useEffect(() => () => unsubscribe(), []);
```

### 3.3 内部状态机

```
┌──────────┐   连接成功    ┌──────────┐
│ Disconnec│──────────────►│ Connected│
│   ted    │◄──────────────│          │
└────┬─────┘   连接断开    └──────────┘
     │                       │
     │ 重连中                 │ 自动发送 subscribe
     ▼                       ▼
┌──────────┐            ┌──────────┐
│ Reconn   │            │ Subscrib │
│ ecting   │            │  ed      │
└──────────┘            └──────────┘
```

**状态转换触发**：

- `Disconnected` → `Reconnecting`：组件挂载 / `onclose` 触发
- `Reconnecting` → `Connected`：onopen + 自动重发 `subscribe` + 重发 ACK 状态恢复（如未来支持）
- `Connected` → `Reconnecting`：onclose / onerror
- `Connected` → `Subscribed`：onopen 后收到服务端 `subscribed` 应答

### 3.4 消息分发流程

```
ws.onmessage (raw text)
  → JSON.parse
  → 校验基础格式
  → if (msg.type === 'ack'):
      pendingRequests.get(msg.requestId)?.resolve(msg)  // 应答匹配
  → else:
      listeners.get(msg.type)?.forEach(handler => handler(msg))  // 事件分发
      listeners.get('*')?.forEach(handler => handler(msg))  // 通配订阅（可选）
```

### 3.5 重连机制

```typescript
// 单一指数退避定时器
const MIN_RETRY_DELAY_MS = 1_000;
const MAX_RETRY_DELAY_MS = 30_000;
let retryDelay = MIN_RETRY_DELAY_MS;

function scheduleReconnect() {
  retryTimer = setTimeout(() => {
    retryDelay = Math.min(retryDelay * 2, MAX_RETRY_DELAY_MS);
    connect();  // 重连会重发 subscribe
  }, retryDelay);
}

// 重连成功后重置
function onOpen() {
  retryDelay = MIN_RETRY_DELAY_MS;
  send({ type: 'subscribe', serverIds: state.subscribedServerIds, eventTypes: state.subscribedEventTypes });
}
```

### 3.6 现有 Hook 整合

#### useConsole（独立连接 → 共享）

```typescript
// 改造前：独立 WebSocket
const ws = new WebSocket(url);
ws.onmessage = (e) => { /* 解析 console_line */ };

// 改造后：使用事件总线
const ws = useWebSocket();
useEffect(() => {
  const unsubscribe = ws.subscribe('console_line', (msg) => {
    if (msg.serverId === serverId) {
      setLines(prev => [...prev, msg.line].slice(-500));
    }
  });
  return unsubscribe;
}, [serverId, ws]);

// 发送命令
const sendCommand = (cmd: string) => ws.send({ type: 'terminal_input', serverId, data: cmd + '\r' });
```

#### useSteamCmdProgress（独立连接 → 共享）

```typescript
// 改造前：独立 WebSocket
const ws = new WebSocket(url);

// 改造后：使用事件总线
const ws = useWebSocket();
useEffect(() => {
  const unsubscribe = ws.subscribe('steamcmd_progress', (msg) => {
    if (msg.jobId === targetJobId) {
      setProgress(msg);
    }
  });
  return unsubscribe;
}, [targetJobId, ws]);
```

#### useServer（已经用 subscribe，微调）

```typescript
// 改造前：直接订阅
const ws = useWebSocket();
useEffect(() => {
  const unsubscribe = ws.subscribe((msg) => {  // 旧 API
    if (msg.type === 'state_change') setServers(...);
  });
  return unsubscribe;
}, []);

// 改造后：按类型订阅
const ws = useWebSocket();
useEffect(() => {
  const unsubscribe = ws.subscribe('state_change', (msg) => {
    setServers(prev => prev.map(s => s.id === msg.serverId ? { ...s, state: msg.to } : s));
  });
  return unsubscribe;
}, [ws]);
```

---

## 4. 文件改动清单

### 4.1 服务端

| 文件 | 改动 | 行数 |
|---|---|---|
| WS 网关核心文件 | + 请求处理器注册表 + 路由逻辑 + `sendAck` 方法 | +80 |
| 依赖注入组合根 | + 3 个业务处理器注册（关闭 / 保存 / 关闭服务端） | +30 |
| 终端进程管理模块 | + `waitForMarker` / `waitForProcessExit` 方法 | +40 |
| 共享契约（ws） | + 请求消息类型 | +15 |
| 共享契约（事件） | + 应答事件类型 | +15 |

### 4.2 前端

| 文件 | 改动 | 行数 |
|---|---|---|
| 全局 WS Provider | 重写为事件订阅总线（保留 `connected`） | +120 |
| 终端专用 hook | 改为 `subscribe` + `send`（删独立连接） | -40 |
| SteamCMD 进度 hook | 改为 `subscribe`（删独立连接） | -30 |
| 实例列表 hook | 微调（按类型订阅） | -5 |

**总计**：约 +225 / -75 = 净增 +150 行代码。

---

## 5. 测试策略

### 5.1 服务端单测（gateway.test.ts 扩展）

| 测试 | 场景 |
|---|---|
| 应答正常路径 | 发起请求 → 业务返回 → 收到正确 ack |
| 应答业务错误 | 业务抛异常 → 收到 `ok: false` + `error.code/message` |
| 应答超时 | 业务 30 秒不返回 → 客户端 reject（服务端不强制） |
| 请求 ID 唯一性 | 同一连接多个请求 ID 互不干扰 |
| 未注册请求类型 | 收到 ack + `unsupported_request` 错误 |

### 5.2 前端单测（WebSocketContext.test.tsx）

| 测试 | 场景 |
|---|---|
| 订阅事件分发 | 服务端推 `console_line` → 监听者收到 |
| 多订阅者隔离 | A 订 `console_line`、B 订 `state_change` → 互不干扰 |
| 请求应答匹配 | request → ack 同 requestId → Promise resolve |
| 重连重发订阅 | 断开 → 重连 → 自动重发 `subscribe` |
| 重连后 ACK 失败 | 在飞请求被 reject（不阻塞重连） |
| 指数退避 | 1s → 2s → 4s → … → 30s 上限 |

### 5.3 端到端测试（playwright）

| 测试 | 场景 |
|---|---|
| ACK 端到端 | 启动 Server → 调 `shutdown` → 等待 `state_change: STOPPING` → ack 收到 |
| 控制台共享连接 | 同时打开 Dashboard + Console 页 → 单一 WS 连接工作正常 |
| 重连恢复订阅 | 强制断网 → 恢复 → Console 继续接收输出 |

---

## 6. 迁移计划

### 阶段 1：服务端 ACK（独立提交）

1. 扩展共享契约：请求消息 + 应答消息类型
2. WS 网关核心：注册请求处理器 + 路由逻辑 + `sendAck` 方法
3. 业务模块注册：`terminal_close` / `save` / `shutdown` 三个处理器
4. 终端进程管理模块：新增 `waitForMarker` / `waitForProcessExit`
5. 服务端单测：覆盖 5 个测试用例

**验收**：服务端向后兼容（现有 `subscribe` / `terminal_input` 不变），新增三个请求类型可用

### 阶段 2：前端事件总线（独立提交）

1. WebSocketContext 重写为事件订阅总线
2. 保留旧 `connected` API（向后兼容）
3. 前端单测：覆盖订阅 / 重连 / ACK 失败

**验收**：单一连接建立，事件可订阅，旧 API 不破坏

### 阶段 3：现有 Hook 迁移（独立提交）

1. 终端专用 hook：删独立连接，改用 `subscribe` + `send`
2. SteamCMD 进度 hook：同上
3. 实例列表 hook：微调按类型订阅
4. 端到端测试：覆盖共享连接 + 重连恢复

**验收**：3 处独立连接合并为 1 个，行为一致

### 阶段 4：ACK 前端集成（独立提交）

1. 危险指令确认弹窗：调 `request('shutdown')` 等待 ack
2. 终端关闭按钮：调 `request('terminal_close')` 等待 ack
3. 保存按钮：调 `request('save')` 等待 ack

**验收**：用户操作有明确成功/失败反馈，超时有提示

---

## 7. 风险评估

| 风险 | 严重度 | 缓解措施 |
|---|---|---|
| 订阅总线改造影响所有 hook | 中 | 分阶段迁移（阶段 3 单独提交），保留旧 API 向后兼容 |
| 共享连接单点失败 | 低 | 统一重连逻辑反而简化问题定位；3 处独立连接本来就是「技术债」而非「可靠性」 |
| ACK 超时需要业务层配合 | 中 | 设计 `send`（fire-and-forget）+ `request`（带 ACK）两个 API，调用方按需选择 |
| `requestId` 冲突导致应答错位 | 低 | 用 UUID v4（冲突概率 2^-122）；服务端校验收到未知 ID 时发 `error` 事件而非静默丢弃 |
| 重连后 ACK 在飞请求卡住 | 低 | 重连时清空 `pendingRequests` 并 reject 所有 Promise；与 GSM3 设计保持一致（不持久化在飞请求） |
| 业务处理器抛异常导致连接挂掉 | 中 | `routeMessage` 包 try/catch；异常转为 ack error；不抛出到 ws 层 |

---

## 8. 未来扩展（不在本次实现范围）

- **房间抽象**（按 serverId 隔离广播）——当 Q1 答案变化（多 Server 实际部署）时再设计
- **历史消息缓存 + 重连回放**——独立技术债，单独 Sprint
- **服务端推送的消息级 ACK**（如 `state_change` 也带 ID）——消息去重场景，超出本次范围
- **服务端主动调用客户端的能力**（如「请前端刷新配置」）——双向 RPC，超出本次范围

---

## 9. 验收清单

- [x] 服务端：现有 `subscribe` / `terminal_input` 协议不变
- [x] 服务端：新增 `terminal_close` / `save` / `shutdown` 三个请求类型可用
- [x] 前端：WebSocketContext 暴露 `subscribe` + `request` + `connected` 三种能力（另加 `send` fire-and-forget）
- [x] 前端：3 处独立 WS 连接合并为 1 个
- [x] 前端：旧 `useWebSocket().connected` API 不破坏
- [x] 测试：服务端 6 个 ACK 单测（gateway）+ 6 个 waitForMarker 单测（ptyManager）+ 前端 9 个单测（WebSocketContext）全绿；e2e 9/9（含 WS 连接回归 + ACK 按钮渲染）。依赖真机 U3DS 的用例（§5.3 关服 ACK 端到端 / 重连恢复订阅）留在真机验证阶段
- [x] 文档：本次设计落到 `docs/architecture/ws-wrapper-design.md`（本文件，状态已更新为已实现）
- [x] 文档：决策过程保留在 `claudedocs/research_ws_socketio_decision_2026-08-12.md`
- [x] 文档：`architecture-spec.md` §3.4 / §4.3 同步更新为共享总线 + ACK 现状

---

## 10. 下一步

~~等待评审~~ 阶段 1-4 已实施完成（2026-08-12）。剩余事项见 §10.1 实施偏差与 §10.2 未覆盖项。

### 10.1 实施偏差记录（设计稿 → 落地）

| 设计稿 | 落地 | 理由 |
|---|---|---|
| `terminal_close` → `ptyManager.close` | → `ptyManager.kill`（SIGTERM → 5s → SIGKILL） | PtyManager 无 close 方法，kill 是语义最近的既有能力（优雅停 → 强杀兜底） |
| `shutdown` 只写 `Shutdown` 命令 | 先写 `Save` 再写 `Shutdown`，delaySeconds 钳制 0–600，reason 剥引号/换行 | 对齐 SOP 重启流水线与 REST stop 同序（先刷盘再关）；钳制防手滑天文数字 |
| `save` 等待信号失败直接 ack error | `waitForMarker` 超时转 `save_timeout` 业务错误（不上抛 AppError） | 超时/退出属于可预期业务结果，走 error 字段符合契约 |
| 服务端注册在 gateway 内 | 处理器注册移到 `composition-root.ts`（gateway 只提供注册表 + 路由） | 网关保持协议层职责；业务依赖（ptyManager）在组合根注入 |
| 阶段 4 只提「危险指令确认弹窗调 request('shutdown')」 | 存档/关服/关闭控制台三个独立按钮 + ConfirmDialog + `runAck` 统一 toast 反馈 | 按钮化的存档/关服对普通玩家更明确；关控制台是核选项需单独确认文案 |

### 10.2 未覆盖项（需真机 / 后续）

- **关服 ACK 端到端**（§5.3）：依赖真实 U3DS——启动 → shutdown → 等 state_change + ack。留 Sprint 5 真机验证。
- **重连恢复订阅 e2e**（§5.3）：强制断网模拟在真实浏览器环境未做，前端单测已覆盖逻辑。
- **房间抽象 / 历史回放 / 消息级去重**：§8 明确不在本次范围，技术债清单跟进。

**待讨论事项（来自决策记录）**：

- `claudedocs/research_ws_socketio_decision_2026-08-12.md` §7 待讨论 #1：Q1 答案与 `CLAUDE.md §2` 的张力——独立 brainstorm/ADR 翻转讨论
- `waitForMarker` 的 marker 正则目前硬编码 `world saved`（大小写不敏感）——如 U3DS 版本输出文案变化，需在真机验证时校正

---

*创建日期：2026-08-12 · WS 包装层架构设计（决策依据：research_ws_socketio_decision_2026-08-12.md §5）*
