## 项目概述
Unturned Manager — Unturned Linux 专用服务器的 Web UI 管理面板。前端 React + shadcn/ui + Tailwind，后端 Node.js + Express + TypeScript，Docker Compose 部署。

## 实现现状（2026-08-11，Phase 0-7 落地后）

### 后端模块目录（11 个，`manager-server/src/modules/`）
认证 / 配置 / 文件锁 / 文件 / 日志 / 进程 / 服务端管理 / 会话 / 设置 / SteamCMD / 创意工坊

其中：
- 服务端管理——4 态状态机 + `activeOperation` 竞态防护 + 目录扫描为实例真源
- 会话——终端会话元数据持久化（ADR-0005 Phase 7）
- 日志——脱敏管道 + 文件尾随；持久终端输出经 WebSocket 推送
- 创意工坊——Steam 网页接口拉元数据（需接口密钥）
- 已删除：远程控制台管理器、状态查询客户端（ADR-0004 Phase 6）

### 前端页面（8 个，`manager-web/src/pages/`）
登录 / 仪表盘 / 控制台 / 模组 / 配置 / 文件 / 服务端设置 / 系统设置

已删除：玩家管理页（ADR-0004 Phase 6，随远程控制台通道一并删除）

## 技术选型（已确认）
- 前端：React 18 + TypeScript + Vite + Tailwind CSS 4 + shadcn/ui（基于 `@base-ui/react`）
- 图表：recharts；图标：lucide-react；表格：`@tanstack/react-table`；动画：Motion (framer-motion v13)
- 终端渲染：xterm.js
- 后端：Node.js 20 + Express 4 + TypeScript + `ws`
- 数据库：SQLite（better-sqlite3），收敛为 3 表：用户 / 刷新令牌 / 设置键值
- 命令通道：`node-pty` 持久终端（owner-trust 模型）——远程控制台与状态查询通道已删除，`rcon-srcds` 不再是依赖
- 进程管理：Node.js 原生子进程派生——`dockerode` 未采用
- 配置解析：`fast-xml-parser` + `js-yaml`
- 契约：zod + zod-openapi，`shared/schemas/` 派生类型与 OpenAPI 文档
- 部署：Docker Compose（面板与服务端同主机、共享卷、同桥接网络）

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
- ✅ 🎨 Files — GSM3 风格改造完成 (右键菜单+权限弹窗+FileCard组件)
- 🟡 🎨 System Settings — 新建完成 (5 Cards, 复用Input/Select/Switch)
  - ✅ 🎨 Config — 完成
  - 🟡 🎨 Server Setup — 基本完成（2026-08-05 改造）
  - 🟡 🎨 Files — 框架已建，黑色文字待修复
- 维护页: 🧩 Components (25 个组件，新增 FileCard), 🧩 Icon Refs (309 个图标)
- 页面总计: 8 页 (Dashboard/Console/Players/Config/Mods/Files/Server Setup/System Settings)
- 交互弹窗: Files右键菜单, PermissionsDialog
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

## 共享组件清单（2026-08-07 最新：10 个）
PageState / ConfirmDialog / Dialog / SearchInput / TabBar / Card / PasswordInput / DataTable / ConfigSection / ConfigToggle / ConfigField

## 关键教训
- Lucide 图标通过 stroke 渲染，需用 `set_strokes`，`set_fills` 无效
- 6 页面 Sidebar 必须用组件实例，不能 detach
- 修复子组件会自动传播到所有页面实例