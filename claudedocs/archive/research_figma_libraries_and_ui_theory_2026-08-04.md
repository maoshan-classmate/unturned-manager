# Figma 组件库 & UI 视觉设计理论研究

> 日期：2026-08-04
> 阶段：`/sc:research` — 纯调研，不做实现
> 目标：为 Unturned Manager 设计面板推荐 Figma 组件库 + UI 视觉设计理论知识应用方案

---

## 一、Figma 社区推荐组件库

### 1.1 必装（与项目技术栈完美匹配）

#### 🥇 shadcn/ui Design System — Pietro Schirano
| 属性 | 详情 |
|---|---|
| **Figma 地址** | `@shadcn/ui - Design System` (搜索 "shadcn/ui design system Pietro Schirano") |
| **价格** | **完全免费** |
| **人气** | 17.6k likes / 353k users |
| **暗色模式** | ✅ 有 |
| **匹配度** | ⭐⭐⭐⭐⭐ — 跟我们项目使用的 React shadcn/ui 组件 **完全一致** |

> 每个组件都在 Figma 中精心还原了代码实现。Button、Card、Table、Dialog、Tabs、Dropdown、Input 等所有 shadcn 组件都有对应的 Figma 版本。

#### 🥈 shadcn/ui Components with Variables — Sitsiilia Bergmann
| 属性 | 详情 |
|---|---|
| **Figma 地址** | `shadcn/ui components with variables & Tailwind classes` |
| **价格** | **完全免费** |
| **暗色模式** | ✅ 有（通过 Radix Colors + Tailwind 变量） |
| **更新** | 持续更新（最后 2026-01） |
| **匹配度** | ⭐⭐⭐⭐⭐ — 带 Tailwind 类名 + CSS 变量 |

> 包含 Dark/Light 双模式、Radix 色彩系统、Figma Variables、Lucide 图标、Phosphor 图标、Remix 图标。组件含动画。还有配套的 Figma Plugin 用于快速切换主题/图标/圆角/字体。

---

### 1.2 强烈推荐（暗色 Dashboard 专用）

#### 🥉 Flowbite Design System
| 属性 | 详情 |
|---|---|
| **Figma 地址** | `flowbite-design-system` |
| **价格** | **免费**（Pro 版付费） |
| **暗色模式** | ✅ 有 |
| **特点** | Auto Layout + 变体 + Tailwind CSS 无缝集成 |
| **匹配度** | ⭐⭐⭐⭐ — Tailwind 原生，和我们的 CSS 框架一致 |

> 开源组件集合，含变体、Auto Layout、暗色模式、示例页面、样式指南。有配套 MCP Server（Figma → Code AI 转换）。

#### 🏅 Untitled UI FREE
| 属性 | 详情 |
|---|---|
| **Figma 地址** | `❖ Untitled UI – FREE Figma UI kit and design system v2.0` |
| **价格** | **免费**（PRO $129 买断） |
| **人气** | 15.7k likes / 342k users |
| **暗色模式** | ⚠️ 免费版无暗色变量（PRO 版有） |
| **组件量** | 350+ styles, 基础组件, 420+ 页面示例 |

> 全球最大的 Figma UI Kit。免费版虽不含暗色变量，但组件质量极高，结构和 Auto Layout 是最佳实践参考。**主要用作布局/间距/组件结构参考，非直接复用。**

---

### 1.3 可选补充

| 名称 | Figma 地址 | 价格 | 亮点 |
|---|---|---|---|
| **Ant Design** | `Ant Design Open Source` | 免费 | 企业级表格/表单, 351k users |
| **Preline UI** | `Preline UI Figma` | 免费 | 5000+ 组件, Tailwind CSS |
| **Eva Design System** | `Eva Design System` | 免费 | 自动主题切换引擎 |
| **Material Dashboard Shadcn** | `material-dashboard-shadcn-free-admin-template` | 免费 | 成品 Dashboard 布局 |
| **Nile Dashboard Dark** | `Nile Dashboard & Design System - Dark` | 免费 | 专为暗色主题设计 |
| **59 Charts UI** | `59 Charts UI Responsive Components` | 免费 | 适配 recharts/chart.js 的图表组件 |
| **HeroUI Figma Kit** | `HeroUI Figma Kit (Community)` | 免费 | 103k users, Next.js 生态 |

---

### 1.4 推荐添加顺序

```
1️⃣ shadcn/ui Design System (Pietro Schirano)     ← 最高优先级
2️⃣ shadcn/ui Components with Variables (Sitsiilia) ← 最高优先级
3️⃣ Flowbite Design System                         ← 仪表板组件补充
4️⃣ Untitled UI FREE                               ← 布局/间距参考
5️⃣ Material Dashboard Shadcn                       ← 仪表板灵感
6️⃣ 59 Charts UI                                   ← 图表组件（匹配 recharts）
7️⃣ Ant Design Open Source                         ← 表格/表单增强
8️⃣ Preline UI Figma                               ← 备选组件库
```

---

## 二、UI 视觉设计理论知识 & 应用方案

### 2.1 暗色主题色彩原则

#### ❌ 避免的错误
| 错误 | 问题 | 正确做法 |
|---|---|---|
| 纯黑背景 `#000000` | 缺乏深度，过于刺眼 | 使用暗灰 `#0F172A` |
| 纯白文字 `#FFFFFF` | 产生光晕效应，眼疲劳 | 使用灰白 `#F1F5F9` |
| 高饱和度颜色 | 在暗色上过于刺眼 | 降低饱和度~20% |
| 用阴影表示层级 | 暗色中阴影不可见 | 用亮度差表示层级 |
| 直接套用亮色模式设计 | 对比度和层级混乱 | 为暗色单独设计 |

#### ✅ 我们的色板应用方案

```
Elevation 层级（由深到浅 = 由低到高）：
┌─────────────────────────────────────────────┐
│ Level 0: #020617  Sidebar 背景               │ ← 最底层
│ Level 1: #0F172A  Content 背景               │
│ Level 2: #1E293B  Card 表面                  │
│ Level 3: #334155  Card hover / 弹窗          │ ← 最顶层
├─────────────────────────────────────────────┤
│ Text Primary:   #F1F5F9  (WCAG AAA 12.6:1)  │
│ Text Secondary: #94A3B8  (WCAG AA 5.2:1)    │
│ Text Muted:     #64748B  (WCAG AA 4.6:1)    │
├─────────────────────────────────────────────┤
│ Accent:         #22C55E  (green-500)         │
│ Accent Hover:   #16A34A  (green-600)         │
│ Status Online:  #22C55E                      │
│ Status Warning: #F59E0B                      │
│ Status Danger:  #EF4444                      │
└─────────────────────────────────────────────┘
```

### 2.2 间距系统 — 8px 软网格

**选择 8px 基础网格 + 4px 半步长的理由：**
- 8px 是业界标准（Material Design、Ant Design、shadcn/ui 全部遵循）
- 多数屏幕分辨率可被 8 整除
- 视觉节奏感强，开发者友好
- 4px 半步长用于精细间距（图标、小文字）

#### 间距尺度表

| Token | 值 | 用途 |
|---|---|---|
| `space-1` | 4px | 图标与文字间距，紧密元素 |
| `space-2` | 8px | 同组元素间距 |
| `space-3` | 12px | 标签与输入框 |
| `space-4` | 16px | Card 内边距，按钮间距 |
| `space-5` | 20px | （半步长，特殊场景） |
| `space-6` | 24px | Section 大边距，页面 padding |
| `space-8` | 32px | Card 间距 |
| `space-10` | 40px | 大区块间距 |
| `space-12` | 48px | 页面顶部留白 |
| `space-16` | 64px | Hero 区域间距 |

#### 应用到当前 Figma 设计

```
当前问题：
- Dashboard 内容区 padding: 24px ✅ 正确
- Card 之间间距: 16px ✅ 正确
- Card 内部 padding: 需统一为 16px
- TopBar 高度: 64px → 改为 56px（7×8）
- Sidebar 宽度: 260px → 改为 256px（32×8）或保持 264px（33×8 但好看）
```

### 2.3 排版系统

#### 字体层级（基于 Inter，匹配 shadcn/ui）

| Level | Size | Weight | Line Height | 用途 |
|---|---|---|---|---|
| **h1** | 30px | Bold (700) | 40px | 页面标题 |
| **h2** | 24px | SemiBold (600) | 32px | Section 标题 |
| **h3** | 20px | SemiBold (600) | 28px | Card 标题 |
| **h4** | 16px | SemiBold (600) | 24px | 小标题 |
| **body-lg** | 16px | Regular (400) | 24px | 正文大字 |
| **body** | 14px | Regular (400) | 20px | 正文 |
| **body-sm** | 13px | Regular (400) | 18px | 次要文字 |
| **caption** | 12px | Regular (400) | 16px | 辅助信息 |
| **mono** | 13px | Regular (400) | 20px | 控制台/代码 |

#### 排版关键原则

1. **行高至少 1.4×** — 暗色背景上过小的行高导致文字拥挤
2. **字重不要太细** — Regular (400) 是最低标准，不要在暗色背景上用 Light (300)
3. **斜体慎用** — 暗色模式中斜体识别度下降
4. **文字层级 ≤4 层** — 超过 4 层用户无法区分

### 2.4 视觉层级最佳实践

#### F 型扫描模式

```
用户浏览 Dashboard 的视线路径：
┌──────────────────────────────────────┐
│ ① TopBar / 页面标题          ← 第一眼 │
├───────────┬──────────────────────────┤
│ ② Sidebar │ ③ 左上角 KPI Card  ← 第二眼│
│  导航     │ ④ 右侧 KPI Cards          │
│           │ ⑤ 下方图表区域     ← 第三眼│
│           │ ⑥ 底部操作区              │
└───────────┴──────────────────────────┘
```

#### 应用到我们的页面

| 页面 | 最重要元素位置 | 推荐调整 |
|---|---|---|
| Dashboard | StatCards 顶行 | ✅ 已正确放置 |
| Console | 终端输出区 | ✅ 终端占最大面积 |
| Players | 玩家表格 | ✅ 表格为主体 |
| Mods | Mod 卡片网格 | ⚠️ 可加大卡片预览图 |
| Config | 表单字段 | ⚠️ 可增加分组卡片 |
| Server Setup | 服务器状态卡片 | ✅ 状态在顶部 |

### 2.5 Card 设计模式

#### 标准 Card 结构（shadcn/ui Card 映射）

```
┌─ Card (rounded-lg = 8px, bg-card, border) ─┐
│ ┌─ CardHeader ────────────────────────────┐ │
│ │  Title (h3)          [Action Button]    │ │
│ │  Description (body-sm, text-secondary)  │ │
│ └─────────────────────────────────────────┘ │
│ ┌─ CardContent ──────────────────────────┐ │
│ │                                         │ │
│ │  Charts / Tables / Forms / Metrics      │ │
│ │                                         │ │
│ └─────────────────────────────────────────┘ │
│ ┌─ CardFooter (可选) ────────────────────┐ │
│ │  Pagination / Summary / Actions        │ │
│ └─────────────────────────────────────────┘ │
└─────────────────────────────────────────────┘
```

#### Card 设计规则
- Card 内部 padding: **16px** (space-4) 或 **24px** (space-6) 用于大卡片
- Card 之间的 gap: **16px** (space-4)
- Header 与 Content 之间存在 divider 时：divider 高度 1px，颜色 `border/default`
- 圆角统一: **8px** (rounded-lg)
- 边框: 1px solid `border/default`

### 2.6 数据可视化原则

#### 图表配色（暗色主题专用）

```
不要用亮色模式的默认配色。为暗色背景重新设计：

✅ Do:
- 亮色线条 + 半透明填充（折线图）
- 去饱和度的配色（柱状图）
- 网格线极度淡化（opacity 0.06）

❌ Don't:
- 直接用亮色模式调色板
- 深色线条（暗背景上看不见）
- 实色大面积填充（太沉重）
```

### 2.7 微交互和状态反馈

#### 组件状态（应用到 Figma 组件变体）

| 组件 | 需要覆盖的状态 |
|---|---|
| Button | Default, Hover, Active, Disabled, Loading |
| Input | Default, Focus, Error, Disabled, Filled |
| Table Row | Default, Hover, Selected |
| Badge | Online, Warning, Offline, Error |
| Card | Default, Hover (elevated) |
| Nav Item | Active, Inactive, Hover |

### 2.8 游戏管理面板特有的设计考量

#### Unturned 军事生存风格元素
1. **军事化数据表达** — 数字大且清晰，如军用仪表盘
2. **状态指示灯** — 红/绿/黄，像控制台面板
3. **终端美学** — Console 页面保留经典黑底绿字
4. **低多边形感** — Unturned 本身的 low-poly 风格可延伸到 UI（简化几何、硬边角）
5. **功能优先** — 游戏服务器管理不需要花哨动画，功能性和响应速度优先

#### 中文化设计注意事项
- 中文字符宽度约为英文 2×，在表格和卡片中预留空间
- 行高要适当增加（中文字符更高）
- 数字和单位保持英文（32ms / 3h 12m）更清晰
- 混合排版注意对齐

---

## 三、具体应用到当前 Figma 的改进计划

### 3.1 立即可做的改进

| # | 改进项 | 理论依据 | 预期效果 |
|---|---|---|---|
| 1 | Sidebar 宽 260→256px（32×8） | 8px 网格对齐 | 视觉更规整 |
| 2 | TopBar 高 64→56px（7×8） | 8px 网格对齐 | 节省垂直空间 |
| 3 | Card 间统一 16px gap | 8px 间距系统 | 节奏感一致 |
| 4 | Card 内统一 24px padding | 间距层级 | 呼吸感 |
| 5 | 增加 Card 的 1px border | Elevation 表达 | 暗色中区分卡片边界 |
| 6 | 按钮高度统一 36px（h-9） | shadcn/ui 规范 | 与代码对齐 |
| 7 | 输入框高度统一 36px | shadcn/ui 规范 | 与代码对齐 |
| 8 | 表格行高 40px | 可读性 | 数据更清晰 |
| 9 | 导航项间距统一 40px | 8px 网格 | 节奏感 |
| 10 | 正文行高 ≥ 1.4 | 暗色可读性 | 文字更舒适 |

### 3.2 等待组件库导入后可做的改进

- 替换自定义组件为 shadcn/ui Figma 组件实例
- 使用组件变体覆盖所有交互状态
- 应用 Figma Variables 管理暗色主题 token
- 创建响应式 Auto Layout 布局

---

## 四、信息来源

| # | 来源 | 内容 |
|---|---|---|
| 1 | Figma Community UI Kits | 4,770+ 免费 UI Kit 浏览 |
| 2 | untitledui.com | Untitled UI 定价和功能对比 |
| 3 | glowui.com/blog/figma-ui-kits | 12 款 Figma UI Kit 横评 |
| 4 | ui.shadcn.com/docs/figma | shadcn/ui 官方 Figma 推荐 |
| 5 | tailadmin.com/blog/figma-dashboard-ui-kits | 7 款 Figma Dashboard 横评 |
| 6 | toptal.com/designers/ui/dark-ui-design | Toptal 暗色 UI 设计原则 |
| 7 | xmethod.de/blog/dark-theme-ux | 暗色 UX 最佳实践 |
| 8 | qodequay.com/dark-mode-dashboards | 暗色 Dashboard 设计原则 |
| 9 | adminlte.io/blog/dark-dashboard-templates | 19 款暗色 Dashboard 设计 |
| 10 | uxplanet.org (8pt grid system) | 8点网格系统详解 |
| 11 | designsystems.com (space, grids, layouts) | 空间系统和布局 |
| 12 | artofstyleframe.com (visual hierarchy) | 视觉层级 7 原则 |
| 13 | eleken.co/blog-posts/dark-mode-ui | 暗色 UI 原则 + 5 真实案例 |
| 14 | wrappixel.com/blog/best-dark-mode-dashboard | 30+ 暗色 Dashboard 模板 |
| 15 | uxdesign.cc (dark UI design principles) | 暗色 UI 设计原则 |
