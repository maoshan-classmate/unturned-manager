# B2 目录扫描真源重构——设计规格

> 状态：设计稿 · 依据 `claudedocs/research_database_necessity_2026-08-09.md`（终稿，已拍板）· 影响面为两份侦查 agent 报告 + 直接取证
> 边界：本文档是设计，不含实施。实施前须过 ADR。

---

## 1. 背景与决策链

调研结论（已拍板）：实例真源从 DB `servers` 表迁到**目录扫描**；`config_snapshots`、`audit_logs` 退役；DB 最小化为「加密 K-V（settings）+ 认证（users/refresh_tokens）」。

本次重构是 B2 的落地设计。除表退役外，**顺带修复 4 个既有缺口**（均为影响面侦查确认）：

| # | 缺口 | 证据 |
|---|---|---|
| 1 | RCON 凭证**从未落库**——只在 createServer 注入一次内存，**重启即丢** | `ServerManager.ts:136-144`；`rcon_password_enc` 列无 INSERT/UPDATE |
| 2 | configureServer 改 RCON 凭证**不生效**——只合并内存 config，不重新 register | `ServerManager.ts:157`（UPDATE 不含凭证） |
| 3 | 后端**无删除实例能力**（无 `removeServer`/`DELETE`），前端删除是纯本地假动作 | `shared/contracts/server.ts:5-21`；`useServer.ts:53` 注释自认 |
| 4 | 前端 `CreateServerDialog` 采集 `rconPassword` 但**丢弃** | `CreateServerDialog.tsx:113-119` |

## 2. 影响范围总表（核心）

### 2.1 后端 `manager-server/src`

| 文件 | 类别 | 影响 |
|---|---|---|
| `modules/server/ServerManager.ts` | **重构** | `loadServersFromDb`(:70)→目录扫描；create/configure 去 DB、写目录；**新增 removeServer**；state 去持久化(:484)；删 `auditLog()`(:518)；RCON 凭证改读写 settings K-V；重启时从 K-V 恢复 register |
| `modules/config/ConfigService.ts` | **改** | `atomicWrite`(:60)乐观锁 DB version→**文件 mtime 比对**；删 config_snapshots 读写(:71,:94)；`resolvePath`(:47) 改全局 install_dir |
| `routes/servers.ts` | **改** | 新增 `DELETE /:id`；POST/PATCH 语义从 DB 改为目录 |
| `routes/audit-logs.ts` | **删** | 整文件（含 `:44` getDb 直读违规） |
| `routes/rcon.ts` | **改** | 删 `:70` audit_logs 写入 |
| `routes/files.ts` | **改** | `:27` `SELECT install_dir` → 全局路径解析 |
| `routes/config.ts` | **改** | 若透传 expectedVersion → 改 mtime 校验（待核实） |
| `modules/logs/LogStreamer.ts` | **改** | `:172` 路径解析 |
| `modules/workshop/WorkshopAcfService.ts` | **改** | `:189,:202` 路径解析 |
| `modules/workshop/WorkshopApplyService.ts` | **改** | `:214` 路径解析 |
| `modules/workshop/WorkshopDeleteService.ts` | **改** | `:116` 路径解析 |
| `modules/files/FilesService.ts` | **改** | `:50` 路径解析 |
| `modules/steamcmd/SteamCmdManager.ts` | **改** | `:77` `WHERE state!='STOPPED' AND install_dir=?` **依赖 state 列** → 改「活跃实例」探活判断（A2S 轮询 / PID 登记），update 前置检查逻辑重写 |
| `modules/settings/settingsStorage.ts` | **增** | 扩展 K-V 承载 RCON 凭证（`rcon:<serverId>:<protocol>`） |
| `modules/rcon/RconManager.ts` | **改** | 凭证从 K-V 恢复 register；`unregister` 接线 |
| `modules/auth/AuthService.ts` | 零改动 | users/refresh_tokens 保留 |
| `composition-root.ts` | **改** | ServerManager 构造注入（路径解析 / settings 存储） |
| `db/connection.ts` | 零改动 | SQLite 保留 |
| `db/migrations/005-*.sql` | **新增** | 删三表 + 无数据迁移（三表均无业务数据：servers 行=派生缓存、config_snapshots=死写、audit_logs=死写） |

### 2.2 共享 `shared/`

| 文件 | 类别 | 影响 |
|---|---|---|
| `contracts/server.ts` | **改** | `IServerManager` 新增 `removeServer(serverId)` |
| `schemas/server.schema.ts` | **改** | `ServerConfig` 补 `openModCredential`（补 ADR-17 双协议凭证分离脱节）；新增删除确认 schema（如 `DeleteServerSchema`） |
| `contracts/rcon.ts` | 微调 | 无破坏（`RconServerConfig` 已有双协议字段） |

### 2.3 前端 `manager-web/src`

| 文件 | 类别 | 影响 |
|---|---|---|
| `hooks/useServer.ts` | **改** | `addServer`/`removeServer`(:49-56) 接真 API（POST/DELETE `/servers`）；`ServerInfo` 类型(:4-11) 对齐新响应 |
| `pages/ServerSetupPage.tsx` | **改** | `handleDelete`(:66-80) 接 `apiClient.delete`；创建流程改真 API；`:186-187` 读 gamePort 适配 |
| `components/server-setup/CreateServerDialog.tsx` | **改** | `onSubmit`(:46-60) 调 `POST /servers`；`rconPassword`(:113-119) 接上（修复缺口 4） |
| `pages/DashboardPage.tsx` | **改** | `:164` 读 `server.gamePort`——若 Commands.dat 解析提供则兼容，否则适配 |
| 其余 8 个消费者（Config/Files/Players/Mods/Console/ControlCard/Sidebar/WebSocketContext） | **零改动** | 只读 `servers[0].id/name/state` 兼容形状 |
| `api/` | **增** | `createServer`/`deleteServer` 封装 |

### 2.4 测试

| 文件 | 类别 | 影响 |
|---|---|---|
| 后端测试夹具 6 处内联 servers DDL | **改/删** | 随 servers 表退役 |
| `e2e/test-server.ts:15` | **改** | 建实例夹具改目录方式 |
| `e2e/smoke.spec.ts` | **增** | 补 create→delete 真链路用例（现状 case 9 不提交表单） |
| 前端单测（2 个 vitest） | 零改动 | 无 DB/audit mock |

### 2.5 破坏面风险

| 风险 | 触发 | 缓解 |
|---|---|---|
| `GET /servers` 响应形状变化 | gamePort/ownerSteamId/installDir 不再来自 DB 行 | Commands.dat 解析提供 name/port/owner；install_dir 全局化后不入响应或保留冗余字段 |
| `state` 不再持久化 | 崩溃恢复语义变化 | 已有崩溃恢复 ADR 兜底；listServers 由 A2S 探活实时状态 |
| 目录扫描开销 | 大目录 readdir | 实例数=ServerID 数（个位~十位），可忽略；启动时一次扫描 |

## 3. 分模块设计

### 3.1 ServerDiscovery——目录扫描真源（新增）

```
scan(installDir):
  readdir <installDir>/Servers/
  └─ 每个 <ServerID>/Server/Commands.dat 存在 ⇒ 实例成立
     ├─ Name/Port/Owner ← parseCommandsDat（复用 ConfigService 解析器）
     ├─ RCON 凭证 ← settings K-V（rcon:<id>:openmod / :rocketmod）
     └─ 注册 A2S + RCON（凭证缺失则 DEGRADED 态，可后补）
```

- `installDir` **全局化**：`config.ts` 默认 `/opt/unturned`（`ServerManager.ts:88` 现默认值），移除 servers 行级 install_dir。
- 实例身份 = 目录存在性，不写 DB。
- 运行时状态（进程 PID、state）驻内存 + PID 登记（`settings` 或 `<ServerID>/.panel.pid`），重启靠 `kill(pid,0)` + A2S 探活恢复。

### 3.2 PathResolver——替代 8 处 `SELECT install_dir`

新增统一路径工具（`modules/server/pathResolver.ts`）：`resolveServerPath(serverId, relative)` = `join(installDir, 'Servers', serverId, relative)`。8 个模块的 DB 查询全部替换为此纯函数——**这是本次改动量最大的机械替换**。

### 3.3 RCON 凭证持久化（settings 加密 K-V，新增能力）

```
key: rcon:<serverId>:openmod       value: <SteamID:密码>（AES-GCM 密文）
key: rcon:<serverId>:rocketmod     value: <裸密码>（AES-GCM 密文）
```

- 生命周期：createServer 写 → configureServer 改（修缺口 2）→ removeServer 删 → 启动扫描恢复 register（修缺口 1）。
- `settingsStorage` 复用现有 `setSetting/getSetting`，仅新增 key 约定 + 便捷封装。

### 3.4 乐观锁 mtime 化（ConfigService）

- `atomicWrite` 版本号 → `fs.stat(absPath).mtimeMs`。
- 读接口（GET config/commands 等）返回 `mtime`；写接口接受可选 `expectedMtime`，不匹配抛 `VERSION_CONFLICT`（保持现有错误码）。
- 已确认：三个 PUT 端点（`routes/config.ts:25-37/:48-56/:67-75`）现透传 `body.expectedVersion`，schema 定义在 `shared/schemas/config.schema.ts:58/67/72` → 字段改为 `expectedMtime`（语义对齐，字段名变更属契约小改，前端零引用无破坏）。
- **前端不传则不校验**——兼容现状（前端 `expectedVersion` 零命中），单用户下并发概率低，未来可启用。零前端强制改动。

### 3.5 审计退役（audit_logs）

- 删 `routes/audit-logs.ts`、`ServerManager.auditLog`、`routes/rcon.ts:70` 写入。
- 事件由 pino 承接；日志浏览沿用 `LogStreamer` 机制（现有，不新增）。
- Settings「面板日志」卡保持现状（日志级别/滚动配置，无 API）。

### 3.6 删除实例（新增能力，配合目录真源）

```
DELETE /servers/:id
  → 若 RUNNING：先 stop（优雅）→ 等退出
  → 删 Servers/<id>/ 目录（二次确认由前端 ConfirmDialog 承担）
  → 删 settings K-V 凭证（rcon:<id>:*）
  → unregister RCON / A2S
```

前端 `handleDelete` 从纯本地（`useServer.ts:53`）改为真 API + `refresh()`；`ServerSetupPage.tsx:225` 确认文案已对齐「删除目录与所有配置」。

## 4. 契约层变更

- `IServerManager.removeServer(serverId: ServerId): Promise<void>`（新增）
- `ServerConfig` 补 `openModCredential?: string`；CreateServerSchema 同步
- `ServerInfo`（前端 `useServer.ts:4-11`）：对齐 `GET /servers` 新响应；gamePort 由 Commands.dat 解析提供

## 5. 迁移（`005-*.sql`）

三表均无业务数据（servers 行=派生缓存、config_snapshots=死写、audit_logs=死写），**仅 DROP，无数据搬运**。RCON 凭证本就不在 DB（缺口 1），无迁移。保留：users/refresh_tokens/settings。

- `004-drop-mod-cache-tables.sql:26-32` 注释「保留 6 表」清单需同步改为「保留 3 表」。
- `tests/e2e/test-server.ts:13-17` 夹具现只建 servers/users/refresh_tokens 三表（无 config_snapshots/audit_logs/settings）——退役后统一建「保留 3 表」，夹具反而更干净。

## 6. 验证方案

| 层 | 用例 | 平台 |
|---|---|---|
| 单测 | PathResolver 纯函数；ServerDiscovery 扫描（fixtures 目录）；settings K-V 凭证读写；atomicWrite mtime 冲突 | ✅ Windows 可全量（fixtures 用 `os.tmpdir`） |
| e2e | 新增 create→delete 真链路（填表单→POST→列表出现→DELETE→消失）；既有 9 用例回归 | ✅ Windows（不真启动 U3DS） |
| 契约 | `GET /servers` 形状对齐（8 个前端消费者零改动证明） | ✅ Windows |
| 手动 | 改 RCON 凭证后重连生效（缺口 2）；面板重启后凭证恢复（缺口 1） | ✅ Windows（逻辑层） |
| **Linux 真机** | **吸附运行中 U3DS 进程**（/proc 验证）、**重启后状态恢复**（A2S 对真实服务端）、开服/关服端到端 | ⚠️ **必须 Linux**——spawn `ServerHelper.sh` + SIGTERM/SIGKILL 语义在 Windows 无法真实复现 |

## 7. 风险与回滚

- **最大风险**：8 处路径解析机械替换遗漏 → 引入 grep 断言：迁移后全仓 `SELECT install_dir` 归零。
- 回滚：迁移 `005` 为不可逆 DROP（无数据损失），代码按模块灰度，先 PathResolver 后 ServerManager。
- 目录删除不可逆 → removeServer 前强制前端二次确认 + 后端幂等（目录不存在返回成功）。

## 8. 待办前置

1. ADR：B2 目录扫描真源 + DB 最小化决策固化（含 4 缺口修复范围）。
2. ✅ 已核实：`routes/config.ts` 三个 PUT 端点透传 `expectedVersion`（`config.schema.ts:58/67/72`）→ 改 `expectedMtime`。
3. 决定 PID 登记落点（settings K-V vs `<ServerID>/.panel.pid`）。
4. `ServerConfig` 类型真源在 `shared/types/domain.ts:10`（仅 `rconPassword`），补 `openModCredential` 时两处（domain.ts + server.schema.ts）同步。
5. `SteamCmdManager:77` 的 state 依赖 → 定义「活跃实例」判定接口（A2S 探活为准）。

## 9. 平台边界（Windows 开发 vs Linux 部署）

> 项目定位 = Unturned **Linux 专用**服务端面板；开发环境 = Windows（当前）。本节逐点标注本次设计的平台属性。

### 9.1 跨平台（Windows 开发环境可完整实现 + 验证）

| 设计点 | 说明 |
|---|---|
| 目录扫描 `readdir Servers/` | node fs 跨平台；开发用 `test-servers/` 目录做 fixture |
| `PathResolver` 路径拼接 | `path.join` 跨平台 |
| mtime 乐观锁 | `fs.stat` 跨平台；NTFS/ext4 均满足 ms 精度 |
| settings 加密 K-V（RCON 凭证） | 纯 JS crypto，跨平台 |
| 删除实例 `fs.rm(dir, {recursive})` | node fs 跨平台 |
| A2S 探活 | 网络协议，跨平台（但真实验证需真实服务端） |

### 9.2 Linux 相关（必须特别标注）

| 设计点 | Linux 依赖 | 影响 |
|---|---|---|
| **开服 spawn** `${installDir}/ServerHelper.sh`（`ServerManager.ts:188/310`） | U3DS 是 Linux 专用二进制 | **B2 不修改启动逻辑**，但端到端验证只能在 Linux 真机 |
| **关服 SIGTERM/SIGKILL**（`ProcessSupervisor.ts:107/143`） | Unix 信号语义；Windows 上 SIGTERM 语义不同（近似强杀） | 同上，逻辑不动，验证需 Linux |
| **PID 登记 + 吸附运行中 U3DS**（§3.1，本次新增） | 「吸附验证」在 Linux 读 `/proc/<pid>/cmdline` 归属；Windows 无 `/proc` | **该验证实现是 Linux 专属**；Windows 只能做 PID 登记/探活的逻辑单测 |
| **`install_dir` 全局化默认 `/opt/unturned`** | Linux 部署路径 | Windows 开发必须在 `.env` 用 `INSTALL_DIR` 覆盖为本地测试路径，否则默认值在 Windows 无效 |

### 9.3 Windows 开发策略

- 本次重构的**全部代码 + 单测 + e2e（除启动类）**可在 Windows 完成。
- 「吸附运行中进程」「重启后状态恢复」「开服/关服端到端」三条链路**必须在 Linux 真机验证**——开发期用 `test-servers/` 模拟目录结构做逻辑层验证，真机验证留到 Sprint 5（现有验证 tracker 已有此约定）。
- 设计 §3.1 的 PID 登记接口须平台无关（`process.kill(pid,0)` 探活跨平台），**仅「进程归属验证」的默认实现 Linux 专属**，用接口隔离便于将来扩展。

### 9.4 GSM 照抄对照表（Linux 真机验证基准）

> GSM 已在 Linux 真机跑过。逐点对照 B2 设计要点，标注可抄性 + 来源证据，避免重发明。
> **§9.4 决策原则**：能在 GSM 抄的**直接抄**——GSM 是 Linux 验证过的基线；不能直接抄的（如 GSM 场景不覆盖），**先按 GSM 现状实现为默认**，留给后续 enhancement hook。先实现总没错。

| 设计点 | GSM 来源（file:line） | 行为 | 抄性 |
|---|---|---|---|
| **进程关停三段** | `TerminalManager.ts:2082-2137` `forceKillProcess` | SIGINT 2s → SIGTERM 2s → SIGKILL 1s → Win `taskkill /F /T /PID` 1s | ✅ **直接抄** 时长集 |
| **进程组杀** | `TerminalManager.ts:728,761-768` | `detached: os.platform() !== 'win32'` + `process.kill(-pid, signal)` | ✅ **直接抄** |
| **进程探活** | `TerminalManager.ts:2016-2022` `hasChildProcessExited` | `process.kill(pid, 0)` 捕 ESRCH 判否（供复用，目前不在主流程） | ✅ **直接抄** |
| **`child_process` 环境剥离 secret** | `utils/childProcessEnvironment.ts:1-14` | 从 `process.env` 剥离 `EASYTIER_SECRET_KEY/JWT_SECRET/SESSION_SECRET` 后再传给 spawn | ✅ **直接抄**（脱敏字段按我们的 key 改） |
| **启动脚本探测 + chmod +x** | `InstanceManager.ts:202-225` (detectStartScript) + `:878-907` (chmod) | linux 优先级 `start.sh` → `run.sh`；未命中抛分平台提示 Error | ✅ **抄 4 项优先级 + chmod + 兜底文案** |
| **删除实例三步** | `InstanceManager.ts:724-754` `deleteInstance` | closeTerminalInternal → in-memory map.delete → saveInstances | ✅ **直接抄**（路径翻译：close RCON → map.delete → save） |
| **凭证 AES-GCM 加密模板** | `easytierSecretCipher.ts:1-102` | AES-256-GCM，IV=12字节随机，AAD=`gsm3:easytier:secrets:v1`，key 从 `EASYTIER_SECRET_KEY` 环境变量或 `data/.secret-key`（mode 0o600 自动生成） | ✅ **直接抄模板**（AAD 改为 `unturned-manager:rcon:v1`） |
| **崩溃检测骨架** | `InstanceManager.ts:911-931` `handleTerminalFinalized` | onExit → status=stopped + 清 pid + 写 lastStopped | ✅ **直接抄**骨架 |
| **PID 吸附 + 进程归属验证** | ❌ GSM **不吸附**——`InstanceManager.ts:315` 注释「`status: 'stopped', // 重启后所有实例都是停止状态`」；GSM PTY 句柄即归属，无 pid 归属验证需求 | GSM 重启 = 干净状态机 | ⚠️ **按 GSM 现状对齐**（默认不吸附）+ **预留 enhancement hook**（见 §9.6） |
| **崩溃自动重启** | `GameManager.ts:331-335` `setTimeout(..., 5000)` 5s 硬重启，**无退避** | GSM 简单粗暴 | ✅ **先抄 GSM 5s 硬重启** + **预留 enhancement hook**（指数退避 / 失败上限） |
| **PTY 包装启动游戏** | `TerminalManager.ts:724` + PIDY 二进制 | 命令靠 stdin 打字注入 | ❌ **不能抄**（Unturned 无 stdin 启动协议） |
| **凭证整体明文** | `ConfigManager.ts:193-200` JSON.stringify 整文件 | GSM `data/config.json` 大部分明文 | ❌ **不能抄**（我们坚持 AES-GCM 单值加密） |

### 9.5 降级到 GSM 现状的代价（知情同意，钉入 ADR）

**MVP 行为对齐 GSM 后，用户能感知到的 trade-off**：

| 项 | 用户能感知到的现象 | 现实中的真实操作 |
|---|---|---|
| **PID 吸附 = 不做** | 面板重启后，所有正在运行的实例**状态显示为 STOPPED**（即便进程还在） | 用户需手动点「启动」重新拉起，或用 `ps` 手动确认状态 |
| **进程归属验证 = 不做** | （MVP 用户无感知，因为没有吸附场景） | 仅当未来增加「吸附」「跨面板接管」时才有需求 |
| **崩溃 5s 硬重启**（按 GSM） | Mod 加载失败 → 5s 重启 → 再崩 → 5s 重启 → 磁盘 IO 风暴 | 用户在面板日志看到崩溃循环，需手动停服 + 查 Mod |

**owner 意识**：MVP 阶段这些代价**可接受**——单用户自托管，实例数 1~N 个个位数，磁盘 IO 风暴只在配置错误时短暂出现，不影响线上。**这是 GSM 验证过的「可用方案」，不是理论最优雅方案**。

### 9.6 本期不做——明确排除项

**以下 3 项 GSM 现状对齐的副作用，本期（v1 B2）一律不实现：** 

| 排除项 | 本期行为 | 后续如需实现 |
|---|---|---|
| **PID 吸附** | 面板启动时**所有实例状态一律 STOPPED**（与 GSM 一致） | 后续 Sprint 单独建 ADR + 设计 |
| **进程归属验证** | 不实现 | 同上 |
| **崩溃指数退避** | 5s 硬重启（与 GSM `GameManager.ts:331-335` 一致） | 同上 |

**实现纪律（本期）**：

- **不**预留 enhancement hook 接口（不创建 `IProcessAttacher` / `IProcessOwner` / `ICrashRestartPolicy` 等抽象类）。
- **不**为本期不做的功能写测试。
- **不**写「未来可扩展」的注释或 TODO 标记。
- 上述 3 项代码**完全按 GSM 现状落地**，不留任何「未来易扩展」的接口缝隙。

**为什么不做 enhancement hook**：

- 当前的进程管理代码（`ProcessSupervisor.ts`）已是**具体类直接调用**（`child_process.spawn` + `entry.process.kill('SIGTERM')`），没有抽象层。
- 引入 hook 接口仅当**有第二个具体实现**才有价值（依赖倒置原则）。**只一个实现（默认实现）时抽象是浪费**。
- 真要做增强时（PID 吸附 / 退避），**重新审视设计**比一开始就预留接口更可靠——避免「接口设计错了，无法表达真实需求」的债务。

**如需增强（如有用户反馈崩溃循环 IO 问题）**：

1. 单独建 Sprint，先写 ADR 钉死需求 + 验证 GSM 现状代价；
2. 必要时**重构现有具体代码为接口**（不在 MVP 阶段预判接口形态）；
3. ADR 必须在 docs/adr/ 落地，引用本设计 §9.5（知情同意 trade-off）+ §9.6（本期不做）。
