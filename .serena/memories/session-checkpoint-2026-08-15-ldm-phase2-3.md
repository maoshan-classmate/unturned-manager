## Session Checkpoint 2026-08-15 — LDM Phase 2 + 3 后端落地 + Phase 3-3 评估

> **承接**：LDM Phase 1 commit `cfa662b`（2026-08-13）—— Mod 框架基础闭环
> **本次会话范围**：Phase 2a + 2b + 3 后端（4 commit 落档）+ Phase 3-3 前端评估（Plan agent 报告未开工）

---

## 4 Commit 落档清单（ahead of origin/main 待 push）

| Commit | 内容 | 工作量 |
|---|---|---|
| `65e24c9` | Phase 2a-1：RocketConfigXmlParser + 契约层 + 9 单测 | ~2h 对话 |
| `1f3f2c8` | Phase 2a-2 + 2a-3：LdmConfigWriter + 4 端点 + 14 单测 | ~4h 对话 |
| `5cb7080` | Phase 2b：applyChangesCore 抽出 + LdmApplyService + D2/D3/D4 + POST /apply + 22 单测 | ~3h 对话 |
| `f03ea3d` | Phase 3 后端：getStatus + getPluginDetail + GET /status + GET /community-plugins/:owner/:repo + 4 单测 | ~1.5h 对话 |

---

## 用户关键决策（需在下次会话沿用）

1. **「保存配置」vs「应用变更」完全解耦**——`LdmConfigWriter` 写文件运行时允许（不强制 STOPPED）；`LdmApplyService` 走 `applyChangesCore` 重启流水线由用户主动触发（不自动）
2. **G5 不变**——面板不自动下载 .dll（防止二进制风险）；B1/G3 走 Files API 上传
3. **「应用变更」按钮全局顶部**（在 LdmPage 4 Tab 上方，**不**绑定 Tab ④）——每次重启决策独立
4. **不接管热重载**——`reloadPermissions` 仅 D4 单点重载（PTY 写 `/p reload`）
5. **applyChangesCore 抽到 ServerManager**——与 mod_apply 共用 + 预留 modpack_apply 第三处（backend-development 「重复 ≥3 模块共用→新建共享」原则）
7. **ActiveOperation 类型扩展**——加 `mod_apply` / `ldm_apply` / `modpack_apply` 三个 type
8. **下载步骤 InfoCard**——已抽 `components/shared/InfoCard.tsx`（复用 ConfigPage「💡 配置提示」卡样式）
9. **memory 放本项目**——`.serena/memories/` 维护，外部 `~/.claude/projects/.../memory/MEMORY.md` 不再增索引
10. **LDM-Community 列表 hasReleases 字段**——用户「先不管」留待下次会话评估

---

## 新增后端模块（5 个 +1 重构）

| 模块 | 文件 | 职责 |
|---|---|---|
| `RocketConfigXmlParser` | `manager-server/src/modules/ldm/RocketConfigXmlParser.ts` | 自写 XML 解析器（保留注释/CDATA/属性顺序/嵌套/未知键，零依赖） |
| `AtomicFileWriter` | `manager-server/src/modules/filelock/AtomicFileWriter.ts` | 共享原子写（备份 + 保留最近 10 份 + 自动回滚） |
| `LdmConfigWriter` | `manager-server/src/modules/ldm/LdmConfigWriter.ts` | 4 写方法：writeRocketConfig / writeRocketUnturnedConfig / writePermissionsConfig / writePluginConfig |
| `LdmApplyService` | `manager-server/src/modules/ldm/LdmApplyService.ts` | 薄业务层：调 `applyChangesCore` + 推 WS `ldm_apply_progress` + postStartHook 调 `reloadPermissions` |
| **重构** | `manager-server/src/modules/server/ServerManager.ts` | 抽 `applyChangesCore` 方法（Save + Shutdown 10 + forceKill + spawn + preStopHook/postStartHook 钩子） |

---

## 接口契约（`shared/contracts/ldm.ts`）

### Phase 2a 新增

- `IRocketConfigXmlParser`：`parseRocketConfig` / `parseRocketUnturnedConfig` / `parsePermissionsConfig` / `serializeRocketConfig` / `serializeRocketUnturnedConfig` / `serializePermissionsConfig` / `parseGeneric` / `serializeGeneric`
- `ILdmConfigWriter`：`writeRocketConfig` / `writeRocketUnturnedConfig` / `writePermissionsConfig` / `writePluginConfig`
- 类型：`RocketConfigFields` / `RocketUnturnedConfigFields` / `PermissionsConfigFields` / `PermissionsGroup` / `XmlNode` / `XmlNodeType` / `LdmConfigWriteResult`

### Phase 2b 新增

- `ILdmApplyService`：`apply(serverId, opts?)` → 推 WS `ldm_apply_progress`
- `IServerManager.applyChangesCore(serverId, opts)`：`opts.hook: 'mod_apply' | 'ldm_apply' | 'modpack_apply'`
- `ILdmPluginCommandsService`：`reloadPermissions` / `readLdmVersion` / `readModulesState`
- 类型：`LdmApplyResult`
- `ActiveOperation` 加 `mod_apply` / `ldm_apply` / `modpack_apply` 三个 type

### Phase 3 新增

- `ILdmDiscoveryService.getStatus(serverId)` → `LdmStatus { ldmInstalled, rocketDirExists, pluginCount, detectedAtIso }`
- `ILdmPluginSourceService.getPluginDetail(slug, pat)` → `CommunityPluginDetail { ...readmePreview }`

### 端点（7 个）

| 方法 | 路径 | 阶段 |
|---|---|---|
| GET | `/api/servers/:id/ldm/installed` | Phase 1 |
| GET | `/api/servers/:id/ldm/plugins/:name/config` | Phase 2a |
| PUT | `/api/servers/:id/ldm/plugins/:name/config` | Phase 2a |
| PUT | `/api/servers/:id/ldm/rocket-config` | Phase 2a |
| PUT | `/api/servers/:id/ldm/permissions-config` | Phase 2a |
| POST | `/api/servers/:id/ldm/apply` | Phase 2b |
| GET | `/api/servers/:id/ldm/status` | Phase 3 |
| GET | `/api/ldm/community-plugins/:owner/:repo` | Phase 3 |

---

## WS 事件（`shared/contracts/broadcast.ts`）

新增 `ldm_apply_progress`（serverId + stage ∈ {preparing, stopping, starting, verifying, ready, failed} + percent + errorMessage）

---

## 关键 Bug 修复（颗粒度清晰的根因诊断）

1. **ISO 时间戳含 `:` Windows 文件名非法**——`AtomicFileWriter` 备份文件 `:` 替换为 `-`
2. **`fs.copyFile` 在 vitest forks + Windows 不可靠**——改用 `readFile + writeFile`
3. **`fs.access` 在 Windows + tsx + forks 行为不可靠**——改用 `fs.stat + isFile()`
4. **`parseGeneric` 顶层遇到 close tag `</name>` 仍调 parseElement**——加 peek `xml[pos + 1] === '/'` 跳过
5. **`root = findElement(tree, ROOT_NAME)` 在 children 里找自己**——`root = tree`（wrapRoot 直接返回根元素本身）

---

## 端点错误码

- `server-id-missing` 400
- `plugin-name-missing` 400
- `plugin-name-invalid` 400
- `plugin-config-not-found` 404
- `plugin-config-invalid` 400
- `plugin-slug-invalid` 400
- `plugin-detail-not-found` 404
- `ldm-config-read-failed` 500
- `ldm-config-write-failed` 500
- `atomic-write-failed` 500
- `operation-conflict` 409
- `server-not-running` 409

---

## 验证门槛最终态

- typecheck **0 错**
- 全量后端单测 **307/307**（+44 用例净增；8 fail 历史 backlog：PTY `\r→\n` + steamCmdManager mock 串台——**与本次无关**）
- 7 端点 + 5 模块 + 1 重构 + 2 WS事件全部落档

---

## Phase 3-3 前端评估（Plan agent 报告，**未开工**）

现实档 **13.5h**（乐观 10h / 悲观 21h），与设计 §12.4「Phase 3 估时 5-7 人天」中的前端部分吻合。

### 🚨 关键风险（agent 报告原话）

1. **FrameworkConfigTab 不存在**——当前 LdmPage 只有 `installed` / `source` 两 Tab，D2「关于 LDM 卡」无挂载点。**必须先建 FrameworkConfigTab 骨架**（+1.5h），否则 D2 无处放
2. **CommunityCard 双交互冲突**——当前内嵌 `<label>` 触发文件选择，要再加「查看详情」入口。两入口布局竞争，需画 wireframe 先
3. **Clipboard API 权限**——`navigator.clipboard.writeText()` 在非 HTTPS 可能 `NotAllowedError`，需兜底（0.3h 探坑）

### 实施顺序（agent 推荐）

```
① 前置盘点 FrameworkConfigTab 存在性（0.5h）→ 必须先决策「本 PR 带骨架」vs「拆 PR」
② 并行做 4 新组件骨架（2h）→ OnboardingSop → LdmStatus → LdmAbout → CommunityPluginDetailDialog
③ 改造 CommunityCard + LdmPage 顶层 state（0.8h）→ 关键 UX 决策（画 wireframe 后再写）
④ 接入 InstalledTab + FrameworkConfigTab 顶部（0.5h）
⑤ 测试 + 视觉验证（4h）
```

### 关键文件

- `manager-web/src/pages/LdmPage.tsx`（680 行；改造 InstalledTab 顶部插 LdmStatusCard、LdmPage 顶层加 OnboardingSopCard + 抽屉 state、CommunityCard 加 onViewDetail）
- `manager-web/src/components/shared/Dialog.tsx`（CommunityPluginDetailDialog 包装对象）
- `manager-web/src/components/shared/InfoCard.tsx`（OnboardingSopCard / LdmStatusCard / LdmAboutCard 复用容器）
- `manager-web/src/components/mods/ModDetailDialog.tsx`（CommunityPluginDetailDialog 实现模板）
- `manager-web/src/pages/LdmPage.test.tsx`（161 行；加 4 新组件单测 + 1 集成）

---

## 下次会话接手点（Phase 3-3 开工前必读）

1. **先确认 FrameworkConfigTab 是否存在**——`grep -rn "FrameworkConfigTab|框架配置" manager-web/src`；若无，决定「本 PR 带骨架」还是「拆 PR 依赖」
2. **画 CommunityCard 双入口 wireframe**——「查看详情」入口与「上传到此实例」`<label>` 布局（agent 推荐卡片本体可点击 + label 保留按钮样式）
3. **Clipboard API 探坑**——`navigator.clipboard.writeText()` 兜底（`document.execCommand("copy")` 备用 + toast 提示失败）
4. **4 新组件顺序实施**：OnboardingSopCard (纯展示) → LdmStatusCard (useQuery /status) → LdmAboutCard (useQuery readLdmVersion) → CommunityPluginDetailDialog (Dialog 包装 + useQuery /community-plugins/:owner/:repo)
5. **复用边界**：InfoCard 容器（4 处复用）、Dialog（详情抽屉）、TabBar + PageState + ConfirmDialog（已用无需改）

---

## 历史遗留 Phase 1 fail（升期门控外的 backlog，不阻塞）

- PTY 写命令断言 `\r→\n` 联动——commit `0b1a882` 改了产品代码但测试断言未同步
- `steamCmdManager` mock 串台——`vi.clearAllMocks()` 不清 implementation 残留
- 修复建议：构造函数注入 mock，避免共享全局 fakeXxx

---

## 关联文档（下次会话参考）

- `docs/architecture/ldm-phase2-design.md`（实施契约层，含 §11/§12 切片 + §3.3 端点 + §5 数据模型）
- `docs/architecture/ldm-integration-design.md`（主设计 §5 模块 + §6 端点 + §11 全功能盘点）
- `docs/adr/0006-ldm-framework-integration.md`（ADR 边界决策）
- `.claude/rules/unturned-sop.md` §LDM（重启流水线 + G5 边界 + Phase 2b 流程）
- `.serena/memories/session-checkpoint-2026-08-15-ldm-b1-upload.md`（2026-08-15 早些时候 LdmPage B1 闭环）