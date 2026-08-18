# 前端 UI 动画与排版现代化规范（活参考）

> **文件作用**：UI 动画 / 排版 / 视觉层次 / 多分辨率 / 数字处理 / 组件特效参数化的活参考。所有 UI 改动对照本文件。
>
> **维护**：随 Sprint 更新；过时迁 `archive/`。
>
> **配套文档**：
> - 设计令牌：`docs/architecture/design-system-mapping.md`（颜色 / 字体 / 间距 / 圆角真源）
> - 术语对照：`claudedocs/reference_ui_terms.md`（内部术语 → 界面用语）
> - Motion 选型 ADR：`docs/adr/0001-adopt-motion-animation-library.md`

---

## 1. 设计令牌沿用（不变）

色板 / 字号阶 / 间距 / 圆角 / 字体 = `design-system-mapping.md` §1-§3。

**12 色常量**（基线 11 + 1 个文件夹 hover 变体）：sidebar `#020617` / content `#0F172A` / card `#1E293B` / border `#334059` / 主文本 `#F1F5FB` / 次级 `#94A3B8` / 弱化 `#64748B` / 在线 `#22C55E` / 危险 `#EF4444` / 警告 `#F59E0B` / 文件夹 `#3B82F6` / 文件夹 hover `#60A5FA`。

**新色值规则**：基线仍是 11 色常量；科技感装饰色（HUD 扫描线、glow 光晕、dot-matrix 网格、状态徽章变体等）允许新增，但**不与项目主题冲突**——评审标准：

| 维度 | 要求 |
|---|---|
| 色相 | 与 emerald-500 强调色 / slate 灰阶**同一色相家族**或**纯灰阶** |
| 饱和度 | 不引入高饱和警示色（避免与 11 色冲突） |
| 透明度 | 优先用 `rgba` 透明度变体而非新色（如 `rgba(16, 185, 129, 0.1)`） |
| 对比度 | 与 `#0F172A` 内容底色对比 ≥ 4.5:1（WCAG AA） |
| 入库 | 新色值入 `design-system-mapping.md` §1 色板表（含 RGB / Hex / Tailwind / 用途） |

**禁用**：emoji；额外动画库（除 §3.1 允许的 `@number-flow/react` / GSAP 外）。

---

## 2. 多分辨率字体适配

### 2.1 死板现状

全站使用固定 Tailwind 字号档（`text-xs` ~ `text-2xl`）。1440px 画布下清晰，但 1920px / 2560px（高分屏）下字号相对偏小，老玩家看着累。

### 2.2 策略

- **正文档位**（label / body / 字段值）：用 `clamp()` 或 Tailwind v4 容器查询，区间 1440-2560px 线性放大 1.0x → 1.15x
- **数字档位**（StatCard 数字、计数）：同步放大，特殊处用 `tabular-nums`
- **标题档位**（页面标题 / 卡片标题）：保持固定（避免布局跳）
- **最小字号 ≥ 12px**（无障碍下限）
- **最大字号 ≤ 32px**（避免溢出）

### 2.3 实现路线

| 路线 | 适用 | 推荐度 |
|---|---|---|
| Tailwind v4 容器查询 `@md:text-base @lg:text-lg` | 标题档 | 推荐 |
| CSS `clamp(0.875rem, 0.75rem + 0.5vw, 1rem)` | 正文档 | 推荐（更平滑） |

**两种并存**：正文用 clamp，标题用断点。

### 2.4 字号档区间表

| 角色 | 旧档（固定） | 新档（区间） | Tailwind 写法 |
|---|---|---|---|
| 页面标题 | `text-2xl` | 24-30px | `text-2xl @2xl:text-3xl` |
| 卡片标题 | `text-base` | 16-18px | `text-base @2xl:text-lg` |
| 字段标签 | `text-sm` | 14-16px | `text-sm @2xl:text-base` |
| 字段值 | `text-sm` | 14-16px | `text-sm @2xl:text-base` |
| 弱化提示 | `text-xs` | 12-14px | `text-xs @2xl:text-sm` |
| StatCard 数字 | `text-2xl` | 24-30px | `text-2xl @2xl:text-3xl` |
| 小标签徽章 | `text-[11px]` | 11-13px | `text-[11px] @2xl:text-xs` |

**Tailwind v4 断点**：`@2xl` = 1536px / `@3xl` = 1920px / `@4xl` = 2560px。

---

## 3. 动效改进（Motion v13 + 必要新库）

### 3.1 动画库选型评估

| 库 | 现状 | 适用范围 | 决策 |
|---|---|---|---|
| Motion v13（framer-motion） | 已引入（13 处用法） | 入场 / 退场 / stagger / layoutId | 继续 |
| Tailwind `animate-spin` / `animate-pulse` | 已用（Loader2 / RefreshCw / ShieldCheck） | 简单加载 | 继续 |
| **`@number-flow/react`** | 已引入（P1，数字滚动） | 数字滚动插值 | StatCard 启用 |
| **GSAP** | 未引入 | 复杂时间线（HUD 扫描线 / dot-matrix） | **P2 必要时引入** |

**推荐决策**：
- **P0-P1 用 Motion v13 + Tailwind animate 足够**（不改库）
- **P1 数字滚动** → 引入 `@number-flow/react`（比手写 Number Ticker 干净，支持 locale / decimal / tabular）
- **P2 HUD 扫描线** → 必要时引入 GSAP（DOM 性能更好，时间线 API 强）

**当前状态**（2026-08-18）：
- P0 已合入（commit 1d8f941 / c25ae7a / 7de96d1），后续 6732ca6 / 72b210b 字号抬档，b36c0af 文档收尾
- P1 已合入（cf38633 / f2378a9 / ac01e09 / ec9068b），加上本系列的 UI 修正链（82b032b / 9239858 / 556547e / 2e61db5 / 2195a83）
- P2 已合入（a770af0 / 80907cf / 55e0379）—— Button 动画档补齐 + ProgressBar 完成闪烁 + 状态徽章中文方括号 + Glow Button CTA + HUD 装饰组件上线；LdmPage 应用变更按钮 + isDirty 联动待 Phase 5 落地时按本文 §3.2 P2 表格「Glow Button CTA 接入」行接入
- P3C 已合入（Cyberpunk Neon Folder，commit f08c76a）
- P3A 已合入（资源图 System Monitor 化，commit 2f32326 后端 + 61452ca 前端）
- P3B 已合入（Status Block，commit 0c76b8c 后端 + 74dedd4 前端）

### 3.2 动效优先级（按合并 PR 整理）

#### P0（已合入）

| 区域 | 改动 | 工时 |
|---|---|---|
| Sidebar | active 条 layoutId 滑动 | 1h |
| TabBar | 填充块 layoutId 滑动（指示器样式可切换） | 1h |
| PageState | 三态 fade-in 切换（不动正常内容） | 1h |
| Dialog | 入场 scale+fade，退出 AnimatePresence；DialogShell 抽公共遮罩 | 1h |
| **多分辨率字号档** | §2 落地（贯穿全站） | 3h |

#### P1（已合入）

| 区域 | 改动 | 工时 |
|---|---|---|
| 路由切换 | App.tsx 路由层 Location keyed fade；motion.div 需 h-full 传递 viewport 高度 | 1h |
| Button | 补 hover brightness + glow variant + animation 档（press-only / glow-pulse 类型占位） | 1h |
| StatCard | status 增 `transitioning`；enableStatusIndicator（pulse / spin）+ enableNumberTicker；清除 inline hex 违规 | 3h |
| 卡片网格 | StaggerContainer 跨页面复用（4 页接入 + maxStaggeredItems 限制长列表） | 2h |
| 数字字段 mono + 千分位 | utils 加 formatNumber / formatBytes；Dashboard 端口 + ModCard 订阅数 / 评分补齐 | 2h |

**未做**（本批范围外）：
- ServerSetupPage 4 卡按使用频率重排 — 现状已与 §4.5 拍板顺序一致，工作量为 0
- mono 字段清单化剩余位置（版本号 / 文件大小 / 更多端口） — 多位置改动留给后续 sprint 专项处理
- `animation` Prop 的 `press-only` / `glow-pulse` 视觉差异 — 类型预留，渲染等同 normal（P2 扩展）

#### P2（已合入 · commit 链 a770af0 / 80907cf / 55e0379）

| 区域 | 改动 | 工时 | 落地 |
|---|---|---|---|
| Button 动画档视觉补齐 | press-only 覆盖 hover brightness；glow-pulse 仅 glow variant 生效 + 1.5s shadow 呼吸 keyframes | 0.5h | a770af0 |
| ProgressBar 完成闪烁 | `onCompleteFlash` 可选 Prop + useRef/useEffect 状态机 + 700ms filter brightness keyframes | 1h | a770af0 |
| 状态徽章中文方括号 | `formatStateBadge` 工具 + Dashboard / ServerSetupPage / ServerControlCard / ConfigPage 4 处替换 + `reference_ui_terms.md` 加豁免条目（D2 拍板：仅中文） | 1h | 80907cf |
| Glow Button CTA 接入 | ServerControlCard 启动按钮常驻 glow-pulse（D4 拍板选项 3）；ConfigPage 保存按钮 dirty 时切 glow；LdmPage 应用变更按钮待 Phase 5 落地时接入 | 2h | 80907cf |
| HUD 装饰组件 | 新建 HudDecoration（dot-matrix + emerald 扫描线 4s 循环 + prefers-reduced-motion）；Dashboard 「服务器状态」StatCard + Console 终端区域嵌入 | 4h | 55e0379 |

**决策固化**：GSAP 不引入（D1）；中文方括号（D2）；HUD 原方案（D3）；glow-pulse 智能触发（D4 选项 3）。

#### P3（全合入 · commit f08c76a / 2f32326 / 61452ca / 0c76b8c / 74dedd4）

| 区域 | 改动 | 工时 | commit |
|---|---|---|---|
| Cyberpunk Neon Folder | FilesPage 文件夹 hover 立体（克制用） | 2h | f08c76a |
| Dashboard 资源图后端 | MetricsService + `GET /api/system/metrics` | 4h | 2f32326 |
| Dashboard 资源图前端 | SystemMonitorCard + useMetrics 5s 轮询 | 2h | 61452ca |
| Status Block 后端 | IncidentsService 环形缓冲 + WS `incident_created` + ServerManager transition 集成 | 3h | 0c76b8c |
| Status Block 前端 | StatusBlock 6 类事件 + 3 档严重程度 + useIncidents WS 订阅 | 3h | 74dedd4 |

### 3.3 动效 Token（沿用 + 扩展）

| Token | 时长 | 缓动 | 用途 |
|---|---|---|---|
| card-enter | 500ms | easeOut | 卡片入场 |
| card-exit | 250ms | easeIn | 卡片出场 |
| page-transition | 200ms | easeOut | 路由切换 |
| stagger-step | 80ms | — | 列表 / 网格错位入场 |
| tab-indicator | 300ms | spring | TabBar 下划线 |
| sidebar-indicator | 300ms | spring | Sidebar active 条 |
| status-pulse | 1.5s | easeInOut loop | 在线状态点呼吸 |
| dialog-enter | 200ms | easeOut + scale 0.95→1 | 弹窗入场 |
| dialog-exit | 150ms | easeIn + scale 1→0.95 | 弹窗出场 |
| button-press | 100ms | easeOut | 按钮按下 scale 0.98 |
| button-hover | 200ms | easeOut | 按钮 hover brightness |
| number-tick | 800ms | easeOut | 数字滚动 |
| scan-line | 4s | linear loop | HUD 扫描线（GSAP） |

**全局**：`<MotionConfig reducedMotion="user">`（无障碍，ADR-0001）。

---

## 4. 排版与视觉层次

### 4.1 视觉层次（每屏 Primary 唯一）

| 档 | 用途 | 实现 |
|---|---|---|
| Primary | 每屏 1 个 | `bg-emerald-500 hover:bg-emerald-600`（Button variant="default"） |
| Secondary | 普通操作 | `bg-slate-800 text-slate-100 hover:bg-slate-700`（Button variant="secondary"） |
| Ghost | 次要操作 | `bg-transparent hover:bg-slate-800/50`（Button variant="ghost"） |
| Danger | 危险操作（停服 / 删除） | `bg-red-500 hover:bg-red-600`（Button variant="danger"） |

**每屏扫描规则**：页面渲染完成后 grep `bg-emerald-500` 只出现 1 次（在 Primary Button），其他 Button 全部 Secondary / Ghost。

### 4.2 字号阶（§2.4 已锁，跨断点区间）

### 4.3 间距节奏（统一 8 / 16 / 24 三档）

| 档 | 值 | 用途 |
|---|---|---|
| 紧凑 | 8px | 行内元素、字段组内 |
| 常规 | 16px | 卡片内组件间距、按钮组 |
| 舒展 | 24px | 卡片间距、页面主 padding |

**规则**：
- 同屏最多 3 档间距
- 外部间距 = 内部间距 × 2（卡片间距 24 / 卡内 12）
- 禁用 6 / 10 / 14 / 20 之类零碎值

### 4.4 视觉权重

- **关键数据**：大字号 + `font-mono tabular-nums` + `text-slate-100`
- **次要信息**：`text-slate-400`
- **弱化提示**：`text-slate-500`
- **状态文字**：跟随状态色（`text-emerald-500` / `text-amber-500` / `text-red-500`）

### 4.5 摆放顺序（频率优先）

| 区域 | 顺序 |
|---|---|
| DashboardPage | 标题 + 状态徽章 → 4 StatCard → 资源图 → 跳转按钮 |
| ServerSetupPage | 左栏（实例库 + 创建入口）→ 右上 4 主卡（按使用频率）→ 操作提示 |
| SettingsPage | 4 卡平级（按设计稿） |
| ConfigPage | Tab 按使用频率（Commands → Config.txt → Workshop） |
| ModsPage | 标题 + 筛选 → 网格 → 分页 |

**ServerSetupPage 4 卡按使用频率重排**：
1. SteamCMD（启动前置，最高频）
2. U3DS（启动前置，高频）
3. Server Control（启停控制，最高频）
4. Scheduled Tasks（定时任务，低频）

> ⚠️ 重排破坏 Figma 1:1 复刻，需用户拍板。

### 4.6 状态指示三件套（任选 3 / 至少 2）

| 件 | 形式 |
|---|---|
| 色点 / 图标 | 视觉信号（颜色不是唯一） |
| 文字标签 | 语义（运行中 / 已停止 / 启动中） |
| 动效 | RUNNING pulse / STARTING 旋转环 / STOPPED 静默 |

**当前缺第三件套**——已在 §3.2 P1 列入。

### 4.7 数字排版

| 字段 | 处理 |
|---|---|
| AppID、端口、版本号、路径、SteamID64 | `font-mono` |
| 文件大小、字节数 | `font-mono` + `tabular-nums` |
| 玩家数、Mod 数等大数字 | `font-mono tabular-nums` + 千分位（`formatNumber`） |
| 时间戳、日志时间 | `font-mono` |
| **命令字段**（cron、startCommand） | **`font-mono`** |

### 4.8 数字处理工具函数

| 函数 | 输入 | 输出 | 用途 |
|---|---|---|---|
| `formatNumber(n)` | 数字 | 千分位字符串 | **仅展示型**——StatCard、表格、卡片 |
| `formatDecimal(n, decimals=2)` | 数字、小数位 | 限定小数位字符串 | **输入框处理**（提交前两步小数钳制） |
| `formatBytes(n)` | 字节数 | 自适应单位（B / KB / MB / GB） | 文件大小 |

**输入框规则**：
- 输入框**不格式化千分位**——原值进、原值出
- 提交前可走 `formatDecimal(value, 2)` 限制两位小数
- 数字字段绑定受控组件，`onChange` 监听 raw 值

### 4.9 图标 + 文字

- **图标永远 + 文字**（图标独立出现缺语义）
- **例外**：TabBar 紧凑空间可只用图标
- **图标大小**：14px（按钮内）/ 16px（菜单项）/ 20px（卡片头）
- **不引入 emoji**：坚持 lucide 图标

---

## 5. 复用组件特效参数化

**核心原则**：组件 Props 接受 `variant` / `animation` 字段，不同 variant 对应不同特效，通过传参选择。

### 5.1 StatCard（重点改造）

```ts
interface StatCardProps {
  icon: LucideIcon;
  label: string;
  value: string | number;
  subtext?: string;
  /** 状态色：扩展 transitioning 用于 STARTING/STOPPING */
  status?: 'online' | 'warning' | 'danger' | 'neutral' | 'transitioning';
  /** 动效档 */
  animation?: 'subtle' | 'normal' | 'hud';
  /** 数字滚动 */
  enableNumberTicker?: boolean;
}
```

**三种特效**：
- `subtle`：默认 hover 抬升 + 边框过渡（克制）
- `normal`：subtle + 状态点 pulse / spin
- `hud`：normal + HUD 边框（dot-matrix）+ 扫描线（GSAP）

### 5.2 Button（扩展）

```ts
interface ButtonProps {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'glow';
  // ...
  animation?: 'normal' | 'press-only' | 'glow-pulse';
}
```

- `glow`：Glow Button（启动 / 保存 CTA）
- `press-only`：仅 active scale，无 hover 亮度
- `glow-pulse`：持续呼吸光晕（仅关键操作）

### 5.3 Card（扩展）

```ts
interface CardProps {
  // 现有字段
  hover?: 'none' | 'lift' | 'glow';
  animation?: 'none' | 'fade-in' | 'stagger';
}
```

### 5.4 Dialog（扩展）

```ts
interface DialogProps {
  // 现有字段
  animation?: 'fade-scale' | 'fade-only' | 'slide-up';
}
```

### 5.5 ProgressBar（扩展）

```ts
interface ProgressBarProps {
  // 现有字段
  onCompleteFlash?: boolean; // 完成时 fill 闪烁一次
}
```

### 5.6 StatusBadge（新组件）

```ts
interface StatusBadgeProps {
  state: 'RUNNING' | 'STARTING' | 'STOPPING' | 'STOPPED';
  showLabel?: boolean;
  size?: 'sm' | 'md';
}
```

色点 + 文字 + 动效三件套的标准实现，复用于 ServerSetupPage 实例列表、Dashboard、U3dsCard、ServerControlCard 等。

### 5.7 TabBar（扩展）

```ts
interface TabBarProps {
  tabs: TabItem[];
  active: string;
  onChange: (key: string) => void;
  /** 指示器样式 */
  indicatorStyle?: 'underline' | 'background' | 'pill';
}
```

### 5.8 Sidebar（active 条扩展）

```ts
interface NavItem {
  to: string;
  icon: LucideIcon;
  label: string;
  /** 指示器样式 */
  indicatorStyle?: 'left-bar' | 'background' | 'pill';
}
```

---

## 6. 信息架构（已锁 · 8 页）

```
仪表盘 → 控制台 → 配置 → 模组 → Mod 框架 → 文件 → 服务器设置 → 系统设置
```

**全局级优先**：仪表盘 / 控制台 / 文件（不依赖实例）
**实例级其次**：配置 / 模组 / Mod 框架 / 服务器设置（依赖具体实例）
**设置最末**：账户 / 安全 / 网页

---

## 7. 验收标准

### 7.1 多分辨率

- [ ] 1440px / 1920px / 2560px 三档视口下字号成比例放大
- [ ] 最小字号 ≥ 12px，最大字号 ≤ 32px

### 7.2 动效

- [ ] 路由切换有 fade 过渡
- [ ] TabBar 切换时下划线 layoutId 滑动
- [ ] Sidebar active 条 layoutId 滑动
- [ ] PageState 三态 fade-in 切换
- [ ] Dialog 入场 / 退场 fade + scale
- [ ] StatCard：状态指示三件套（色点 + 文字 + pulse / spin / 静默）
- [ ] StatCard：数字变化时插值滚动（`@number-flow/react`）
- [ ] 卡片网格 stagger 入场

### 7.3 排版

- [ ] 全站每个屏只有 1 个 Primary 按钮
- [ ] 数字字段统一 `font-mono tabular-nums`
- [ ] mono 字段清单覆盖 AppID / 端口 / 路径 / SteamID64 / 文件大小 / 版本号 / 日志时间 / 命令字段
- [ ] 数字输入框**不格式化千分位**，两位小数
- [ ] 间距节奏统一 8 / 16 / 24 三档
- [ ] `formatNumber` 千分位工具函数就绪

### 7.4 组件参数化

- [ ] StatCard / Button / Card / Dialog / ProgressBar / StatusBadge / TabBar / Sidebar Props 支持特效参数化
- [ ] 每个组件至少 2 种 variant

### 7.5 约束

- [ ] 新色值（如果引入）评审通过：与项目主题不冲突 + 入 `design-system-mapping.md` §1
- [ ] 不引入 emoji
- [ ] 引入 `@number-flow/react` 数字滚动（如 P1 落地）
- [ ] 必要时引入 GSAP 做 HUD 扫描线（如 P2 落地）
- [ ] 不引入其他动画库
- [ ] 不破坏 xterm 控制台渲染

### 7.6 验证门槛

- [ ] 前端 typecheck 0
- [ ] 前端 vitest 全绿
- [ ] 前端 e2e 关键路径跑通
- [ ] Storybook 每个变体一个故事
- [ ] 后端 typecheck / 单测天然不变（见 §8 开发边界）

---

## 8. 开发边界

### 8.1 不动范围

| 范围 | 原因 |
|---|---|
| `manager-server/src/**` | 本次仅前端改造，后端零改动 |
| `shared/schemas/**` | API 契约冻结 |
| `shared/contracts/**` | API 契约冻结 |
| `shared/types/**` | 前后端共享类型冻结 |
| `docs/architecture/architecture-spec.md` 后端模块边界 | 范围外 |
| `.research/**` | 钉死只读 |

### 8.2 允许新建

| 类型 | 位置 | 触发条件 |
|---|---|---|
| 跨页面复用组件 | `manager-web/src/components/shared/` | 同一 JSX 模式出现 ≥3 次（component-abstraction.md 铁律 ①） |
| 单页面专属组件 | `manager-web/src/components/<feature>/` | 仅当前页面用，但代码量 ≥50 行 |
| 通用工具函数 | `manager-web/src/lib/utils.ts` | 通用格式化 / 校验 / 转换 |
| shadcn/ui 包装扩展 | `manager-web/src/components/ui/` | 新增 shadcn 组件时；保持与原版 API 兼容 |

### 8.3 不允许

- ❌ 改后端任何文件
- ❌ 改 API 契约（即便前端调用更顺手）
- ❌ 改 `.research/` 任何文件
- ❌ 改 Figma 设计稿（动效叠加在现有 UI 上，不重做设计）

---

## 9. 下一步

- 检查 `docs/architecture/design-system-mapping.md` 是否与 §1 配色与字号档同步更新
- mono 字段剩余位置（版本号 / 文件大小 / 更多端口）留待后续 sprint 专项处理
- P2 / P3 持续推进

---

*创建日期：2026-08-17 · UI 动画现代化调研（/sc:brainstorm 输出）*
*更新：2026-08-18 · P0/P1 实施状态合入 + 章节编号修正*