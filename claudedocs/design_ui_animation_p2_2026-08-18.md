# UI 动画 P2 设计规格

> **范围**：P0/P1 已合入（参考 `reference_ui_animation.md` §3.2）。本文档设计 P2 范围 5 项的接口 / 视觉 / 实施。
>
> **创建日期**：2026-08-18
> **配套**：活参考 `claudedocs/reference_ui_animation.md`
> **前置依赖**：P0/P1 已合入的 `DialogShell` / `StaggerContainer` / `formatNumber` / `@number-flow/react` 等基础

---

## 1. 目标与边界

### 1.1 目标

把已类型化的视觉潜能（`variant="glow"` / `animation="press-only|glow-pulse"` / `onCompleteFlash`）真正落地，让状态徽章有可读的「方括号语言」，并审视是否引入 GSAP 做 HUD 装饰。

### 1.2 范围（5 项 · 总工时 8.5h）

| # | 项 | 工时 | 类型 |
|---|---|---|---|
| 2.1 | Glow Button 接入 CTA | 2h | 复用现有 + 接 2-3 个调用方 |
| 2.2 | ProgressBar `onCompleteFlash` | 1h | 单组件扩展 |
| 2.3 | HUD 装饰（dot-matrix + 扫描线） | 4h | 评估 GSAP 决策点 |
| 2.4 | `[ READY ]` 方括号状态徽章 | 1h | 工具函数 + 4 处替换 |
| 2.5 | Button `press-only` / `glow-pulse` 视觉补齐 | 0.5h | 单组件扩展 |

### 1.3 不在范围

- ❌ 不引入 GSAP（除非 §2.3 决策点通过）—— 引入决策点必须用户拍板
- ❌ 不改后端任何文件
- ❌ 不改 API 契约
- ❌ 不重做 Figma 设计稿（动效叠加）
- ❌ 不动 ProgressBar 的 inline hex 历史欠账（铁律③ 违规，但属 P3 之后的清理专项）

---

## 2. 设计细节

### 2.1 Glow Button 接入 CTA

**现状**：`button.tsx:33-35` 已定义 `variant="glow"`（emerald 背景 + 24px shadow + hover brightness 双增）。全仓 0 调用方（`grep variant="glow"` 无命中）。

**设计目标**：把「启动服务器」「保存配置」「应用变更」类关键 CTA 从 `default` 改为 `glow`，视觉上与「次要操作」拉开一档。

**调用方候选**（按优先级）：

| 位置 | 当前 | 改后 | 备注 |
|---|---|---|---|
| `ServerControlCard` 启动按钮 | `default` | `glow` | 高频 CTA |
| `ConfigPage` 各 Tab 保存配置 | `default` | `glow` | 写盘动作 |
| `LdmPage` 顶部「应用变更」 | `default` | `glow` | 关键 LDM 写入 |

**接口**（已存在，无需扩展）：

```ts
// Button 已经支持，无 API 变更
<Button variant="glow" size="lg">启动服务器</Button>
```

**视觉规范**：

- 默认：`bg-emerald-500` + `shadow-[0_0_24px_rgba(34,197,94,0.5)]`
- hover：亮度 +10% + `shadow-[0_0_32px_rgba(34,197,94,0.7)]`
- active：scale-[0.98]（沿用现有）
- 间距：保持现有 `gap-1.5 px-4`（lg 尺寸）

**文件改动**（3 文件，每文件 1-3 行）：

| 文件 | 行 | 改动 |
|---|---|---|
| `manager-web/src/components/server-setup/ServerControlCard.tsx` | 启动按钮处 | `variant="default"` → `variant="glow"` |
| `manager-web/src/pages/ConfigPage.tsx` | 各 Tab 保存按钮 | `variant="default"` → `variant="glow"`（需先查具体行） |
| `manager-web/src/components/ldm/LdmPage.tsx` | 顶部「应用变更」 | `variant="default"` → `variant="glow"` |

**验收**：

- [ ] 3 处调用方落地
- [ ] 视觉对比：glow 按钮比 default 明显更突出（自检：暗背景下阴影可见）
- [ ] 每屏只有 1 个 Primary Button（glow）——违反需评估是否合理
- [ ] typecheck 0 / vitest 全绿

**风险**：低。Button 本身已实现，仅替换调用方。

---

### 2.2 ProgressBar `onCompleteFlash`

**现状**：`ProgressBar.tsx:30-37` Props 无 `onCompleteFlash`。完成态仅切色（`#22C55E`），无闪烁反馈。

**设计目标**：完成瞬间 fill 闪烁一次（1.5× brightness 0→1→1 over 600ms），强化「成功」语义。

**接口扩展**（向后兼容，新增可选 Prop）：

```ts
export interface ProgressBarProps {
  // 现有字段...
  /** 完成瞬间 fill 闪烁一次（默认 false）—— 长任务完成反馈 */
  onCompleteFlash?: boolean;
}
```

**视觉规范**：

- 触发条件：`stage === "completed"` 且 `onCompleteFlash === true` 且 percent 由 < 100 跨过 100
- 闪烁：`filter: brightness(1.5)` 0% → 100% 0-100ms → 100% 100-500ms（回落 500ms ease-out）
- 实现：CSS keyframes 注入（复用 indeterminate 模式：`@keyframes progressbar-complete-flash`）

**实现要点**：

- 用 `useRef` 跟踪上一次 stage，避免初始 mount 时已 completed 误触发闪烁
- 闪烁动画只触发一次（依赖 useEffect + 状态机闭合）

**文件改动**（1 文件，1 处 Props + 1 处 effect + 1 处 keyframes）：

| 文件 | 改动 |
|---|---|
| `manager-web/src/components/shared/ProgressBar.tsx` | + Props `onCompleteFlash?: boolean`；+ useRef + useEffect 检测完成瞬态；+ `<style>` keyframes 注入 |

**验收**：

- [ ] `onCompleteFlash` Prop 工作正常
- [ ] 初始 mount 已 completed 不闪烁
- [ ] failed 状态不闪烁
- [ ] 与现有 indeterminate 动画不冲突
- [ ] ProgressBar 测试 + 新测试：默认 false / 显式 true 触发闪烁

**风险**：低。纯前端 prop + 一次性 CSS 动画。

---

### 2.3 HUD 装饰（dot-matrix + 扫描线）

**现状**：活参考 §3.2 P2 项注明「需评估 GSAP」。GSAP 未安装（`package.json` 无 `gsap`）。

**设计目标**：在 Dashboard 关键 StatCard + Console 顶部加 HUD 装饰——强化科技感、不喧宾夺主。

**视觉规范**：

- **dot-matrix 边框**：卡片顶部内嵌一行点阵（6-8 个 dot，颜色 emerald-500/30%
  - 实现：`<div>` 8 个 2px 圆点，间距 6px，opacity 0.3
  - 静态（不用 GSAP，纯 CSS）
- **扫描线**：4 秒一次的横向 emerald 半透光线，从顶滑到底
  - 实现：CSS keyframes 或 GSAP timeline（GSAP 性能更优）

**GSAP 决策点**：

| 方案 | 优点 | 缺点 |
|---|---|---|
| A. 纯 CSS keyframes | 0 依赖、易维护 | 长 timeline 难编排，复杂动效受限 |
| B. 引入 GSAP | 时间线强、性能好（GPU 加速） | + 30KB gzipped、新增依赖学习成本 |

**推荐**：**A 优先，复杂时再考虑 GSAP**。P2 范围内纯 CSS 足够。

**接口设计**（新增装饰组件，不污染现有 Card / StatCard）：

```ts
// 新组件：manager-web/src/components/shared/HudDecoration.tsx
interface HudDecorationProps {
  /** 装饰强度：subtle（仅 dot-matrix）/ normal（+扫描线） */
  intensity?: 'subtle' | 'normal';
  /** 扫描线颜色（默认 emerald/20） */
  scanColor?: string;
  /** 类名透传 */
  className?: string;
}
```

**使用方式**：作为装饰层 `absolute inset-0 pointer-events-none` 嵌入卡片内。

```tsx
// 在 StatCard / ConsolePage 顶部使用
<Card>
  <HudDecoration intensity="normal" />
  {/* 原有内容 */}
</Card>
```

**文件改动**：

| 文件 | 类型 | 改动 |
|---|---|---|
| `manager-web/src/components/shared/HudDecoration.tsx` | **新建** | dot-matrix + 扫描线（纯 CSS keyframes） |
| `manager-web/src/components/shared/HudDecoration.test.tsx` | **新建** | 渲染测试 + intensity 切换 |
| `manager-web/src/pages/DashboardPage.tsx` | 改 | 关键 StatCard 嵌入 HudDecoration（≤3 张） |
| `manager-web/src/pages/ConsolePage.tsx` | 改 | 顶部嵌入 HudDecoration（终端卡片上方） |

**验收**：

- [ ] dot-matrix 视觉可见但克制（不抢内容）
- [ ] 扫描线 4s 一次循环不卡顿
- [ ] 不破坏现有交互（pointer-events-none）
- [ ] 不影响无障碍（`prefers-reduced-motion` 停动画）
- [ ] GSAP 未引入（如用户后续拍板需要复杂动效，单独 PR）

**风险**：中。视觉装饰容易「过度设计」。**评审点**：HudDecoration 默认不开（`intensity="subtle"`），用 `prefers-reduced-motion` 媒体查询尊重无障碍偏好。

---

### 2.4 `【运行中】` 中文方括号状态徽章（用户拍板 D2）

**现状**：4 个状态文案在 `lib/utils.ts:48-51` + `DashboardPage.tsx:113-116` 各一份。两份需统一。状态文字裸出（"运行中"/"已停止"）。

**设计目标**：状态徽章统一用中文方括号 `【】` 包裹。**用户拍板：仅中文版本**。

**视觉规范**：

| 状态 | 现有 | 改后 |
|---|---|---|
| STOPPED | 已停止 | `【已停止】` |
| STARTING | 启动中 | `【启动中】` |
| RUNNING | 运行中 | `【运行中】` |
| STOPPING | 停止中 | `【停止中】` |

**字体**：`font-medium` + `text-xs` + `tracking-wider`（中文方括号需保留中文字重，不强行等宽）

**豁免说明**：需在 `reference_ui_terms.md` 加一行——「状态徽章使用中文方括号作为视觉装饰」——属铁律① 正式豁免。

**实现方式**：

**方案 A：直接改 `STATE_LABELS` 映射值**

```ts
// lib/utils.ts
export const STATE_LABELS = {
  STOPPED: "[ STOPPED ]",
  STARTING: "[ STARTING ]",
  RUNNING: "[ RUNNING ]",
  STOPPING: "[ STOPPING ]",
} as const;
```

- 优点：改动小、单一来源
- 缺点：状态文案变成「英文术语 + 方括号」——可能违反铁律①「行内术语堆砌」

**方案 B：新增 `formatStateBadge(state)` 工具函数，调用方显式选用**

```ts
// lib/utils.ts
export function formatStateBadge(state: ServerState): string {
  const map = { ... };
  return map[state];
}
```

- 优点：保留现有 `STATE_LABELS` 不变；徽章语义独立
- 缺点：调用方需要替换字符串渲染

**推荐**：**方案 B**——保留界面文案规范（铁律① 不允许中英术语堆砌），但徽章是「装饰性语义」可豁免。

**说明豁免**：徽章文案 `[ RUNNING ]` 类似英文 `命令参数`——表面像术语堆砌。需在 `reference_ui_terms.md` 加一行说明：「服务端状态徽章使用英文方括号格式作为视觉装饰」，作为正式豁免。

**文件改动**：

| 文件 | 改动 |
|---|---|
| `manager-web/src/lib/utils.ts` | + `formatStateBadge(state)` 工具函数；STATE_LABELS 保持中文不变（4 状态） |
| `manager-web/src/components/stats/StatCard.tsx` | value 渲染时调用 `formatStateBadge(state)`（若 state 已知） |
| `manager-web/src/pages/DashboardPage.tsx` | 状态徽章改用 `formatStateBadge`（删本地 STATE_LABELS 重复） |
| `manager-web/src/pages/ServerSetupPage.tsx` | 实例列表状态徽章改用 `formatStateBadge` |
| `manager-web/src/components/server-setup/ServerControlCard.tsx` | 状态文字改用 `formatStateBadge` |
| `manager-web/src/pages/ConfigPage.tsx` | 守卫壳状态文字（如有）改用 |
| `claudedocs/reference_ui_terms.md` | + 「状态徽章方括号豁免」说明 |

**验收**：

- [ ] 4 处调用方统一为 `formatStateBadge`
- [ ] 视觉：`[ RUNNING ]` 等徽章字体等宽、有间距
- [ ] 现有中文 `STATE_LABELS` 保留（不破坏 SettingsPage / LDM 页文案）
- [ ] `reference_ui_terms.md` 加豁免条目
- [ ] typecheck 0 / vitest 全绿

**风险**：低。纯字符串格式化 + 替换。**评审点**：是否真要英文方括号？中文方括号 `【运行中】` 是备选——纯视觉偏好。

---

### 2.5 Button `press-only` / `glow-pulse` 视觉补齐（用户拍板 D4 = 选项 3）

**现状**：`button.tsx:57` 已定义 `animation: 'normal' | 'press-only' | 'glow-pulse'`，但 `:63` 解构为 `_animation` 丢弃（等同 normal）。3 个值当前视觉无差异。

**设计目标**：补齐 3 种动画档的视觉差异。**用户拍板 D4 = 选项 3（智能触发）**。

**视觉规范**：

| 档 | 默认 | hover | active |
|---|---|---|---|
| `normal` | 当前 | brightness +10% | scale 0.98 |
| `press-only` | 当前 | 无 brightness | scale 0.98 |
| `glow-pulse` | 当前 | brightness +10% + glow 闪烁 | scale 0.98 |

**调用方约定（D4 选项 3 = 智能触发）**：

| 调用方 | 默认 animation | 触发切换条件 |
|---|---|---|
| 启动服务器按钮（ServerControlCard） | `glow-pulse` 常驻 | — |
| 应用变更按钮（LdmPage 顶部全局） | `glow-pulse` | 仅当 LDM 配置有未保存改动时启用；保存后自动切回 `glow` |

**逻辑**：呼吸光晕 = 「有事要做」信号，而不是「一直在喊」。用户保存配置后呼吸停，操作感更清爽。

**实现要点**：

- `press-only`：去掉 `hover:brightness-110`（Tailwind class 切换）
- `glow-pulse`：仅在 `variant="glow"` 时生效；非 glow variant 降级为 normal；呼吸用 `animate-pulse` 或自定 keyframes（emerald shadow 缩放）
- 闪烁节奏：1.5s ease-in-out infinite（与现有 status-pulse 一致）
- 「未保存改动」判定：复用 LdmPage 现有的 `isDirty` 状态（已有 dirty / saved 区分），与「应用变更」按钮 disabled 联动

**文件改动**（1-2 文件）：

| 文件 | 改动 |
|---|---|
| `manager-web/src/components/ui/button.tsx` | buttonVariants 加 `animation` 变体；Component 用 cn 合并 class；+ glow-pulse keyframes 注入 |
| `manager-web/src/components/ldm/LdmPage.tsx` | 应用变更按钮根据 isDirty 切换 `animation="glow-pulse"` / `animation="normal"` |

**验收**：

- [ ] 3 种 animation 视觉差异可观察
- [ ] `glow-pulse` 仅 glow variant 生效
- [ ] 启动服务器按钮常驻 glow-pulse
- [ ] 应用变更按钮在 dirty 时呼吸，保存后停止
- [ ] 现有 default/secondary/ghost/danger 调用方 0 行为变化
- [ ] typecheck 0 / vitest 全绿

**风险**：低。但需注意「按钮持续呼吸」可能造成视觉疲劳，启动服务器按钮常驻需验证 5min 后是否仍合理。

---

## 3. 实施顺序

按依赖和风险递进，**5 项分 3 个 PR**（避免单 PR 过大）：

### PR-P2A（2.5 + 2.2 · 共 1.5h · 小功能）

- 2.5 Button 动画档补齐（单文件、风险低）
- 2.2 ProgressBar `onCompleteFlash`（单文件）
- **门槛**：≤3 文件 · ≤50 行/文件 → 最小验证（typecheck 即可）

### PR-P2B（2.4 + 2.1 · 共 3h · 小功能）

- 2.4 状态徽章方括号化（多处替换但每处 1 行）
- 2.1 Glow Button 接入 CTA（3 处替换）
- **门槛**：≤3 文件（按变更归属文件数）· 多数 < 50 行 → 最小验证

### PR-P2C（2.3 · 4h · 完整功能）

- 2.3 HudDecoration 新组件 + 2 处嵌入
- **门槛**：≥ 4 文件 · 含新组件 → 完整验证（typecheck + 单测 + e2e）

**依赖关系**：

- P2A 不依赖任何 → 可独立
- P2B 依赖 P2A 完成的 Button（glow variant 已用上）
- P2C 完全独立 → 可与 P2A 并行

---

## 4. 验收门槛汇总

| 项 | typecheck | vitest | 视觉自检 | e2e |
|---|---|---|---|---|
| 2.1 Glow Button | ✅ | ✅ | ✅ | — |
| 2.2 onCompleteFlash | ✅ | ✅ 新增 2 测试 | ✅ | — |
| 2.3 HudDecoration | ✅ | ✅ 新增组件测试 | ✅ | ✅ 控制台嵌入 |
| 2.4 方括号徽章 | ✅ | ✅ | ✅ | — |
| 2.5 Button 动画档 | ✅ | ✅ 补 button.test | ✅ | — |

**全局**：

- [ ] 不引入 emoji（铁律）
- [ ] 不引入 GSAP（除非 §6 用户拍板）
- [ ] 不破坏 xterm 控制台渲染
- [ ] 新色值（如有）评审通过 + 入 `design-system-mapping.md`
- [ ] `prefers-reduced-motion` 媒体查询尊重无障碍偏好（HudDecoration / glow-pulse）

---

## 5. 评审点（需用户拍板）

### 5.1 GSAP 是否引入？

**当前立场**：不引入（P2C 用 CSS keyframes 足够）。

**如用户拍板引入**，GSAP 适用场景：

- 多卡片协同时间线（卡片组 stagger 联动）
- 复杂 SVG 路径动画
- 滚动触发动效（IntersectionObserver + GSAP ScrollTrigger）

**不适用场景**（CSS 已够）：

- 单元素 fade / scale
- 单元素循环（扫描线、glow-pulse）

### 5.2 方括号语言是否中文版？

**英文方括号** `[ RUNNING ]` ——命令终端风格

**中文方括号** `【运行中】` ——更适合普通玩家

**默认推荐**：英文方括号（与 P1 mono 字段、命令终端调性一致）；若用户偏好中文可改。

### 5.3 glow-pulse 用法边界

- **推荐用法**：每屏 1 个关键 CTA（如「启动服务器」「应用变更」）
- **禁止用法**：多个按钮同时 glow-pulse（视觉混乱）

---

## 6. 用户拍板决策（2026-08-18 全部固化）

| # | 决策 | 拍板结果 | 落地细节 |
|---|---|---|---|
| **D1** | 引入 GSAP？ | ❌ **不引入** | P2 用 CSS keyframes 足够；未来触发条件写进 ADR-0007 候选（见 §9） |
| **D2** | 方括号语言？ | ✅ **中文方括号** `【运行中】` 等 | 中文方括号作铁律① 豁免；`reference_ui_terms.md` 加条目 |
| **D3** | HudDecoration 取舍？ | ✅ **C（原方案）** dot-matrix + 扫描线 | Dashboard 1-3 张关键卡 + Console 顶部嵌入；`prefers-reduced-motion` 无障碍尊重 |
| **D4** | glow-pulse 用法？ | ✅ **选项 3（智能触发）** | 启动服务器常驻 `glow-pulse`；应用变更仅 dirty 时启用 |

**全部决策已定，可开 PR 实施。**

---

## 7. 衔接 P3

- P3 已锁：Dashboard 资源图 System Monitor 化 / Status Block / Cyberpunk Neon Folder
- P2 HUD 装饰不抢 P3 风头（克制为主）
- 状态徽章方括号化为 P3 Status Block 铺路（统一视觉语言）

---

## 8. 文档同步清单

P2 实施时同步更新：

- `claudedocs/reference_ui_animation.md` §3.2 P2 状态：「未启动」→「已合入（PR-P2A/B/C）」
- `claudedocs/reference_ui_terms.md` + 「状态徽章中文方括号豁免」
- `docs/architecture/design-system-mapping.md` §1（如有新色值）

---

## 9. GSAP 未来触发条件（ADR-0007 候选）

**当前立场**：不引入。

**未来出现以下需求时**重新评估 GSAP：

| 触发条件 | GSAP 对应能力 | 优先级 |
|---|---|---|
| Dashboard 资源图需滚动联动（System Monitor sparkline） | ScrollTrigger | P3 |
| Status Block 多卡片协同时间线（incident 流式进入） | timeline | P3 |
| 任何 SVG 路径动画（Mod 浏览 hover 时图标 morph） | MorphSVG / DrawSVG | 待定 |
| 物理弹性需求（卡片拖拽排序） | elastic / inertia | 待定 |

**评审流程**：

1. 需求确认（哪个动效用 CSS / Motion v13 做不出来）
2. 写 ADR-0007-candidate.md 记录「为什么不 CSS」
3. 评估 30KB gzipped 是否值得
4. 用户拍板

**不适用场景（CSS / Motion 已够）**：

- 单元素 fade / scale
- 元素循环（扫描线 / pulse / glow-pulse）
- Stagger 入场
- `layoutId` 滑动（TabBar / Sidebar）

---

*创建日期：2026-08-18 · /sc:design 输出 · 配套活参考 reference_ui_animation.md*
*决策固化：2026-08-18 D1-D4 全部拍板*