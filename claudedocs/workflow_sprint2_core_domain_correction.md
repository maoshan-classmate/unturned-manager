# Sprint 2 核心域修正工作流——GSM3 + CLAUDE.md §4 交叉审计

> 产出：`/sc:workflow` 交叉审计（2 agent × GSM3 + 调研文档）  
> 日期：2026-08-07  
> 状态：📋 修正计划（待 `/sc:implement`）

---

## 审计结论

两个研究 agent 交叉验证 GSM3 源码 + CLAUDE.md §4 + claudedocs 调研文档，发现 **8 项偏差**（其中 3 项 P0 阻塞、4 项 P1、1 项文档冲突）。

### P0 — 阻塞核心功能

| # | 发现 | 当前代码 | 权威来源 | 证据 |
|---|---|---|---|---|
| **1** | `spawn` 用相对路径 `./ServerHelper.sh`，无 `cwd` | `ServerManager.ts:155` | CLAUDE.md §4.2: `/opt/unturned/ServerHelper.sh` | GSM3 InstanceManager 总是传 `cwd`；`installDir` 在 `loadServersFromDb` 中硬编码 `''` |
| **2** | A2S 轮询超时 60s 且不报错 | `ServerManager.ts:22,280` | CLAUDE.md §4.6: "超时 30 秒就报错" | `pollA2S` 超时只 log warn，照样 transition RUNNING |
| **3** | 跨协议凭证冲突——同一密码字段通吃 OpenMod `SteamID:Password` 和 RocketMod 裸密码 | `RconManager.ts:145` vs `RconManager.ts:120` | `reference_config_files.md:237` OpenMod 格式 vs `Rocket.config.xml` 裸密码 | GSM3 只做单一协议无此问题；这是我们双协议设计的产物 |

### P1 — 安全 + 状态完整性

| # | 发现 | 证据 |
|---|---|---|
| **4** | 危险指令门控空白——`DANGEROUS_COMMANDS` 定义了但 `isDangerous()` 从未被调用 | `RconManager.ts:67-70` 定义了但无调用点；`routes/rcon.ts:20` 只写了 TODO 注释 |
| **5** | Owner 专属指令未鉴权——`Cheats/Owner/Shutdown` 未校验 `ownerSteamId` | `reference_console_commands.md:503-509` 列了 3 条 Owner-only 指令 |
| **6** | DEGRADED 未接线——`RconManager.onStateChange` 从未被 `ServerManager` 订阅 | `ServerManager` constructor 无 `rconManager.onStateChange(...)` 调用 |
| **7** | `restart()` activeOperation 竞态窗口——`stop()` 和 `start()` 之间 `activeOperation` 重置为 `none` | `ServerManager.ts:220-224` stop 的 finally 清掉 activeOp，然后才调 start |

### 文档冲突

| # | 发现 | CLAUDE.md §4.6 | reference_console_commands.md |
|---|---|---|---|
| **8** | Shutdown 延迟 | `Shutdown 30 <重启原因>` | `Shutdown 10 面板触发重启` |

> **决议**：以 CLAUDE.md 为准（宪法级），改为 `Shutdown 30`。`reference_console_commands.md` 是参考文档，以 CLAUDE.md 为准。

---

## 修正任务清单

### Wave A: 进程 + 启动路径修复 (P0 #1, #2)

| Task | 文件 | 改动 | 参考 |
|---|---|---|---|
| A.1 | `ServerManager.ts` | `spawn` 传绝对路径 `installDir + '/ServerHelper.sh'` + `cwd: installDir` | GSM3 InstanceManager 总是传 `workingDirectory` |
| A.2 | `ServerManager.ts:loadServersFromDb` | 从 `servers` 表读 `installDir` 字段（需加列或从配置取） | GSM3 `instance.workingDirectory` |
| A.3 | `ServerManager.ts` | A2S 轮询超时 30s → `throw Error('A2S 超时')` | §4.6 直述 |
| A.4 | `ProcessSupervisor.ts` | `spawn` 方法加 `cwd` 参数 | GSM3 `spawn(cmd, args, { cwd })` |

### Wave B: RCON 凭证 + 安全修复 (P0 #3, P1 #4, #5)

| Task | 文件 | 改动 |
|---|---|---|
| B.1 | `shared/contracts/rcon.ts` | `RconServerConfig` 拆 `rconPassword` → `openModCredential` + `rocketModPassword` |
| B.2 | `RconManager.ts` | `connectSourceRcon` 用 `openModCredential`，`connectTelnetRcon` 用 `rocketModPassword` |
| B.3 | `routes/rcon.ts` | 实现 `isDangerous()` 门控：前端 ConfirmDialog 发送 `confirmed: true` 头 |
| B.4 | `RconManager.ts` | `execute()` 中校验 Owner-only 指令：`cmdName in OWNER_ONLY_COMMANDS` → 比对 `ownerSteamId` |

### Wave C: 状态机完整性 (P1 #6, #7)

| Task | 文件 | 改动 |
|---|---|---|
| C.1 | `ServerManager.ts` | constructor 中订阅 `rconManager.onStateChange` → 连续 DEGRADED 3 次 → transition DEGRADED |
| C.2 | `ServerManager.ts` | constructor 中订阅 `processSupervisor.onCrash` → transition STOPPED + audit log |
| C.3 | `ServerManager.ts:restart()` | 整个 restart 用一个 `activeOperation` 覆盖，不在 stop/start 之间释放 |

### Wave D: 文档冲突 (P2 #8)

| Task | 文件 | 改动 |
|---|---|---|
| D.1 | `ServerManager.ts:201` | `Shutdown 10` → `Shutdown 30`（对齐 CLAUDE.md §4.6） |

---

## 参考源地图（实现时逐条对照）

| 实现涉及 | 必须对照的参考 | 位置 |
|---|---|---|
| RCON 命令执行 | `reference_console_commands.md` | 64 条命令分类、dangerous/owner-only 标记 |
| RCON 协议细节 | `reference_config_files.md` §RCON | OpenMod yaml 字段、RocketMod XML 字段 |
| 启动命令 | CLAUDE.md §4.2 | 精确命令 `ServerHelper.sh +InternetServer/<ID> -ThreadedConsole` |
| 状态机 | CLAUDE.md §4.7 | 五态 + activeOperation 竞态防护 |
| 重启流水线 | CLAUDE.md §4.6 | Save → Shutdown → waitForExit → spawn → poll A2S |
| 进程模式 | GSM3 `TerminalManager.ts:278-298` | spawn 参数、cwd、env 过滤 |
| 文件备份 | CLAUDE.md §4.4 | `cp .bak.<ISO timestamp>` before write |
| Config 保留未知键 | GSM3 `GameConfigManager.ts:485-506` | merge-with-existing save strategy |

---

## 执行顺序

```
Wave A (进程路径) → Wave B (RCON 安全) → Wave C (状态机完整性) → Wave D (文档)
    独立                    依赖 B.1             依赖 A + B
```

**估时**：6-8 小时（4 个 wave，每个 1.5-2h）

---

*本文件是 Sprint 2 核心域唯一修正权威。实现时必须以本文件为蓝本，逐任务对照参考源。*
