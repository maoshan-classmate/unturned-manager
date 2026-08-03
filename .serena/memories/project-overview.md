## 项目概述
Unturned Manager — Unturned Linux 专用服务器的 Web UI 管理面板。前端 React + shadcn/ui + Tailwind，后端 Node.js + Express + TypeScript，Docker Compose 部署。

## 技术选型（已确认）
- 前端：React 18 + TypeScript + Vite + Tailwind CSS 3 + shadcn/ui
- 图表：recharts
- 图标：lucide-react
- 表格：@tanstack/react-table
- 后端：Node.js + Express 4 + TypeScript + ws (WebSocket)
- 数据库：SQLite (better-sqlite3)
- RCON：rcon-srcds (OpenMod Valve Source RCON) + net 模块 (RocketMod Telnet fallback)
- 进程管理：dockerode (Docker SDK)
- 部署：Docker Compose (panel 容器 + U3DS 容器，共享卷 + 同 bridge 网络)

## 部署模式
- Docker 部署，同局域网内
- 多实例（同机多服，共享一份 U3DS 安装，不同 ServerID）
- 单账号 JWT 登录

## UI 设计
- 6 个页面已在 Figma 设计完成
- 统一暗色主题（slate 色系 + emerald-500 强调色）
- Figma 页面名以 "🎨" 前缀