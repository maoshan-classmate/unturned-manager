# ADR-0003: 数据库最小化 + 实例目录扫描真源 + GSM 现状对齐

> **状态**：待评审 · **日期**：2026-08-09 · **驱动源**：`claudedocs/research_database_necessity_2026-08-09.md`（终稿，已拍板）+ `docs/architecture/b2-directory-scan-refactor.md`（设计规格）
> **前置 ADR**：无（与 ADR-0001 动画库 / ADR-0002 API 修复无关）
> **本 ADR 决策**：DB 最小化为 `settings + users/refresh_tokens` 三张表；实例身份从 `servers` 表迁到目录扫描；`config_snapshots` / `audit_logs` 退役；进程生命周期对齐 GSM 现状（不吸附 / 不做归属验证 / 5s 硬重启）
> **本 ADR 不做**：PID 吸附 / 进程归属验证 / 崩溃指数退避（明确排除，§8）

---

## 1. 决策摘要（TL;DR）

| 决策点 | 选择 | 拒绝方案 | 理由 |
|---|---|---|---|
| **实例真源** | 目录扫描 `readdir <installDir>/Servers/` | 保留 `servers` 表 / 进程扫描 | SOP 目录模型即声明；GSM `InstanceManager.ts:882-889` 同款；进程扫描无法识别「面板管的实例」 |
| **DB 留存** | `settings`（加密 K-V）+ `users` / `refresh_tokens`（认证） | 全 DB 退役 / 保留 6 表 | secrets 需「密钥 + 密文分离」才叫有效加密；refresh 撤销清单是运行时动态，`.env` 装不下 |
| **乐观锁** | 文件 mtime 比对 | DB `config_snapshots.version` | `content` 列死数据（grep 全仓只有 `SELECT version` 与 `INSERT`）；前端 `expectedVersion` 零命中 |
| **审计** | **不实现**（事件走 pino） | 保留 `audit_logs` 表 | 前端零消费（`SettingsPage.tsx:182-190` 仅日志级别/滚动配置）；GSM 无对等物 |
| **RCON 凭证** | `settings` 加密 K-V，key=`rcon:<serverId>:<protocol>` | 继续内存注入 | 修复现有缺口：调试 / 配置重启即丢（`ServerManager.ts:136-145`） |
| **删除实例** | 后端新增 `IServerManager.removeServer` + `DELETE /:id` | 沿用前端纯本地假动作 | 现有 `useServer.ts:53` 注释自认「后端未实现」 |
| **进程生命周期** | 沿用 GSM 现状：SIGINT 2s→SIGTERM 2s→SIGKILL 1s→Win taskkill 1s | 自研时序 / 退避策略 | GSM `TerminalManager.ts:2082-2137` 已在 Linux 真机验证 |
| **崩溃重启** | GSM 现状：5s 硬重启（`GameManager.ts:331-335`） | 指数退避 | 已知会在 Mod 循环崩溃时拉满磁盘 IO，**本期接受**（§8） |
| **PID 吸附** | **不实现**（面板重启后所有实例 STOPPED） | 注册 PID + 启动探活 | GSM 不做（`InstanceManager.ts:315` 注释「重启后所有实例都是停止状态」），先抄现状 |
| **进程归属验证** | **不实现** | `/proc/<pid>` 校验 | GSM PTY 句柄即归属，我们无此场景 |
| **PID 进程组杀** | `detached:platform!=='win32'` + `process.kill(-pid, signal)` | 句柄单进程杀 | GSM `TerminalManager.ts:728,761-768` Linux 真机标准 |
| **凭证加密模板** | AES-256-GCM + IV + AAD + `0o600` key file | 整体明文 JSON | GSM `easytierSecretCipher.ts:1-102` 唯一对称加密模板（AAD 改为 `unturned-manager:rcon:v1`） |

---

## 2. 背景与现状证据

### 2.1 调度驱动

调研报告 `claudedocs/research_database_necessity_2026-08-09.md` 揭露了 12 个事实问题，需要合并固化为决策：

- **6 表 DB 现状**：`servers` / `users` / `refresh_tokens` / `config_snapshots` / `audit_logs` / `settings`（`migrations/001-003` 加 `004` 砍 2 表后留存）
- **8 个模块 `SELECT install_dir FROM servers`**（`files.ts:27` / `LogStreamer.ts:172` / `ConfigService.ts:49` / `WorkshopAcfService.ts:189,202` / `WorkshopApplyService.ts:214` / `FilesService.ts:50` / `WorkshopDeleteService.ts:116`）→ 路径解析全部为「按 id 查表拼路径」
- **`config_snapshots.content` 死数据**：grep 全仓 0 次 `SELECT content`，只有 `SELECT version`（`ConfigService.ts:71`）与 `INSERT`（`:94`）
- **`audit_logs` 前端零消费**：`SettingsPage.tsx:182-190`「面板日志」卡仅日志级别/滚动配置，无 API 调用；`manager-web/src` grep `audit|审计` 零命中
- **RCON 凭证重启即丢**：`rcon_password_enc` 列从未被 INSERT/UPDATE，`ServerManager.ts:136-145` 仅注入内存，`configureServer` 改凭证不生效（缺口 1）
- **后端无删除实例能力**：`IServerManager` 无 `removeServer`、路由无 `DELETE`、`RconManager.unregister` 零调用方（缺口 2）

### 2.2 参考项目对齐

- **GSM3**（`.research/GameServerManager`，40+ 游戏通用面板）：**无 DB**，纯 `data/*.json` + 目录扫描 + 内存 Map（详见调研报告 §1.1）
- **DMP DST**（`.research/dst-management-platform-api`，同品类单游戏面板）：用 SQLite，GORM + WAL，10 表，DB 为房间/世界实例权威来源（§1.2）

### 2.3 GSM 调研关键发现

GSM 调研揭穿 3 个我们之前认为是「自研缺口」实是「GSM 现状」的事：

- **PTY 句柄即归属 + 无吸附语义**（`InstanceManager.ts:315` 注释「重启后所有实例都是停止状态」）
- **PTY 句柄即归属 + 无 pid 归属验证需求**（`pidof`/`ps -ef` 在 `InstanceManager` / `TerminalManager` / `GameManager` 模块零命中）
- **崩溃 5s 硬重启**（`GameManager.ts:331-335`）——已知会在循环崩溃时拉满磁盘 IO

**结论**：GSM 不是「更好的方案」，是「**基础架构不同 + 业务场景不覆盖**」。我们走的是「在 GSM 现状基础上做 superset」路径，**先抄后超**。

---

## 3. 决策内容

### 3.1 实例真源 = 目录扫描

```
scan(installDir):
  readdir <installDir>/Servers/
  └─ 每个 <ServerID>/Server/Commands.dat 存在 ⇒ 实例成立
     ├─ Name/Port/Owner ← parseCommandsDat（复用 ConfigService 解析器）
     ├─ RCON 凭证 ← settings K-V（rcon:<id>:openmod / :rocketmod）
     └─ 注册 A2S + RCON（凭证缺失则 DEGRADED 态，可后补）
```

- `installDir` 全局化为 `config.ts` 默认 `/opt/unturned`，移除 servers 行级 `install_dir`
- 实例身份 = 目录存在性，不写 DB
- 运行时状态（PID、state）驻内存 + fly 5s 重启（GSM 现状）；**面板重启后所有实例状态视为 STOPPED**（与 GSM 一致）

### 3.2 DB 留存 = settings + users + refresh_tokens

| 表 | 用途 | 存什么 |
|---|---|---|
| `settings` | 加密 K-V | `steam_webapi_key` + `rcon:<serverId>:openmod` + `rcon:<serverId>:rocketmod` |
| `users` | 单用户 | Argon2id 哈希 |
| `refresh_tokens` | JWT 撤销清单 | jti + 撤销时间 |

- 迁移 `005-*.sql`：DROP `servers` / `config_snapshots` / `audit_logs` 三表（无数据搬运——3 表均无业务数据）
- 凭证加密：「密钥 + 密文分离」= `ENCRYPTION_KEY` 在 `.env`，密文在 `settings.value_enc`（现有 AES-GCM 不变）

### 3.3 乐观锁 = 文件 mtime

- `atomicWrite` 改 `fs.stat(absPath).mtimeMs` 比对
- 读接口返回 `mtime`；写接口接受 `expectedMtime`，不匹配抛 `VERSION_CONFLICT`（保留错误码）
- 前端不传则不校验（兼容现状；前端 `expectedVersion` 零命中）

### 3.4 进程生命周期 = GSM 现状（不增强）

- **关停**：`TerminalManager.ts:2082-2137` 三段（SIGINT 2s→SIGTERM 2s→SIGKILL 1s→Win taskkill 1s）
- **进程组杀**：`detached: os.platform() !== 'win32'` + `process.kill(-pid, signal)`
- **崩溃自动重启**：GSM 5s 硬重启（无退避、无失败计数）
- **PID 吸附** / **进程归属验证** / **指数退避**：**本期不做**（§8）

### 3.5 启动脚本探测，按 GSM 优先级

`detectStartScript`（`InstanceManager.ts:202-225`）4 项优先级 + `chmod +x`（`:878-907`）：

- linux：`start.sh` → `run.sh`
- 未命中抛分平台提示 Error

### 3.6 凭证加密模板 = `easytierSecretCipher.ts`

- AES-256-GCM，IV=12字节随机
- AAD：`unturned-manager:rcon:v1`（承 GSM `gsm3:easytier:secrets:v1` 改成我们的）
- Key 来自 `ENCRYPTION_KEY` 环境变量（已有；`config.ts:14`）

---

## 4. 拒绝方案

### 4.1 拒绝：保留 `servers` 表

- 拒绝理由：8 个模块仅取 `install_dir` 一个字段，读多写少；`state` 是派生数据崩溃后必然脏读；目录扫描等价获取实例身份
- 改造成本：8 处机械替换 + 增 1 个 `PathResolver` 纯函数 + 增 `005` 迁移
- **代价**：路径解析重构（1 个 sprint 局部工作）

### 4.2 拒绝：进程扫描（`pidof` / `ps -ef`）发现实例

- 拒绝理由：无法区分「面板管的实例」与「别人手动起的同名进程」；命令行解析脆；与 GSM 数据驱动方向背离
- **代价**：0（本来就不是方案）

### 4.3 拒绝：DB 内保存 RCON 凭证的二进制列（`rcon_password_enc`）

- 拒绝理由：当前 001 schema 已有该列但从未用（缺口 1）——单独存储路径反而增 1 个真源点
- 替代方案：复用 `settings` 表的 K-V 通用加密，零新增表
- **代价**：0

### 4.4 拒绝：保留 `config_snapshots` DB version 列

- 拒绝理由：`content` 死数据；前端 `expectedVersion` 零命中；mtime 已能覆盖
- **代价**：0（合约字段名 `expectedVersion` 改 `expectedMtime`，前端零引用）

### 4.5 拒绝：保留 `audit_logs` + 后续补「面板日志」页面

- 拒绝理由：用户已拍板「不做」；pino 已记事件；GSM 无对等物
- **代价**：0

### 4.6 拒绝：自研进程生命周期时序 / 退避

- 拒绝理由：GSM 已在 Linux 真机验证；自研是无中生有
- **代价**：已知 5s 硬重启会在 Mod 循环崩溃时拉满磁盘 IO（§8 接受）

### 4.7 拒绝：预留 enhancement hook 接口（`IProcessAttacher` / `IProcessOwner` / `ICrashRestartPolicy`）

- 拒绝理由：当前 `ProcessSupervisor` 是具体类直调，**只一个实现时抽象是浪费**（依赖倒置原则）；真要做增强时**重新审视设计**比预判接口更可靠
- **代价**：未来做增强时需重写当前具体代码为接口（一次性工作）

### 4.8 拒绝：前端 `addServer` / `removeServer` 继续纯本地

- 拒绝理由：现有 `useServer.ts:49-56` 注释自认「后端未实现」；刷新即丢
- 替代方案：接 `POST /servers` + `DELETE /servers/:id`

---

## 5. 实施路径

### 5.1 后端（manager-server/src）

| 模块 | 改造 |
|---|---|
| `modules/server/ServerManager.ts` | `loadServersFromDb` → 目录扫描；create/configure 去 DB、写目录；**新增 `removeServer`**；state 去持久化；删 `auditLog`；RCON 凭证改读写 settings K-V |
| `modules/server/pathResolver.ts`（**新增**） | `resolveServerPath(serverId, relative)` 纯函数——替代 8 处 `SELECT install_dir` |
| `modules/config/ConfigService.ts` | `atomicWrite` mtime 化；删 `config_snapshots` 读写 |
| `routes/servers.ts` | **新增 `DELETE /:id`** |
| `routes/audit-logs.ts` | **整文件删除** |
| `routes/rcon.ts` | 删 `:70` audit_logs 写入 |
| `routes/files.ts` | `:27` 改 PathResolver |
| `routes/config.ts` | 三个 PUT 端点 `expectedVersion` → `expectedMtime` |
| `modules/{logs,workshop,files,steamcmd}/...` | 8 处 `SELECT install_dir` → PathResolver |
| `modules/settings/settingsStorage.ts` | 扩展 K-V 承载 RCON 凭证（`rcon:<serverId>:<protocol>`） |
| `modules/rcon/RconManager.ts` | 凭证从 K-V 恢复 register；`unregister` 接线 |
| `db/migrations/005-*.sql` | **新增**——DROP 三表（无数据搬运） |

### 5.2 共享（shared/）

- `contracts/server.ts`：新增 `IServerManager.removeServer`
- `schemas/server.schema.ts`：`ServerConfig` 补 `openModCredential`（补 ADR-17 脱节）
- `types/domain.ts`：同步补 `openModCredential`（schema 真源）

### 5.3 前端（manager-web/src）

| 文件 | 改造 |
|---|---|
| `hooks/useServer.ts` | `addServer`/`removeServer` 接真 API |
| `pages/ServerSetupPage.tsx` | `handleDelete` (`:66-80`) 接 `apiClient.delete` |
| `components/server-setup/CreateServerDialog.tsx` | `onSubmit` (`:46-60`) 调 `POST /servers`；`rconPassword` 字段接上（修缺口 4） |
| `pages/DashboardPage.tsx` | `:164` 读 `server.gamePort` 适配新响应 |
| 其余 8 个消费者（Config/Files/Players/Mods/Console/ControlCard/Sidebar/WebSocketContext） | **零改动**（只读 `servers[0].id/name/state` 兼容形状） |
| `api/` | 增 `createServer` / `deleteServer` 封装 |

### 5.4 测试

- 后端 6 处内联 servers DDL 改动 → 同步更新
- `e2e/test-server.ts:13-17` 夹具改建「保留 3 表」
- `e2e/smoke.spec.ts` 补 create→delete 真链路用例（现状 case 9 不提交表单）
- 前端 2 个 vitest 零改动（无 DB/audit mock）

### 5.5 验证方案

| 平台 | 验证范围 |
|---|---|
| Windows 开发 | 全部代码 + 单测 + e2e（除启动类） |
| Linux 真机 | 吸附（现状不做）/ 重启状态恢复 / 开服/关服端到端；Sprint 5 验证 |

---

## 6. 顺带修复的 4 个既有缺口

| # | 缺口 | 现状 | ADR 修复 |
|---|---|---|---|
| 1 | RCON 凭证**从未落库** | `rcon_password_enc` 列从未 INSERT/UPDATE；`ServerManager.ts:136-145` 仅注入内存 | 写入 `settings` K-V，面板重启也恢复 |
| 2 | **改 RCON 凭证不生效** | `configureServer` 只更新 name/game_port/owner_steam_id | settings K-V 实时更新 + `rconManager.register` 重连 |
| 3 | **后端无删除实例能力** | `IServerManager` 无 `removeServer`、路由无 `DELETE` | 本 ADR 实施新增 |
| 4 | 前端 `rconPassword` **采集后丢弃** | `CreateServerDialog.tsx:113-119` 不在 `newServer` 里 | 接 `POST /servers` 时一并提交 |

---

## 7. 拒绝复盘（§4 之外）

| 备选 | 拒绝理由 |
|---|---|
| **专门写一个 `server-discovery` 服务** | `pathResolver` 纯函数足够；8 处调用机械替换即可 |
| **换 better-sqlite3 为其他数据库** | 引入 SQLite 是 backlog 决策，bench/results 充分 |
| **保持 6 表但用一张索引合并** | 反正表都无业务数据，合并无收益 |
| **复用 `easytierSecretCipher.ts` 原封不动** | GSM 的文件名和 AAD 字符串硬编码；按规范改 AAD 字段名 |
| **进程生命周期写一套自己的时序常数** | 自研无测试环境；GSM 已 Linux 验证 |

---

## 8. 明确排除项（本期不做）

> **以下 3 项明确标注「本期不做」**，避免后续误读为「enhancement hook」。

| 排除项 | 本期行为 | 后续如需 |
|---|---|---|
| **PID 吸附** | 面板启动时所有实例状态一律 STOPPED（与 GSM 一致） | 单独 Sprint + ADR |
| **进程归属验证** | 不实现 | 单独 Sprint + ADR |
| **崩溃指数退避** | 5s 硬重启（与 GSM `GameManager.ts:331-335` 一致） | 单独 Sprint + ADR |

**实现纪律**：

- **不**预留 enhancement hook 接口
- **不**为本期不做的功能写测试
- **不**写「未来可扩展」注释或 TODO 标记
- 上述 3 项代码**完全按 GSM 现状落地**，不留任何「未来易扩展」的接口缝隙

**为什么不做 enhancement hook**：

- 当前 `ProcessSupervisor.ts` 是具体类直调，**只一个实现时抽象是浪费**（依赖倒置原则）
- 引入 hook 接口仅当**有第二个具体实现**才有价值
- 真要做增强时**重新审视设计**比预判接口更可靠——避免「接口设计错了，无法表达真实需求」的债务

**知会代价**（ADR 知情同意）：

- 面板重启后所有实例**状态显示 STOPPED**（即便进程还在跑）——用户需手动点「启动」重新拉起
- Mod 加载失败循环崩溃时**磁盘 IO 会被 5s 硬重启拉满**——用户在面板日志可见
- MVP 阶段可接受：单用户自托管，实例数 1~N 个个位数，磁盘 IO 风暴只在配置错误时短暂出现

---

## 9. 前置待办（实施前）

1. 决定 PID 登记落点（settings K-V vs `<ServerID>/.panel.pid`）——**本期不做 PID 登记，此项作废**；改为 Sprint 5 评估
2. ADR：本文档（ADR-0003），提交后实施
3. 编码前阅读 `docs/architecture/b2-directory-scan-refactor.md`（设计规格）§2-§9

---

## 10. 关联

- **调研报告**：`claudedocs/research_database_necessity_2026-08-09.md`（终稿）
- **设计规格**：`docs/architecture/b2-directory-scan-refactor.md`
- **项目宪法**：`CLAUDE.md`（设计源头、术语钉死表）
- **运行规范**：`.claude/rules/unturned-sop.md`（目录布局/重启流水线）
- **平台铁律**：`.claude/rules/prohibitions.md`（明文存密码 / 编译 U3-SDK 等硬禁止）
- **后续 ADR 候选**：「PID 吸附 / 进程归属验证 / 崩溃指数退避」按需单独建 ADR，引用本 ADR §8
