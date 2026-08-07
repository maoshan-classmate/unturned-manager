# 页面 Figma 1:1 复刻工作流

## Phase 1: ConsolePage (2:3)

### Figma 设计要素
- 顶部 ServerTabBar（多服务器切换标签，当前激活高亮 emerald）
- ConsoleToolbar：一排预设命令按钮（Say/Save/Players/Kick/Day/Night/Shutdown/Help），等宽排列
- ConsoleOutput：黑色终端背景，等宽字体，ANSI 着色行，虚拟滚动
- ConsoleInput：底部固定输入栏，前缀 `>`，发送按钮，↑↓翻历史
- WebSocket 连接状态指示器（绿点/红点）

### 当前页面差距
- ❌ 命令按钮排列不够紧凑（Figma 是等宽 Toolbar 非独立按钮）
- ❌ 输出区域没有 ANSI 语法高亮着色
- ❌ 缺少 ServerTabBar 多服切换
- ❌ 输入栏和发送按钮样式不对

### 实施步骤
1. 重写 Toolbar：等宽按钮组，active 状态 emerald 高亮
2. 添加 ANSI 着色解析（\x1b[颜色]m → 对应 CSS color）
3. 输入栏改为 Figma 样式（圆角输入框 + 发送按钮并排）
4. WS 状态指示器（connected 绿点/disconnected 红点）
5. 虚拟滚动 react-window（大日志量性能）

---

## Phase 2: PlayersPage (2:5)

### Figma 设计要素
- 标题栏 "Players" + 在线计数 badge（emerald 底色）
- 搜索框（右侧）
- 表格列：Player（头像+名字）、Steam ID、Character、Ping、Online、Actions
- 玩家行：圆形头像首字母、SteamID 等宽字体、Ping 彩色 badge（绿<80/黄>80/红>150）、Online 绿点 badge、Kick/Ban 按钮
- 空态：居中图标 + "暂无在线玩家"
- 刷新按钮

### 当前页面差距
- ❌ 表头样式不匹配
- ❌ Ping badge 缺少红黄绿分色
- ❌ 玩家行缺少 Online badge
- ❌ Actions 按钮样式不对（应该更紧凑）
- ❌ 搜索框和刷新按钮位置与 Figma 不一致

### 实施步骤
1. 表头改为 Figma 样式（slate 底色、分割线）
2. Ping 三色 badge（<80 绿 / 80-150 黄 / >150 红）
3. 添加 Online badge（绿点+文字）
4. Actions 按钮改为紧凑 icon-only + tooltip
5. 调整搜索框和刷新按钮位置

---

## Phase 3: ServerSetupPage (3:117)

### Figma 设计要素
- Tab 切换：实例管理 / SteamCMD / 更新
- 实例管理 Tab：Server 卡片列表（名称+状态+端口+操作按钮）
- SteamCMD Tab：安装状态（路径+版本+最后检查时间）+ 安装/更新按钮
- 更新 Tab：app_update 按钮 + 日志输出
- 创建服务器表单：ServerID/名称/端口/Owner SteamID/安装目录/RCON 密码
- 状态指示灯：绿（运行中）/ 黄（启动中/停止中）/ 红（降级）/ 灰（已停止）

### 当前页面差距
- ❌ 创建表单布局松散
- ❌ 服务器卡片缺少详细信息展示
- ❌ SteamCMD 状态卡片缺少版本号和最后检查时间
- ❌ 更新 Tab 缺少日志输出区域
- ❌ 按钮和表单字段间距不统一

### 实施步骤
1. 创建表单改为 Figma 布局（6 字段紧凑排列）
2. 服务器卡片添加详细信息行（安装路径、RCON 端口）
3. SteamCMD 状态卡片补充版本号 + 最后检查时间
4. 更新 Tab 添加 mock 日志输出区
5. 统一间距和圆角

---

## Phase 4: SettingsPage (23:19917)

### Figma 设计要素
- 5 张 Card 网格布局（2 列 × 3 行）
- 每张 Card：icon（emerald）+ 标题 + 内容行（标签:值格式）
- 账户安全 Card：3 个密码输入框 + 修改密码按钮
- 安全配置 Card：凭据加密/JWT 有效期/密码哈希/速率限制（只读展示）
- 网页设置 Card：主题/语言/默认页（只读展示）
- 面板日志 Card：日志级别/滚动/输出格式（只读展示）
- 游戏默认值 Card：8 个只读字段 2×4 网格

### 当前页面差距
- ❌ 卡片内间距不统一
- ❌ 游戏默认值 Card 字段太多太密
- ❌ 缺少统一的 label:value 排版
- ❌ 密码输入框没有眼图标切换

### 实施步骤
1. 统一所有 Card 内部为 Figma 布局
2. 游戏默认值 Card 改为 2×4 网格
3. 只读字段改为统一的 "标签: 值" 格式
4. 密码输入框复用 PasswordInput 组件

---

## 验证

每完成一个页面：
1. typecheck 零错误
2. Playwright 截图对比 Figma
3. 零 JS 错误
4. 所有交互状态正常

## 执行顺序

```
1. ConsolePage（独立，无依赖）
2. PlayersPage（独立，无依赖）
3. ServerSetupPage（独立，无依赖）
4. SettingsPage（独立，无依赖）
```

四个页面可并行开发，无相互依赖。
