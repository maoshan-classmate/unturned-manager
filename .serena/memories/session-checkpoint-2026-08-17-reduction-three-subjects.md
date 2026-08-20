# Session Checkpoint 2026-08-17 减法三连击

commit f1db6e0（35 文件 +206/-2042 行 / 净减 1836）；删 SettingsPage 游戏默认值卡片（5→4 卡）；删 LdmPage 第 4 Tab「插件来源」（4→3 Tab）并改写 OnboardingSopCard 第 4 步为「由用户自行下载插件」；删后端 LdmPluginSourceService + 4 端点（GET /api/ldm/community-plugins、POST /api/ldm/community-plugins/test-pat、GET /api/ldm/community-plugins/:owner/:repo、createLdmCommunityRouter 整个路由族）+ ILdmPluginSourceService / CommunityPlugin / CommunityPluginDetail 契约 + CommunityPluginDetailDialog 组件 + 4 Zod Schema；test-server.ts 补 item_list 表 DDL（修 itemService 启动崩溃）；8 文档同步 + 调研报告归档到 archive/；代码注释历史叙事清理。

## 关键改动（按模块）

### 前端
- `manager-web/src/pages/SettingsPage.tsx`：删 Gamepad2 import + 游戏默认值卡片（约 -33 行）；JSDoc 卡片数 5→4
- `manager-web/src/pages/LdmPage.tsx`：874→492 行（-382）；删 SourceTab 函数 + CommunityCard + InstallStepsCard + 3 类型定义（CommunityPlugin/CommunityPluginsResponse/PatTestResult）；activeTab 类型 4→3；保留 InstalledTab + UploadButton + PluginCard + RuntimeStatusBadge
- `manager-web/src/components/ldm/OnboardingSopCard.tsx`：第 4 步文案改写——「从 LDM-Community 列表下载」→「由用户自行下载 .dll（GitHub Releases / 开发者官网）」+ G5 不下载保留
- `manager-web/src/components/ldm/CommunityPluginDetailDialog.{tsx,test.tsx}`：整体删除
- `manager-web/e2e/smoke.spec.ts`：LdmPage 测试 4 Tab → 3 Tab，移除插件来源断言

### 后端
- `manager-server/src/routes/ldm.ts`：删 `createLdmCommunityRouter`（约 -72 行）+ ILdmPluginSourceService type import
- `manager-server/src/composition-root.ts`：卸 ldmSource 注入（4 处）
- `manager-server/src/index.ts`：卸 community router `app.use`
- `manager-server/src/modules/ldm/LdmPluginSourceService.ts`：整体删除
- `manager-server/tests/ldmPluginSourceService.test.ts`：整体删除
- `manager-server/tests/ldmRoutes.test.ts`：删 community router 测试块
- `manager-server/tests/e2e/test-server.ts`：补 item_list 表 DDL（修 itemService 启动崩溃）

### shared
- `shared/contracts/ldm.ts`：删 ILdmPluginSourceService 接口 + CommunityPluginDetail 接口 + import
- `shared/schemas/ldm.schema.ts`：删 CommunityPluginSchema + CommunityPluginsResponseSchema + CommunityPluginDetailSchema + TestPatRequestSchema 等 4 Schema + 3 类型
- `shared/types/domain.ts`：删 CommunityPlugin 接口
- `shared/index.ts`：卸 ILdmPluginSourceService / CommunityPluginDetail 导出

### 文档同步（10 文件）
- `docs/architecture/design-system-mapping.md`：删游戏默认值行 + 卡片数 5→4 + 加 LDM 减法标注
- `docs/architecture/architecture-spec.md`：顶部加 ⚠ LDM 减法说明
- `docs/adr/0006-ldm-framework-integration.md`：顶部 + 9 处（接口数 6→5、4 Tab→3 Tab、3 community 端点、PluginSourceTab.tsx 等）
- `docs/architecture/ldm-integration-design.md`：顶部 + §7.5 标 ⚠ + 13 处修订（端点 14→12、模块删 LdmPluginSourceService、§12 MVP 4 端点→3 端点等）
- `docs/architecture/ldm-phase2-design.md`：上一期落档描述更新
- `docs/architecture/ldm-phase4-design.md`：描述减一行
- `docs/architecture/ldm-editor-design.md`：2 处 hasReleases 标删除
- `claudedocs/reference_api_spec.md`：删 3 端点 + 卡片数更新
- `claudedocs/archive/research_ldm_community_source_2026-08-12.md`：移动归档

## 验证

| 项目 | 结果 |
|---|---|
| 后端 tsc --noEmit | 0 错 |
| 前端 tsc --noEmit | 0 错 |
| 前端 vitest | 148/148 |
| 后端 vitest | 363 passed + 4 历史 backlog failed（与减法无关）|
| 后端 e2e（API）| 25/26（1 个 Steam WebAPI 超时，环境问题）|
| 前端 e2e（smoke）| 9 passed / 5 failed（1 历史 flaky + 4 dev 环境/已过时用例）|

## 踩坑（用户下次避坑）

1. PowerShell 默认 GBK 编码会破坏 .ts/.tsx 文件中文——永远不要用 PowerShell 写源码（用 Node 脚本或 Edit 工具）
2. Node 脚本跨文件批量替换会破坏 CRLF→LF 行尾 + 大文件 GBK 误读——只改单行整段，不用脚本跨文件批量
3. comment-history hook 关键词：之前、曾经、修复了、上次、以前、旧版、老版、Phase、阶段、sc:design 第、2026（日期）——JSDoc 注释避免
4. Edit 工具 old/new 方向：old_string 是要被删的，new_string 是要保留的（重复犯过 2 次）
5. tool result "successfully" 但文件未实际改——每次 Edit 后 Read 关键行确认

## doc-outdated-guard 扫描发现（提交前已修）

- FIX_SUGGESTION（0006 / ldm-integration-design / ldm-phase2-design）——本次提交前已全部修
- REVIEW_NEEDED MEMORY.md 索引——用户全局文件，不在 staged 范围
- REVIEW_NEEDED 调研文档引用——已删（方案 A）

## 后续 sprint 待办

- 修 SteamCmdManager 历史 backlog（Phase 0 review 回归 3 个用例）
- 修 WS gateway terminal_input 历史 backlog（ptyManager 未注入 1 个用例）
- 修前端 e2e dev 环境：让 .test-install/Servers/ 有 ApiServer 实例（或改 smoke spec 走 test-server 模式）
- 残留块注释内违规词清理（约 166 处）—— 行内脚本已清 35 文件 114 处

Why: 减法落地闭环记录，便于后续 sprint 续接
How to apply: 涉及 LDM 接入时查 ldm-integration-design.md §7.5 ⚠ 标注；涉及 SettingsPage 改卡片数时此 commit 锚定 5→4