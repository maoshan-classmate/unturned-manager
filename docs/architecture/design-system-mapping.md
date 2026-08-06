# 设计系统映射表（Figma → 代码）

> 文件作用：把 Figma 文件 `unturned-manager` 真值映射到代码侧的 shadcn/ui + Tailwind 主题与组件。  
> 来源：`figwright` MCP 拉到的 Components 页 + 6 个核心页面 + shadcn 参考页。  
> 维护：`docs/architecture/` 下唯一权威，遇到 Figma 改动必须同步此文件。
>
> 拉数证据：Figma fileKey=null（路由空），但 Pages/Local Components/Paint Styles 全部可拉，真实节点树已拿到 6 张核心页的 Frame 子树 + 21 个 Component + 4 个 Component Set。

---

## 1. 设计令牌 Figma Paint Style → Tailwind v3 主题

| Figma Token 名 | RGB | Hex（推荐） | Tailwind class | 用途 |
|---|---|---|---|---|
| `bg/sidebar` | (0.008, 0.024, 0.090) | `#020617` | `bg-slate-950` | 左侧导航条 |
| `bg/content` | (0.059, 0.090, 0.165) | `#0F172A` | `bg-slate-900` | 内容区底色 |
| `bg/card` | (0.118, 0.161, 0.231) | `#1E293B` | `bg-slate-800` | 卡片底色 |
| `border/default` | (0.118, 0.161, 0.231) | `#1E293B` | `border-slate-800` | 边框（与 bg/card 同色） |
| `border/strokes` | (0.200, 0.250, 0.350) | `#334155` | `border-slate-700` | TopBar / Card 边框（出现频率高，是次级边框） |
| `text/primary` | (0.945, 0.961, 0.984) | `#F1F5FB` | `text-slate-100` | 主文本 |
| `text/secondary` | (0.580, 0.639, 0.722) | `#94A3B8` | `text-slate-400` | 次级文本 |
| `text/muted` | (0.392, 0.455, 0.545) | `#64748B` | `text-slate-500` | 弱化文本 |
| `accent/primary` | (0.133, 0.773, 0.369) | `#22C55E` | `text-emerald-500` / `bg-emerald-500` | 强调色 |
| `accent/hover` | (0.086, 0.639, 0.290) | `#16A34A` | `bg-emerald-600` | 强调色 hover |
| `status/online` | (同 accent/primary) | `#22C55E` | `text-emerald-500` | 在线徽章 |
| `status/warning` | (0.961, 0.620, 0.043) | `#F59E0B` | `text-amber-500` | 警告徽章 |
| `status/danger` | (0.937, 0.267, 0.267) | `#EF4444` | `text-red-500` / `bg-red-500` | 错误徽章 |

**主题落地**：`tailwind.config.ts`：

```ts
// 验证过的色阶（Figma 实测 → Tailwind v3 默认色板对齐）
theme: {
  extend: {
    colors: {
      // 自命名别名（可选，跟 shadcn/ui 默认主题一致则无需扩展）
      // shadcn/ui 已经把 --background / --foreground / --primary 等定义好了
      // 这里仅当代码需要直接用 Figma token 命名时才补
    }
  }
}
```

> **`shadcn/ui` 默认主题 = slate + emerald 跟 Figma 完全对齐**，不需要写 `tailwind.config.ts` 主题扩展。新建项目 `npx shadcn-ui@latest init` 时选 slate 默认即可。

---

## 2. 字体

| Token | Figma 实际使用 | 落地 |
|---|---|---|
| 字体族 | **Inter**（页面所有文字） | `index.css` 全局：`@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap');` |
| 字重 | Regular (66 处) / Medium (247 处，默认主力) / Semi Bold (35 处) | shadcn/ui 默认 `font-sans` 已含 |
| 字号阶 | 见 §3 推算 | 跟 shadcn 默认一致 |

**Figma 页面里实际出现的字号**（从截图反推）：
- 24px = 页面大标题（"MyServer" 在 TopBar）
- 18px = 卡片标题（"Server Status" / "Workshop Mods"）
- 16px = 段落/表格内容（"Server Name MyServer" / "Hawaii …"）
- 14px = 次级文本（"by Renaxon"）
- 12px = 弱化/提示文本（"12 mod maps available"）

对应 Tailwind：`text-2xl` / `text-lg` / `text-base` / `text-sm` / `text-xs`。

---

## 3. 间距与尺寸

- **画布宽** 1440px（标准桌面端）
- **左侧侧边栏** 260px（`Sidebar 5:29` 宽度 = 1440 - 260 = 1180 内容区）
- **TopBar** 64px 高
- **卡片圆角** `radius: 8px`（TopBar/标题/普通 Card）
- **按钮圆角** `radius: 6px`（按钮）
- **按钮高** 36px（主流程按钮）/ 32px（Server Setup 卡片内操作按钮）
- **按钮尺寸**：105×36（标准）/ 100×36（小）/ 64×28（紧凑型，ModCard 行内）
- **卡片内边距**：24px（标准，从 Card 节点 `x=24, y=24` 推算）
- **卡片间距**：24-32px（从多个 Card 节点 y 坐标差推断）
- **主内容 padding**：左右各 24-260px = 总 260（Sidebar）+ 24 = 284 左 padding

---

## 4. Figma Components → 代码组件映射（21 个 Component）

### 4.1 核心 Components（Components 页 `5:2`）
| Figma 组件 ID | Figma 名 | 变体 | shadcn/ui 对位 | 本项目落地路径 |
|---|---|---|---|---|
| `5:29` | Sidebar | — | 自行实现（无 shadcn 对应） | `src/components/layout/Sidebar.tsx` |
| `5:34` | StatCard | — | `Card` 包装 | `src/components/stats/StatCard.tsx` |
| `5:39` | Card | — | shadcn `Card` | 直接用 `@/components/ui/card` |
| `5:52` | **Button**（Component Set） | Primary/Secondary/Danger/Ghost | shadcn `Button` 的 variant | 直接用 `@/components/ui/button` |
| `5:62` | **Badge**（Component Set） | Online/Warning/Offline | shadcn `Badge` 改造 variant | `src/components/ui/badge.tsx`（自定义 variant） |
| `12:16436` | ConfirmDialog | — | shadcn `AlertDialog` | `src/components/ui/confirm-dialog.tsx` |
| `12:16476` | ToolbarBtn | — | shadcn `Button` `ghost` variant | `src/components/ui/toolbar-btn.tsx` |
| `14:16695` | ModCard | — | shadcn `Card` 包装 | `src/components/mods/ModCard.tsx` |
| `17:17520` | DataRow | — | Table row | `<TableRow>` |
| `17:17601` | PlayerTable | — | `@tanstack/react-table` 8.x | `src/components/players/PlayerTable.tsx` |
| `17:17754` | Toast/Error | Toast Set | shadcn `Toast` + variant | `src/components/ui/toast.tsx` |
| `17:17965` | Input | — | shadcn `Input` | `@/components/ui/input` |
| `17:17966` | Select | — | shadcn `Select` | `@/components/ui/select` |
| `17:17967` | Switch/ON + `17:17968` Switch/OFF | 状态枚举 | shadcn `Switch` + checked | 用 shadcn `Switch` 表态，ON/OFF 不必拆两个 |
| `17:17969` | Checkbox | — | shadcn `Checkbox` | `@/components/ui/checkbox` |
| `20:19444` | ConfigDialog | — | shadcn `Dialog` | `src/components/config/ConfigDialog.tsx` |
| `21:19780` | FileCard | — | shadcn `Card` | `src/components/files/FileCard.tsx` |

> Figma 上的 Switch 拆成 ON/OFF 两组件是错的——代码侧应该用受控组件 + `aria-checked`，而不是拆两个。

### 4.2 引用关系（从页面拉出来的）
- `5:48` Button=Primary → 被 Dashboard Quick Actions（4 个）、Server Setup Btn-启动/启动 5 个 实例调用
- `12:16436` ConfirmDialog → 在 Dashboard、Console、Mods、Players、Config、Server Setup 6 张页面里以 Instance 复用
- `14:16695` ModCard → 在 Mods 页 5 处 Instance 复用（已经做过设计稿）
- `17:17601` PlayerTable → 在 Players 页 Instance 复用

---

## 5. Figma 页面 → 路由映射

| Figma Page ID | Figma 名字 | 路由（前端约定） | v1 必备？ |
|---|---|---|---|
| `2:2` | 🎨 Dashboard | `/` | ✅ P0 |
| `2:3` | 🎨 Console | `/console` | ✅ P0 |
| `2:4` | 🎨 Mods | `/mods` | ✅ P0（**核心差异化**） |
| `2:5` | 🎨 Players | `/players` | ✅ P0 |
| `2:6` | 🎨 Config（5 子页 stack：Commands/Config.txt/Workshop/OpenMod/RocketMod） | `/config/[tab]` | ✅ P0（**做 Commands.dat 一栏，5 个 Tab v1.1 后做**） |
| `3:117` | 🎨 Server Setup | `/server-setup` | ✅ P0（**核心差异化**） |
| `12:16326` | 🎨 Files | `/files` | ✅ **P0**（**骨干功能**——文件管理/上传/上下文菜单/权限对话框都完整画了，收回 P0） |
| `23:19917` | 🎨 System Settings | `/settings` | ⏳ **P1**（账户/安全/网页/日志/默认值 5 卡做完就上） |
| `5:2` | 🧩 Components | — | （仅供 Figma 用） |
| `8:1742` / `8:1563` | shadcn-ui-颜色 / 字体排版 | — | （参考） |
| `9:15632` | 🧩 Icon Refs | — | （设计稿） |

### 5.1 Config 页面 5 个 Tab 的细节（修正之前 PNG 截图的猜测）
设计师把 5 个 Tab 拆成 **5 张独立的 1440×900 frame 沿 y 轴排列**：
- `3:149` Config Table（默认 Commands.dat tab）
- `20:18205` Config.txt Table
- `20:18413` Workshop Tab
- `20:18621` OpenMod Tab
- `20:18829` RocketMod Tab

**实现侧建议**：要么用同一个 Page + 5 个 Frame 互斥（visible 切换）；要么存 5 张图片备查。**代码侧只实现 Commands.dat 一个 Tab 做 v1 demo，其他 4 个 v1.1 后做**。

### 5.2 Files 页面真实结构（收回 P0）

`12:16327` 是 Pages 根 frame（1440×900），子节点：

| Frame 名 | 节点 ID | x / y / 宽 / 高 | 内容 |
|---|---|---|---|
| TopBar | `21:19587` | 24/16/1132/56 | 顶部 + 标题 |
| Toolbar | `21:19588` | 24/80/1132/48 | 工具条（含 `btn-refresh 21:19685` 32×32 + 上传/新建文件夹/搜索按钮） |
| Path Bar | `21:19589` | 24/136/1132/36 | 路径面包屑 |
| File Grid | `21:19590` | 24/180/1132/656 | **主网格区——文件卡片瀑布流** |
| Status Bar | `21:19591` | 24/844/1132/32 | 底部统计（选了几个 / 总大小） |

**挂在 Page 节点 `12:16326` 上的 Dialog（设计稿可见，不嵌入运行时）**：
- `Context Menu 23:19864`（1460/100/180/242）—— 右键上下文菜单
- `PermissionsDialog 23:19865`（1660/100/440/290）—— 权限对话框

**Files P0 实现清单**：
1. 文件读取（Grid 视图，按路径递归）
2. 路径面包屑（Path Bar）
3. 工具栏按钮：刷新 / 上传 / 新建文件夹 / 搜索
4. 状态栏：选中数 / 总大小
5. **右键上下文菜单**（新建/删除/重命名/下载/复制路径）
6. **权限对话框**（从 GM-Players 调用，把 ACL 钉到这个文件）
7. 上传/下载走 GSM `chunkUpload` 模式（v1 简化版：大文件可续传 + 进度条）

**Files 是 P0 不是 P2 的三个理由**：
- **骨干交互**：玩家上传 mod 替代包、配置文件 repair、日志查 tail，没有 Files 就只能 SSH。GSM 把它放 P0 是对的，本项目也得。
- **核心差异化**：AMP/TcAdmin 都没有好用的 Web Files，Pterodactyl 还得装 sftp 子服务。空白市场在这。
- **依赖最少**：Files 页不依赖 RCON、不依赖 SteamCMD、不依赖 OpenMod。可以独立做完先上线，作为「基础服务」给其他页用（Mods 看 `Workshop/Content/`、Configs 看 `Servers/<ID>/Config.txt` 等）。

### 5.3 System Settings 页面真实结构（P1）

`23:19918` 是 Pages 根 frame，五张 Card 网格布局（2×2 + 1 行）：

| Card 名 | 节点 ID | 宽 × 高 | 内容 |
|---|---|---|---|
| 账户安全 | `23:19977` | 550 × 240 | 改密码 / 二步验证 / 登出所有设备 |
| 安全配置 | `23:19978` | 550 × 240 | 凭据加密 / 速率限制 / CSP |
| 网页设置 | `23:19979` | 550 × 160 | 主题 / 语言 / 默认页 |
| 面板日志 | `23:19980` | 550 × 160 | 日志级别 / 滚动大小 / 导出按钮 |
| 游戏默认值 | `23:19981` | 550 × 68 | 新开服时默认端口/难度/视角 |

**P1 实现清单（按设计稿优先级）**：
1. 改密码（用 Argon2id 重 hash）
2. 日志级别切换（pino level enum）
3. 主题切换（`light` / `dark` —— shadcn `next-themes` 集成）
4. 默认值写入 `data/config.json` 文件

**Settings 是 P1 不是 P0 的理由**：这些卡片**全部不阻塞 Mods / Server Setup / Files 的核心流程**。Settings 是「用得着、不紧急、还得对 UI 一遍跑一遍验证」。

---

## 6. 路由 + 多 ServerID 切分（v1 必备）

`3:134` Console v2 给了 3 个 ServerID Tab `[MyServer] [MyServer2] [MyServer3]`。**v1 路由必须能跨 ServerID 切换**：

```
/                                    → Dashboard（带 ServerID 切换器）
/:serverId/console                   → Console（顶部 Tab 切实例）
/:serverId/mods                      → Mods
/:serverId/players                   → Players
/:serverId/config/[tab]              → Config
/:serverId/server-setup              → Server Setup
```

`serverId` URL segment 改成 `+` URLSearchParams 也行，但要默认所有路由参数化。多实例是 v1 必备。

---

## 7. 与 CLAUDE.md §2.3 的对账（确认无冲突）

| CLAUDE.md §2.3 钉死的库 | Figma 上验到的 | 一致？ |
|---|---|---|
| `recharts`（图表） | Dashboard 有 Player Activity Chart + Resource Usage Chart 2 处实例 | ✅ |
| `@tanstack/react-table`（表格） | Players 用 `PlayerTable` 组件，列：Player/SteamID/Character/Ping/Online/Actions | ✅ |
| `lucide-react`（图标） | 设计稿用 emoji（🎨 ⚡ 🖥️ 等），**真正的图标**用 lucide，对应组件：如 ModCard 详情用 `Eye`、移除用 `X`、订阅用 `Plus` | ✅（需实现时映射） |
| `rcon-srcds` | Console 的连接状态指示器「Connected (OpenMod RCON 25545)」已经用上 | ✅ |
| `ws` | Dashboard 实时推送（玩家数 / Mod 数 / CPU/RAM）需要 ws 推动 | ✅ |

---

## 8. 设计令牌自动同步（CI）

下次 Figma 改动怎么同步：
1. 设计改完 → 在 Figma 选中 Components 页 → 跑 `mcp__figwright__get_variable_defs` 重新拉（如果有改）
2. 跑 `mcp__figwright__get_styles` 把 12 个 Paint Style 颜色抽样
3. 对比本文件 §1 表，把有差异的 hex 覆盖
4. PR title 建议：`design: sync tokens from Figma (YYYY-MM-DD)`

> `mcp__figwright__token_map` 可自动把 Figma 变量映射到项目 Tailwind 配置。等组件稳定、写第一个 PR 时跑一次，验证映射。

---

*本文件是 docs/architecture/ 的子文件，跟 `business-panel-architecture-2026-08-06.md` 同一棵目录。任何设计变更先改这里、再改 `tailwind.config.ts`，最后动组件代码。*
