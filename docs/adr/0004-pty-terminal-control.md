# ADR-0004: 实例控制改为持久 PTY 终端 + xterm.js

- **状态**：草案（待用户拍板）
- **日期**：2026-08-10
- **背景**：BUG 3/7「启动超时/失败」的根本性纠偏

---

## 1. 背景与动机

### 1.1 当前实现的根本错误（Linux 实机第五版 BUG 3/7 根因）

本项目 `ServerManager.start()` 当前形态：

```
spawn ServerHelper.sh
  ↓
轮询 A2S_INFO 直到就绪（30s 超时）
  ↓
HTTP 返回 { state: RUNNING }
  ↓
（用户跳转到控制台看 stdout 日志）
```

**这是错的**——`CLAUDE.md §4` 当时拍 30s 轮询是「MVP 起步值」，但设计上**面板不该等「能玩」才返回**。U3DS 启动链路天然要 30-120s（mod + 场景加载），HTTP 同步等 = 必然超时；而且「A2S 通就告诉用户能玩」是**面板多管闲事**——面板只管 PTY 在不在跑，真在跑什么由终端输出告诉用户。

### 1.2 用户的设计意图（2026-08-10 反馈原文）

> 在用户创建实例之后，就应该跳转到控制台，里面有终端信息了。然后你启动还是暂停，都应该只是发送终端指令。具体真的有没有启动，终端会显示吧。

**用户要求 = GSM3 同款抽象**：

```
spawn 持久 PTY（永驻 shell）       ← 进程一直在跑
  ↓
HTTP 立即返回 { terminalSessionId } ← 不等任何东西
  ↓
1s 后往 PTY 塞启动命令             ← "./ServerHelper.sh +InternetServer/<id> -ThreadedConsole\r"
  ↓
用户跳转控制台看 xterm.js 实时输出  ← U3DS 日志、玩家名、报错全部显示在终端
```

### 1.3 GSM3 证据（铁证）

**后端（`.research/GameServerManager/server/src/modules/instance/InstanceManager.ts:1004-1040`）**：

```ts
this.emit('instance-status-changed', { id, status: 'running' });
// ...
return { success: true, terminalSessionId };   // HTTP 立刻返回

// 1s 后往终端塞启动命令
startCommandTimer = setTimeout(() => {
  this.terminalManager.handleInput(virtualSocket, {
    sessionId: terminalSessionId,
    data: startCommand + '\r'
  });
}, 1000);
```

**暂停 = 往 PTY 发 ctrl+c**（同文件 `:1186-`）：

```ts
const stopInput = instance.stopCommand === 'ctrl+c'
```

**前端 xterm.js**（`.research/GameServerManager/client/src/pages/TerminalPage.tsx:270-280`）：

```ts
terminal.onData((data) => {
  socketClient.sendTerminalInput(sessionId, data);  // 终端里任何按键都发给后端
});
```

---

## 2. 决策

### 2.1 实例进程模型：持久 PTY 终端

**当前**：`spawn ServerHelper.sh`（直接 fork 子进程，stdout pipe 进 LogStreamer）

**改为**：每个实例启动时 spawn 一个**永驻 PTY 进程**（bash 或专用 wrapper 脚本），PTY 的 stdin 接收「启动命令」「ctrl+c」「say」等任意字符串输入，stdout/stderr 持续广播到前端 xterm.js。

### 2.2 spawn 目标从「U3DS 启动脚本」改为「wrapper bash」

**当前 spawn 命令**（`ServerManager.ts:478-484`）：

```ts
const args = [`+InternetServer/${id}`, "-ThreadedConsole"];
return this.processSupervisor.spawn(id, `${installDir}/${script}`, args, installDir);
```

**改为**（伪代码——PTY 库选型见 §3.1）：

```ts
// 每个实例一个永驻 bash，cwd = installDir
const pty = await ptyProcess.spawn("/bin/bash", [], {
  cwd: installDir,
  env: { ...process.env, TERM: "xterm-256color" },
});

// 1 秒后自动塞 startCommand（用户可在控制卡片编辑）
setTimeout(() => pty.write(`${startCommand}\r`), 1000);
```

启动命令模板（**用户可编辑**，GSM3 形态——见 §6.1 决策）：

```bash
./ServerHelper.sh +InternetServer/<id> -ThreadedConsole    # 多实例主推
./ExampleServer.sh                                         # 单服模式回落
```

> ⚠️ **Phase 1 落地需同步修 `unturned-sop.md` 与 `startScript.ts`**：`detectStartScript` 当前优先级是 `start.sh > run.sh`，但 U3DS 实际启动脚本是 `ServerHelper.sh` → `ExampleServer.sh`（与 `CLAUDE.md §2` 多实例主推一致）。修正 `detectStartScript` 优先级顺序为 `ServerHelper.sh > ExampleServer.sh`。

### 2.3 HTTP 行为：立即返回

| 当前 | 改为 |
|---|---|
| `POST /:id/start` 同步等 A2S 30s | `POST /:id/start` 立即 202 `{ terminalSessionId }` |
| `POST /:id/stop` 等进程退出 | `POST /:id/stop` 立即 202，PTY 写 `ctrl+c` |
| `POST /:id/restart` 同上 | 立即 202，PTY 写启动命令 |
| `GET /:id/status` 同步查 A2S | **删除**——状态直接读 PTY 进程在不在（见 §2.6 + Phase 5） |

**说明**：状态由 PTY 进程在/不在驱动，**不再有任何 A2S 查询路径**。与 §2.6「删除 A2SClient」一致——如果你读到这里看到「保留 A2S」，那是历史版本，**以 §2.6 为准**。

### 2.4 WS 推送：console_line（已有）+ 新增 terminal_input（双向）

**已有**：`LogStreamer` 广播 `console_line` 给前端（`type: 'console_line'`，含 serverId/line/source）

**新增**：

```
ws.send({type:'terminal_input', serverId, data})  // 前端 → 后端（写入 PTY stdin）
```

WS gateway 新增事件类型，处理函数把 data 写入对应 serverId 的 PTY stdin。

### 2.5 前端：xterm.js 集成

控制台页（`ConsolePage`）当前用 `<pre>` + LogStreamer 的 plain 文本。新增 `@xterm/xterm` + `@xterm/addon-fit`：

```tsx
<Terminal
  ref={termRef}
  onData={(data) => ws.send({type:'terminal_input', serverId, data})}
/>
```

xterm.js 自带 ANSI 着色、history 翻屏、resize、Ctrl+C 信号——U3DS 的彩色日志就**天然好看**，比 plain `<pre>` 强一截。

### 2.6 移除 A2SClient

「服务端能不能玩」不该由面板检测（违背用户设计意图）。整个 A2S 通道删除：

| 删除项 | 影响范围 |
|---|---|
| `A2SClient.ts` 整个文件 | 单文件 |
| `@fabricio-191/valve-server-query` 依赖 | package.json |
| `IA2SClient` 契约 + 所有引用 | shared/contracts/a2s.ts + composition-root + 任何 mock 测试 |
| `ServerManager.start/startInternal` pollA2S 私有方法 | 2 处方法体 |
| `A2S_POLL_TIMEOUT / A2S_POLL_INTERVAL` 常量 | 移除 |

**状态展示改读 PTY 进程**——PTY 进程在 = 「运行中」，PTY 进程退出 = 「已停止」，用户看终端输出判断场景是否加载完。

---

## 3. 工程细节

### 3.1 PTY 库选型

Node.js 上常见方案：

| 库 | 说明 |
|---|---|
| **`node-pty`** | 业界事实标准；GSM3 也用它；跨平台（win32/winpty、linux/macOS/macOS-conpty） |
| `@lydell/node-pty` | node-pty 预编译 fork，体积更小但少维护 |
| `ws/xterm/pty.js` | 老旧，不维护 |

**决策**：**`node-pty`**——与 GSM3 同款，本项目架构规约「技术栈对齐 GSM3」白名单覆盖。代价：原生模块，需要 C 编译器（Dockerfile 已有 `node:20` builder + python3/make/g++，无需新增）。

### 3.2 WS 心跳改造（已落实的部分）

`gateway.ts` 已有 ping/pong 30s 心跳（commit `f311e14`）。**terminal_input 是新事件类型**，走同一条 WS 心跳保护——只要 WS 不丢事件，前端敲什么后端就收到什么。

### 3.3 状态机

PTY 进程 = 实例进程。状态完全由 PTY 进程的 spawn/exit 驱动，**不再有 A2S 维度**。

```
STOPPED ──spawn /bin/bash──> STARTING(PTY 刚创)──1s 塞 startCommand──> RUNNING
       ↑                                                                   │
       │                                                                   │ ctrl+c
       │                                                                   ↓
       └──────── stop (PTY 写 ctrl+c / 等进程退出) ────────────────── STOPPING
                                                                          │
                                                              bash 退出
                                                                          ↓
                                                                       STOPPED
```

RUNNING 的「业务含义」：PTY 进程在跑。**「玩家能不能连」由终端输出告诉用户**，不是状态字段。

**Mod 应用判定**（用户决策 2026-08-10）：当 PTY 输出含「Server is ready」/「World saved」类 ready 信号 + `Servers/<id>/Workshop/steamapps/workshop/content/1110390/` 目录落盘 + acf 更新 = 应用成功。无 A2S 轮询。

> ⚠️ **Phase 1 落地需同步修 `unturned-sop.md` §「重启/改 Mod 流水线」**：将「轮询 A2S_INFO 直到就绪」改为「PTY 输出 ready 信号 + content 目录落盘 + acf 更新」。

### 3.4 RCON 通道：降级为可选 + PTY 安全门控 owner-trust-only

**用户决策**：命令全部走 PTY 终端，RCON 不再是主路径。PTY 接受任何命令——**owner-trust-only**（GSM3 同款）。

实施策略：
- `Ban <id>` / `Save` / `Shutdown` / `Say <msg>` / `Players` —— **PTY 拼字符串直接发**，无角色检查
- RCON 通道（`rcon-srcds` + RocketMod Telnet）**保留但降级为 fallback**——只有 PTY 不可用（如用户关闭控制台后还想远程 Save）才走
- **Phase 6 评估**：如果 RCON 实际无使用场景，彻底删除（与 ADR §6.4 一致）

**安全门控语义变更**（关键）：
- 旧：`rcon-protocol.md` 假设「`Ban/Owner` 等危险指令的安全门仅通过 RCON 校验」——ADR-0004 落地后这不再是事实
- 新：PTY 终端只受 **WS 自身的 JWT 认证** 保护（`gateway.ts` `verifyClient` 已经校验 access token）。登录 = JWT 有效 = 可在终端执行任何命令
- 单用户系统（`CLAUDE.md §2` JWT 单用户）+ 终端是 owner 自己用 = owner-trust 模型成立
- 同步要求：`rcon-protocol.md` 加 addendum 明确「PTY 路径不走 428 二次确认 / 角色门控——前端需自行拦截危险指令（Phase 4 后实现）」；保留 RCON 安全门作为结构化 API 的接口门控（`POST /rcon/execute`）

> ⚠️ **Phase 1 落地需同步改 `rcon-protocol.md`**——明确区分「结构化 RCON 接口的安全门」与「PTY 终端的 owner-trust 模型」，避免后续误以为 RCON 通道独享安全。

### 3.5 旧 `startScript.ts` 的去留

- `detectStartScript()`：**保留 + 修正优先级**——U3DS 实际启动脚本是 `ServerHelper.sh` → `ExampleServer.sh`（不是当前 `start.sh > run.sh`），修正优先级顺序，与 `unturned-sop.md §「安装+启动」` 对齐
- `ensureStartScriptExecutable()`：**保留**——PTY 启动命令前先 chmod +x
- `spawnU3DS()`：**删除**——PTY 模式下不需要直接 spawn U3DS

---

## 4. 实施分期（用户拍板：功能粒度拆分，可能不止 6 期）

每期独立可回滚，前端未动期间后端可独立验证。

### Phase 0：所有 SteamCMD 长任务统一异步化（先做，PTY 之外的最后一波同步债）

**目的**：让 `installU3DS` / `updateU3DS` / `reinstall` / `checkUpdate` / `downloadWorkshopItem` 全部异步（HTTP 立即返回 jobId，进度/完成/失败走 WS `steamcmd_progress`）。这是「HTTP 立即返回」抽象的最后一波落地——之前只有 `installU3DS`（commit f311e14）和 `downloadWorkshopItem`（commit f311e14）异步化了，`updateU3DS` / `reinstall` / `checkUpdate` 还停留在「同步等完成」状态。

**改动清单**：

- `SteamCmdManager.updateU3DS(installDir): Promise<string>`（返回 jobId）
  - 当前形态：同步等 SteamCMD 退出（30min+）
  - 改为：spawn 后立即 return jobId；后台 `waitForExit` → 广播 completed/failed；catch 错误 → 广播 failed（与 `installU3DS` 同形态，commit f311e14 已建立样板）
- `SteamCmdManager.reinstall(installDir?): Promise<string>`（返回 jobId）
  - 当前形态：同步下载 + 解压 + `+quit` 初始化（2-3min）
  - 改为：spawn 后立即 return jobId；后台 `waitForExit` → 广播 completed/failed
- `SteamCmdManager.checkUpdate(installDir?): Promise<string>`（返回 jobId）
  - 当前形态：3 套 runscript fallback 跑 steamcmd（30s+）
  - 改为：spawn 后立即 return jobId；后台 `waitForExit` → 拿到 buildid 后**通过 WS 广播一次「最新版本号」**（前端 toast 显示）；失败广播 failed
- `routes/steamcmd.ts` 三处路由：同步 200 → **202** `{ data: { jobId } }`
- 前端调用方（`SteamCmdCard`、`U3dsCard`）：调 update/reinstall/check-update 改订阅 `steamcmd_progress` 拿结果，**不再读 HTTP body**

**前端 UX（用户原话：下载完再弹个窗）**：

```
用户点「更新 U3DS」
  ↓
HTTP 202 立即返回 { jobId }
  ↓
toast「U3DS 更新已提交」  ← 不是「完成」
  ↓
WS steamcmd_progress 实时推进度条
  ↓
完成 → toast「U3DS 更新完成」弹窗  ← 下载完再弹
失败 → toast「U3DS 更新失败」+ 错误原因
```

**验证**：手动更新 / 重装 / 检查更新，**axios 不再 timeout**（30min 也不超时）；WS 推进度事件完整；前端 toast 按时机弹。

### Phase 1：PTY 抽象 + 删除 A2S 通道

- `PtyManager` 模块：spawn/write/resize/kill，封装 node-pty
- `ProcessSupervisor` 拆：PTY 进程走 PtyManager；非 PTY（steamcmd 等）保留
- **删除 `A2SClient.ts`** + `IA2SClient` 契约 + `@fabricio-191/valve-server-query` 依赖 + 相关 mock 测试
- **删除 `ServerManager.pollA2S`** 私有方法 + `A2S_POLL_TIMEOUT / A2S_POLL_INTERVAL` 常量
- 单测：mock node-pty 验证 PtyManager；更新依赖该模块的所有测试 mock
- 验证：typecheck + 既有测试不挂

### Phase 2：ServerManager.start 改 PTY

- `start()` 改：spawn `/bin/bash`（cwd = installDir）→ 立即返回 `{ terminalSessionId, pid }` → 1s 后写 startCommand
- `stop()` 改：PTY 写 `ctrl+c`，等进程退出（30s 超时 → forceKill）
- `restart()` 改：stop + start
- 实例元数据新增 `terminalSessionId` + `startCommand` 字段
- 删除 `spawnU3DS()` 私有方法
- 验证：手动开 PTY + 写命令 → 看到 U3DS 启动日志

### Phase 3：前端 xterm.js 集成 + WS terminal_input

- `ConsolePage` 替换 `<pre>` 为 `<Terminal />`
- WS 新增 `terminal_input` 事件类型（前端 → 后端）
- gateway 处理 `terminal_input`：写入对应 serverId 的 PTY stdin
- WS broadcast `console_line` 已有，PTY 输出走这条
- xterm.js 自带 ANSI 着色，U3DS 彩色日志天然好看
- 验证：终端里敲任意命令（`Say hello`、`Players`、`Shutdown 30`）能看到输出

### Phase 4：实例元数据 startCommand 可编辑

- 控制卡片 UI：startCommand 可编辑输入框 + 保存按钮（持久化到 SQLite）
- 后端：`PATCH /api/servers/:id` 支持 startCommand 更新
- 兜底：用户没填 startCommand 时，detectStartScript 自动生成 `./ServerHelper.sh +InternetServer/<id> -ThreadedConsole`
- 验证：保存自定义命令 → restart → PTY 1s 后塞的是新命令

### Phase 5：状态展示适配（PTY 替代 A2S）

- Dashboard 状态卡片：「运行中/已停止」读 PTY 进程在不在（isRunning）
- 实例列表：状态指示灯基于 PTY 进程状态
- 玩家数 / 当前地图等运行时信息：可选——前端主动查？或干脆不展示（看终端）
- 验证：点启动按钮 → 卡片立刻显示「运行中」；点停止 → 等进程退出显示「已停止」

### Phase 6：RCON 通道降级或删除

- 评估 RCON 是否仍必要
- 候选 1：保留为 fallback（PTY 不可用时用）
- 候选 2：彻底删除（与 GSM3 完全一致）
- 决策依据：Phase 3 实测后，看前端有没有「PTY 关闭后还想 Save」的用例
- 验证：明确保留或删除的边界

### 未来 Phase（待评估）

- **Phase 7+**：PTY 输出录制回放（GSM3 有历史会话保存 `TerminalPage.tsx:887` 路径）
- **实例模板**：startCommand 模板复用（GSM3 也支持保存会话模板）
- **多 tab 终端**：同一实例开多个终端（GSM3 支持）
- 这些看 Phase 1-6 实测后用户反馈再排

> 注：原「§5 风险表 axios timeout 仍有其他长任务」一行已删除——Phase 0 把 update/reinstall/check-update 也异步化后，**所有 SteamCMD 长任务都已 202 立即返回**，HTTP 路径上无 >10s 等待，axios timeout 风险归零。

---

## 5. 风险与回退

| 风险 | 缓解 |
|---|---|
| node-pty 编译失败 / 镜像构建慢 | 已有 `node:20` builder 含 make/g++；阿里云镜像源已配置（commit `391750e`）；参考 GSM3 Dockerfile 同款依赖 |
| PTY 永久进程容器重建后丢失会话 | PTY 进程绑 session 生命周期；容器重建 = 用户重连 PTY（行为合理） |
| 状态信息丢失（无 A2S 后玩家数 / 地图无面板展示） | 用户决策：「如果只是用于卡片展示，那就可以不需要」（§6.5）；想看玩家数进终端敲 `Players`，地图进终端敲 `Map` |
| node-pty runtime 缺 PTY 设备权限 | node-pty Linux 上需要 `/dev/ptmx` + `/dev/pts`；Docker 默认 runtime 有这些设备权限，但需在 Phase 1 DoD 显式验证（`docker exec unturned-manager ls -la /dev/ptmx` + spawn bash 测试）。如缺权限需 `--privileged` 或 `--device /dev/ptmx` |

---

## 6. 决策记录（2026-08-10 用户拍板）

### 6.1 启动命令模板

**用户原话**：「在服务器设置 → 服务器控制卡片里不是可以编辑启动命令吗」

✅ **保留用户在控制卡片可编辑 startCommand**——GSM3 形态，**与 ADR-0003 B2 的「硬编码」判断反转**。

代码层面：实例元数据新增 `startCommand: string`（用户可编辑），PTY 1s 后塞 `startCommand + '\r'`。后端**只做模板兜底**（如果用户没填，根据 `detectStartScript()` 自动生成 `./ServerHelper.sh +InternetServer/<id> -ThreadedConsole`）。

GSM3 实例配置里就有 `startCommand: string`（`InstanceManager.ts:26`），完全沿用。

### 6.2 wrapper shell

✅ **`/bin/bash`**（GSM3 同款），不重新决策。

### 6.3 PTY 进程生命周期

✅ **1 实例 1 PTY 永驻**（GSM3 同款），不重新决策。容器重建 = 用户重连 PTY，行为合理。

### 6.4 RCON vs PTY 分工

**用户原话**：「为什么不能都走终端 我在我们的项目中目前没发现有什么区别」

✅ **全部走 PTY 终端**——你的判断对。GSM3 也这么做（本项目之前分 RCON 是过度设计）。

**反思**：
- 「Ban <steamId>」这种结构化命令**直接 PTY 拼字符串就能执行**——GSM3 证明可行
- RCON 当前实现 = OpenMod Valve Source RCON → RocketMod Telnet 回落，是另一套**结构化协议**。**保留价值在哪？** 没有。砍掉更简单。
- 「避免用户在终端里敲错」是**过保护**——GSM3 不这么做，本项目也不该这么做。

**实施变化**：把 RCON 通道**降级为可选 fallback**——PTY 终端里 `Say`、`Save`、`Shutdown`、`Players`、`Ban` 等命令直接拼字符串发给 PTY（用户敲也行，自动操作也行）；只有**当 PTY 暂时不可用**（如控制台关闭后还想操作）才走 RCON。

**RCON 去留的最终决策放 Phase 6**——Phase 1-5 不动 RCON，先把所有 PTY 改造做实；Phase 6 评估是否还需要 RCON fallback。

### 6.5 A2S 状态查询

**用户原话**：「如果只是用于卡片展示，那就可以不需要。看看删除影响范围大吗」

✅ **删除 A2SClient**——你的判断对，「状态展示」不该由面板去做。

**影响范围评估**（删除前需确认）：

| 影响点 | 是否真需要 A2S | 处理 |
|---|---|---|
| `ServerManager.start()` pollA2S | 不需要（**已计划删除**） | 删除 |
| `ServerManager.startInternal()` pollA2S | 不需要（**已计划删除**） | 删除 |
| Dashboard 状态卡片 | 「运行中/已停止」可由 PTY 进程在不存在替 | 不需要 |
| `pollA2S` 30s 超时 | 跟随 start 删除 | 删除 |
| A2SClient.ts 整个文件 | — | 删除 |
| `@fabricio-191/valve-server-query` 依赖 | — | 从 package.json 删除 |
| `IA2SClient` 契约 + 任何引用 | — | 删 |

**Phase 1 DoD grep 验证清单**（必跑，确认无遗漏引用）：

```bash
# 1. 全文搜 IA2SClient 引用
grep -r "IA2SClient" --include="*.ts" manager-server/ shared/ manager-web/

# 2. 搜 A2SClient 实例
grep -r "new A2SClient" --include="*.ts" manager-server/

# 3. 搜依赖与 import
grep -r "@fabricio-191/valve-server-query" --include="*.ts" manager-server/

# 4. 搜 ServerManager.pollA2S / A2S_POLL_
grep -rn "pollA2S\|A2S_POLL" --include="*.ts" manager-server/

# 5. 搜测试 mock
grep -r "query\|A2S" manager-server/tests/

# 全部应仅返回 ADR-0004 之外 0 业务命中
```

**结论**：A2S 移除**影响范围小且集中**——只 `ServerManager.start/startInternal`、`A2SClient.ts`、依赖、契约 4 处。删掉 ADR 简化一半。

### 6.6 WS 事件命名

✅ **采纳本项目命名风格 `terminal_input`**（与 `steamcmd_progress` / `console_line` 一致，下划线分隔）——不抄 GSM3 的 `terminal-input`。

### 6.7 实施分期

**用户原话**：「每个功能点分一期 可能不止 4 期」

✅ **功能粒度拆分**——以下调整为 6 期（每期独立可回滚）：

```
Phase 1: 进程模型重构（PTY 抽象 + 删除 A2SClient + ProcessSupervisor 拆分）
Phase 2: ServerManager.start 改 PTY（HTTP 立即返回 + 1s 塞启动命令 + 删除 pollA2S）
Phase 3: 前端控制台 xterm.js 集成 + WS terminal_input 双向事件
Phase 4: 实例元数据 startCommand 可编辑（控制卡片 UI）
Phase 5: 状态展示适配（Dashboard / 实例列表读 PTY 进程状态，不再读 A2S）
Phase 6: RCON 通道降级或删除（评估 RCON 是否仍必要）
```

**注意**：Phase 5 在删除 A2SClient 后做，否则 Dashboard 卡片无数据源。

### 6.8 xterm.js 包大小

✅ **接受 ~150KB gzip**——不重新决策。

---

## 7. 替代方案（考虑过但否决）

| 方案 | 否决理由 |
|---|---|
| **保留 spawn ServerHelper.sh + 异步返回** | 失去「在终端里看到 U3DS 日志并交互发命令」的能力；启动/暂停仍要绕道 shell；违背你设计意图 |
| **保留 A2S 轮询 + 拉长超时到 5min**（仅作对比，本 ADR 已否决此方案） | 不解决 UX 本质——用户等 5 分钟看一个「启动成功」仍然是糟糕的；GSM3 也证明不需要 |
| **用 docker exec 进 U3DS 容器内 bash** | 当前是单容器；docker exec 跨实例不可扩展；增加 Docker 客户端依赖 |
| **用 WebSocket 替代 PTY** | WS 走 stdout pipe 已经是「伪终端」；node-pty 是工业事实标准，重写没有收益 |

---

## 8. 关联决策

- **依赖**：ADR-0003 B2 目录扫描数据源（实例身份 = `<installDir>/Servers/<id>/Server/Commands.dat`）
- **替代**：§7 否决的所有方案
- **后续**：Phase 1-4 实施完成需补一份 `claudedocs/reference_pty_terminal.md` 活参考文档