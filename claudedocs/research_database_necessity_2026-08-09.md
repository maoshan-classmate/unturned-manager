# 调研报告：未转变者运维面板的数据库必要性——GSM / DST 双参考仓对比（终稿·已拍板）

> 日期：2026-08-09 · 方法：本地参考仓取证（file:line 证据）+ 本项目 DB 全量盘点 + 多轮用户决策收敛
> 边界：本报告只做分析与建议，不包含任何实施。

---

## 执行摘要（最终决策）

**结论：数据库不是必要，但保留 SQLite 最小化是边际成本最低的选择（用户已拍板选项 C）。**

最终拍板的架构：

| 层 | 方案 | 真源/载体 |
|---|---|---|
| 实例发现 | 目录扫描 `readdir Servers/` + 读 Commands.dat | 文件系统（`servers` 表移除） |
| 并发控制 | 文件 mtime / 内容 hash 比对 | 文件系统（`config_snapshots` 表移除） |
| 事件日志 | pino 结构化日志，复用 `LogStreamer` 浏览机制 | 日志文件（`audit_logs` 表移除，用户拍板不做「面板日志」页） |
| **加密 K-V** | WebAPI Key + 每实例 RCON 凭证 | **SQLite `settings` 表保留**（AES-GCM，master key 在 .env） |
| 认证 | users + refresh_tokens | **SQLite 保留** |

**DB 最终只承担两件事**：加密 K-V（`settings`：steam_webapi_key + RCON 凭证）+ 认证（users/refresh_tokens）。其余全裁。

---

## 一、三方取证结果（证据链）

### 1.1 GSM3（`.research/GameServerManager`）——无数据库，纯文件

三份 `package.json` 均无 DB 依赖。持久化 = JSON 文件 + 目录扫描 + 内存 Map，**全程无进程扫描**：

| 数据类别 | 存储 | 证据 |
|---|---|---|
| 面板全局配置（含 JWT secret） | `data/config.json` | `ConfigManager.ts:65` |
| 用户账号（bcrypt、锁定） | `data/users.json` | `AuthManager.ts:48` |
| 实例（工作目录、启动命令、状态） | `data/instances.json` 注册表 | `InstanceManager.ts:294-301` |
| 游戏实例配置 | `data/games/<gameId>.json` 目录扫描 | `GameManager.ts:882-889` |
| 启动细节 | 工作目录内 `readdir` 找 start.sh / jar | `detectStartScript`:202、`detectJarFile`:228 |
| 进程 | 仅 `spawn()` 拉起自己持有的进程 | `GameManager.ts:278/483` |

GSM 三层模型：注册表（身份）→ 目录文件（启动细节）→ spawn（进程）。无进程吸附（grep 无 `pidof`/`ps`/`/proc` 实例发现逻辑）。部署无 DB 容器，仅命名卷 `gsm3_data:/root/server/data`（`docker-compose.yml:26`）。

### 1.2 DMP（`.research/dst-management-platform-api`）——SQLite，DB 即真源

Go + GORM + `glebarez/sqlite`（`go.mod:10,20`），WAL，单文件 `data/dmp.db`（`database/db/database.go:16-47`）。10 张表，DB 为房间/世界实例权威来源：创建房间先写 DB 再落地配置（`app/room/handler.go:75-97` → `dst/room.go:42-67`），调度器从 `roomDao.GetRoomBasic()` 加载（`scheduler/jobs.go:85-101`），无目录反向扫描。

### 1.3 本项目现状——SQLite，6 表（004 迁移后）

## 二、逐表裁决（含最终拍板）

判定框架——三问：(a) 数据能否从文件系统推导？(b) 是否需要结构化查询/事务？(c) 是否面板自有、游戏不关心？

| 表 | 现状证据 | 裁决 | 依据 |
|---|---|---|---|
| **`servers`** | 7 个模块查询仅为取 `install_dir`（`files.ts:27`、`LogStreamer.ts:172`、`ConfigService.ts:49`、`WorkshopAcfService.ts:189,202`、`WorkshopApplyService.ts:214`、`FilesService.ts:50`、`WorkshopDeleteService.ts:116`）；`state` 列持久化运行时状态 | **移除** | `readdir Servers/` + 读 Commands.dat 即得实例身份（SOP 目录模型）；`state` 是派生数据，崩溃后必然脏读 |
| **`config_snapshots`** | 唯一写入点 `atomicWrite()`（`ConfigService.ts:60-101`）；`SELECT version` 用于乐观锁（`:69-77`）；`content` 列**全仓无人读**（grep 仅 `SELECT version` 与 `INSERT`，无 `SELECT content`） | **移除** | 乐观锁改文件 mtime/内容 hash 比对；真正备份在文件系统 `backups/<serverId>/<ts>_<name>` + `rollback()`（`:375-400`） |
| **`audit_logs`** | actor 硬编码 `'admin'`（`ServerManager.ts:524`）；查询端点（`audit-logs.ts:21`）前端零消费（`manager-web/src` grep `audit\|审计` 零命中；`SettingsPage.tsx:182-190`「面板日志」卡仅日志级别/滚动配置）；`audit-logs.ts:44` 直接 `getDb()` 违反后端规范；GSM 无对等物 | **移除（用户拍板：不做「面板日志」页）** | pino 已记同样事件，复用 `LogStreamer` 机制浏览；顺带消除 `getDb()` 违规 |
| **`settings`** | AES-GCM `value_enc` 加密 K-V（`settingsStorage.ts:16-32`），当前仅存 `steam_webapi_key` | **保留为加密 K-V 容器** | 密钥分离（master key `ENCRYPTION_KEY` 在 .env，密文在 DB）才是有效加密；**扩展承载每实例 RCON 凭证**（`rcon:<serverId>:<protocol>` key 前缀） |
| **`users` / `refresh_tokens`** | Argon2id + jti 撤销清单（`AuthService.ts:43-112`；access 15m / refresh 7d + rotation） | **保留** | refresh 撤销清单是运行时动态状态，无法静态化（.env 装不下） |

## 三、`.env` 边界（本轮论证结论）

「配在 .env」只对**静态单值**成立——密钥与初始种子**已经在 .env**（`.env.example:5-7`、`config.ts:13-14`）：

| 数据 | 能否进 .env | 依据 |
|---|---|---|
| JWT_SECRET / ENCRYPTION_KEY | ✅ **已在** | `.env.example:5-6` |
| admin 种子（ADMIN_PASSWORD） | ✅ **已在** | `.env.example:7` |
| WebAPI Key | ⚠️ 能进，但改 key 要重启 | `routes/settings.ts:31` 运行时写 DB vs `.env` 进程启动读死 |
| RCON 凭证（每实例 × 双协议） | ❌ 明文违反 prohibitions；多值塞不下 | ADR-17 |
| refresh token 撤销清单 | ❌ 运行时动态增长 | `AuthService.ts:112` 每次刷新插一条 |

**结论**：WebAPI Key + RCON 凭证留在加密 K-V（settings 表），master key 在 .env，密钥分离不变。

## 四、终局架构

```
实例发现   readdir Servers/ → Commands.dat（name/port/map/owner）   文件系统
进程管理   spawn 句柄 + PID 登记 + A2S 轮询探活                   运行时状态（不落库）
乐观锁     文件 mtime / 内容 hash 比对                             文件系统
事件日志   pino（复用 LogStreamer 浏览机制）                       日志文件
加密 K-V   settings：steam_webapi_key + rcon:<serverId>:<protocol>  SQLite（AES-GCM）
认证       users + refresh_tokens（access 15m / refresh 7d）         SQLite
```

### 对现有代码的影响面

| 模块 | 变更 |
|---|---|
| `ServerManager.ts:70-94` `loadServersFromDb` | 改目录扫描（启动时 readdir Servers/） |
| `ServerManager.ts:123-165` create/configure | 移除 DB 读写；createServer 改「建目录 + 写 Commands.dat」 |
| `ServerManager.ts:484` state 持久化 | 移除；运行时状态驻内存 + A2S 探活 |
| `ConfigService.ts:60-101` `atomicWrite` | 乐观锁 DB version → 文件 mtime 比对；删 config_snapshots 读写 |
| `routes/audit-logs.ts` 整文件 + `auditLog()`（`ServerManager.ts:518-528`、`routes/rcon.ts:70`） | 删除 |
| `settingsStorage.ts` | 扩展 K-V 承载 RCON 凭证（key 前缀 `rcon:`）；RCON 凭证读写迁移 |
| 前端 `useServer.ts:49-56` addServer/removeServer | 语义对齐：本地乐观更新 + 创建/删除作用于目录 |
| `migrations/` | 新增 005：删 servers/config_snapshots/audit_logs 三表，RCON 凭证迁移到 settings |

### 遗留决策点（实施前确认，已收窄）

1. `install_dir`（多 ServerID 共装时是全局常量）落位：config.ts 单值还是 settings 表？（当前 7 处查询只为取它）
2. RCON 凭证 key 命名：`rcon:<serverId>:openmod` / `rcon:<serverId>:rocketmod`（ADR-17 双协议凭证分离保持）
3. 计划任务无持久化（grep 无 schedule/cron）——若实现，参照 GSM `scheduled-tasks.json`，不进 DB

---

## 五、置信度

| 结论 | 置信度 | 说明 |
|---|---|---|
| GSM 无 DB、纯 JSON + 目录扫描、无进程吸附 | 高 | 依赖清单 + 全部存储点位 + spawn 证据 |
| DMP 用 SQLite 且 DB 为实例真源 | 高 | GORM 初始化 + DAO 调用链 |
| `config_snapshots.content` / `audit_logs` 前端零消费 | 高 | 全仓 grep + Settings 卡实况 |
| DB 终局 = 加密 K-V + 认证 | 中高 | 基于重写成本与安全性的工程判断，已拍板 |

## 六、来源

- 本地取证：`.research/GameServerManager`、`.research/dst-management-platform-api`、`manager-server/src/db/`、`manager-server/src/modules/`、`manager-server/src/routes/`、`manager-server/.env.example`、`manager-web/src/`
- 项目规则：`.claude/rules/unturned-sop.md`、`.claude/rules/prohibitions.md`、`.claude/rules/backend-development.md`
- 迁移历史：`manager-server/src/db/migrations/001-004`
