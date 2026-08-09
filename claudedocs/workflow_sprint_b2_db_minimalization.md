# Workflow Sprint: B2 数据库最小化 + 实例目录扫描 + GSM 现状对齐

> **日期**：2026-08-09 · **驱动**：ADR-0003（`docs/adr/0003-b2-directory-scan-datasource.md`）
> **设计规格**：`docs/architecture/b2-directory-scan-refactor.md`
> **策略**：systematic · 7 个 task，按依赖图排序（不是按代码层）
> **质量门**：每个 task 独立 commit + 自测全绿后方可解锁下一个

---

## 1. 依赖图（任务拓扑）

```
T1 DB 迁移 005（删三表）
   ├─→ T2 PathResolver + 8 处替换
   ├─→ T3 乐观锁 mtime 化
   ├─→ T4 审计退役
   └─→ T5 RCON 凭证 + ServerManager 重写
         ├─→ T6 进程生命周期 GSM 对齐
         └─→ T7 契约 + 前端 + 测试 + 文档
```

**关键依赖**：

- **T1 是所有后端改动的前置**——迁移 005 会 DROP 3 表，**任何代码还在引用这些表，迁移即失败**。所以 T1 排在最前，但 T1 之前要先确保所有「使用方」（T2/T3/T4/T5）已迁完——所以 T1 又是「最后运行」的迁移步骤。
- **T2/T3/T4/T5 互不依赖**，可以并行实施，但提交时按 T1→T2→T3→T4→T5 顺序，**T1 迁移放最后 diff**。
- **T6 依赖 T5**——因为 T5 重写 ServerManager（spawn 依赖 RCON 凭证 K-V），T6 改 ProcessSupervisor 时机。
- **T7 依赖 T6**——前端/契约/测试。

---

## 2. Task 详表

### T1 — 数据库迁移 005（删三表）

**目标**：DROP `servers` / `config_snapshots` / `audit_logs` 三表 + 同步 `migrations/004` 注释。

**为什么是「先于代码删表」再「后于代码删表」**：SQLite 迁移是不可逆的「DROP」语义，T1**实际跑**在所有引用代码删除后；但 T1 的**文件 `005-*.sql`** 必须在 T7 之前写完，否则 `migrate.ts` 不知道有这张迁移。

**范围**：

| 文件 | 改动 |
|---|---|
| `db/migrations/005-*.sql`（新建） | DROP 三表（含「无数据搬运」说明）；同步 `004` 注释「保留 6 表」→「保留 3 表」 |
| `db/migrate.ts` | 无需改动（自动扫 migrations/） |

**验收**：

- 迁移文件落盘
- `tests/e2e/test-server.ts:13-17` 夹具同步：现有只建 3 张（users/refresh_tokens/servers），改后建「**保留 3 张**」（users/refresh_tokens/settings）
- 手动本地运行一次迁移：旧 DB 文件删掉，重建后只有 3 表

**风险**：T1 迁移不会在该 Sprint 跑（代码引用未清完），但要确保**最终提交时** `migrate.ts` 能跑通。

**门槛**：

- ✅ 迁移文件落盘
- ✅ 006+ 关键测试夹具同步
- ✅ 通过 `tsc --noEmit`

**估算**：30 分钟（小文件）

---

### T2 — PathResolver 纯函数 + 8 处路径替换

**目标**：新增 `modules/server/pathResolver.ts` 纯函数；8 处 `SELECT install_dir FROM servers` 全部替换。

**为什么独立成 task**：8 处机械替换是这次工作量最大的部分，**单一责任人**+独立 commit，**review 成本最低**。

**范围**：

| 文件 | 改动 |
|---|---|
| `modules/server/pathResolver.ts`（**新建**） | `resolveServerPath(serverId, relative): string` 纯函数；`resolveInstallDir(): string` 读 config 全局 |
| `modules/config/ConfigService.ts:49` | `resolvePath` 改调 PathResolver |
| `modules/files/FilesService.ts:50` | `resolveInstallDir` 改 PathResolver |
| `modules/logs/LogStreamer.ts:172` | `resolveLogsDir` 改 PathResolver |
| `modules/workshop/WorkshopAcfService.ts:189,202` | `resolveAcfPath` / `resolveStagingAcfPath` 改 PathResolver |
| `modules/workshop/WorkshopApplyService.ts:214` | `resolvePaths` 改 PathResolver |
| `modules/workshop/WorkshopDeleteService.ts:116` | `resolveContentDir` 改 PathResolver |
| `routes/files.ts:27` | `resolveValidatedPath` 改 PathResolver（同时消除 `getDb()` 直读违规） |
| `modules/steamcmd/SteamCmdManager.ts:77` | `WHERE state!='STOPPED'` 改「活跃实例」探活判断（**T5 同步**，这里 T2 先不删，等 T5 改 state 后删） |

**验收**：

- `PathResolver` 单测：路径拼接正确（`os.tmpdir` 风格 fixture）
- 后端 `tsc --noEmit` 零错
- `grep -n 'SELECT install_dir FROM servers' manager-server/src` 命中数 ≤ 1（仅 SteamCmdManager 残余）

**风险**：

- 路径分隔符：`path.join` 跨平台，但需注意 `installDir` 是否带尾 `/`
- `installDir` 全局化后默认值问题：测试环境 `os.tmpdir() + '/test-install'`，生产环境 `/opt/unturned`

**门槛**：

- ✅ PathResolver 单测覆盖（含 `installDir` 带尾斜杠边界）
- ✅ 8 处全部替换（grep 断言）
- ✅ `tsc --noEmit` 绿
- ✅ 后端单测全绿

**估算**：2-3 小时（机械替换 + 单测）

---

### T3 — 乐观锁 mtime 化

**目标**：`atomicWrite` 改 `fs.stat(absPath).mtimeMs` 比对；删 `config_snapshots` 读写；契约字段 `expectedVersion` → `expectedMtime`。

**范围**：

| 文件 | 改动 |
|---|---|
| `modules/config/ConfigService.ts:60-101` | `atomicWrite` mtime 化；删 `config_snapshots` 读写（`:71, :94`） |
| `routes/config.ts:25-37, :48-56, :67-75` | 三个 PUT 端点 `body.expectedVersion` → `body.expectedMtime` |
| `shared/schemas/config.schema.ts:58, :67, :72` | `expectedVersion` 字段 → `expectedMtime` |
| `shared/contracts/config.ts` | `IConfigService` 接口 mtime 化（如有相应字段） |
| `tests/configService.test.ts` | mtime 冲突场景测试 |

**验收**：

- 单测：mtime 匹配 → 写入成功；mtime 不匹配 → `VERSION_CONFLICT`
- `tsc --noEmit` 绿
- 后端单测全绿
- grep `config_snapshots` 命中数 = 0

**风险**：

- `expectedMtime` 是数字还是字符串？JSON 序列化统一为毫秒整数
- 文件创建瞬间 mtime 一致性：`fs.writeFile` 后立即 `fs.stat` 拿到新 mtime

**门槛**：

- ✅ mtime 冲突单测
- ✅ `config_snapshots` 引用清零
- ✅ `tsc --noEmit` 绿
- ✅ 后端单测全绿

**估算**：1.5-2 小时

---

### T4 — 审计退役 + pino 承接

**目标**：删 `audit_logs` 表读写；事件走 pino 日志。

**范围**：

| 文件 | 改动 |
|---|---|
| `routes/audit-logs.ts` | **整文件删除** |
| `modules/server/ServerManager.ts:518-528` | `auditLog` 方法删除；caller（`:64, :147, :166, :209, :522` 等）调用全删 |
| `routes/rcon.ts:70` | audit_logs INSERT 删除 |
| 搜索全部 `INSERT INTO audit_logs` | 全部清理 |
| 搜索全部 `audit_logs` | 全部清理（除 T1 迁移文件） |
| `tests/api.smoke.test.ts` | 涉及 audit_logs 断言全删 |

**验收**：

- `grep -rn 'audit_logs' manager-server/src` 命中数 = 0（除 T1 迁移）
- `tsc --noEmit` 绿
- 后端单测全绿

**风险**：

- 路径依赖：删 `auditLog` 后所有 caller 必须同步改
- 编译通过不代表逻辑正确：caller 删调用后是否影响状态机？答：audit 是旁路，不影响主流程

**门槛**：

- ✅ `audit_logs` 引用清零
- ✅ `tsc --noEmit` 绿
- ✅ 后端单测全绿
- ✅ 前端 e2e 不变（8 个用例已有不依赖审计）

**估算**：1 小时

---

### T5 — RCON 凭证持久化 + ServerManager 重写

**目标**：最复杂的中心节点。settings K-V 扩展承载 RCON 凭证；ServerManager 目录扫描化；state 去持久化；新增 removeServer；删 auditLog（已被 T4 删）。

**范围**：

| 文件 | 改动 |
|---|---|
| `modules/settings/settingsStorage.ts` | 增 `setRconCredential(serverId, protocol, value)` / `getRconCredential` / `deleteRconCredential`（key 前缀 `rcon:<serverId>:<protocol>`） |
| `modules/server/ServerManager.ts:70-94` | `loadServersFromDb` → `loadServersFromDir` 目录扫描 + 读 Commands.dat + 凭证 K-V 恢复 |
| `modules/server/ServerManager.ts:123` | `createServer` 写目录 + 写 K-V（不再 INSERT servers） |
| `modules/server/ServerManager.ts:151` | `configureServer` 改目录 + 改 K-V（修复缺口 2） |
| `modules/server/ServerManager.ts:484` | state 持久化删除（运行时状态驻内存） |
| `modules/server/ServerManager.ts:518` | `auditLog` 已被 T4 删，仅作为 sanity check |
| `shared/contracts/server.ts:5-21` | `IServerManager` 新增 `removeServer(serverId): Promise<void>` |
| `shared/schemas/server.schema.ts` | `ServerConfig` 补 `openModCredential` |
| `shared/types/domain.ts:10` | 同步补 `openModCredential` |
| `modules/rcon/RconManager.ts` | 凭证从 K-V 恢复 register；`unregister` 接线 |
| `routes/servers.ts` | 新增 `DELETE /:id`；所有 caller 改 `removeServer` |
| `tests/serverManager.test.ts` | 全部重写（不再 DB fixture） |
| `tests/routes.mods.test.ts` | 改用 PathResolver + K-V fixture |
| `tests/utilities.test.ts` | 同上 |
| `tests/api.smoke.test.ts` | 同步改用 K-V fixture |

**验收**：

- `IServerManager.removeServer` 实现 + `DELETE /:id` 端点工作
- `createServer` 写目录 + K-V 双写一致性
- `configureServer` 改 RCON 凭证**立即生效**（修复缺口 2 验证）
- 面板重启后 RCON 凭证恢复（修复缺口 1 验证）
- 后端 `tsc --noEmit` 绿
- 后端单测全绿

**风险**：

- **T5 是整个 Sprint 最复杂节点**——目录扫描 + 凭证 K-V + 反循环依赖
- 凭证写入失败但目录创建成功的不一致处理：先 K-V 再目录，目录失败时回滚 K-V
- `installDir` 全局化：当前 8 处查询就是为了取它，T5 后所有模块依赖 PathResolver 全局

**门槛**：

- ✅ 4 个既有缺口修复验证（台账式）
- ✅ `IServerManager` 全方法实现
- ✅ `removeServer` e2e 流程通
- ✅ `tsc --noEmit` 绿
- ✅ 后端单测全绿（包含原有 serverManager 测试重写）
- ✅ 路径解析不掉（覆盖 T2 单测）

**估算**：4-6 小时（最复杂 task）

---

### T6 — 进程生命周期对齐 GSM 现状

**目标**：ProcessSupervisor 改 GSM 三段关停 + 进程组杀；5s 硬重启；启动脚本探测抄 GSM。

**范围**：

| 文件 | 改动 |
|---|---|
| `modules/process/ProcessSupervisor.ts` | **SIGINT 2s → SIGTERM 2s → SIGKILL 1s → Win taskkill 1s**（抄 `TerminalManager.ts:2082-2137`） |
| `modules/process/ProcessSupervisor.ts` | `spawn` 改 `detached: platform !== 'win32'`（抄 `TerminalManager.ts:728`） |
| `modules/process/ProcessSupervisor.ts` | `kill` 改 `-pid` 进程组杀（抄 `TerminalManager.ts:761-768`） |
| `modules/server/ServerManager.ts:188, :310` | spawn 改 `detached:true` + 进程组杀法 |
| `modules/server/ServerManager.ts` | 崩溃 5s 硬重启（抄 `GameManager.ts:331-335`） |
| `modules/server/InstanceManager.ts`（**新建**，部分中 T5 已建） | `detectStartScript` 4 项优先级 + chmod +x（抄 `InstanceManager.ts:202-225, :878-907`） |
| `utils/childProcessEnvironment.ts`（**新建**） | 环境剥离 secret（抄 GSM `utils/childProcessEnvironment.ts:1-14`） |
| `utils/cryptoBox.ts` | 现状保留（不动） |

**验收**：

- 注册 PID 验证：spawn 后 `process.kill(pid, 0)` 成功（但**不吸附**——面板重启视为 STOPPED）
- 关停三段时长单测：mock 进程验证信号序列
- 启动脚本探测单测：fixture 目录覆盖 win32/linux 优先级
- 后端 `tsc --noEmit` 绿
- 后端单测全绿

**风险**：

- `detached:true` 在 Windows + `process.kill(-pid)` 不工作 → 平台分支（已抄 GSM 现有模式）
- SIGTERM 在 Windows 语义不同（GSM `forceKillProcess` 也用同样的 Windows taskkill 兜底）

**门槛**：

- ✅ 关停三段时长单测
- ✅ 启动脚本探测单测（含 chmod +x 模拟）
- ✅ `tsc --noEmit` 绿
- ✅ 后端单测全绿
- ✅ Linux 真机验证（留 Sprint 5）

**估算**：3-4 小时

---

### T7 — 契约 + 前端 + 测试 + 文档同步

**目标**：补齐前后端契约层；前端 4 文件改造；e2e 补 create→delete 链路；MEMORY.md 同步。

**范围**：

| 文件 | 改动 |
|---|---|
| `shared/contracts/server.ts` | （T5 已做） |
| `shared/schemas/server.schema.ts` | `ServerConfig` 补 `openModCredential`（T5 已做）+ 新增 `DeleteServerSchema` |
| `shared/schemas/server.schema.ts` | `ConfigureServerSchema` 同步补 `openModCredential` |
| `shared/index.ts` | 导出新增 |
| `hooks/useServer.ts:4-11` | `ServerInfo` 类型对齐 `GET /servers` 新响应 |
| `hooks/useServer.ts:49-56` | `addServer` 接 `POST /servers`；`removeServer` 接 `DELETE /servers/:id` |
| `pages/ServerSetupPage.tsx:66-80` | `handleDelete` 接真实 API |
| `components/server-setup/CreateServerDialog.tsx:46-60` | `onSubmit` 调真 API |
| `components/server-setup/CreateServerDialog.tsx:113-119` | `rconPassword` 字段接上（修缺口 4） |
| `pages/DashboardPage.tsx:164` | 读 `server.gamePort` 适配新响应 |
| `api/client.ts`（或 `api/servers.ts`） | 增 `createServer` / `deleteServer` 封装 |
| `e2e/smoke.spec.ts` | 补 create→delete 真链路用例（填表单→POST→列表出现→DELETE→消失） |
| `MEMORY.md` | 同步「Phase 0–3 全 4 卡实施完成」→「Sprint B2 完成」；新增「B2 设计落地」索引 |
| `claudedocs/research_database_necessity_2026-08-09.md` | 不改（终稿已落盘） |
| `docs/architecture/b2-directory-scan-refactor.md` | 不改（设计规格已落盘） |
| `docs/adr/0003-b2-directory-scan-datasource.md` | 不改（决策已 ADR 化） |

**验收**：

- 前端 `tsc --noEmit` 零错
- 前端 build 成功
- 前端 vitest 单测全绿（2 个测试文件）
- 前端 e2e 9 + 1 = 10 用例全绿
- 手动验证：登录 → 创建实例 → 列表出现 → 删除 → 列表消失

**风险**：

- 前端 `ServerInfo` 与新响应形状对齐：需后端定接口后定前端
- 端到端 e2e 依赖后端 + 前端 + 真实数据库状态——需完整起服务

**门槛**：

- ✅ 前端 4 文件改造 + 8 个消费者零改动验证
- ✅ 端到端流程通
- ✅ 前端 build 绿
- ✅ 前端 e2e 10 用例全绿
- ✅ MEMORY.md 同步

**估算**：3-4 小时

---

## 3. 任务依赖图（拓扑排序）

```
T1 (DB 迁移) ────┬─→ T2 (PathResolver)
                ├─→ T3 (乐观锁)
                ├─→ T4 (审计退役)
                └─→ T5 (ServerManager) ─┬─→ T6 (进程生命周期)
                                        └─→ T7 (契约 + 前端 + 测试)
```

---

## 4. 总体质量门

| 维度 | 验收 |
|---|---|
| **类型** | `tsc --noEmit` 前后端零错 |
| **构建** | 前端 `npm run build` 绿 |
| **单测** | 后端 jest + 前端 vitest 全绿，覆盖改到的文件 ≥ 80% |
| **E2E** | playwright 10 用例全绿（含新增 create→delete） |
| **契约** | 前后端 `GET /servers` 响应形状对齐（OpenAPI/zod 校验） |
| **Lint** | eslint + prettier 零警告 |
| **文档** | MEMORY.md 同步；claudedocs/wor**kflow** 完成 → 删除（按规范） |
| **IPC 通讯** | ADR-0003 已评审通过 |

---

## 5. 提交顺序（commit 序列）

```
T2  → T3  → T4  → T5  → T6  → T7  → T1  (迁移 005 最后)
```

**为什么 T1 最后**：

- T1 迁移文件落盘的同时，所有其他代码已不再引用三表
- 跑 `migrate.ts` 时不会因其他代码还在引用而失败
- 一次 commit 包含「迁移文件 + 注释同步 + 夹具同步」

**每个 task 一个 commit**，commit message 按 `操作名: <简要>` 规范：

```
功能重构: PathResolver 纯函数 + 8 处路径替换
功能重构: 乐观锁 mtime 化 + config_snapshots 退役
功能重构: 审计日志退役 + pino 承接
功能重构: RCON 凭证持久化 + ServerManager 目录扫描重写
功能重构: 进程生命周期对齐 GSM 现状
功能重构: 契约 + 前端 + 测试 + 文档同步
功能重构: 数据库迁移 005 删三表
```

---

## 6. 风险登记表

| 风险 | 触发条件 | 缓解 |
|---|---|---|
| T5 「目录扫描 + K-V 双写」不一致 | 目录创建成功但 K-V 写入失败 | 先 K-V 后目录，回滚顺序 |
| T6 `detached:true` 在 Windows 语义 | Windows 无进程组 | 平台分支（已抄 GSM） |
| T1 迁移不可逆 | DROP 后无法恢复 | 所有数据迁移前手动备份（即便无业务数据） |
| 端到端 e2e 跨前后端+DB 环境 | e2e setup 复杂 | 拆两个用例：扣 1 = 单独验后端 + 扣 2 = 单独验前端 |
| Sprint 5 真机验证未跑 | Windows 开发无法触达 Linux 进程行为 | 文档明记「真机验证留 Sprint 5」 |

---

## 7. 关联文档

- **决策依据**：ADR-0003
- **设计规格**：`docs/architecture/b2-directory-scan-refactor.md`
- **调研报告**：`claudedocs/research_database_necessity_2026-08-09.md`
- **完成定义**：`.claude/rules/development.md` §Definition of Done

---

## 8. 完成后

按 `document-organization.md` 规范，本工作流文件 **Sprint 完成后删除**（不归档）。
