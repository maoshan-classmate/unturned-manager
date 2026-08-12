# WS 库选型调研与决策 — 2026-08-12

> **类型**：brainstorm 产出 + 决策记录  
> **触发**：用户提问「本项目 WebSocket vs Socket.IO（GSM3 选型）取舍」  
> **状态**：✅ **已决策** — 不换 Socket.IO，走 `ws` + 轻量包装层  
> **下一步**：包装层设计与实现均已完成（`docs/architecture/ws-wrapper-design.md` 状态「已实现」，阶段 1-4 落地）；剩余未决项见 §9

---

## 0. 一句话结论

**不换 Socket.IO，保持 `ws`，在 gateway.ts 之上加 ~150-200 行轻量包装层**——核心动机是补 ACK（用户真实需求），其余 Socket.IO 优势场景在当前项目设计目标下都用不上。

---

## 1. 背景

用户提问：本项目通信用 `ws`（裸 WebSocket 库），GSM3 用 Socket.IO——是否应该对齐 GSM3 选 Socket.IO？

**关键约束**（来自 `CLAUDE.md` + `prohibitions.md`）：

- `CLAUDE.md §2` 技术栈表钉死用 `ws`
- `prohibitions.md`「硬禁止（要先写 ADR 才能用）」第一行：Socket.IO
- `ADR-0004` 已定 PTY 终端 + WS 双向链路（不是 Socket.IO）
- 翻案需要写新 ADR 论证「之前的判断错了」

---

## 2. 调研产出（3 份并行调研）

### 2.1 调研 1：本项目 WebSocket 实际用法

| 维度 | 现状 |
|---|---|
| 服务端文件 | **1 个**：WS 网关核心文件（约 220 行） |
| 客户端 WS 连接 | **3 处独立**：全局共享 Provider + 终端专用 hook + 创意工坊下载专用 hook |
| 真实广播事件 | **4 类**：状态变更、终端输出行、Mod 应用进度、SteamCMD 下载进度 |
| 契约定义但未触发 | **2 类**：玩家加入/离开、文件变更（ADR-0004 Phase 6 删 RCON 后的残留契约） |
| 鉴权 | URL 查询参数 `?token=<accessToken>` + HTTP 升级握手阶段校验 |
| 心跳 | 服务端每 30 秒 ping，浏览器原生 WebSocket 自动回 pong |
| 重连 | 客户端手写指数退避（1 秒 → 2 秒 → 4 秒 → … → 30 秒上限），**3 处各自重写一遍** |
| 会话恢复 | � 无——纯一次性推送模式，无消息序号、无服务端历史缓存 |
| 订阅模型 | 客户端首条订阅消息 → 服务端 Map 单连接过滤 |

**关键发现**：

- 三个客户端各自重写重连逻辑——根因是全局 Provider 只暴露「是否连接」布尔，不分发事件
- 注册/注销接口定义但从未调用——订阅完全靠客户端订阅消息管理
- Mod 应用进度字段不一致——契约定义剩余秒数，实际广播用了消息字段
- 广播失败被静默吞掉——所有调用都包了空 catch

### 2.2 调研 2：GSM3 Socket.IO 用法

| 维度 | 现状 |
|---|---|
| 服务端代码 | 主控入口 + 终端事件处理器等多个模块 |
| 客户端 | **1 个 783 行单例**（中央客户端封装）+ 2 处临时独立连接 |
| 自定义事件 | **30+ 类**（终端系列 / 游戏系列 / 系统监控系列 / 文件监控 / VPN / 各类部署/下载进度等） |
| 房间机制 | 真正的房间加入/离开 API（系统监控房间、VPN 配置房间、每客户端 ID 房间） |
| 鉴权 | Socket.IO 中间件（验证握手阶段令牌）+ HTTP 中间件（验证头部令牌） |
| 心跳 | Socket.IO 默认 25 秒 PING/PONG |
| **重连** | ⚠️ **禁用** socket.io-client 自带，手写指数退避 + 应答队列（待确认重连队列） |
| 设计文档 | ❌ **没有**——无 ADR / 无提交记录解释为什么选 Socket.IO |

**关键发现**：

- GSM3 用 Socket.IO 主要因为「房间 + 握手鉴权 + 事件系统 + 重连」这些原生能力匹配它的多游戏多客户端场景
- **但 GSM3 自己禁用了 socket.io-client 的自带重连**——证明 Socket.IO 的便利性在 GSM3 实际场景里也没完全省下来
- 没有「设计文档解释为什么选 Socket.IO」——选型本身未被显式论证

### 2.3 调研 3：ws vs Socket.IO 技术差异

| 维度 | `ws` | Socket.IO |
|---|---|---|
| 协议 | RFC 6455 原生 | WebSocket 之上的引擎.IO 私有协议层 |
| 互通 | ❌ **官方明确两者不互通**——纯 WebSocket 客户端连不上 Socket.IO 服务端 | 同左 |
| 包体积 | 零运行时依赖（仅可选 peer） | 引擎.IO + 解析器 + 适配器等 5+ 个包 |
| PTY 高频流性能 | 结构上更适配（无解析器开销、可关心跳省带宽、无轮询首屏延迟） | 多一层解析器 + 字符串化，结构上不利 |
| 房间 / 中间件 / 应答确认 / 多语言客户端 | ❌ 需自己造 | ✅ 原生 |
| 集群广播 | � 自接 Redis/NATS pub/sub | ✅ Redis 适配器开箱即用 |
| 当前版本 | 8.21.3 | 服务端 4.8.3 / 客户端 4.8.3 |

**关键发现**：

- 协议层两者**不可互通**——Socket.IO 在官方说明里明确「不是 WebSocket 实现」
- PTY + xterm.js 这种「单向服务器推、高频小包、低延迟」场景，工程社区共识是 `ws` 更适配
- Socket.IO 的优势场景是「双向带应答 + 房间 + 跨节点」——与本项目当前需求匹配度低

---

## 3. 用户拍板的 6 个关键问题

| 编号 | 问题 | 用户回答 | 影响 |
|---|---|---|---|
| Q1 | 本项目真实多实例规模？ | 一个实例对应一个 Server，或最多 1 个 Server | 房间抽象**当前不写**；与 `CLAUDE.md §2` 钉死的「多实例共装」存在张力（见 §6） |
| Q2 | 是否计划扩展非 Web 客户端？ | 目前无计划 | Socket.IO 的多语言客户端优势**用不上** |
| Q3 | 是否需要应答确认语义？ | **肯定要** | ACK 是真实需求，是本次评估的**核心动机** |
| Q4 | 单实例部署是终态还是过渡？ | 终态 | Socket.IO 的 Redis 适配器**用不上** |
| Q5 | 对齐 GSM3 的最终目的？ | **简化开发**——不能简化、收益过小就没必要 | 评估标准：换 Socket.IO 是否能简化本项目代码 |
| Q6 | 当前技术债解决优先级？ | 优先级高，先评估是否要换 | 决定是否启动本次评估 |

---

## 4. 决策依据（基于 Q5「简化开发」原则）

**换 Socket.IO 是否简化本项目开发？逐项打分：**

| 当前痛点 | Socket.IO 能解决吗？ | 简化收益 | 引入代价 |
|---|---|---|---|
| **Q3 应答确认（真实需求）** | ✅ 原生 socket.emit 带回调 | ★★★★ 显著 | — |
| **3 处重写重连（技术债）** | ⚠️ GSM3 自己也手写——禁用自带重连 | ★☆☆ 几乎无 | — |
| **房间抽象（Q1 ≤1 个 Server）** | ✅ 原生 API | ☆☆☆ 当前不需要 | — |
| **中间件鉴权（当前握手校验已够）** | ✅ io.use | ★☆☆ 当前不痛 | — |
| **事件分发（当前 4 类事件）** | ✅ emit/on | ★★☆ 略优 | — |
| **PTY 高频流（核心场景）** | ❌ 多一层解析器开销 + 首屏轮询延迟 | — | ★★☆ 性能下降 |
| **包体积** | � +5 个运行时依赖 | — | ★★☆ 启动/审计面变大 |
| **违反 `CLAUDE.md §2` + `prohibitions.md`** | — | — | ★★★ 要写翻案 ADR |

**结论**：应答确认是唯一显著收益点，其他都是「GSM3 用了我也用」的对齐幻觉。GSM3 自己手写重连已经证明这条路并不省事。

---

## 5. 推荐路径：包装层细化

**保持 `ws`，在 WS 网关之上加 ~150-200 行轻量包装层**。

### 包装层 1：应答确认协议（约 50 行）

约定消息格式：

- 请求：`{ id: uuid, type, serverId, payload }`
- 应答：`{ id: uuid, type: "ack", ok, payload?, error? }`

新增 WS 网关方法：

- 请求方法：发起带超时（默认 30 秒，可覆盖）的请求，返回 Promise 解析 `{ ok, payload?, error? }`
- 内部维护 `Map<id, {resolve, reject, timeout}>`，收到应答时按 id 匹配
- 超时未响应 → 拒绝 + 日志

### 包装层 2：共享 WS 连接 + 事件总线（约 100 行）

升级全局 WS Provider → 事件订阅总线：

- **单一** WS 连接（不再建第二、第三个）
- 终端 hook 和 SteamCMD 进度 hook 改为「订阅消息类型 + 处理函数」模式
- 共享指数退避重连（删 3 处重复）
- 类似认证上下文的模式（Provider + 专用 hook + 空值守卫）

### 包装层 3：房间抽象（**不实现**）

Q1 答案确认当前是「一个实例 = 一个 Server」或最多 1 个——房间抽象**当前不写**，需要时再写（精益原则）。

### 预估改动

| 文件 | 改动 |
|---|---|
| WS 网关核心文件 | +50 行（应答确认协议 + 请求方法） |
| 共享契约文件 | +10 行（客户端/服务端应答消息类型） |
| 全局 WS Provider | 重写为事件总线（约 150 行） |
| 终端专用 hook | -30 行（删除重连、改为订阅） |
| SteamCMD 进度 hook | -30 行（同上） |
| 实例列表 hook | 微调（订阅替代回调） |

总计净增约 150 行代码（删 -60、增 +210）。**不引入新依赖、不违反铁律、不需要翻案 ADR。**

---

## 6. 为什么「不换」的三条硬理由

1. **PTY 高频流是核心场景**——Socket.IO 的解析器开销和轮询首屏延迟在这个场景下结构不利。调研已经明确指出「`ws` 更适配 PTY + xterm.js」。

2. **GSM3 自己的证据**——GSM3 禁用了 socket.io-client 自带重连，自己手写应答队列，单独为 Steam/Minecraft 下载创建临时连接。这说明 Socket.IO 的便利性在 GSM3 的实际场景里也没省下来。

3. **`CLAUDE.md §2` + `prohibitions.md` 的「Socket.IO 禁用」是 ADR 写过的判断**——翻案需要论证「之前的判断错了」，而当前没有反例（PTY 高频流恰恰是 `ws` 更优的方向）。

---

## 7. 后续讨论事项（未决，标记待办）

### 待讨论 #1：Q1 答案与 `CLAUDE.md §2` 的张力

**问题描述**：

- `CLAUDE.md §2` 钉死的「多实例共装（省 10GB/服）」是**能力预留**（一个面板能管多个 Server）
- 用户 Q1 答案「一个实例对应一个 Server，或最多 1 个」是**实际部署规模**（每个面板只跑 1 个 Server）

**为什么是张力**：

- 能力预留意味着设计目标允许多实例（用户可以开多个 Server）
- 实际部署规模意味着大多数用户根本用不上多实例
- 如果「多实例共装」是过度设计，未来可能不再需要这个能力——那是一个独立的 ADR 翻转讨论

**当前状态**：不翻转 `ADR-0002`（多实例共装）——能力预留与实际部署规模是两件事。但用户已标记「这点后续讨论」，应单独发起 brainstorm/ADR 评估。

**待办**：另起一次 brainstorm 讨论 `ADR-0002` 是否需要翻转。

---

## 8. 引用清单

### 调研来源

- `manager-server/src/ws/gateway.ts`（WS 网关核心，约 220 行）
- `manager-server/src/composition-root.ts`（依赖注入）
- `manager-server/src/index.ts`（启动/关闭）
- `manager-server/src/modules/auth/AuthService.ts`（令牌校验）
- `manager-server/src/modules/logs/LogStreamer.ts`（日志流）
- `manager-server/src/modules/server/ServerManager.ts`（状态变更广播）
- `manager-server/src/modules/steamcmd/SteamCmdManager.ts`（SteamCMD 进度广播）
- `manager-server/src/modules/workshop/WorkshopApplyService.ts`（Mod 应用进度广播）
- `manager-server/src/modules/process/PtyManager.ts`（node-pty 包装）
- `manager-web/src/contexts/WebSocketContext.tsx`（全局 WS Provider）
- `manager-web/src/contexts/AuthContext.tsx`（认证上下文）
- `manager-web/src/api/client.ts`（自动刷新令牌）
- `manager-web/src/hooks/useConsole.ts`（终端专用 hook）
- `manager-web/src/hooks/useServer.ts`（实例列表 hook）
- `manager-web/src/hooks/useSteamCmdProgress.ts`（SteamCMD 进度 hook）
- `manager-web/vite.config.ts`（开发代理）
- `shared/contracts/broadcast.ts`（事件契约）
- `shared/contracts/ws.ts`（客户端消息契约）
- `shared/contracts/pty.ts`（PTY 接口契约）

### 外部参考

- [websockets/ws GitHub](https://github.com/websockets/ws)
- [ws package.json (master, 8.21.3)](https://raw.githubusercontent.com/websockets/ws/master/package.json)
- [Socket.IO 官方站](https://socket.io/)
- [Socket.IO Overview](https://socket.io/docs/v4/)（明确「非 WebSocket 实现」）
- [Socket.IO How it works](https://socket.io/docs/v4/how-it-works/)（引擎.IO 架构、握手、心跳）
- [socket.io package.json (main, 4.8.3)](https://raw.githubusercontent.com/socketio/socket.io/main/packages/socket.io/package.json)
- [socket.io-client package.json (main, 4.8.3)](https://raw.githubusercontent.com/socketio/socket.io/main/packages/socket.io-client/package.json)
- GSM3 `.research/GameServerManager/server/src/index.ts`（Socket.IO 初始化 + 鉴权中间件）
- GSM3 `.research/GameServerManager/server/src/socket/terminalSocketHandlers.ts`（终端事件注册）
- GSM3 `.research/GameServerManager/server/src/modules/system/SystemManager.ts`（系统监控房间/定时器）
- GSM3 `.research/GameServerManager/client/src/utils/socket.ts`（单例客户端封装，应答确认队列）
- GSM3 `.research/GameServerManager/docs/WebSocket断连恢复加固说明.md`（断连恢复加固历史）

### 项目内铁律

- `CLAUDE.md §2`（技术栈表钉死用 `ws`）
- `prohibitions.md`「硬禁止（要先写 ADR 才能用）」第一行（Socket.IO 禁用）
- `ADR-0004`（PTY 终端 + WS 双向链路决策）

---

## 9. 下一步

包装层设计与实现均已完成——`docs/architecture/ws-wrapper-design.md`（状态「✅ 已实现」）：
应答确认协议（`terminal_close` / `save` / `shutdown` ACK）+ 共享 WS 事件总线（`subscribe` / `send` / `request`）。

剩余未决项：

| 待办 | 说明 |
|---|---|
| 单独评估 ADR-0002 | 另起 brainstorm 讨论「多实例共装」是否需要翻转（见 §7 待讨论 #1） |
| 真机验证 | 关服 ACK 端到端、重连恢复订阅需真实 U3DS 环境（Sprint 5） |

---

*创建日期：2026-08-12 · WS 库选型决策 brainstorm 产出*  
*最后更新：2026-08-12——决策落档；包装层已设计并实现（ws-wrapper-design.md）；张力点（Q1 vs §2）标注为后续讨论*
