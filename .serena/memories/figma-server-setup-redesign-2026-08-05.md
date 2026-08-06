## Server Setup 页面 Figma 改造 (2026-08-05)

### 会话目标
将 Server Setup 页面从原始设计改造为符合规范的系统化布局，修复设计问题并补全缺失交互组件。

### 已完成的改造

#### 1. 内容重构
- **移除 Tab Bar**: 删除 5 个 Tab（安装/启动停止/更新/计划任务/日志），4 张卡片直接平铺展示
- **移除文件管理器卡片**: 文件管理器将在 🎨 Files 页面单独实现
- **Header 简化**: 高度从 72px → 64px，移除了 Tab Bar 占用的空间

#### 2. 卡片布局规范化
- **内边距统一**: 所有卡片图标/文字/按钮从 x=16 → x=24，符合 24px 设计规范
- **图标标题对齐**: 所有 4 张卡片的 icon 和 title 统一为 y=24
- **背景色修正**: 5 张卡片 bg 从 #121B2E → #1E293B（设计规范 Card 颜色）
- **卡片间隙**: Row1 与 Row2 间距 16px，符合规范

#### 3. 按钮图标 Lucide 化
- 启动/停止/重启/保存按钮 emoji 替换为 Lucide 图标:
  - ▶ → icon/play (白色, 绿底)
  - ■ → icon/square (#94A3B8)
  - ↻ → icon/refresh-cw (#94A3B8)
  - 💾 → icon/save (#94A3B8)
- 图标 16×16, x=8, y=10 inside button frames

#### 4. 计划任务卡片重构为分页列表
- 列顺序: 任务名称 | 执行时间(CRON) | 通知方式 | 启用 | 操作
- 4 行数据: 每日重启/自动保存/广播通知/Workshop检查
- 启用列使用绿色 ● (#22C55E) 指示器
- 通知方式列使用下拉样式（▼ 指示器）
- 执行时间使用 CRON 表达式
- 底部添加分页栏: "显示 1-4 条，共 4 条 上一页 下一页"

#### 5. 交互弹窗补全
- **ConfirmDialog ×3**: 重装 SteamCMD/停止服务器/重启服务器
  - 位于 Content 区域右侧 (x=1460)，避免图层重叠
  - 消息文本设置 textAutoResize=HEIGHT 自动换行
  - Dialog 尺寸调整为 440×220
- **编辑计划任务 Dialog** (450×340): 任务名称+CRON时间+通知方式下拉+取消/保存
- **编辑启动命令 Dialog** (500×280): 命令输入框+取消/保存
- **SteamCMD 安装路径 Dialog** (450×200): 路径输入+取消/保存

### 关键设计规范
- 卡片: bg #1E293B, border 1px #334155, radius 8px
- 弹窗: 同卡片风格，位于 Content 区域外 (x=1460, x=1900)
- 按钮: Primary #22C55E 绿底白字, Secondary outline #334155 边框 #94A3B8 文字
- 表格: Header bg #1E293B, 行高 32px, 文字 #CBD5E1(名称)/#94A3B8(其他)

### 关键教训
- RECTANGLE 不能包含 TEXT 子元素，用 FRAME 替代或文字放在父 frame 内
- 弹窗必须置于 Content 区域外 (x>1440)，否则会与卡片重叠
- ConfirmDialog 实例默认 textAutoResize=WIDTH_AND_HEIGHT 导致长文本溢出，需改为 HEIGHT
- 移动卡片子元素时不要遗漏 StatusDot 等小元素
- batch 工具可高效执行多项写操作

**Why:** Server Setup 是 6 个核心页面之一，需要与其他已完成页面保持设计一致性
**How to apply:** 后续 Figma 修改参考此会话的弹窗布局、图标替换和表格重构模式
