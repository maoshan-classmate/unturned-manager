# P3 动效设计稿（资源图 + 状态块 + 霓虹文件夹）

> 配套活参考：`claudedocs/reference_ui_animation.md` §3.2 P3 表格。
> 同步规划动效优先级 P3 工时落地（前两批 P0/P1 已合入，链接见活参考 §3.1）。
>
> **范围**：
> - **P3A 资源图 System Monitor 化**（6h，**后端阻塞**）
> - **P3B Status Block**（6h，**后端阻塞**）
> - **P3C Cyberpunk Neon Folder**（2h，**前端独享，立等可取**）

---

## 1. 现状盘点

### 1.1 后端指标端点（Grep 结果）

```
manager-server/src/modules/server/ServerManager.ts       ← 状态机/PTY 相关，非指标
manager-server/src/modules/filelock/FileLockProvider.ts   ← 文件锁，非指标
manager-server/src/db/seed.ts                            ← 种子，无
```

12 个路由文件（auth / config / files / items / ldm / mod-browse / mods / servers / sessions / settings / steamcmd / u3ds / workshop）——**零指标端点**。

### 1.2 Dashboard 当前结构

```
标题 + 状态徽章 + 跳转入口
StaggerContainer（4 StatCard：服务器状态/在线玩家/CPU 使用/Mod 数）
虚线框占位「资源使用图」  ← P3A 替换
```

`Stats.cpu` 永远是 `—`——因后端无指标；`Stats.players` 同理。

### 1.3 FilesPage 当前结构

```
面包屑 + 路径导航 + 工具栏（新建/上传/刷新）
网格布局（FileCardComp：208×125，Folder icon #3B82F6 蓝，文件 icon 蓝/靛/橙）
右键菜单（重命名/删除/复制/移动/下载）
```

文件夹 hover 当前**无动效**，仅 `transition-colors` 切换边框/背景色。

### 1.4 StaggerContainer 现有能力

- 子元素 stagger 入场（80ms 间隔 + 8px Y 偏移）
- `maxStaggeredItems` 限制（>12 走整体 fade，避免长列表入场过慢）
- `<MotionConfig reducedMotion="user">` 全局接管无障碍

---

## 2. P3A 资源图 System Monitor 化

### 2.1 目标

Dashboard 中部虚线占位 → 真实系统监控图（CPU/内存/网络 sparkline + 实时数据点）。

### 2.2 后端依赖（**阻塞**）

新端点：`GET /api/servers/:id/metrics?window=5m`

**响应 schema**：
```typescript
{
  serverId: string,
  window: "1m" | "5m" | "15m",
  samples: Array<{
    timestamp: number,    // unix ms
    cpuPercent: number,   // 0-100
    memUsedMB: number,    // RSS
    netInKBps: number,    // 网络入向 kb/s
    netOutKBps: number,   // 网络出向 kb/s
  }>,
  current: {
    cpuPercent: number,
    memUsedMB: number,
    memTotalMB: number,
    netInKBps: number,
    netOutKBps: number,
  }
}
```

**采集策略**（2 选 1，待 D2 拍板）：

| 路线 | 实现 | 优点 | 缺点 |
|---|---|---|---|
| **A** `pidusage`（Node.js 库） | 后端定时采样 PTY 进程 RSS/CPU | 精确 | 仅 U3DS 进程；网络需 /proc/net/dev |
| **B** `systeminformation`（Node.js 库） | 采样整个容器/宿主 | 简单 | 多实例共装时无法区分；与 Docker 容器边界冲突 |

**推荐 B**（多 ServerID 共装决策已锁，进程级粒度无意义；网络指标采样宿主机 `/proc/net/dev` + 按 ServerID 标签区分——但**多实例共装 = 同一 U3DS 进程**，网络/内存无法拆分到 ServerID）。

→ 衍生风险：**多实例共装下「资源图」实际显示的是宿主/容器总资源，不是单 ServerID 资源**——这个边界要在 UI 文案明示：「系统资源（多实例）」。

### 2.3 前端组件

新建 `components/dashboard/SystemMonitorCard.tsx`：

```tsx
interface SystemMonitorCardProps {
  serverId: string;
  window?: "1m" | "5m" | "15m";
}
```

**布局**（占 Dashboard 中部 flex-1 区域）：
```
┌─ 系统资源（多实例）─────────────────────┐
│ CPU:    35.2%    ▁▂▃▅▇▆▅▃▂  sparkline  │
│ 内存:   1.2/4GB                        │
│ 网络:   ↓ 12.3 KB/s  ↑ 8.7 KB/s        │
│ 时间窗: [1m] [5m] [15m]                │
└────────────────────────────────────────┘
```

**复用**：
- `StatCard` 数字滚动（`enableNumberTicker`）——P1 已加
- `motion` 入场（`StaggerContainer` 子元素）

**sparkline 选型**：
- 不引入新库——手写 SVG `<polyline>` 接 samples 数据点
- 颜色沿用 `text-emerald-500`（CPU）/ `text-amber-500`（内存高载 >80%）/ `text-blue-400`（网络）

### 2.4 D 拍板项

| ID | 决策点 | 选项 |
|---|---|---|
| **D1** | sparkline 视觉风格 | 1. 纯线（克制）/ 2. 渐变填充（赛博朋克）/ 3. 折线 + 数据点高亮 |
| **D2** | 资源采集对象 | A. 单 ServerID 进程 / **B. 宿主/容器总资源**（默认）|
| **D3** | 端点轮询频率 | 5s / 10s / 30s |
| **D4** | 多实例共装下文案 | 「系统资源」/ 「宿主资源」/ 「实例资源（共用）」 |

---

## 3. P3B Status Block

### 3.1 目标

Dashboard 顶置「实时状态条 + incident 流」——比 StatCard 头部状态徽章更显眼，incident 流显示近期重要事件（启动/Mod 应用/重启/存档失败）。

### 3.2 后端依赖（**阻塞**）

**现有**：`state_change` WS 事件（Phase 5）推送状态变更；前端 `WebSocketContext` 升级事件订阅总线（2026-08-12 完成）。

**需要扩展**：
1. **事件聚合**——服务端维护最近 N 条 incident（默认 50），按时间倒序
2. **新端点**：`GET /api/servers/:id/incidents?limit=50`
3. **WS 事件**：`incident_created`（实时推送新增事件）

**事件 schema**：
```typescript
{
  id: string,
  serverId: string,
  type: "start" | "stop" | "restart" | "mod_apply" | "save" | "crash",
  severity: "info" | "warning" | "error",
  message: string,        // 中文描述（界面文案规范）
  timestamp: number,
  details?: {             // 可选上下文
    reason?: string,
    durationMs?: number,
    modCount?: number,
  }
}
```

**存储策略**：进程内环形缓冲（不落 SQLite——incident 是高频流，不是审计日志）；后端重启清空可接受。

### 3.3 前端组件

新建 `components/dashboard/StatusBlock.tsx`：

```tsx
interface StatusBlockProps {
  serverId: string;
  incidents: Incident[];
}
```

**布局**：
```
┌─ 当前状态 ───────────────────────────────────┐
│ ● 运行中 · 已连续 2h 35m · 端口 27015         │
└──────────────────────────────────────────────┘
┌─ 近期事件（最新 5 条）───────────────────────┐
│ ✓ 14:32 启动完成（耗时 8.3s）              │
│ ✓ 14:00 Mod 列表已应用（3 个）             │
│ ⚠ 13:45 存档失败：磁盘空间不足             │
└──────────────────────────────────────────────┘
```

**复用**：
- 状态徽章走 `formatStateBadge`（中文方括号豁免）
- 事件流走 `StaggerContainer`（入场）
- 点击事件 → 跳控制台对应时间点（V2 留 P4）

### 3.4 D 拍板项

| ID | 决策点 | 选项 |
|---|---|---|
| **D5** | 事件保留条数 | 50 / 100 / 200 |
| **D6** | 事件持久化 | 进程内（默认）/ SQLite / 文件 |
| **D7** | UI 展示条数 | 3 / 5 / 10（默认 5）|
| **D8** | 事件严重程度与图标 | ✓ info / ⚠ warning / ✗ error 三档 |

---

## 4. P3C Cyberpunk Neon Folder

### 4.1 目标

FilesPage 文件夹 hover 时立体霓虹化——赛博朋克霓虹边框 + 微光晕。

### 4.2 后端依赖

**无**——纯前端独享，**立等可取**。

### 4.3 前端组件

**复用现有 `FilesPage` 的 `FileCardComp`**——不新建组件，直接改造渲染逻辑：

| 触发 | 当前 | 改造后 |
|---|---|---|
| 默认 | `#1E293B` 背景 + `#334059` 边框 | 同（不变）|
| hover | 仅背景/边框色过渡 | **+ 霓虹边框**（`box-shadow: 0 0 12px rgba(59,130,246,0.5)`）+ **微旋转**（`rotate-[-1.5deg]`）+ **图标颜色加深**（`#3B82F6` → `#60A5FA`）|
| selected | `rgba(34,197,94,0.12)` 背景 | 保留 |

**色值合规**：`#3B82F6` 已在全局色板（folder icon = `#3B82F6`）；`#60A5FA` 是 Tailwind blue-400 同色相家族——已走 §1 新色值规则入库 `design-system-mapping.md` §1（D9 选项 2 已落地）。

### 4.4 动效 token 复用

```
card-hover: 200ms easeOut  ← 已有
```

无需新增动效 token。**核心是 hover 触发的 box-shadow + rotate transition**。

### 4.5 D 拍板项

| ID | 决策点 | 选项 |
|---|---|---|
| **D9** | hover 强度 | 1. 仅边框色 + 微光晕（克制）/ 2. + 微旋转 1.5°（霓虹）/ **3. + 文字轻微抬升**（立体） |
| **D10** | 仅文件夹触发 vs 全部文件 | 1. 仅文件夹 / 2. 文件夹+文件（一致性）|
| **D11** | 是否区分多分辨率 | 1. 不区分 / 2. `@2xl:` 下增强（2560px 大屏更明显）|

---

## 5. 实施 PR 划分

按后端依赖顺序，**P3C 可立即开**，**P3A/P3B 等后端支撑**：

### PR-1：P3C Cyberpunk Neon Folder（**立即可开**）

- **范围**：FilesPage FileCardComp hover 改造 + `design-system-mapping.md` §1 补色
- **文件数预估**：1-2 文件（FilesPage.tsx 改 + design-system-mapping.md 增补 1 行）
- **工时**：2h
- **风险**：低（纯样式 + 既有动效 token）
- **D 拍板**：D9 / D10 / D11

### PR-2：P3A 资源图 System Monitor 化（**后端先行**）

**子 PR-2a：后端指标采集 + 端点**
- 新增 `manager-server/src/modules/metrics/` 模块
- 端点 `GET /api/servers/:id/metrics`
- 选 `systeminformation` 路线（D2 拍板）
- 工时：4h
- 文件：4-6（MetricsService / routes/metrics / shared/schema / 测试）

**子 PR-2b：前端 SystemMonitorCard**
- 新建 `components/dashboard/SystemMonitorCard.tsx`
- 替换 Dashboard 虚线占位
- 工时：2h
- 文件：2-3（组件 + 测试 + DashboardPage 替换）
- D 拍板：D1 / D3 / D4

### PR-3：P3B Status Block（**后端先行**）

**子 PR-3a：后端 incident 环形缓冲 + WS 事件**
- 扩展 `manager-server/src/modules/server/ServerManager.ts` incident 收集
- 端点 `GET /api/servers/:id/incidents`
- WS `incident_created` 推送
- 工时：3h
- 文件：3-4（incident 收集模块 + 端点 + WS handler + 测试）

**子 PR-3b：前端 StatusBlock**
- 新建 `components/dashboard/StatusBlock.tsx`
- Dashboard 顶置插入
- 工时：3h
- 文件：2-3（组件 + 测试 + DashboardPage 接入）
- D 拍板：D5 / D6 / D7 / D8

---

## 6. 验收门槛

### 6.1 P3C（小功能，最小验证）

- [ ] typecheck 0
- [ ] FilesPage 文件夹 hover 触发霓虹边框 + 微旋转
- [ ] prefers-reduced-motion 下无动效
- [ ] FilesPage 现有 e2e 全绿

### 6.2 P3A / P3B（完整验证）

- [ ] 后端 typecheck 0 + 单测全绿
- [ ] 前端 typecheck 0 + vitest 全绿 + e2e 主路径跑通
- [ ] 后端 `/metrics` 与 `/incidents` 端点 Zod 校验
- [ ] WS `incident_created` 推送握手通

### 6.3 全局

- [ ] 不引入新动画库（sparkline 手写 SVG）
- [ ] 不引入 emoji
- [ ] 新色值（如有）入 `design-system-mapping.md` §1
- [ ] 不改后端契约以外的现有接口

---

## 7. 风险与依赖

| 风险 | 等级 | 缓解 |
|---|---|---|
| 后端指标采集多实例共装无法拆分到 ServerID | 中 | UI 文案明示「系统资源（多实例）」+ D2 选项 B 默认 |
| sparkline 性能（高频轮询 + 重渲染）| 低 | 60fps 限制 + window 滚动 60s 一次性绘制 |
| incident 环形缓冲重启清空 | 低 | 文档明示 + 不落审计（incident ≠ audit log）|
| FilesPage 改样式破坏 Figma 1:1 | 中 | 仅加 hover 状态，默认态与 Figma 一致 |

---

## 8. 建议决策顺序

```
1. PR-1（P3C）立即开——前端独享，无后端阻塞
2. PR-2a → PR-2b（资源图）——后端先行
3. PR-3a → PR-3b（Status Block）——后端先行
```

每个 PR 独立 merge，commit 链清晰可回滚。

---

*创建日期：2026-08-18 · P3 动效设计*