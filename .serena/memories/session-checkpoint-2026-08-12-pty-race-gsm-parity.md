# Session Checkpoint 2026-08-12 — 服务器状态控制链路三连击修复（对齐 GSM3）

2026-08-12 会话完成「仪表盘状态显示 + Dashboard 写操作冗余 + PTY 启动 race」三个独立但相关的 bug 修复。**所有修复均参考 GSM3 真实代码**，1:1 对齐范式。

## 用户视角症状

- 服务器已启动，但仪表盘数据仍显示「已停止」
- 「服务器设置」→ 服务器控制卡片：启动按钮仍可点，停止/重启/保存按钮置灰
- **链路层**：按钮状态错位 → 「看不到真状态」的根本原因是前端从未拿到真实运行态

## 触发链（用户逐级决策）

1. `/sc:troubleshoot` 诊断：发现 ServerConfig 类型无 state 字段 + listServers 不注入内存态（主根因）
2. 用户拍板修复（`--fix`）：方案 1 + 方案 2（Dashboard 删写操作按钮）
3. 用户质疑按钮：DashboardPage 用了原生 `<a>`，复用 buttonVariants 样式而非 Button 组件（base-ui 官方不推荐 Button render 成 a：链接有独立语义）
4. `/sc:recommend` 评估 PTY race 1s setTimeout 风险
5. 用户拍板 A：抄 GSM 落地 — START_COMMAND_DELAY 1s→3s + stdout ready 正则 + transition 幂等

## 三提交闭环

| Commit | 内容 | 验证 |
|---|---|---|
| `6c934fc` | 修主根因：ServerConfig/state 字段 + listServers 注入 + 前端类型对齐 + Dashboard 删三件套改跳转链接 | 后端 197/197、前端 33/33、typecheck 双 0 |
| `0f10eb4` | 重构：Dashboard 跳转链接复用 buttonVariants 样式（保留 a 链接语义） | 前端 33/33、typecheck 0 |
| `bb88a7a` | PTY race 对齐 GSM 范式：1s→3s + stdout ready 正则 + transition 幂等 | 后端 200/200（含 3 新测试）、typecheck 双 0 |

## GSM3 调研结论（**已 grep + read 验证**）

### 1. PTY ready 检测范式（`GameManager.ts`）

GSM 用**两种并行策略**，不替代：

| 策略 | GSM 位置 | 行为 |
|---|---|---|
| A：固定定时器 + 存活检查 | `:355-365` / `:553-563` | `setTimeout(() => { if (process && !killed) status='running' }, 3000)` |
| B：stdout 命中 ready 正则 | `:795-802`（`parseMinecraftOutput`） | `if (output.includes('Done (') && output.includes('For help, type "help"')) status='running'` |

**关键设计**：3 秒固定定时器（不是 1 秒）、两个策略并行（哪个先到用哪个）、transition 内部幂等避免重复广播。

### 2. PTY Session 状态（`TerminalManager.ts:1116-1127`）

```ts
setTimeout(() => {
  const current = this.sessions.get(session.id)
  if (current !== session || current.state !== 'ready' ||
      current.process !== launch.process || current.processExited) return
  this.writePtyStdin(current, '\r')
}, 500)
```

GSM 的 `state === 'ready'` 是 PTY 进程创建成功，**不是游戏进程启动成功**——这是关键语义差异。GSM 在 PTY 准备好 500ms 后塞启动命令；U3DS 起没起靠 `parseGameOutput` 命中 ready 字符串判定。

### 3. 关键差异

| 项 | GSM3 | 本项目（已修） |
|---|---|---|
| 定时器时长 | 3000ms | 3000ms（对齐） |
| ready 正则命中 | `Done (...)` / `For help, type "help"` | `Server is ready` / `World saved` / `Startup complete` |
| 进程存活检查 | `process && !killed` | `ptyManager.isRunning(id)`（已存在） |
| transition 幂等 | 隐式（内部判断） | **新增显式 `if (entry.state === to) return`** |

## 主根因 + 衍生问题

### 🔴 主根因：`listServers()` 不返回内存运行态

**链路**（每步核验）：
1. `ServerManager.ts:70` `RuntimeServerState.state` 内存里有正确状态 ✅
2. `transition()` → `broadcaster.broadcast({type:'state_change', serverId, to})` ✅
3. `WebSocketContext.tsx:90` ws.onmessage fan-out 给 listeners ✅
4. `useServer.ts:83-96` subscribe → setServers 改 state ✅
5. **GET /servers** → `listServers()` 只返 `s.config`（**无 state 字段！**）❌ 断点
6. `ServerConfig` 接口设计遗漏 `state` 字段
7. 前端 `server.state === undefined` → 显示 STOPPED → 启动按钮永远可点

**修复**：`ServerConfig` 加 `state?: ServerState` + `listServers()` 注入 `{ ...s.config, state: s.state }`。

### 🟡 次生问题：Dashboard 写操作按钮冗余

Dashboard 是「概览」，不该承载启动/停止/重启——控制操作只在「服务器设置」一处入口。**修复**：删三件套 + ConfirmDialog + useServerActions，改跳转链接 `/<serverId>/server-setup`。

### 🟠 设计质疑：按钮组件复用

用户指出 `<a>` 是抄近路。**正解**：
- base-ui Button **不推荐** render 成 a（链接有独立语义：`Cmd+Click`、右键菜单、屏幕阅读器念"链接"）
- **复用样式 + 保留语义**：`className={cn(buttonVariants({variant:'secondary'}))}` 套 `<a>`
- 铁律 1「三行原则」没过阈值不抽 `LinkButton` 组件（当前 1 处使用）

### 🟠 PTY race（独立 bug，GSM 范式修复）

`ServerManager.ts:520-527` 之前是 1s 强制 RUNNING，U3DS 实测启动 3-8 秒必踩。**对齐 GSM**：3s 兜底 + stdout 命中 `Server is ready` 提前 transition + transition 幂等。

## 关键设计决策

### 1. transition 幂等化（GSM 隐式 → 本项目显式）

```ts
private transition(serverId: ServerId, to: ServerState): void {
  const entry = this.servers.get(serverId);
  if (!entry) return;
  if (entry.state === to) return; // ← 新增：双触发去重
  const from = entry.state;
  entry.state = to;
  // ...
}
```

正则命中 + 定时器兜底谁先到谁触发，幂等守住不重复广播 state_change。

### 2. U3DS_READY_PATTERNS 常量（抄 unturned-sop.md）

```ts
const U3DS_READY_PATTERNS: RegExp[] = [
  /Server is ready/i,   // 主信号
  /World saved/i,       // 备用：保存完成的同源信号
  /Startup complete/i,  // 备用：未来 U3DS 改输出格式兜底
];
```

### 3. 测试时间假设同步改写（**5 处 1000→3000**）

`tests/serverManager.test.ts` 5 处 `advanceTimersByTimeAsync(1000)` 必须同步改 `3000`，否则 START_COMMAND_DELAY=3000 后老测试全部失败。**原子改**——不留中间态。

### 4. 前端 Dashboard 跳转链接语义

```tsx
<a href={`/${server.id}/server-setup`}
   className={cn(buttonVariants({ variant: "secondary", size: "default" }))}>
  <ArrowRight size={14} />
  前往服务器设置
</a>
```

复用 buttonVariants 样式 + 保留 `<a>` 链接语义 + 不强行 `<Button render={<a/>}>`（base-ui 官方不推荐）。

## 文件改动清单

| 文件 | commit | 改动 |
|---|---|---|
| `shared/types/domain.ts` | 6c934fc | ServerConfig 加 `state?: ServerState` 字段 |
| `manager-server/src/modules/server/ServerManager.ts` | 6c934fc + bb88a7a | listServers 注入 state + START_COMMAND_DELAY 1s→3s + transition 幂等 + U3DS_READY_PATTERNS + pipePtyOutput 正则监听 |
| `manager-web/src/hooks/useServer.ts` | 6c934fc | ServerInfo.state 注释更新（双源：GET /servers + WS 推送） |
| `manager-web/src/pages/DashboardPage.tsx` | 6c934fc + 0f10eb4 | 删 start/stop/restart 三件套 + ConfirmDialog + useServerActions；改跳转链接复用 buttonVariants |
| `manager-server/tests/serverManager.test.ts` | bb88a7a | 5 处 1000→3000 + 注释对齐 + 3 新测试（正则立即 RUNNING / 多正则覆盖 / 幂等双触发不重复） |

## 测试覆盖现状

- 后端 **200/200** 单测（含 3 个新 PTY ready 测试，从 197 涨到 200）
- 前端 **33/33** 单测
- 前后端 typecheck 双 0
- **未跑 e2e**（未拉起真实 U3DS 实机；下一步 Sprint 5 实机验证）

## 用户核心反馈（**重要教训**）

1. **不要写完功能就过**——写完必查 shared 目录是否有可复用（这次因没查，DashboardPage 第一版写了原生 `<a>`）
2. **base-ui Button 不支持 asChild，要 render prop**——且 base-ui 官方明确不推荐 Button render 成 a，链接有独立语义
3. **GSM 范式要真读代码**——不要凭印象。GSM 实际是 3s 不是 1s、GSM 实际双策略并行不是二选一
4. **铁律 1「三行原则」**——同一 JSX 模式 ≥3 次才抽组件。1 处使用不抽 LinkButton，过早抽象变死代码
5. **变更触发连锁**——改 START_COMMAND_DELAY 1s→3s 必须同步改测试假设时间，否则原子改破坏测试

## 关联文件

- 主修复 commit：`bb88a7a`（PTY race + GSM 范式）
- 前置修复 commit：`6c934fc`（listServers state 注入 + Dashboard 去写操作）
- 样式修复 commit：`0f10eb4`（buttonVariants 复用）
- GSM 真源：`.research/GameServerManager/server/src/modules/game/GameManager.ts:355-365/553-563/795-802`、`.research/GameServerManager/server/src/modules/terminal/TerminalManager.ts:1116-1127`
- 规范文档：`unturned-sop.md:147`（`Server is ready` / `World saved` 早就写进 SOP，代码未落地——本次对齐）