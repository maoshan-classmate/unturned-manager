## 2026-08-04 Figma 设计改造会话总结

### 会话目标
将 Unturned Manager 的 6 个 Figma 设计页面进行系统性改造：统一暗色主题、用 Lucide 图标替换 emoji、对齐 8px 网格间距、建立可复用组件体系。

### 完成的核心工作

#### 1. 颜色体系修正
- 全局文字色 `#000000→#F1F5F9`（主）/ `#94A3B8`（次要）
- 暗色主题 Elevation：Sidebar `#020617` → Content `#0F172A` → Card `#1E293B`
- 修复所有页面中的白色背景（`#FFFFFF`）改为暗色
- Card 边框: 1px `#334155` 替代阴影表示层级

#### 2. 图标系统
- 从 shadcn/ui 导入 877 个 Lucide 图标，清理保留 309 个
- 关键教训：Lucide 图标通过 Vector stroke 渲染，必须用 `set_strokes` 设置颜色，`set_fills` 无效
- 修复：所有图标 `fill.visible=false`，仅通过 stroke 渲染
- 建立 🧩 Icon Refs 页面：45 个预着色图标，4 个分类（Navigation/Action/Status/Server）

#### 3. 8px 网格间距系统
- 页面内容 padding: 24px
- Card 内部 padding: 24px
- Card 间距: 16px
- Section 间距: 48px (Components 页面)

#### 4. 组件体系（🧩 Components 页面 5:2）
- Sidebar (260×900) — 6 页面实例引用，导航侧边栏
- StatCard (271×112) — 24px 内边距
- Card (560×300) — 24px 内边距，标题+分割线+内容
- Button 变体组 — Primary/Secondary/Danger/Ghost
- Badge 变体组 — Online/Warning/Offline
- SearchInput — 搜索输入框（暗色bg+边框）
- Pagination — 分页导航
- FilterDropdown — 筛选下拉

#### 5. 6 页面改造详情
- Dashboard: 环形图(75%)+柱状图(CPU/RAM/NET)，卡片右边缘统一 1156px，Quick Actions 按钮
- Console: 工具栏 9 按钮中文化，终端格式优化，Sidebar 从 detach 修复为实例
- Players: 搜索框+下拉组件化，操作图标标注"私信/禁言/踢出"，斑马纹表格行
- Mods: 星级评分（4实心琥珀+1空心灰），筛选栏，分页栏，文字换行修复
- Config: Commands.dat + Config.txt 双 Tab 表单，输入框背景，Tab 白色修复
- Server Setup: 自定义启动命令输入框，文件管理器入口卡片，绿点位置修复

#### 6. 导入的资源库（只读参考）
- shadcn-ui-组件 (8:41): 27 个组件演示
- shadcn-ui-字体排版 (8:1563): Inter 排版层级（h1-h4/p/small/subtle）
- shadcn-ui-颜色 (8:1742): Slate 色板 + 语义色
- shadcn-ui-Primitives (8:1826): 基础图元
- shadcn-ui-图标 (8:2431): 309 个 Lucide 图标
- Material Dashboard ×4: Pages (8:7070), Tables (8:10494), Pagination (8:12003), Charts (8:12152)

### 关键设计规范
- 排版: h1 30px Semi Bold / h2 24px / h3 20px / body 14px / caption 12px (Inter)
- 强调色: `#22C55E` (green-500)
- 文字: primary `#F1F5F9`, secondary `#94A3B8`, muted `#64748B`
- 状态: online `#22C55E`, warning `#F59E0B`, danger `#EF4444`
- 按钮: 36px 高, 6px 圆角, green filled / outline border / ghost

### 已知问题和坑
1. **Lucide 图标必须用 set_strokes**：不能只用 set_fills
2. **Agent 创建 frame 默认放在当前活跃页面**：必须先 navigate_to_page
3. **不能向组件实例添加子元素**：需要 detach 或者创建独立 frame
4. **Card 和 StatCard 修改会自动传播到所有页面实例**
5. **Sidebar 绝对不能 detach**：否则失去组件引用

### 待完成
- Config: Workshop/OpenMod/RocketMod Tab 内容
- Server Setup: 更新/计划任务/日志 Tab 内容
- Mods: 详情浮层，Elver 和 More Farming 的星级修复
- Players: 详情浮层
- 文件资源管理器完整实现（目录树+文件列表+编辑器）

**Why:** 系统性 UI 改造，将散乱的 emoji 文本设计升级为专业的组件化暗色主题
**How to apply:** 后续 Figma 工作参考 Components 页面组件和上述设计规范
