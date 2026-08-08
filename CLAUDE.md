# unturned-manager — 项目宪法

> 技术名词（库名、命令名、文件名、协议名、端口号）保留原文；正文中在旁边加中文说明。  
> 本文档是项目入口——详细铁律在 `.claude/rules/`，按文件路径按需加载。

---

## 1. 项目身份

Unturned 3.x Linux 专用服务端的自托管 Web 管理面板。  
**不是**通用游戏面板、不是 Pterodactyl/Pelican/AMP 克隆、不是远程 Agent 架构——用「共享卷 + RCON」在进程内和服务端通信。

### 术语钉死表

| 术语 | 含义 |
|---|---|
| **U3DS** | Unturned 专用服务端二进制，Steam AppID `1110390` |
| **U3-SDK** | 官方 Unity 客户端源码（`.research/U3-SDK`），**绝对不能编译来当服务端用** |
| **ServerID** | `Servers/` 下的子目录，代表一个服务端实例 |
| **GSM** | `GameServerManager`（`.research/GameServerManager`），只参考技术栈 |
| **RCON** | 远程控制协议，往服务端发命令的通道 |
| **A2S** | Valve 服务器在线状态查询协议 |
| **GSLT** | Game Server Login Token，AppID `304930` 申请 |
| **SteamID64** | 玩家 17 位数字 ID（`7656119...`） |

---

## 2. 架构方向

- **通信**：共享卷 + RCON（OpenMod 优先，RocketMod Telnet 回落），不走 Agent 边车
- **多实例**：同一 U3DS 安装目录挂多个 ServerID，不是一个服一个容器（省 10GB×N）
- **状态机**：`STOPPED → STARTING → RUNNING → DEGRADED/STOPPING → STOPPED`
- **认证**：单用户 JWT + Argon2id，数据库预留 `users` 表
- **设计源头**：`docs/architecture/design-system-mapping.md`（真 Figma 拉取），不用 PNG 猜

### 技术栈

| 层 | 技术 |
|---|---|
| **前端** | React 18 + TypeScript + Vite + Tailwind CSS 4 + shadcn/ui（基于 @base-ui/react）+ Motion (framer-motion v13) + @tanstack/react-table + recharts + lucide-react |
| **后端** | Node.js 20 + Express 4 + TypeScript + `ws` + better-sqlite3 + pino |
| **游戏集成** | `rcon-srcds`（OpenMod Valve Source RCON）→ `net`（RocketMod Telnet 回落）+ `@fabricio-191/valve-server-query`（A2S）+ `fast-xml-parser` + `js-yaml` |
| **API 契约** | zod + zod-openapi——`shared/schemas/` 定义 Zod schema，派生 TS 类型 + OpenAPI 3.0，前后端共用 |
| **部署** | Docker Compose（panel + U3DS 同主机、共享卷、同 bridge 网络）；Caddy/nginx 反向代理 TLS 终结 |

---

## 3. 铁律文档索引

| 规则文件 | 加载条件 | 内容 |
|---|---|---|
| @.claude/rules/prohibitions.md | 全局 | 禁用清单 + GSM 白名单/黑名单 |
| @.claude/rules/document-organization.md | 全局 | 文档存放位置/命名/生命周期 |
| @.claude/rules/component-abstraction.md | `manager-web/**` | 前端组件抽象铁律 + 色值常量 |
| @.claude/rules/frontend-development.md | `manager-web/**` | 前端开发规范（样式/表单/状态/JSDoc） |
| @.claude/rules/backend-development.md | `manager-server/**` | 后端开发规范（模块/错误/校验/JSDoc） |
| @.claude/rules/unturned-sop.md | `manager-server/src/modules/**` | 开服 SOP（目录布局/配置/状态机/重启流水线） |
| @.claude/rules/rcon-protocol.md | `manager-server/src/modules/rcon/**` | RCON 双协议凭证分离 + 安全门控 |
| @.claude/rules/development.md | 全局 | 验证门槛/PR 5 件套/完成定义 |
| @.claude/rules/communication.md | 全局 | 沟通规则（问/不问）+ Serena 记忆纪律 |

### 关键参考文档

| 文档 | 何时读 |
|---|---|
| `docs/architecture/architecture-spec.md` | 后端模块实现前 |
| `docs/architecture/design-system-mapping.md` | 前端组件实现前 |
| `claudedocs/reference_config_files.md` | 涉及配置文件读写 |
| `claudedocs/reference_console_commands.md` | 涉及 RCON 命令 |
| `claudedocs/research_verification_tracker.md` | 承诺"能跑"之前 |

---

## 4. 提交规范

```
<操作名>: <简要概括,不超过30个中文字符>
```

| 操作名 | 适用场景 |
|---|---|
| `修复` | bug 修复、错误纠正 |
| `功能实现` | 新功能、新模块、新页面 |
| `功能重构` | 代码重构、结构优化（不改变功能） |
| `架构设计` | 架构决策、ADR、系统设计 |
| `文档规范` | 文档增删改、规范制定 |
| `其他更新` | 依赖更新、配置调整、构建脚本 |

---

## 5. 仓库蓝图

```
D:/unturned-manager/
├── CLAUDE.md                ← 你在读这个（入口）
├── .claude/rules/           ← 铁律文档（渐进式披露，9 文件）
├── .claude/agents/          ← 自定义 agent 定义
├── .claude/hooks/           ← 自动化钩子脚本
├── docs/                    ← 架构文档（adr/ + architecture/）
├── claudedocs/              ← 调研产出 + 活参考 + archive/
├── manager-server/          ← 后端（Express 4 + ws + SQLite）
├── manager-web/             ← 前端（React 18 + shadcn/ui + Tailwind CSS 4 + Motion）
├── shared/                  ← 前后端共享（types/ + contracts/ + schemas/）
├── .research/               ← 只读参考仓（U3-SDK + GSM）——**绝对不能改**
└── test-servers/            ← 测试用服务端文件
```

---

## 6. git commit 前文档过时检测

① `git add` → ② `git diff --cached --name-only`，**仅当 staged 含 `.md` 文件时**才调 `doc-outdated-guard` subagent（`@.claude/agents/doc-outdated-guard.md`），输出 `正在调取文档语义分析...` → ③ `git commit`。每步独立 Bash 调用。详细流程见 `.claude/rules/development.md`。

---

*最近修订：2026-08-08——合并 tech-stack 信息、新增 3 个规范文件、rules 增至 9 个、新增 §6 git commit 文档过时检测、移除 agent hook、hook exit 0 改为 JSON 输出。*
