# Session Checkpoint 2026-08-19 P3 动效三批全闭环

## PR-1 P3C Cyberpunk Neon Folder（commit 链）

1. `f08c76a` FilesPage FileCardComp 文件夹 hover 霓虹边框 + 微旋转 1.5° + `@2xl:` 增强 + 蓝色图标 hover 加深
2. `41539ac` 文档 guard v2 修 4 处过时（component-abstraction.md 加 #60A5FA / design-system-mapping.md §1 token / reference_ui_animation.md 9→11 色 / workflow_p3 status 更新）

## PR-2 P3A 资源图 System Monitor 化（commit 链）

1. `2f32326` PR-2a 后端：MetricsService（systeminformation 5s 采样 + 200 环形）+ 契约 schemas/contracts + `GET /api/system/metrics` + 11 单测 + 4 e2e
2. `61452ca` PR-2b 前端：SystemMonitorCard（CPU/内存 sparkline + NumberFlow + 时间窗切换 + CPU >80% 切 amber + 网络留白 title）+ useMetrics 5s 轮询 hook + 12 单测

## PR-3 P3B Status Block（commit 链）

1. `0c76b8c` PR-3a 后端：IncidentsService（进程内环形 100 条 + 单调递增 timestamp + broadcast `incident_created`）+ 契约 schemas/contracts + `GET /api/servers/:id/incidents` 嵌套路由 + ServerManager transition 自动记录 start/stop/crash + 10 单测 + 5 e2e
2. `74dedd4` PR-3b 前端：StatusBlock（6 类事件图标 + 3 档严重程度 + maxItems 默认 5 + 时间格式化同/跨日）+ useIncidents hook（挂载拉历史 + WS 订阅 + 前置去重）+ 14 单测

## 文档收尾（commit 链）

1. `9af3b46` 删 P3 workflow_p3_ui-animation.md（按 document-organization.md §生命周期「Sprint 工作流完成删除」）+ reference_api_spec.md §1/§2.10/§2.11/§4 同步 metrics/incidents 端点与 WS 事件
2. `9efd2a9` subagent 审计发现 reference_ui_animation.md line 93/134 实施状态停留在 P3C 已合入/P3AB 未启动，4 行字符串同步 P3A/P3B commit hash

## 用户关键决策

- **metrics 端点位置**：用户拍中从 `/api/servers/:id/metrics` 改 `/api/system/metrics`（与 u3ds/steamcmd/items 同级全局端点）——多实例共装下不分 ServerID，UI 文案「系统资源（多实例）」明示边界
- **destructive 测试反馈**：测试连续 4 个失败用户没打断，让我自己改稳——`Strict Mode` 双 effect 跑、5s setInterval + 真实时间不兼容是根因

## 工具与测试教训

- **React 18 Strict Mode** effect 双跑导致单测 `toHaveBeenCalledTimes(N)` 失败——用 `toHaveBeenCalled()` + `toHaveBeenLastCalledWith()` 或断言 `mock.calls.length >= N`
- **vitest fake timers + setInterval**：用 `vi.useFakeTimers()` + `await act(async () => { await vi.runOnlyPendingTimersAsync() })` 推初始异步；`await vi.advanceTimersByTimeAsync(5_000)` 推轮询；不能与 `waitFor` 默认 timeout 共存
- **同毫秒多事件排序**：`Date.now()` 快速循环返回相同值 → sort 不稳定 → IncidentsService 引入单调递增 timestamp 序列号（`nextTimestamp()` private 方法）
- **`Math.max(...)` 取极值**时 `range = max - min || 1` 防御 0 区间，sparkline 渲染不崩
- **全局 token 同步**：换端口必须 vite proxy + .env SERVER_PORT 双改，禁止只改一端
- **PR 拆分原则**：可拆先后端时（PR-2a → PR-2b、PR-3a → PR-3b），commit 链路清晰可回滚；每个子 PR 都做最小闭环（schema + service + route + DI + test）
- **subagent 审计价值**：派 general-purpose 逐项核对 P3 设计稿 12 项 D 决策 + 测试数据 + 文档同步，发现 reference_ui_animation.md 状态字符串 4 行未跟随 4 个 commit 同步——单 agent 审查能在收尾期捕获这种「commit 落地但字符串残留」的偏差

## 测试数据快照

- 前端 typecheck 0 / 前端 vitest **254/254** 全绿（原 232 → P3C +29 / P3A +24 / P3B +22 = 254）
- 后端 typecheck 0 / 后端 P3 单测 **21/21** 全绿（MetricsService 11 + IncidentsService 10）
- 后端 P3 e2e **9/9** 全绿（metrics 4 + incidents 5）
- 后端全量 vitest **402/419**（4 fail pre-existing：gateway PTY 注入 + steamCmdManager 锁 key，与 P3 无关）

## 链路上线要点（end-to-end 验证）

后端 ServerManager transition（STARTING/RUNNING/STOPPED）→ IncidentsService.record() → broadcaster.broadcast(`{type:"incident_created",incident}`) → 前端 WS 接收 → useIncidents 前置去重插入 → StatusBlock 实时展示。同时 `GET /api/servers/:id/incidents?limit=50` 拉历史倒序展示。