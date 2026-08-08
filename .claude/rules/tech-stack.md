# 技术栈铁律

> 代码里一旦用了，要换就得先更新本文件 + 写一份 ADR。  
> 技术名词保留原文，正文中在旁边加中文说明。

## 前端

| 分层 | 锁定的库 | 备注 |
|---|---|---|
| 框架 | React 18 + TypeScript | |
| 构建 | Vite | |
| 样式 | Tailwind CSS 4 + shadcn/ui（CSS-first 配置） | 深色主题 slate 色系，点睛色 HSL(160, 84%, 39%) emerald-500 |
| 图表 | recharts | |
| 表格 | @tanstack/react-table | |
| 图标 | lucide-react | |
| 状态管理 | （实现阶段决定，轻量级、Zustand 风格） | |
| 实时通信 | 浏览器原生 `ws` | **不能用 Socket.IO** |
| 动画(CSS) | tw-animate-css | |
| 动画(React) | Motion (framer-motion v13)，从 `motion/react` 导入 | ADR-0001，全局 `<MotionConfig reducedMotion="user">` |
| 表单 | react-hook-form + zod + shadcn Input/Button | shadcn Input 已添加 forwardRef 支持 register() |

## 后端

| 分层 | 锁定的库 | 备注 |
|---|---|---|
| 运行时 | Node.js 20 LTS | |
| HTTP 框架 | Express 4 + TypeScript | |
| WebSocket | `ws`（**不是 socket.io**） | |
| 数据库 | SQLite，驱动用 better-sqlite3 | 预留 `users` 表支持多用户扩展 |
| 认证 | 单用户 JWT（一个管理员），Argon2id 密码哈希 | 数据库不堵死多用户 |
| 进程控制 | 共享卷 + child_process / spawn | 第一版不要 Agent 边车，不要 Docker 边车 |
| 日志 | pino | 结构化 JSON + 自动滚动切分 |

## 和游戏服务端集成

| 关注点 | 选定方案 |
|---|---|
| RCON 主链路 | OpenMod 的 Valve Source RCON 协议，npm 上的 `rcon-srcds` |
| RCON 回落方案 | RocketMod 的 Telnet RCON，Node 原生 `net` 模块（自动探测 + 自动回落） |
| A2S 查询 | `@fabricio-191/valve-server-query` |
| XML 配置解析 | `fast-xml-parser` |
| YAML 配置解析 | `js-yaml` |
| Workshop Mod 元数据 | 第一档：URL `?xml=1` 零登录；升级：用户填 WebAPI Key |
| Steam WebAPI HTTP 客户端 | undici（Node 20 内置） |
| API 契约 | zod + zod-openapi——`shared/schemas/` 定义 Zod schema，派生 TS 类型 + OpenAPI 3.0 |

## 部署

| 分层 | 决策 |
|---|---|
| 拓扑 | Docker Compose，panel 容器和 U3DS 容器同主机部署，共享卷 + 同 bridge 网络 |
| 多实例 | 同一 U3DS 安装目录挂多个 ServerID；**不是一个服一个容器**（每服省 10 GB） |
| 反向代理 | Caddy 或 nginx，TLS 终结，JWT 走 `Authorization: Bearer` 头 |
