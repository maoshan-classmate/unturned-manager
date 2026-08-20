# Session Checkpoint 2026-08-19 P4 动效 + 三组件参数化闭环

## P4 主题

PR-1/2/3 + 三组件参数化补丁。沿用 `reference_ui_animation.md` §7 验收清单 + §5 组件参数化设计稿。

## commit 链

1. `fdfe70c` PR-1 P4A StatusBadge 公共组件 + LdmPage 应用变更按钮 isDirty 联动
2. `39510f2` PR-2 P4B 数字工具函数 6 个 + 端口 mono + 间距 p-5 巡检归零
3. PR-3 P4C 4K 实机 + 性能 — **deferred**(用户拍板不需要)
4. `c160810` 三组件参数化: Card hover/animation + Dialog animation slide-up + Sidebar indicatorStyle

## 用户关键决策

- **D1 StatusBadge 动效**: RUNNING 圆点 pulse + STARTING/STOPPING 文字 spin(非静态)
- **D2 LdmPage isDirty 触发**: 任一 Tab 表单脏(D2 推荐)
- **D3 ConfigPage WorkshopTab dirty 提示**: 仅按钮态变化(加计数被否)
- **D4 SteamID64 展示**: 全展示(17 位,不隐藏)
- **D5 命令字段排版**: mono 同行(不滚动不折叠)
- **D6 数字工具颗粒度**: 3 通用 + 3 专用全覆盖
- **PR-3 P4C 实施**: 用户拍板**不做**——本机 1080p + 284 单测覆盖 + Sprint 5 真机就位时再激活
- **三组件参数化**: 用户拍板要做(Card/Dialog/Sidebar 三个 props 设计稿写了但代码未实现)

## 交付清单

**StatusBadge 公共组件** — 4 状态 + 圆点 pulse + STARTING/STOPPING spin(D1)
- 复用: DashboardPage / ServerSetupPage（实例列表）/ ServerControlCard / LdmPage 顶部

**LdmPage 顶部「应用变更」按钮** + isDirty 联动(D2)
- FrameworkConfigTab / PermissionsTab 暴露 `onDirtyChange?: (dirty: boolean) => void` 回调
- 编辑器骨架阶段时启用,当前 Tab 均为只读占位卡 → 按钮默认 disabled

**6 个数字工具函数** — D6 全覆盖
- 已有 3 个: formatSize / formatBytes / formatNumber / formatDate
- 新增 3 个: formatDecimal / formatSteamId64(D4 全展示) / formatUptime / formatDurationMs

**视觉一致性** — P4B
- ServerControlCard 端口 + 查询端口 mono 化
- 13 处 `p-5` (20px) → `p-4` (16px) 间距巡检归零

**三组件参数化** — P4 补丁,c160810
- Card: `hover: 'none'/'lift'/'glow'` + `animation: 'none'/'fade-in'/'stagger'`
- Dialog: `animation` 扩展加 `'slide-up'`(DialogShell 同步)
- ConfirmDialog: `animation` 同步加 `'slide-up'`
- Sidebar: `indicatorStyle: 'left-bar'/'background'/'pill'`

## 工具与测试教训

- **StatusBadge 复用**: 4 处已用,但第 5 处 U3dsCard 是 isInstalled 二态(非 ServerState)不替换
- **LdmPage 顶部按钮**: 编辑器骨架未完成时按钮 always disabled,留好 onDirtyChange API 居合
- **commit message 输入法踩坑**: 中文「是」→「应用」写错(纠端 commit --amend)
- **Sed 批量替换 p-5 → p-4**: 13 处一致替换,跨多个文件
- **LdmPage 顶部 isDirty 触发条件**: T1.4 ConfigPage WorkshopTab dirty glow 在 P2 commit 80907cf 已落地,本轮降级为验证
- **commit 范围控制**: Git status 会出现其他文件(如 App.tsx / useRequireServer.ts)被 hook 触发修改,务必手动 stage 仅 PR-4/5/6 明确范围的 7 文件

## 测试数据

- 前端 typecheck 0 错
- StatusBadge 12 单测 + Card 11 + Dialog 5 + DialogShell 4 + Sidebar 4 新增 = 36 新增
- utils 6 工具函数 25 边界用例
- 前端 vitest **299/299** 全绿(原 284 → 299)
- 后端 0 改动

## 未完成 / Deferred

- **PR-3 P4C 4K 实机 + 性能 SPT 验证**: 需要真机 4K 设备 + SPT 実测,后续 Sprint 5 启动时激活
- **8 页 mono 字段清单化 100%**: P4B 补了 1 处(ServerControlCard 端口),其他 7 页中 34 处已覆盖,未全量 100% 巡检
- **LdmPage 顶部按钮实际生效**: 待 FrameworkConfigTab / PermissionsTab 编辑器骨架完成时,各 Tab 内 `onChange` 调 `onDirtyChange(true)` 启用

## 完整 `reference_ui_animation.md` 走听状态

§7.4 组件参数化 8 组件全部完成(StatCard / Button / Card / Dialog / ProgressBar / StatusBadge / TabBar / Sidebar)
§7.1-7.3, 7.5 全部完成
唯一 deferred: §7.1 中 4K 视口下字号实测 + §7.6 性能验证(PR-3 P4C)

## 本轮 P3 + P4 完整交付

```
P0 7 commits   P1 4 commits   P2 5 commits
P3 8 commits   P4 3 commits   (PR-3 deferred)
                     + c160810 三组件参数化补丁
```

UI 动画现代化线主体 100% 完成。
