# Session Checkpoint 2026-08-13 — v2.6 保存与重启解耦 + 文档铁律

两件事一组提交：v2.6 重构 + 文档铁律。前者解耦保存与重启，后者清掉全仓 `rules/`+`reference_*.md` 历史叙述。

## v2.6：保存 Mod 与服务器重启解耦

**核心决策**：拆为三个独立动作——下载、保存、重启——三者无强绑定。

| 动作 | 入口 | 副作用 | 服务器要求 |
|---|---|---|---|
| 下载 Mod | `POST /mods/download` → `SteamCmdManager.downloadWorkshopItem` | 文件落 `Workshop/staging/...` | 可运行中 |
| 保存 Mod | `PUT /config/workshop` → `ConfigService.writeWorkshopFileIds` | 写 `WorkshopDownloadConfig.json` 的 `File_IDs` | 可运行中（U3DS 不重读） |
| 移动 + 启动 | 用户手动重启 → `ServerManager.startInternal` → `WorkshopApplyService.applyStaged` → `startPty` | 移动 staging → content + spawn U3DS | **STOPPED**（RUNNING 守卫天然保证） |

**为什么这样拆**：U3DS 只在启动时读 `WorkshopDownloadConfig.json`（运行中不重扫目录，U3-SDK `WorkshopDownloadConfig.Use_Cached_Downloads`）。所以「写 File_IDs」运行时零风险。「移动 staging → content」必须停服（SOP 铁律：写入运行中服务端直接读取的位置有风险），但放进 `startInternal` 顶部就自然满足停服条件——start 流程只在非 RUNNING 时执行，RUNNING 时守卫直接 return。

**顺带 bug 修复**：原 `applyStaged` 用 content acf 全量覆盖 `File_IDs`，导致前端「禁用」操作失效（acf 全量推导必然包含已禁用的 mod）。v2.6 拆开后 `File_IDs` 仅由用户勾选列表唯一写入。

## 删除项

- `POST /api/servers/:id/mods/apply` 路由
- `ServerManager.applyModChanges` 方法（145 行）
- `IServerManager.applyModChanges` 契约
- `mod_apply` 状态机操作类型 + 中文标签
- `ModApplyRequestSchema` / `ModOperationResponseSchema`
- `ModApplyProgressEventSchema` 的 6 个 stage（收敛为 `ready` / `failed`）
- UI 「应用 Mod 变更」确认框 + `handleApplyConfirm` + `applyConfirmOpen` state
- crash 守卫里 `mod_apply` 分支（不再需要）

## 新增/修改

- `startInternal` 顶部加 `applyStaged` 调用（移动零冲突）
- `applyStaged` 简化为 4 步：parse staging acf → addItem → mv → 广播（无备份/无回滚 config / 不写 File_IDs）
- 前端 `handleConfig` workshop 分分支调 `PUT /config/workshop`，toast「已保存，重启服务器后生效」

## ADR 修订

ADR-0006 原计划「在 `applyModChanges` 加 ldmApply 分支」，因 v2.6 删除 `applyModChanges` 而作废；`applyChangesCore` 改为从零抽取，母体不复用已删除的壳。LDM Phase 2 实施时按新规对齐。

## 测试

- `tests/serverManager.test.ts`：删 applyModChanges 409 测试 + 新增 startInternal 先 applyStaged 再 spawn 的2 个测试（含失败上抛分支）
- `tests/workshopApplyService.test.ts`（新）：4 用例——空跳过、有货移动且不写 File_IDs、已存在跳过 addItem、失败上抛且不回滚 config
- 后端 268+1skip、前端 64+（含新测试）

## 提交

- `0320a8a` 功能重构：保存 Mod 与服务器重启解耦（v2.6）——21 文件 +479/-441
- `c0b2dee` 文档规范：rules/ 与 reference_*.md 不维护历史信息——3 文件 +54/-68

## doc-outdated-guard 三轮实战

commit0320a8a 含7 个 .md → guard 报 5 FIX（subagent 一次性修完）→ 二次复查补扫 14 FIX（Python一次性清）。
commit c0b2dee 含3 个 .md → guard 报 14 FIX + 2 REVIEW，14 FIX Python一次性清，2 REVIEW 裁定保留（路径日期 stamp 是 `research_*_YYYY-MM-DD.md` 命名规范的真实文件名；端点表 ⚠️/❌ 是「当前未修」清单，不是历史断面）。

## 文档铁律（新立）

`document-organization.md` 新增 §「不维护历史信息」：适用范围 `.claude/rules/*.md` + `claudedocs/reference_*.md`——只写当前事实，变更理由归 `git log` / ADR / `claudedocs/archive/`。

写法禁止：「v* 修订」「Phase 1 — 当前」类相对时态标题、`~~xxx~~` 删除线行、「已修复 / 已落地 / 已实现」类带历史动作的陈述、日期 stamp（如 `2026-08-13`）、commit SHA 引用。

## 教训

- **Edit 工具对含 box-drawing 字符（├─ └─ 等）的多行块匹配不稳定**：多次 Edit 失败时改用 Write 全覆盖或 Python `replace`（PowerShell + Python 配合，bash 反引号会触发命令替换）。写文档类工具时优先 Write 全覆盖，避免 Edit 在中文+特殊字符场景下反复失败浪费时间。
- **「代码注释也要跟着改」是真理**：v2.6 后大量注释残留 `applyModChanges` / `apply_changes_core` / `mod_apply` / `mod_apply_progress` 等旧 API 引用——这些注释不是历史（grep 看到会误以为是真东西）。本次 T11 + T12 + T15 三轮清扫才把全仓净化到只剩 ADR 修订栏 + 头注。
- **「不维护历史信息」是文档角色定位**：rules/ 与 reference_*.md 是「打开就用」的现场读物，变更理由归 git log/ADR/归档，不是文档正文。Linter/guard 报「~~已删」「Phase 1 — 当前」类写法属于违规。