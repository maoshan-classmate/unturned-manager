# LDM Phase 4 高级能力 — 实施契约层

> **承接**：`docs/architecture/ldm-integration-design.md` §11.1 B4 + F4 + §12.5 Phase 4 简略规格
> **状态**：2026-08-15 已实施（commit `e6f12b4` + `15e233a` 错误码语义修正）
> **真源**：LDM 仓 `SmartlyDressedGames/Legally-Distinct-Missile` `Rocket.Unturned/Commands/CommandRocket.cs`（`/rocket reload <plugin>` 行为）
>
> **实施修订（2026-08-15 审计后）**：
> - **错误码语义**：选项 A（代码真抛）——reload/load/unload 时插件不存在/未加载 → 抛 `plugin-not-found`(404)；10s 无响应 → 抛 `pty-timeout`(500)；同 server 并发重入 → 抛 `operation-conflict`(409)
> - **互斥锁**：排队串行 → 拒绝式（有任务在跑即抛 409，不再排队）
> - **失败锚点**：`The plugin X is not loaded`（真源 U.cs:98）加入插件不存在检测，避免白等 10s
> - **成功加速**：waitForMarker 正则补 `Reloading`（真源 U.cs:97 `command_rocket_reload_plugin`）
> - **搜索空态**：筛选中 0 匹配显示「无匹配插件」（非「当前未安装任何插件」）
> - **版本匹配**：`startsWith` 前缀（设计 §4.1 原案，非 includes 子串）
> - **错误码命名**：search 端点统一 `status-invalid`（设计稿原案）

---

## 0. 一句话结论

Phase 4 拆 4a（单插件 reload，2-3 人天）+ 4b（插件搜索/筛选，1-2 人天），合计 **3-5 人天**——和 §12.5 估算一致。核心交付：后端 2 个方法（`LdmPluginCommandsService.reloadPlugin` + `LdmDiscoveryService.searchPlugins`）+ 2 端点（`POST /reload-plugin` + `GET /plugins/search`）+ 前端 InstalledTab 顶部 SearchInput + 状态 chip 筛选 + reload 按钮（二次确认）。

---

## 1. 背景与目标

### 1.1 Phase 1-3 已闭环的能力

| 期 | 已实现 |
|---|---|
| Phase 1 | 列表已装 + 加载/卸载 + LDM-Community 浏览 + GitHub PAT + 上传 .dll |
| Phase 2 | 结构化字段编辑器（XML 解析 + 原子写）+ 重启流水线 + 关于 LDM 卡 |
| Phase 3 | 引导 SOP 卡 + 状态卡 + 详情抽屉 + 4 Tab 骨架 |

### 1.2 Phase 4 要补的 UX 闭环缺口

Phase 1-3 后用户已能 **装、卸、配置**，但还有 2 个高频场景没覆盖：

1. **B4：插件状态异常后能否「不动整个 U3DS 就重新挂载」**——社区已知 reload 会破坏部分插件状态，但运行时崩溃或状态污染时是必要的恢复手段（LDM 提示「Please reload individual plugins instead」正是为此设计）
2. **F4 兼容 + 搜索/筛选**：插件多了之后（30+ 个），列表页没法快速定位——需要按 .dll 名 / 版本前缀搜索 + 按运行时状态筛选

### 1.3 钉死的边界（不变项）

| 边界 | 出处 |
|---|---|
| **全局 `/rocket reload` 不暴露** | `prohibitions.md` 钉死；Issue #1794；设计 §11.1 B5 |
| **单插件 reload「不承诺成功」** | 设计 §11.1 B4——加警告 + 二次确认 |
| **PTY 终端 owner-trust 模型不变** | ADR-0004 Phase 6 |
| **不接管插件签名/哈希校验** | 设计 §11.1 J3——二进制风险；用户自验 |
| **不接管插件兼容性矩阵** | 设计 §11.1 F4——维护成本 O(n³) |
| **不接管 cvar 全局 reload** | 设计 §11.1 J6 |

---

## 2. 总体切片（4a + 4b）

| 期 | 主题 | 工作量 | 后端模块 | 端点 | 前端 | 升期依赖 |
|---|---|---|---|---|---|---|
| **Phase 4a** | 单插件 reload + 警告 UX | 2-3 人天 | `LdmPluginCommandsService` 增 `reloadPlugin(serverId, name)` | +1 = 14 端点 | PluginCard 加 reload 按钮 + ConfirmDialog（二次确认「可能破坏插件状态」） | Phase 1-3 全绿 + Linux 真机验证 reload 行为 |
| **Phase 4b** | 插件搜索/筛选 | 1-2 人天 | `LdmDiscoveryService` 增 `searchPlugins(serverId, query)` | +1 = 14 端点 | InstalledTab 顶部 SearchInput + 状态 chip（全部/已加载/已卸载/加载失败） | Phase 4a 完成 |
| **合计** | — | **3-5 人天** | 2 方法 | 14 端点 + 1 WS | InstalledTab 增强 | — |

**为什么 4a/4b 拆**：reload 涉及 PTY 写命令 + 状态机推断（reload 成功/失败的 stdout 边界）+ 二次确认 UX，单独测；搜索/筛选纯客户端逻辑（路径过滤），工作量小，独立交付。

---

## 3. Phase 4a — 单插件 reload（2-3 人天）

### 3.1 后端：LdmPluginCommandsService 增 reloadPlugin

**职责**：PTY 写 `/rocket reload <name>`（**不**带 `\r`）+ 解析 stdout 区分 reload 成功/失败。

**接口**（`shared/contracts/ldm.ts` 加 `reloadPlugin` 到 `ILdmPluginCommandsService`）：

```typescript
/**
 * PTY 写 `/rocket reload <name>`——单插件 reload（加警告，**不保证成功**）。
 *
 * **关键边界**（§11.1 B4 + LDM 官方 CommandRocket.cs）：
 * - 社区已知 reload 会破坏部分插件状态（依赖全局单例/计时器/缓存的插件）
 * - 面板**必须**前端弹二次确认（设计 §11.1 B4）
 * - 后端**不**主动判断插件是否「安全可 reload」——一律放过，由前端警告 + 用户决策
 *
 * @param serverId 实例标识
 * @param pluginName 插件名（Linux 大小写敏感）
 * @returns outcome + LDM stdout 末尾（≤ 256 字）
 *   success = 命令已接受（reload 已触发，非 reload 最终成功——成功零日志）
 *   failure = LDM 拒绝（加载执行失败 `Failed to load`）
 * @throws AppError('server-not-running') 实例未运行
 * @throws AppError('plugin-not-found') 插件未安装/未加载
 * @throws AppError('pty-write-failed') PTY 写入失败
 * @throws AppError('pty-timeout') 10s 内未收到 LDM 响应
 * @throws AppError('operation-conflict') 已有同 server 的 plugin command 在跑
 */
reloadPlugin(
  serverId: ServerId,
  pluginName: string,
): Promise<{ outcome: "success" | "failure"; ldmOutput: string }>;
```

**实现要点**（参考已有 `loadPlugin` / `unloadPlugin`）：

```typescript
async reloadPlugin(serverId: ServerId, pluginName: string) {
  // 复用现有 run() 框架——verb 增 "reload" 分支
  return this.run(serverId, pluginName, "reload", [
    /Reloading\s+|Reload\s+/i,  // 成功锚点
    // failure 锚点：复用 isFailureLine() 全局函数（已识别 Failed / Unable to / Could not）
  ]);
}
```

**真源核对**：`LDM/Rocket.Unturned/Commands/CommandRocket.cs` 的 `Reload` 命令处理：
- 输入 `/rocket reload <plugin>` → `Reload(player, command)`（CommandRocket.cs:175-186）
- 子串匹配（不区分大小写）：`pl.Name.ToLower().Contains(command[1].ToLower())`
- 找到 → 调用 `pl.ReloadPlugin()` → RocketPlugin.cs:132 触发 `Logger.LogError("Failed to load X, unloading now...")` 异常路径
- 未找到 → 输出 `Plugin X not found`
- 成功 reload → **零日志**（与 load 行为一致）

**单测（≥ 6 用例）**：

1. success 路径：mock `/rocket reload <name>` 写命令，PTY stdout 含「Reloading」→ outcome=success
2. 插件不存在 → stdout 含「Plugin X not found」→ 抛 AppError('plugin-not-found', 404)
3. 插件未加载 → stdout 含「The plugin X is not loaded」→ 抛 AppError('plugin-not-found', 404)
4. failure：reload 抛错 → stdout 含「Failed to load」→ outcome=failure
5. server-not-running → 抛 AppError('server-not-running', 409)
6. 并发 reload 同 server → 第二个抛 AppError('operation-conflict', 409)（拒绝式锁）
7. 超时 10s 无响应 → 抛 AppError('pty-timeout', 500)

### 3.2 API 端点

`POST /api/servers/:id/ldm/reload-plugin`

请求（`ReloadPluginSchema` 加到 `shared/schemas/ldm.schema.ts`）：
```typescript
export const ReloadPluginSchema = z.object({
  pluginName: z.string().regex(/^[A-Za-z0-9._-]+$/, '插件名只能含字母数字 . _ -'),
});
export type ReloadPluginRequest = z.infer<typeof ReloadPluginSchema>;
```

响应（复用 `OperationResponseSchema`）：
```typescript
{
  data: {
    serverId: string,
    pluginName: string,
    outcome: "success" | "failure",
    ldmOutput: string  // ≤ 256 字，failure 时给前端 toast 显示原文
  }
}
```

**错误码**：
- `plugin-name-missing` 400
- `plugin-name-invalid` 400
- `plugin-not-found` 404（插件不存在/未加载，reload/load/unload 共用）
- `server-not-running` 409（PTY 未运行）
- `pty-write-failed` 500
- `pty-timeout` 500（10s 无响应）
- `operation-conflict` 409（同 server 已有 plugin command 在跑，拒绝式锁）

### 3.3 前端 UX

**位置**：InstalledTab 已有的 PluginCard 上（每个 .dll 卡片底部）。

**改动**：
- 在「加载/卸载」按钮旁加「重新加载」按钮（仅 `runtimeStatus === 'loaded'` 时显示——未加载的插件 reload 无意义）
- 点击 → 弹 ConfirmDialog（复用 `components/shared/ConfirmDialog.tsx`，variant=`warning`）：
  ```
  重新加载插件 <pluginName>？
  此操作不保证成功，可能破坏插件状态。建议仅在插件状态异常时使用。
  [取消]  [确认重新加载]
  ```
- 二次确认 → 调 `POST /api/servers/:id/ldm/reload-plugin` → toast「已触发重新加载」（success）/ toast.warning「重新加载未完成：${ldmOutput}」（failure）
- reloadMutation 与 load/unload 共享 `useMutation` 模式；onSuccess 调 `refetch()` 刷新状态

**复用**：
- `components/shared/ConfirmDialog.tsx`（variant=warning 已在 InstallStepsCard 使用）
- `components/ui/button.tsx`（`variant="secondary"` 已有；reload 按钮用 secondary 视觉降权）
- `useMutation` from `@tanstack/react-query`（沿用 InstalledTab 已有的 commandMutation 模式）

### 3.4 PluginCard 改造

新增 prop：
```typescript
onReload?: (pluginName: string) => void;
```

按钮区按 runtimeStatus 分支：
```tsx
<div className="flex gap-2">
  {isLoaded && onReload && (
    <Button size="sm" variant="secondary" onClick={() => setConfirm("reload")}>
      <RefreshCw size={14} /> 重新加载
    </Button>
  )}
  {isLoaded ? (
    <Button ... onUnload />
  ) : (
    <Button ... onLoad />
  )}
</div>
```

确认对话框状态扩展 `"load" | "unload" | "reload" | null`。

---

## 4. Phase 4b — 插件搜索/筛选（1-2 人天）

### 4.1 后端：LdmDiscoveryService 增 searchPlugins

**职责**：复用 `listInstalledPlugins` 的扫描结果做内存过滤（不重新读盘——盘 I/O 一次足够）。

**接口**（`shared/contracts/ldm.ts` 加到 `ILdmDiscoveryService`）：

```typescript
/**
 * 按 query / 状态筛选已装插件——内存过滤（不重新读盘）。
 * Phase 4b 新增——§11.1 F1 列表查询的扩展。
 *
 * @param serverId 实例标识
 * @param opts.query .dll 名 / 版本号 / PluginName 子串匹配（不区分大小写）
 * @param opts.status 运行时状态筛选（loaded/unloaded/failure/cancelled/unknown）；null/undefined = 全部
 * @returns 筛选后的插件列表
 * @throws AppError('server-not-found') 实例不存在
 */
searchPlugins(
  serverId: ServerId,
  opts: { query?: string; status?: PluginRuntimeStatus | null },
): Promise<InstalledPlugin[]>;
```

**实现要点**：
- 内部调 `listInstalledPlugins(serverId)` → 复用其全部逻辑（runtimeStatus 注入）
- 内存过滤：`name.toLowerCase().includes(query.toLowerCase())` + `version?.startsWith(query)` + `runtimeStatus === status`
- query 空字符串 + status null = 返回全部（与 `listInstalledPlugins` 等价）

**为什么是 GET 而非 POST**：纯查询 + 无副作用 + 状态筛选可走 query 参数（RESTful 实践）。

### 4.2 API 端点

`GET /api/servers/:id/ldm/plugins/search?query=&status=`

query 参数：
- `query`（可选，字符串）—— 模糊匹配 .dll 名或版本前缀
- `status`（可选，枚举）—— `loaded` / `unloaded` / `failure` / `cancelled` / `unknown`

响应（直接返回 `InstalledPlugin[]`，复用 Phase 1 schema）：
```typescript
{
  data: InstalledPlugin[]  // 数组直接返回，非包装
}
```

**错误码**：
- `server-id-missing` 400
- `status-invalid` 400（status 参数不在枚举内）

### 4.3 前端 UX

**位置**：InstalledTab 顶部（搜索框 + 状态 chip 在「刷新 / 上传 .dll」按钮旁）。

**改动**：

```
┌─────────────────────────────────────────────────────────┐
│ Mod 框架 > 已装插件                                       │
├─────────────────────────────────────────────────────────┤
│ [搜索 .dll 名或版本...]  [全部][已加载][未加载][失败]    [📤上传 .dll] [🔄刷新] │
├─────────────────────────────────────────────────────────┤
│ 共 5 个插件 · 显示 3 个匹配                                │
│ ┌────────────┐ ...                                          │
│ │ PluginCard │ ...                                          │
│ └────────────┘                                              │
└─────────────────────────────────────────────────────────┘
```

**组件**：复用现有 `components/shared/SearchInput.tsx` + 新增状态 chip（按现有 `Badge` 模式自造）。

**交互**：
- 搜索框：debounce 300ms（避免每次按键都打后端）→ 调 `/plugins/search`
- 状态 chip：单选（`全部` / `已加载` / `未加载` / `失败`），点击切换 → 同上打后端
- query + status 组合查询（AND 关系）
- 结果数显示「共 N 个插件 · 显示 M 个匹配」+ 空态文案「无匹配插件」
- 与 `LdmStatusCard` 兼容：状态卡在上、搜索栏在下（参考「SteamCMD 卡 + 控制按钮」布局）

**复用**：
- `components/shared/SearchInput.tsx`（已存在，ConfigPage 用过）
- `useQuery` 模式（与 LdmStatusCard 同款）

### 4.4 状态过滤的前端映射

| 后端枚举 | 前端 chip 文案 |
|---|---|
| `null`（全部） | 全部 |
| `loaded` | 已加载 |
| `unloaded` | 未加载 |
| `failure` | 加载失败 |
| `cancelled` | 已取消 |
| `unknown` | 未知 |

按 `reference_ui_terms.md` 校对（设计 §11.1 runtimeStatus 5 态，与 InstalledTab 已用文案对齐）。

---

## 5. API 契约（汇总）

### 5.1 端点清单（Phase 4 后 14 端点 + 1 WS）

| # | 方法 | 路径 | 用途 | 阶段 |
|---|---|---|---|---|
| 13 | POST | `/api/servers/:id/ldm/reload-plugin` | 单插件 reload（二次确认） | **Phase 4a** |
| 14 | GET | `/api/servers/:id/ldm/plugins/search` | 按 .dll 名 / 版本 / 状态筛选 | **Phase 4b** |

### 5.2 Zod Schema（`shared/schemas/ldm.schema.ts` 新增）

```typescript
// ─── LDM Phase 4a 契约 ─────────────────────────────────

/** @phase4a POST /api/servers/:id/ldm/reload-plugin 请求 */
export const ReloadPluginSchema = z.object({
  pluginName: z.string().regex(/^[A-Za-z0-9._-]+$/, '插件名只能含字母数字 . _ -'),
});
export type ReloadPluginRequest = z.infer<typeof ReloadPluginSchema>;
```

`GET /plugins/search` 无独立 schema——query 参数校验走 Express middleware（Zod object + parse）。

### 5.3 路由层改动

`manager-server/src/routes/ldm.ts` 加 2 路由：

```typescript
// POST /reload-plugin — 单插件 reload
router.post(
  "/reload-plugin",
  validate(ReloadPluginSchema, "body"),
  asyncHandler(async (req, res) => {
    const serverId = req.params.id as string;
    if (!serverId) throw new AppError("server-id-missing", "实例 ID 缺失", 400);
    const { pluginName } = req.body as { pluginName: string };
    const result = await deps.commands.reloadPlugin(serverId as ServerId, pluginName);
    res.json({ data: { serverId, pluginName, outcome: result.outcome, ldmOutput: result.ldmOutput } });
  }),
);

// GET /plugins/search?query=&status= — 插件搜索/筛选
router.get(
  "/plugins/search",
  asyncHandler(async (req, res) => {
    const serverId = req.params.id as string;
    if (!serverId) throw new AppError("server-id-missing", "实例 ID 缺失", 400);
    const { query, status } = req.query as { query?: string; status?: string };
    if (status && !['loaded','unloaded','failure','cancelled','unknown'].includes(status)) {
      throw new AppError("status-invalid", `状态筛选值非法：${status}`, 400);
    }
    const result = await deps.discovery.searchPlugins(serverId as ServerId, {
      query,
      status: status as PluginRuntimeStatus | null,
    });
    res.json({ data: result });
  }),
);
```

---

## 6. 复用清单

| 对象 | 复用位置 | 复用方式 |
|---|---|---|
| `ConfirmDialog` (shared) | PluginCard reload 确认 | variant=warning（沿用 InfoCard 警告变体） |
| `SearchInput` (shared) | InstalledTab 顶部 | ConfigPage 已有用法 |
| `useQuery` | InstalledTab 搜索状态 | 与 LdmStatusCard 同款 |
| `run()` 私有方法 | LdmPluginCommandsService | 复用 verb="reload" 分支 |
| `isFailureLine()` 全局函数 | LdmPluginCommandsService | 复用 PTY failure 锚点识别 |

---

## 7. 验证门槛

| 门槛 | 工具 | 通过标准 |
|---|---|---|
| 类型检查 | `pnpm run typecheck` | 0 错（前后端 + shared） |
| 后端单测 | `pnpm --filter manager-server test` | 全量绿；reloadPlugin ≥ 6 用例；searchPlugins ≥ 4 用例 |
| 前端单测 | `pnpm --filter manager-web test` | 全量绿；PluginCard reload 按钮 ≥ 3 用例；InstalledTab 搜索 ≥ 2 用例 |
| E2E | playwright | 「reload 成功 → 插件状态变 Loaded」 + 「搜索 Uconomy → 仅 Uconomy 卡片可见」 |
| 文档同步 | doc-outdated-guard | `unturned-sop.md` §LDM + `reference_ui_terms.md` 不引入新术语 |
| 实机验证 | Linux U3DS + LDM | `reloadPlugin` 在真机 reload 后状态变更正确；`searchPlugins` 不崩盘 |

**新增单测清单**：

后端：
- `tests/ldmPluginCommandsService.test.ts` 加 6 用例（reload 行为）
- `tests/ldmRoutes.test.ts` 加 4 用例（reload-plugin 端点 × 2 + plugins/search × 2）
- `tests/ldmDiscoveryService.test.ts` 加 4 用例（searchPlugins 内存过滤）

前端：
- `manager-web/src/pages/LdmPage.test.tsx` PluginCard 描述增 3 用例（reload 按钮渲染 / ConfirmDialog / mutation 调通）
- 新增 `manager-web/src/pages/InstalledTab.test.tsx` 4 用例（搜索 + 状态 chip + 组合查询 + 空态）

---

## 8. 不进 Phase 4 的能力（拒绝清单）

| 能力 | 拒绝理由 | 文档锚点 |
|---|---|---|
| 全局 `rocket reload` | U3-SDK Issue #1794 + LDM 官方已删 | prohibitions.md |
| 单插件「安全可 reload」自动判断 | 无可靠方法 | §11.1 B4 |
| 插件兼容矩阵自动校验 | O(n³) 维护成本 | §11.1 F4 / ADR-0006 §3.1 |
| 插件签名/哈希 | 二进制风险，用户自验 | §11.1 J3 |
| cvar reload | 无官方热重载 | prohibitions.md |
| Tebex 集成 / 商业化 | 钉死不接商业化 | decision-no-auto-install-steamcmd-u3ds.md |

---

## 9. 完成定义（Definition of Done）

- [ ] reloadPlugin 方法实现 + 单测 ≥ 6 用例
- [ ] searchPlugins 方法实现 + 单测 ≥ 4 用例
- [ ] 2 端点 + 2 单测 ≥ 4 用例路由层
- [ ] PluginCard 加 reload 按钮 + ConfirmDialog 警告 UX
- [ ] InstalledTab 顶部 SearchInput + 状态 chip
- [ ] 前后端 typecheck 0 错
- [ ] 前端单测覆盖：PluginCard reload + InstalledTab 搜索/筛选 ≥ 7 用例
- [ ] 文档同步：`unturned-sop.md` §LDM 加 reload + 搜索说明；`reference_ui_terms.md` 不变（沿用现有文案）
- [ ] commit message 走 `<操作名>: <≤30 中文字符>`；Phase 4 所有提交独立可回滚

---

## 10. 升期门控

按 §12.7：本期交付后必须通过「类型检查 + 单测覆盖率 ≥ 80% + E2E ≥ 1 用例 + 实机验证 + 接口契约 + 文档同步 + 提交规范」7 项才能开下一期。

**Phase 4 没有下一期**——这是 LDM 接入规划的最后一期（§12.1 总工期 30-39 人天）。Phase 4 完成后 LDM 接入闭环。

---

## 11. 关联文档

- `docs/architecture/ldm-integration-design.md` §11.1 B4/F1/F4 + §12.5 Phase 4
- `docs/architecture/ldm-phase2-design.md`（实施契约层模板，§1.2 钉死边界）
- `docs/adr/0006-ldm-framework-integration.md`（ADR 边界决策）
- `.claude/rules/unturned-sop.md` §LDM（重启流水线 + G5 边界）
- `.serena/memories/session-checkpoint-2026-08-15-ldm-phase3-3-frontend.md`（Phase 3-3 闭环基线）
- `claudedocs/reference_ui_terms.md`（界面文案术语对照表）

---

_版本：v0.1 设计稿 · 2026-08-15_