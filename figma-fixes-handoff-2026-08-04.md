# Figma 设计修复交接文档（2026-08-04）

> 给接手修复 6 个 Figma 页面（48 个问题）的 worker / 会话使用
> 主对话已于 2026-08-04 完成取证 + 小修复 + 状态报告，剩余工作按此文档执行

---

## 1. 项目背景

- **项目**：Unturned Manager — Unturned Linux 专用服务器 Web 管理面板
- **当前阶段**：Figma 设计末期（6 个页面已设计 80%，代码实现尚未开始）
- **技术栈**（代码实现时）：React 18 + shadcn/ui + Tailwind / Express + SQLite / dockerode
- **Figma 设计文件**：当前页面 `🎨 Dashboard / Console / Mods / Players / Config / Server Setup` + 资源库页 `🧩 Components / Icon Refs` + 导入页 `shadcn-ui-* / Material Dashboard *`

## 2. 既有 baseline

| Page ID | 页面 | baseline PNG（取证前） |
|---|---|---|
| 2:2 / 2:59 | 🎨 Dashboard | `.figwright/screenshots/2-59.png` |
| 2:3 / 3:134 | 🎨 Console | `.figwright/screenshots/3-134.png` |
| 2:4 / 3:100 | 🎨 Mods | `.figwright/screenshots/3-100.png` |
| 2:5 / 3:144 | 🎨 Players | `.figwright/screenshots/3-144.png` |
| 2:6 / 3:149 | 🎨 Config | `.figwright/screenshots/3-149.png` |
| 3:117 / 3:118 | 🎨 Server Setup | `.figwright/screenshots/3-118.png` |

> 注：所有 page id = `x:y` 格式中，y 是 page 内的 frame 顶层 id。Node ID（如 `5:131`、`9:15255`）可直接用 figwright MCP 工具定位。

## 3. 已实施的修复（部分）

| ✓ | 改动 | 影响 |
|---|---|---|
| ✅ | StatCard 主组件 `5:31` characters：`👥  在线玩家` → `在线玩家`（移除 emoji） | 传播到所有引用该 component 的页面 |
| ✅ | Dashboard 4 个 instance 的 `Ixxx;5:31` override：分别改成 `在线玩家 / 运行时间 / 当前地图 / 已启用模组` | 仅 Dashboard 顶行 |
| ✅ | Sidebar `5:26` characters：`MyServer  ● 在线` → `MyServer · 在线`（用中点替代 emoji ●） | 全部 6 个页面（Sidebar 是 instance 同步） |

## 4. 剩余 45 个问题（按优先级排序）

### 4.1 Critical — 12 条

#### C-CON1 Console 9 个工具栏按钮全部无图标
- 节点：5:131 Toolbar 内 9:16126 (玩家) / 9:16127 (保存) / 9:16128 (广播) / 9:16129 (踢出) / 9:16130 (白天) / 9:16131 (夜晚) / 9:16132 (天气) / 9:16133 (空投) / 9:16134 (关机)
- 每个按钮是 28x70~90 frame，仅含 1 个 TEXT 节点
- 修复：在按钮 frame 内追加 lucide icon INSTANCE（16x16 stroke 白色 fill_1gax2pa）
- 选用图标：users / save / megaphone 或 radio / user-x 或 log-out / sun / moon / cloud-rain / package-open / power
- 库已有 lucide icons：`8:6365 users, 8:5635 save, 8:5521 radio, 8:5748 settings, 8:3187 chevron-down, ...` —— 部分需要的图标（sun/moon/user-x）需要 `import_svg` 或 `create_component`
- 调整：图标 x=8 y=6，文字 TEXT 移到 x=30

#### C-PLAY1 Players 表格用空格模拟列
- 节点：5:238 Player Table Card 内 9:15278~9:15290 共 10 个 TEXT 节点
- 修复方向（深度重构）：
  1. 在 Components 页面 `5:2` 下 `create_component` 新建 `PlayerRow` 主组件（H=40，含 5 列 TEXT + 3 个 icon button）
  2. Card 内 10 个 TEXT 节点删除（用 `delete_nodes`），改 10 个 `create_instance` 引用 PlayerRow
  3. 每行 instance 用 `set_text` / `set_instance_properties` 覆盖玩家名/SteamID 等

#### C-MODS1 Mods 3 张卡片标题文字与星标重叠
- 节点：5:153 / 5:154 / 5:155 Mod Cards
- 标题 TEXT（5:159 等）宽 235px 包含 `(12.3k) ID: 1753134636`
- 星标 5 个 INSTANCE x=72-132 覆盖在文字上
- 修复：
  1. 标题 TEXT 改为仅 "Hawaii"（占 0-130px）
  2. 星标 group 移到 x=140（标题右侧）
  3. `(12.3k)` + `ID:` 拆为第二行 caption TEXT y=180

#### C-MODS2 Mods 顶部"订阅模组"重复
- 节点：3:100 Mods Page 工具栏区
- 问题：`[+ 订阅模组]` 文字 + fill_c8d3jo 绿色 `+ 订阅模组` button 同时存在
- 修复：删除文字版，保留绿色 button；button 改为 lucide plus icon + 文字

#### C-MODS3 Pagination 背景白色
- 节点：10:16235 Pagination Bar，fill 是 fill_nll9eq (#FFFFFF)
- 修复：`set_fills` 改为 fill_p79bdt (#172133)

#### C-CFG1 Config.txt Section 整张卡片用字符模拟控件
- 节点：10:16226 Frame (y=628, h=250)
- 仅含 TEXT 10:16228，内容是 `[Normal▼] [✓启用] [1.0___]` 等字符
- 修复（深度重构）：
  1. 保留 title "Config.txt — 游戏玩法配置"
  2. 4×3=12 字段，每个 Label + 真组件：
     - 难度/Select / 摄像机模式/Select / 掉落倍率/Input
     - PvP/Checkbox / 友军伤害/Checkbox / 建造伤害/Checkbox
     - 昼夜周期/Checkbox / 时间流速/Input / 天气频率/Select
     - 最大载具/Input / 重生时间/Input / 饥饿速度/Select
  3. Select 组件需要 `create_component`（优先复用 shadcn-ui-组件 页面里已 import 的）
  4. 用 auto-layout HORIZONTAL 排列三列

#### C-CFG2 表单行间距仅 4px
- 节点：9:15414 Form Section (Commands.dat) 14 个 input-bg RECTANGLE
- y=48/84/120/156/192/228/264 步距 36px（input 高 32px，**gap 仅 4px**）
- 修复：
  1. 重新分配 y=48/104/160/216/272/328（**步距 56px，gap 24px**）
  2. 同步移动 9:15487~9:15500 label TEXT 和 9:15501~9:15517 值 TEXT
  3. Form Section h: 500 → 600
  4. Save Button (9:15518) y: 320 → 480

#### C-SETUP1 File Manager Card 底部超出视口 82px
- 节点：10:16231 (y=782, h=200)，y+h=982 > 900
- 修复选项：
  - A. 把 Card - File Manager y→750，h→130
  - B. 把 Content Grid `9:15561` 改为 auto-layout VERTICAL
  - 推荐 A

#### C-SETUP2 4 个 Server Setup Card 标题图标显示为空白
- 节点：9:15562 / 9:15563 / 9:15564 / 9:15565 标题 icon INSTANCE
- 截图看，4 个卡的标题图标位置显示**空白色块**
- SteamCMD 卡 `9:15566 download` icon 是好的，所以问题在 `CARD` 而非 `ICON`
- 推测：icon 的 fill_1gax2pa 用于 stroke 但 set_fills 是其它色 — 修复见 figma-redesign-session memory 中"Lucide 必设 stroke"教训
- 每张卡的 icon 需要：`set_fills` 设为空 + `set_strokes` 设为 fill_c8d3jo（绿色）

#### C-SETUP3 Server Control Card 内部按钮错位
- 节点：9:15602~9:15605 按钮 y=160（Card 9:15564 y=346 h=420）
- 修复：按钮 sticky 底部 y=720（Card bottom）

#### C-DASH2 Dashboard 资源柱状图基线错乱
- 节点：10:16220 CPU (y=130) / 10:16221 RAM (y=110) / 10:16222 NET (y=170)
- 修复：
  - 全部 y=130 起
  - CPU h=120（45%）/ RAM h=150（52%）/ NET h=90（3.2M）

#### C-CON2 Console InputBar `> _ [发送]` 是文本模拟
- 节点：5:136 TEXT (y=16, w=399)
- 修复：
  - delete_node 5:136
  - create_frame chevron-right icon (24x24, x=24, y=14)
  - create_frame input background (x=44, w=900, h=36)
  - create_frame "发送" button (x=956, w=80, h=36, fill green)

### 4.2 Warning（28 条 - 节选关键）

- W-CON2 Terminal 单 TEXT 节点（5:135）改 monospace JetBrains Mono
- W-CON3 TopBar `▌MyServer▌` 字符 → 真 Tab 组件
- W-CON4 终端状态指示 `●` 字符 → lucide-circle
- W-PLAY2 表格 header 文字重复（5:239 和 10:16200），删除 10:16200
- W-PLAY3 行高统一 40px
- W-PLAY4 搜索框 🔍 → lucide search
- W-PLAY5 下拉 ▼ → lucide chevron-down
- W-PLAY6 分页 ⟨⟩ → chevron-left/right
- W-PLAY7 状态 ●/⚠ → Badge 组件
- W-MODS4 3 卡片封面颜色一致化
- W-MODS5 More Farming 封面不可见（fill_16zfsl5 白）→ fill_sivfd0
- W-MODS6 筛选 ▼ 字符 → chevron-down
- W-MODS7 卡片之间间距统一 24px
- W-CFG3 Save Button x=0 → 居右 x=560
- W-CFG4 Workshop/OpenMod/RocketMod Tab 内容补全（按 .serena/memories/figma-redesign-session-2026-08-04.md 的"待完成"段）
- W-CFG5 label 颜色反转（label 比 input 暗是错的）
- W-CFG6 右侧 400px 空白利用
- W-SETUP2 SteamCMD 按钮底部对齐
- W-SETUP3 Scheduled Tasks Card 高度缩到 280
- W-SETUP4 `[编辑][删除]` 字符 → lucide-icon IconButton
- W-SETUP5 Update / Scheduled Tasks / Logs Tab 内容补全
- W-DASH3 环形图 75% 数字垂直居中 (y=145 → y=170)
- W-DASH4 环右侧统计贴边 (x=270 → x=290 y=110)
- W-DASH6 最近事件 emoji → lucide-icon

### 4.3 Info（6 条 - 风格统一建议）

- I-CON1 终端色 token 化
- I-MODS1 Mod 详情浮层
- I-MODS2 星级宽度
- I-CFG1 字段顺序分类
- I-PLAY1 玩家详情浮层
- I-SETUP1 日志 Tab

## 5. 关键教训（必须遵守）

1. **Lucide 图标必须用 `set_strokes`** —— `set_fills` 对 stroke-rendered 图标无效
2. **不能向 component instance 添加子元素** —— 需要 detach 或者创建独立 frame
3. **Card/StatCard/Sidebar 修改自动传播** —— 在主组件改一次即可，除非你已经 detach
4. **Sidebar 绝对不能 detach** —— 失去所有页面的导航引用
5. **修改后立即截图**（`save_screenshots`）作为 before/after 证据
6. **用 design_diff 验证批量改动** —— `mcp__figwright__design_diff`
7. **修复顺序：廉价操作先行**（set_text → set_position → delete_node → create_component）

## 6. 验收流程（来自 CLAUDE.md）

修复全部完成后必须：
1. 派 code-reviewer subagent 验证（至少 1 个，至多 3 个）
2. 验证维度：截图与修复前的 baseline 对比、像素级对齐、文字与图标的可读性、组件实例引用完整性
3. 输出验证报告，包含每个修复点的 PASS/FAIL

## 7. 关键 Figma 资源

| Resource | ID | 用途 |
|---|---|---|
| Sidebar Component | 5:29 | 导航侧栏，所有页面共用 |
| StatCard Component | 5:34 | KPI 卡片（已修复） |
| Card Component | 5:39 | 通用卡片 |
| Lucide Icons 库 | 8:2431 | 309 个 lucide 图标主组件 |
| 🧩 Icon Refs | 9:15632 | 45 个预着色图标，4 类 |
| shadcn-ui 组件 | 8:41 | 27 个组件演示，可参考样式 |
| Components 页 | 5:2 | 用户自建可复用组件 |

## 8. 当前 Figma 状态差异（与最初 baseline 相比）

- Dashboard 顶行 StatCard 文本：**已变更**（emoji 移除 + instance override 为正确名称）
- Dashboard Sidebar 文字：「MyServer · 在线」（中点，不是 emoji ●）
- 其他 4 个页面（Console/Players/Mods/Config/Server Setup）：**未做修改**

如果你（worker）立即进入修复，建议你先：
1. `navigate_to_page` 到每个页面 → `get_design_context` → `save_screenshots` 保存当前 baseline
2. 再开始修复
3. 修复一个就 design_diff 一次
4. 全部修完启动 reviewer subagent

**Why:** 避免 worker 重复取证，且明确告知当前已实施的小修复避免双重修改
**How to apply:** worker 接手时第一件事就是读这份文件
