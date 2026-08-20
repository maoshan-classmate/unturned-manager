# UI 动画与排版现代化 /sc:brainstorm（2026-08-17）

## 触发与边界

用户感受「前端页面死板没用动画」，走 /sc:brainstorm（仅记录，不实现）。8 轮交互后产出 `claudedocs/reference_ui_animation.md` 活参考。下一步走 `/sc:design` 规格细化，再走 `/sc:workflow` 拆 4 个 PR。

## 调研阶段

### 现状摸底
- Motion 用量 13 处，仅 LoginPage（12 处）+ ItemListDialog（1 处）真正用了 `motion/react`——其他 30+ 文件 0 处使用
- 全靠 Tailwind `transition-colors` / `animate-spin` / `animate-pulse`
- shadcn Dialog 无内建动画（`if (!open) return null`）
- TabBar 静态 background 切换无 layoutId
- StatCard / Card / PageState / 路由切换全无动效
- Toast 走 sonner（默认有动画）✅

### 21st 组件参考（25+ 组件，按类归档）
- A 状态/指标/数据流：System Status Block / System Monitor / Real time Analytics / HUD Area Chart / Data Stream / Live Feed / Animated Download
- B 导航/路由过渡：Animated Sidebar / Motion Navigation Menu / Vertical Tabs / Fade Slide Tabs / Slide Tabs / Transition Panel
- C 视觉冲击（克制用）：Glowing Button / Glow Button / Glow Effect / Cyberpunk Neon Folder / Neural Access Login
- D 数字/计数器：Number Ticker Real-Time / Number Ticker / Count Animation

## 9 项用户决策（落 reference_ui_animation.md §1）

| # | 决策 |
|---|---|
| 1 | 当前会话仅记录，不实现（/sc:brainstorm 边界） |
| 2 | 按 Figma 最新 UI 设计，ServerSetupPage 4 卡按使用频率重排允许 |
| 3 | 数字输入框不要千分位，两位小数（`formatDecimal(value, 2)`） |
| 4 | mono 字段清单**包含**命令字段（cron、startCommand） |
| 5 | 状态第三件套动效与 P1 动效**合并 PR** |
| 6 | 允许引入新动画依赖库（Motion v13 不满足时引入 `@number-flow/react` / GSAP） |
| 7 | 复用组件支持多特效 + 传参切换（8 组件 Props 化） |
| 8 | 本文档作为活参考持久化（落 `claudedocs/reference_ui_animation.md`） |
| 9 | 新色值可添加，不与项目主题冲突即可（5 维度评审标准） |

## 文档9 章核心

1. 用户决策（9 条拍板项）
2. 设计令牌沿用（9 色常量不变 + 新色值 5 维度评审标准）
3. **多分辨率字体适配（新决策 · P0）**——1440/1920/2560 区间放大 1.0-1.15x；正文用 clamp，标题用断点；7 档字号区间表
4. 动效改进（Motion v13 + `@number-flow/react` + GSAP 选型 + P0-P3 四批 13 项 + 13 个动效 Token）
5. 排版与视觉层次（Primary 唯一 / 字号阶 / 间距三档 / 视觉权重 / 摆放顺序 / 状态三件套 / 数字处理 / 图标+文字）
6. **复用组件特效参数化（用户决策#7 落地）** —— StatCard / Button / Card / Dialog / ProgressBar / StatusBadge / TabBar / Sidebar 8 组件 Props 完整定义
7. 信息架构（已锁 · 8 页）
8. 验收标准（6 大类 · 30+ 项）
9. 下一步（`/sc:design` + `/sc:workflow` 拆 4 个 PR）

## 4 批 PR 拆分

- **PR1**（P0）：Sidebar layoutId + TabBar layoutId + PageState fade + Dialog fade-scale + 多分辨率字号档（工时 ~7h）
- **PR2**（P1）：路由 fade + Button 反馈 + StatCard 三件套 + Number Ticker + stagger + 4 卡重排 + mono 字段（工时 ~10.5h）
- **PR3**（P2）：Glow Button + ProgressBar flash + HUD 装饰（dot-matrix / 扫描线，GSAP）（工时 ~8h）
- **PR4**（P3）：Dashboard System Monitor + Status Block + Cyberpunk Folder（工时 ~14h）

## 关键交付物

- **活参考**：`D:\unturned-manager\claudedocs\reference_ui_animation.md`
- 配套：`docs/architecture/design-system-mapping.md` §1（色板真源）+ `claudedocs/reference_ui_terms.md` + `docs/adr/0001-adopt-motion-animation-library.md`

## 下一步（不在本会话范围）

下一会话 `/sc:design`：
1. 每个变体组件的完整 Props 定义 + JSDoc
2. 每个动效的精确时长 / 缓动 / 触发条件
3. 多分辨率断点的 SCSS / Tailwind 配置
4. Storybook 故事清单

Why: UI 动画现代化的完整需求沉淀，便于后续 /sc:design + /sc:workflow 接续
How to apply: 涉及 UI 动效 / 排版 / 多分辨率 / 组件特效参数化时先读 `reference_ui_animation.md`