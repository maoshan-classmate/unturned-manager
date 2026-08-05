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

## UI 设计 (更新于 2026-08-05)
- 6 个页面已在 Figma 设计完成，7 个页面（含 🎨 Files 框架）
- 统一暗色主题（slate 色系 + emerald-500 强调色）
- Figma 页面名以 "🎨" 前缀
- 页面状态:
  - ✅ 🎨 Dashboard — 完成
  - ✅ 🎨 Console — 完成
  - ✅ 🎨 Mods — 完成（文字颜色修复 2026-08-05）
  - ✅ 🎨 Players — 框架存在
  - ✅ 🎨 Config — 完成
  - 🟡 🎨 Server Setup — 基本完成（2026-08-05 改造）
  - 🟡 🎨 Files — 框架已建，黑色文字待修复
- 维护页: 🧩 Components (24 个组件), 🧩 Icon Refs (309 个图标)
- 来源库: shadcn-ui-×5, Material Dashboard ×4

## 设计规范（2026-08-04 确立）
- **颜色**: Sidebar `#020617`, Content `#0F172A`, Card `#1E293B`
- **强调**: `#22C55E` (green-500)
- **文字**: primary `#F1F5F9`, secondary `#94A3B8`, muted `#64748B`
- **状态**: online `#22C55E`, warning `#F59E0B`, danger `#EF4444`
- **间距**: 页面 padding 24px, Card 内 padding 24px, Card 间距 16px
- **排版**: Inter, h1 30px/h2 24px/h3 20px/body 14px/caption 12px

## 🧩 Components 体系
- Sidebar (260×900), StatCard (271×112), Card (560×300)
- Button 变体 (Primary/Secondary/Danger/Ghost)
- Badge 变体 (Online/Warning/Offline)
- SearchInput, Pagination, FilterDropdown
- ConfirmDialog (440×220), ToolbarBtn, ModCard (360×300)
- DataRow (1092×40), PlayerTable (1132×487), Toast 3变体
- Input (260×36), Select (260×36), Switch/ON+OFF, Checkbox, ConfigDialog (480×340)
- Server Setup 交互弹窗: 编辑计划任务 (450×340), 编辑启动命令 (500×280), SteamCMD 路径 (450×200)

## 关键教训
- Lucide 图标通过 stroke 渲染，需用 `set_strokes`，`set_fills` 无效
- 6 页面 Sidebar 必须用组件实例，不能 detach
- 修复子组件会自动传播到所有页面实例