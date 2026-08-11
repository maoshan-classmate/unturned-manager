# 外部参考链接索引

> **文档类型**：活参考文档（reference）
> **用途**：集中管理本项目依赖的所有外部官方文档/API/工具链接，避免散落在各文件中
> **维护**：新增外部依赖时必须同步更新本文档
> **日期**：2026-08-08

---

## 1. Steam / Unturned 官方

### 1.1 Steam WebAPI

| 资源 | 链接 | 说明 |
|---|---|---|
| WebAPI 总览 | https://partner.steamgames.com/doc/webapi | Steamworks WebAPI 入口 |
| IPublishedFileService | https://partner.steamgames.com/doc/webapi/IPublishedFileService | 创意工坊物品查询接口（QueryFiles / GetDetails） |
| IPublishedFileService（第三方参考） | https://steamapi.xpaw.me/IPublishedFileService | 更易读的参数列表，含扩展参数 |
| ISteamRemoteStorage | https://partner.steamgames.com/doc/webapi/ISteamRemoteStorage | 创意工坊主接口（发布/订阅/收藏） |
| WebAPI Key 申请 | https://steamcommunity.com/dev/apikey | 免费，匿名即时生效，与 Steam 账号绑定 |
| GSLT 管理 | https://steamcommunity.com/dev/managegameservers | Game Server Login Token，AppID `304930` |

### 1.2 SteamCMD

| 资源 | 链接 | 说明 |
|---|---|---|
| SteamCMD 官方文档 | https://developer.valvesoftware.com/wiki/SteamCMD | 命令行 Steam 客户端，用于下载服务端和 Workshop |
| Unturned Dedicated Server (AppID 1110390) | https://steamdb.info/app/1110390/ | SteamDB 上的 Unturned 服务端 AppID |

### 1.3 Unturned

| 资源 | 链接 | 说明 |
|---|---|---|
| SDG 官方文档站 | https://docs.smartlydressedgames.com/ | Unturned 服务端/Mod 开发官方文档总入口 |
| SDG 文档站 — 稳定版 | https://docs.smartlydressedgames.com/en/stable/ | Read the Docs 托管的稳定版分支（推荐默认引用） |
| SDG 文档站 — 最新版 | https://docs.smartlydressedgames.com/en/latest/ | Read the Docs 托管的最新版分支（含未稳定内容） |
| 服务端搭建指南 | https://docs.smartlydressedgames.com/en/stable/servers/server-hosting.html | 官方服务端托管教程（U3DS 安装/配置/端口/GSLT） |
| GSLT 指南 | https://docs.smartlydressedgames.com/en/latest/servers/game-server-login-tokens.html | Game Server Login Token 配置说明 |
| 官方文档 GitHub | https://github.com/SmartlyDressedGames/Unturned-Docs | SDG 官方文档源仓库（可提 PR 贡献） |
| 服务端托管规则 | https://docs.smartlydressedgames.com/en/stable/servers/server-hosting-rules.html | 盈利化/内容限制/Anycast 等规则 |
| GSM3 Unturned 食用说明 | https://docs.gsm.xiaozhuhouses.asia/%E6%B8%B8%E6%88%8F%E7%99%BE%E7%A7%91/Steam/%E6%9C%AA%E8%BD%AC%E5%8F%98%E8%80%85%E9%A3%9F%E7%94%A8%E8%AF%B4%E6%98%8E.html | GSM3 平台的 Unturned 单服开服教程（Commands.dat 示例/ExampleServer.sh/Mod 添加流程） |
| U3-SDK（客户端源码） | `.research/U3-SDK` | AppID `304930`，仅供 schema 参考、禁止编译 |
| WorkshopDownloadConfig.cs | `.research/U3-SDK/Assets/Runtime/Assembly-CSharp/Unturned/Provider/WorkshopDownloadConfig.cs` | WorkshopDownloadConfig.json 的 schema 权威来源 |

### 1.4 OpenMod / RocketMod

> ⚠️ **RocketMod 已过期**——本项目打算采用 OpenMod 框架，不采用 RocketMod。原仓库已停止维护，官方维护的分叉为 Legally-Distinct-Missile（LDM）。以下 RocketMod 条目仅作历史参考。

| 资源 | 链接 | 说明 |
|---|---|---|
| OpenMod 文档 | https://openmod.github.io/openmod-docs/ | C# Mod 框架（本项目采用；其 RCON 通道已随 ADR-0004 Phase 6 移除，命令走 PTY 终端） |
| RocketMod 仓库（已过期） | https://github.com/SmartlyDressedGames/Legally-Distinct-Missile | 旧 Mod 框架，Lua 插件，Telnet RCON；SDG 官方维护分叉（LDM），仅历史参考 |

---

## 2. 后端技术栈（Node.js）

### 2.1 运行时 & 框架

| 资源 | 链接 | 说明 |
|---|---|---|
| Node.js 20 LTS API | https://nodejs.org/docs/latest-v20.x/api/ | 运行时 API 参考 |
| Express 4.x API | https://expressjs.com/en/4x/api.html | HTTP 框架 |
| TypeScript | https://www.typescriptlang.org/docs/ | 类型系统 |

### 2.2 数据库 & 存储

| 资源 | 链接 | 说明 |
|---|---|---|
| better-sqlite3 API | https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md | Node.js SQLite3 绑定（同步 API） |
| SQLite 官方文档 | https://www.sqlite.org/docs.html | SQL 语法和特性参考 |

### 2.3 PTY 终端 & 游戏通信

> ADR-0004 Phase 6：RCON/A2S 通道已删，命令统一走 PTY 持久终端 owner-trust 模型。

| 资源 | 链接 | 说明 |
|---|---|---|
| node-pty (npm) | https://www.npmjs.com/package/node-pty | PTY 模拟终端（U3DS 需要 isatty 才输出彩色进度条） |
| xterm.js | https://xtermjs.org/ | 前端终端渲染（输出流 + onData 键盘输入） |

### 2.4 配置解析

| 资源 | 链接 | 说明 |
|---|---|---|
| js-yaml (npm) | https://github.com/nodeca/js-yaml | YAML 解析（OpenMod config.yaml） |
| fast-xml-parser (npm) | https://github.com/NaturalIntelligence/fast-xml-parser | XML 解析（RocketMod Configuration.xml） |

### 2.5 日志 & 安全

| 资源 | 链接 | 说明 |
|---|---|---|
| pino | https://getpino.io/#/docs/ | 结构化 JSON 日志 |
| argon2 (npm) | https://github.com/ranisalt/node-argon2 | 密码哈希（Argon2id） |
| jsonwebtoken (npm) | https://github.com/auth0/node-jsonwebtoken | JWT 签发与校验 |

### 2.6 WebSocket

| 资源 | 链接 | 说明 |
|---|---|---|
| ws (npm) | https://github.com/websockets/ws/blob/master/doc/ws.md | WebSocket 服务端/客户端 |

---

## 3. 前端技术栈（React）

### 3.1 核心框架

| 资源 | 链接 | 说明 |
|---|---|---|
| React 18 | https://react.dev/reference/react | 组件 API、Hooks 参考 |
| TypeScript | https://www.typescriptlang.org/docs/handbook/react.html | React + TypeScript 指南 |
| Vite | https://vite.dev/guide/ | 构建工具 |

### 3.2 UI 框架 & 样式

| 资源 | 链接 | 说明 |
|---|---|---|
| Tailwind CSS | https://tailwindcss.com/docs | Utility-first CSS 框架（本项目用 v4） |
| shadcn/ui | https://ui.shadcn.com/docs | 基于 @base-ui/react 的组件库 |
| @base-ui/react | https://base-ui.com/react/ | shadcn/ui v4 底层依赖，无样式原语组件 |
| Motion (framer-motion v13) | https://motion.dev/docs | React 动画库 |

### 3.3 组件库 & 工具

| 资源 | 链接 | 说明 |
|---|---|---|
| @tanstack/react-table | https://tanstack.com/table/latest | 无头表格库（DataTable 底层） |
| react-hook-form | https://react-hook-form.com/api/ | 表单状态管理（+ zod resolver） |
| zod | https://zod.dev/ | TypeScript-first schema 校验 |
| zod-openapi | https://github.com/samchungy/zod-openapi | Zod → OpenAPI 3.0 生成 |
| lucide-react | https://lucide.dev/icons/ | 图标库（309 个图标） |
| recharts | https://recharts.org/en-US/api | 图表库（Dashboard 统计图） |

---

## 4. DevOps & 部署

| 资源 | 链接 | 说明 |
|---|---|---|
| Docker Compose | https://docs.docker.com/compose/compose-file/ | 多容器编排 |
| Caddy | https://caddyserver.com/docs/ | 反向代理 + 自动 TLS（可选替代 nginx） |
| Dockerode (npm) | https://github.com/apocas/dockerode | Node.js Docker SDK |

---

## 5. 调研参考（只读）

| 资源 | 路径 | 说明 |
|---|---|---|
| DST 管理平台 | `.research/dst-management-platform-api` | Go 实现，Mod 管理链路参考 |
| GameServerManager | `.research/GameServerManager` | 通用游戏管理面板，技术栈参考 |
| U3-SDK | `.research/U3-SDK` | Unity 客户端源码，**只能看 WorkshopDownloadConfig.cs** |

---

*创建日期：2026-08-08 · 维护：每次新增外部依赖必须同步本文档*
*最后更新：2026-08-12 — 补 SDG 文档站版本根链接*
