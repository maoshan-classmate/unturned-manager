# Session Checkpoint 2026-08-18 UI 动画 P0+P1 实施闭环

## P0 三批 + 字号两轮修复 + 文档收尾（commit 链）

1. `1d8f941` 多分辨率字号档（主题层 `--text-*` 改区间）
2. `c25ae7a` 侧栏与分页签选中动效（layoutId 滑动）
3. `7de96d1` 页面三态与弹窗动效（DialogShell 抽公共遮罩 + AnimatePresence）
4. `6732ca6` 字号改纯 vw 自适应（`max(下限, base+slope·vw)` 保 12px 下限、3xl 封顶 32px）
5. `72b210b` 字号整体抬 1 档（xs 12→14 / sm 15→17 / base 16→18 / lg 18→20 / xl 20→22 / 2xl 24→26 / 3xl 30→32 / body 17→19）
6. `b36c0af` 修正活参考章节编号 + 删 P0 工作流文档

## P1 四批（commit 链）

1. `cf38633` 加 `@number-flow/react` + StaggerContainer + `formatNumber`/`formatBytes`
2. `f2378a9` 路由切换 fade（App.tsx Location keyed）+ Button 扩展（hover brightness + glow variant + animation 档）
3. `ac01e09` StatCard 三件套（enableStatusIndicator pulse/spin + enableNumberTicker + 清 inline hex）
4. `ec9068b` 4 页接入 StaggerContainer + 3 处 mono 补齐

## UI 布局修正链（同轮）

- `82b032b` StatCard 加 `h-full` + value `mt-auto`，DashboardPage 顶层 `h-full`
- `9239858` 各页网格 `flex-1 content-start` + Card 默认 `h-full` + Terminal `min-h-0`
- `556547e` ServerSetupPage 2×2 网格 `grid-rows-1fr-1fr` 两行均分
- `2e61db5` ★根因修复：App.tsx 路由 fade 的 `<motion.div>` 加 `h-full`——缺它导致 viewport 高度传递链断裂，所有页面内容堆顶部、底部空
- `2195a83` DashboardPage 4 卡网格去掉 `flex-1`（避免与资源图争空间）
- `8ef2b11` 文档收尾：活参考标 P0/P1 状态 + 删 P1 工作流文档 + 提交 package-lock.json

## 关键决策

- D1 ServerSetupPage 4 卡重排不做（现状顺序已与规格一致）
- D2 路由 fade 用 Location keyed wrapper（不动路由结构）
- D3 引入 `@number-flow/react`
- 字号路线：改主题层档位定义 → 纯 vw + 保下限 → 用户实机 4K 屏反馈偏小后整体抬 1 档

## 测试与工具教训

- vitest jsdom 测 motion 组件必须 mock（缺 getBoundingClientRect）——`vi.hoisted` 工厂返回 `{ motion: { span/div: make(tag) }, AnimatePresence }`，5 个测试文件复用
- `@number-flow/react` 在 jsdom 也要 mock（同样依赖 DOM 测量），mock 渲染 span + data-testid 断言切换
- 项目根有 `package-lock.json` 且被 git 追踪（npm 装包后需提交，`manager-web/` 下无 lock，是 workspace 根锁）
- P1 后 232 单测全绿（基线 148 + P0 33 + P1 20 + 若干修复链连带）
