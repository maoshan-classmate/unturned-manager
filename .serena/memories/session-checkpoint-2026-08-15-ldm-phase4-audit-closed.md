## Session Checkpoint 2026-08-15 — LDM Phase 3-3 前端 + Phase 4 全链路 + 三轮审计闭环

> **承接**：Phase 2+3 后端 commit `f03ea3d`（4 commit：65e24c9 / 1f3f2c8 / 5cb7080 / f03ea3d）
> **本会话范围**：Phase 3-3 前端落地 → Phase 4 设计稿 + 实施 → 三轮独立审计（Phase 4 / Phase 2 / Phase 3）→ 全量缺陷修复 → 设计稿体系对齐

---

## Commit 落档（本会话 10 个）

| Commit | 内容 |
|---|---|
| `f944bc8` | 功能实现: LDM Phase3-3前端引导卡+详情抽屉+2读端点 |
| `42c7031` | 文档规范: LDM Phase3-3前端checkpoint+LdmPage e2e闭环 |
| `5d85071` | 架构设计: LDM Phase4高级能力设计稿(B4 reload+搜索) |
| `b8727c4` | 修复: 单测backlog清理(PTY \n同步+前端mock串台+Loadout去重) |
| `e6f12b4` | 功能实现: LDM Phase4高级能力(B4 reload+插件搜索筛选) |
| `15e233a` | 修复: Phase4审计问题(错误码语义+失败锚点+搜索空态) |
| `b5ae90d` | 文档规范: Phase4设计稿对齐实现(错误码+单测+状态) |
| `db5cd35` | 修复: Phase2-3审计P0致命bug+文案泄漏+单测补齐 |
| `73823de` | 文档规范: 设计稿审计对齐(错误码/钩子/端点)+Sprint工作流归档 |
| `e7c5d8b` | 文档规范: ADR-0006端点形态对齐(community-plugins两段参数) |

**LDM 接入全部闭环（Phase 1-4）**：14 端点 + 1 WS + 6 后端模块 + 8 共享契约 + 前端 4 Tab + 3 份设计稿 + ADR-0006。

---

## 用户关键决策（下次会话沿用）

1. **Phase 3-3 Tab 拆分**：本 PR 带 FrameworkConfigTab 骨架 + LdmAboutCard（不拆 PR）
2. **CommunityCard 双入口布局**：标题旁加 Info 按钮（按钮区只留「上传到此实例」）
3. **Clipboard API**：沿用项目惯例 `navigator.clipboard.writeText` 裸调，失败 sonner toast（不引入兜底）
4. **Phase 4 错误码语义 = 选项 A**：代码真抛 `plugin-not-found`(404) / `pty-timeout`(500) / `operation-conflict`(409)——load/unload/reload 统一
5. **修复范围（Phase 2-4 审计）**：修 P0 + 关键 P1（P2 轻微项记录待办）
6. **workflow_sprint5_ldm_phase1.md 归档删除**：Phase 1 完成，Sprint 生命周期规则

---

## Phase 3-3 前端落地

**5 新组件 + 2 改造 + Tab 2→4**：

| 组件 | 职责 |
|---|---|
| `LdmStatusCard` | InstalledTab 顶部——主框架/配置目录/插件总数 3 徽章（useQuery /status） |
| `LdmAboutCard` | FrameworkConfigTab 顶部——版本 + 模块状态（双 useQuery /version + /modules-state） |
| `OnboardingSopCard` | 全局顶部 5 步引导 + 复制命令（localStorage 折叠记忆） |
| `CommunityPluginDetailDialog` | 详情抽屉——README 预览 + Releases 外链（守住 G5 不下载） |
| `FrameworkConfigTab` / `PermissionsTab` | 4 Tab 骨架（编辑器留 Phase 4） |
| `CommunityCard` 改造 | 标题旁 Info 按钮 + 「前往 Releases」 |
| `LdmPage` | Tab 2→4 + 顶层 detailSlug state |

**后端补 2 读端点**（支撑 LdmAboutCard）：`GET /version` + `GET /modules-state`（Phase 2 后端方法未暴露路由）。

---

## Phase 4 实施

**后端**：`LdmPluginCommandsService.reloadPlugin`（PTY `/rocket reload <name>`）+ `LdmDiscoveryService.searchPlugins`（内存过滤）+ 2 端点。

**前端**：PluginCard reload 按钮（ConfirmDialog warning 二级确认「不保证成功」）+ InstalledTab SearchInput（debounce 300ms）+ 状态 chip（6 态）。

---

## 三轮审计（全部独立 agent 派发）→ 缺陷全修

> **驱动**：用户质疑「3-5 人天 1 会话做完不现实」——正确。三轮审计揪出大量欠账。

### Phase 4 审计（第 1 轮）
- 严重缺失：前端 Phase 4 新功能零单测 / searchPlugins 零单测 / e2e 零
- 真实缺陷：reload 未加载插件白等 10s（缺 `The plugin X is not loaded` 锚点）、waitForMarker 缺 Reloading、错误码 4 个承诺不抛、搜索空态文案错、toast「已重新加载」误导、版本 includes 非 startsWith

### Phase 2 审计（第 2 轮）—— 2 个 P0 致命 bug
- **P0-1**：applyChangesCore postStartHook 在 STARTING 执行（startInternal 异步返回）→ LDM `/p reload` 权限重载永远不执行 → **权限组配置改完不生效**。修复：加 `waitForState`（15s 超时降级）等 RUNNING
- **P0-2**：serializeRocketUnturnedConfig 用 `findElement` 找根元素永远找不到 → **9 字段修改不写回**。修复：`root = tree`
- **P0-3**：缺 PUT /rocket-unturned-config 路由 → writeRocketUnturnedConfig 是死代码。修复：补路由 + 测试

### Phase 3 审计（第 3 轮）
- 严重缺失：getStatus / getPluginDetail service 层零单测
- 4 处界面文案内部术语泄漏（U3DS / Rocket / PTY / LDM 全称）
- readmePreview 语义错位（release body 非 README）

### 修复清单
- 错误码语义：run() 框架改拒绝式锁（Set 替代 Map 队列）+ not-found/not-loaded 抛 404 + 超时抛 500
- 失败锚点补 `The plugin X is not loaded`（真源 U.cs:98）
- 5 项 Phase 4 缺陷全修
- 4 处文案泄漏修 + 4 处测试缺口补（applyChangesCore 4 / Rocket.Unturned round-trip 3 / getStatus 4 / getPluginDetail 3）
- 设计稿体系对齐（integration + phase2 + phase4 + ADR-0006）

---

## 关键 bug 与根因（下次会话参考）

1. **`vi.spyOn` 跨测试残留**：`vi.clearAllMocks()` 不清 spy 实现，`vi.restoreAllMocks()` 才能还原——steamCmdManager 3 fail 因此
2. **`userEvent.click` 对 @base-ui/react Button 失效**：改 `fireEvent.click` 同步触发
3. **navigator.clipboard 是只读 getter**：`Object.assign` 无效，需 `Object.defineProperty`
4. **startInternal 异步返回 STARTING**：RUNNING 靠 1s 塞命令 + ready 正则 / 3s 兜底——postStartHook 需 waitForState
5. **axios 错误码路径**：`err.response.data.error.code` 非 `err.code`
6. **`setElementBool` 输出 .NET PascalCase**：`True`/`False` 非小写——测试断言要匹配
7. **httpClient 底层用全局 fetch**：测试 fetchMock 可拦 enrich + releases 全部调用

---

## 验证门槛最终态

- 前后端 + shared typecheck **0 错**
- 前端单测 **161/161** 全绿
- 后端单测 **348/377**（3 fail = 已知 steamCmdManager mock 串台 backlog，与本次无关）
- LDM 相关测试全覆盖：ldmRoutes 28 / ldmPluginCommandsService 12 / RocketConfigXmlParser 12 / ldmDiscoveryService 15 / ldmPluginSourceService 16 / serverManager 35 / LdmApplyService 等

---

## 剩余 backlog（记录不阻塞）

| 项 | 说明 |
|---|---|
| steamCmdManager 3 fail | mock 串台——构造函数注入 mock 架构重构 |
| serializePermissionsConfig 未知键丢失 | Groups 整体重建丢手写未知键（设计 §3.1 承诺冲突） |
| writer 内 Zod 校验 | 校验只在路由层，绕过路由直调 writer 可写非法字段 |
| 占位卡「16 字段」文案 | 实际 9 字段可编辑（RCON 排除） |
| mod_apply 未接入 applyChangesCore | WorkshopApplyService.applyStaged 仍在 startInternal 内（非 applyChangesCore 共用方）——设计稿已标注未兑现 |
| readmePreview 语义 | 实际 release body 非 README——设计稿已标注 |
| e2e Phase 4 reload 场景 | 需真机 U3DS RUNNING（Sprint 5 实机验证项） |

---

## 下次会话接手点

1. **LDM 接入全闭环**——Phase 1-4 完成；升期门控 §12.7 剩「实机验证」（Sprint 5 Linux U3DS 跑通 Phase 3-4）
2. **steamCmdManager backlog**：mock 架构重构（构造函数注入，避免共享全局 fakeXxx）
3. **P2 轻微项**：按上表逐项（未知键 / Zod / 文案 / mod_apply 接入）
4. **设计稿体系已对齐**——三份设计稿 + ADR 与代码一致，可直接作实施依据

---

## 关联文档

- `docs/architecture/ldm-integration-design.md`（主设计稿，头部「实施与审计修订」块）
- `docs/architecture/ldm-phase2-design.md`（实施修订块）
- `docs/architecture/ldm-phase4-design.md`（实施修订块 + 错误码对齐）
- `docs/adr/0006-ldm-framework-integration.md`（端点形态对齐）
- `claudedocs/research_ldm_community_source_2026-08-12.md`（引用清理）
- `.serena/memories/session-checkpoint-2026-08-15-ldm-phase3-3-frontend.md`（Phase 3-3 基线）
- `.serena/memories/session-checkpoint-2026-08-15-ldm-phase2-3.md`（Phase 2+3 后端基线）