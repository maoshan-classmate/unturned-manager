# ADR-0006：LDM Mod 框架接入（仅配置 + 启停 + 插件来源）

> **状态**：待评审 · **日期**：2026-08-12
> **承接**：CLAUDE.md §1（钉死 LDM）+ ADR-0003 B2 目录扫描真源 + ADR-0004 PTY 终端 owner-trust
> **驱动源**：用户 2026-08-12「LDM Mod 框架暂未实现，需要接入」+ Serena 记忆 `session-checkpoint-2026-08-12-ldm-framework.md`
> **设计文档**：`docs/architecture/ldm-integration-design.md`

---

## 1. 背景与动机

### 1.1 当前实现的根本缺口

`mod-management-design.md` v2.5（已实现，commit `eff19c9`）只覆盖 **Steam Workshop 资源包**（unity3d 数据包：地图/武器/皮肤/UI），由 `WorkshopMetadataService` + `WorkshopAcfService` + `WorkshopApplyService` + `WorkshopDeleteService` 四个服务支撑。

**LDM（Legally-Distinct-Missile，Unturned 官方维护的 Mod 框架）是完全独立的另一个维度**：
- **资源包** = U3DS 内核加载的数据（unity3d）
- **LDM 插件** = 服务器代码逻辑（.dll，提供权限、经济、地图机制、反作弊等）

**当前代码层缺口**（commit `c5f2ac8` 删了 OpenMod/RocketMod 残留后）：
- `Rocket/Rocket.config.xml` 一行解析代码没有
- `Rocket/Plugins/<Name>/` 一行扫描代码没有
- `Rocket/Plugins/<Name>/Configuration.xml` 一行读写代码没有
- LDM 插件来源（LDM-Community 列表）没有任何拉取/缓存代码
- 前端 `ConfigPage` 没有 LDM Tab；侧栏没有「Mod 框架」入口

### 1.2 钉死的边界（不用重新决策）

| 边界 | 出处 |
|---|---|
| **唯一命令通道 = PTY 终端 owner-trust**（JWT 有效即视为 owner 写任意命令） | ADR-0004 Phase 6 |
| **状态机 = 4 态 STOPPED/STARTING/RUNNING/STOPPING** | ADR-0004 §3.3 |
| **重启流水线 = Save + Shutdown 10 + forceKill** | `unturned-sop.md` §重启 |
| **Mod 变更应用 = `applyModChanges` 已有 9 步流水线** | `ServerManager.ts:714-854` |
| **配置原子写 = `ConfigService.atomicWrite`（temp + rename + 备份）** | `ConfigService.ts:60` |
| **路径解析 = `resolveInstallDir` + `resolveServerPath`** | `pathResolver.ts` |
| **禁止自动跑 `rocket reload` 任何形式**（LDM 无官方热重载） | `prohibitions.md` 钉死 |
| **不自动装 SteamCMD/U3DS/LDM**（引导式） | `decision-no-auto-install-steamcmd-u3ds.md` |

---

## 2. 决策摘要

| 决策点 | 选择 | 拒绝方案 | 理由 |
|---|---|---|---|
| **接入范围** | 仅配置 + 启停 + 插件来源 | 全接管（编译/分发/热重载/兼容性矩阵） | 编译/分发超出面板职责；LDM 无官方热重载（钉死）；兼容性矩阵维护成本无限 |
| **LDM 安装** | ❌ 不做（引导式：用户复制 U3DS 装包自带的 Extras 到 Modules 激活） | 面板自动 cp | 遵循「不自动装」决策 |
| **插件 .dll 分发** | ⚠️ 仅用户主动上传（Files API）；**不自动下载/同步** | 自动从 GitHub/Workshop 同步 | 二进制风险 + 编译分发不是面板职责 |
| **改 LDM 配置生效方式** | 抽 `LdmApplyService` 薄业务层 + `ServerManager.applyChangesCore` 9 步流水线共用 | 在 `ServerManager.applyModChanges` 加 ldmApply 分支 | backend-development.md 「重复 ≥3 模块共用→新建共享」原则（现在是 2 个：mod_apply + ldm_apply；预留 modpack_apply 第三处）；模块意识 = 三层结构 + 依赖注入 + destroy() |
| **配置文件读权限** | ✅ Rocket.config.xml 结构化读 | 仅原文 | 字段表有限（10–15 字段），结构化对用户友好 |
| **Configuration.xml 读权限** | ✅ 原文读 + XML 通用编辑器写 | 强解插件 schema | 插件 schema 由插件开发者决定，面板不强解（维护成本无限） |
| **.dll 版本号读取** | ✅ PE 元数据解析（**自写流式解析**，零依赖；`pe-library` 已 archived 否决） | mono CLI 反射 | 开发期本机无 mono 拖 CI；PE 元数据纯 Node 解析（ECMA-335 Partition II §22 真源） |
| **数据真源** | 文件系统（`Rocket/` + `Plugins/<Name>/`） | 新增 SQLite 表 | 真源唯一 = 文件系统；B2 决策「目录扫描真源」已定 |
| **API 命名空间** | `/api/servers/:id/ldm/*` | 复用 `/api/mods/*` | 与资源包管理边界清晰，UI Tab 分开 |
| **前端页面** | 新建 `<LdmPage>` 顶层路由 | 加进 `<ConfigPage>` | LDM 是独立功能维度，4 Tab 已满；放 ConfigPage 会破坏三行原则 |
| **模块命名空间** | `manager-server/src/modules/ldm/` | 放 `workshop/` 下 | LDM 与 Workshop 资源包是两套机制，目录隔离 |

---

## 3. 决策内容

### 3.1 面板能力边界（写权限）

| 能力 | 是否做 | 说明 |
|---|---|---|
| LDM 主框架安装 | ⚠️ 引导 + 不自动 cp | 显示 5 步 SOP；用户执行 `cp -r /opt/unturned/Extras/Rocket.Unturned /opt/unturned/Modules/` |
| 插件 .dll 安装 | ⚠️ Web 上传（Files API） | 走 GitHub Releases + LDM-Community 列表（**不上 Steam Workshop**） |
| 插件 .dll 升级/删除 | ⚠️ Files API（替换/删除） | Linux 大小写校验 |
| 已装插件清单展示 | ✅ | 读 `Plugins/` 目录（.dll + Configuration.xml）+ 运行时加载状态（`/rocket plugins` stdout 解析） |
| 插件加载/卸载 | ✅ | PTY 写 `/rocket load <name>` / `/rocket unload <name>`（可不停服） |
| Rocket.config.xml 结构化编辑 | ✅ | 字段表已确认（LanguageCode / MaxFrames / RCON / AutomaticShutdown / WebPermissions / WebConfigurations），逐字段控件；**RCON 字段隐藏**（默认 `"changeme"` 明文，禁用） |
| Rocket.Unturned.config.xml 结构化编辑 | ✅ | 子任务发现独立文件（AutomaticSave / CharacterNameValidation / LogSuspicious / Item/Vehicle Blacklist 9 字段） |
| Permissions.config.xml 树形编辑 | ✅ | Groups / Members / Permissions / Color / ParentGroup / Priority / Prefix / Suffix / Permission Cooldown 全字段 |
| 插件 Configuration.xml 编辑 | ✅ | 通用 Monaco XML 编辑器（原文写 + 实时校验；不解析字段） |
| LDM 插件来源浏览 | ⚠️ 外链 + 列表展示 | 外链 [LDM-Community](https://ldm-community.github.io/pluginlist) + 面板本地缓存公开数据 |
| LDM 日志观察 | ✅ | 复用现有 PTY 控制台（xterm.js 已实时渲染 U3DS stdout） |
| 空参 `/rocket` 版本信息 | ✅ | 前端「关于 LDM」卡片（**无 `/rocket info` 命令**——2026-08-12 源码核对） |
| `/modules` U3DS 原生命令验证 | ✅ | 验证 Rocket.Unturned 模块加载状态 |
| LDM 全局 `/rocket reload` | ❌ | U3-SDK Issue #1794 + LDM 官方已删 + prohibitions 钉死（提示"Please reload individual plugins instead"） |
| LDM 插件 `/rocket reload <name>` | ⚠️ 暴露 + 加警告 | 不保证成功（社区已知会破坏插件状态） |
| LDM 插件兼容性矩阵 | ❌ | 维护成本无限，超出面板职责 |
| 自动故障诊断（哪个插件导致崩溃） | ❌ | 只展示 stdout 日志，定位归 owner |

### 3.2 模块树

```
manager-server/src/modules/ldm/
├── LdmDiscoveryService.ts        # 读 Rocket.config.xml + Rocket.Unturned.config.xml + Permissions.config.xml + Plugins/ 目录
├── LdmConfigWriter.ts            # 写上述 3 个 XML 文件（原子写 + 备份 + 回滚）
├── LdmApplyService.ts            # 薄业务层（activeOperation 类型 / WS 事件名 / 业务 hook），调 ServerManager.applyChangesCore
├── LdmPluginSourceService.ts     # 拉取 [LDM-Community](https://ldm-community.github.io/pluginlist) 公开插件列表（本地缓存）
├── LdmPluginCommandsService.ts   # PTY 写 /rocket load/unload/reload + 解析 stdout 插件状态
├── LdmAssemblyVersionReader.ts   # PE 元数据解析读 .dll 版本号（自写流式解析，零依赖）
├── RocketConfigXmlParser.ts      # 自写 XML 解析（保留注释/属性顺序/CDATA/嵌套）
└── (单测文件 .test.ts)

manager-server/src/modules/server/ServerManager.ts
└── applyChangesCore(serverId, opts)   # §5.6 抽出的 9 步流水线本体（mod_apply / ldm_apply 共用，预留第三应用方）

shared/
├── types/domain.ts                # + RocketConfig / RocketUnturnedConfig / PermissionsConfig / InstalledPlugin / LdmState / CommunityPlugin
├── schemas/ldm.schema.ts          # 9 个 Zod schema
└── contracts/ldm.ts               # 6 个接口：ILdmDiscoveryService + ILdmConfigWriter + ILdmApplyService + ILdmPluginSourceService + ILdmPluginCommandsService + ILdmAssemblyVersionReader

manager-web/src/
├── pages/LdmPage.tsx              # 4 Tab（已装插件 / 框架配置 / 权限组 / 插件来源）
├── components/ldm/
│   ├── InstalledTab.tsx
│   ├── FrameworkConfigTab.tsx     # Rocket.config.xml + Rocket.Unturned.config.xml 双卡片
│   ├── PermissionsTab.tsx         # Permissions.config.xml 树形编辑器
│   ├── PluginConfigDialog.tsx     # 通用 Monaco XML 编辑器
│   └── PluginSourceTab.tsx        # LDM-Community 列表 + 外链到 GitHub Releases
└── lib/utils.ts                   # + formatPluginVersion / parseRocketStatus 等
```

### 3.3 API 端点（14 个 ldm REST + 1 复用 files + 1 WS）

```
GET    /api/servers/:id/ldm/installed         → ILdmDiscoveryService.readState
GET    /api/servers/:id/ldm/plugins/:name/config  → ILdmDiscoveryService.readPluginConfig
PUT    /api/servers/:id/ldm/plugins/:name/config  → ILdmConfigWriter.writePluginConfig
PUT    /api/servers/:id/ldm/rocket-config     → ILdmConfigWriter.writeRocketConfig
PUT    /api/servers/:id/ldm/permissions-config → ILdmConfigWriter.writePermissionsConfig
POST   /api/servers/:id/ldm/load-plugin       → LdmPluginCommandsService（PTY /rocket load，不停服）
POST   /api/servers/:id/ldm/unload-plugin     → LdmPluginCommandsService（PTY /rocket unload，不停服）
POST   /api/servers/:id/ldm/apply             → ILdmApplyService.applyChanges（重启流水线）
GET    /api/ldm/community-plugins             → ILdmPluginSourceService（LDM-Community 列表，本地缓存）
POST   /api/ldm/community-plugins/test-pat    → ILdmPluginSourceService（PAT 测连通性，Phase 1）
GET    /api/servers/:id/ldm/status            → ILdmDiscoveryService.getLdmStatus（Phase 3）
GET    /api/ldm/community-plugins/:slug       → ILdmPluginSourceService.getCommunityPlugin（Phase 3）
POST   /api/servers/:id/ldm/reload-plugin     → LdmPluginCommandsService.reloadPlugin（Phase 4，二次确认）
GET    /api/servers/:id/ldm/plugins/search    → LdmDiscoveryService.searchPlugins（Phase 4）
POST   /api/servers/:id/files                 → FilesService 复用（.dll 上传）
WS     ldm_apply_progress                     → 重启进度事件
```

### 3.4 状态机扩展

**不改 4 态**——LDM 配置写入在 `ServerManager.applyChangesCore` 内自动判 state=STOPPED 后写，与现有 `applyModChanges` 同款。

### 3.5 与 ADR-0003/0004 的对齐

- **ADR-0003 B2 目录扫描真源**：LDM 状态真源 = `Rocket/` + `Plugins/` 文件系统，无新增 SQLite 表。
- **ADR-0004 PTY 终端 owner-trust**：所有改 LDM 配置生效走 PTY 流水线（Say + Save + Shutdown 10 + forceKill + spawn），与 `applyModChanges` 同链路。
- **ADR-0005 Phase 7**：LDM 操作日志走现有 WS 事件总线（`ldm_apply_progress` 与 `mod_apply_progress` 同形 schema）。

---

## 4. 不做（明确排除）

| 不做 | 理由 |
|---|---|
| 自动装 LDM 主框架 | 决策：`decision-no-auto-install-steamcmd-u3ds.md` —— 引导式 |
| 插件 .dll 自动下载/同步 | 用户从 GitHub Releases 手动下载 + 面板主动上传；面板自动写 .dll = 二进制风险 |
| 插件商店 / 商业化 | 超出面板职责 |
| 热重载任何形式（`rocket reload` / `cvar reload`） | LDM 无官方热重载（钉死）；改配置必须重启 |
| 插件兼容性矩阵 | 维护成本无限（每 LDM 新版本 × 每插件新版本 × 每 U3DS 版本 = O(n³)） |
| 自动故障诊断（哪个插件导致崩溃） | 只展示 stdout 日志，定位归 owner |
| `rocket reload` / `cvar reload` 任何命令 | `prohibitions.md` 钉死 |
| 全局 LDM 配置（一次改所有实例） | 每个实例 Rocket/ 独立是钉死边界 |

---

## 5. 验收门槛

按 `.claude/rules/development.md`：

- [ ] 类型检查：tsc --noEmit 零错误
- [ ] 代码风格：ESLint 零警告
- [ ] 单测覆盖率：改到的文件行覆盖 ≥ 80%；`RocketConfigXmlParser` ≥ 8 个用例
- [ ] E2E（Playwright）：装 LDM（mock）→ 加载插件（不停服）→ 改配置 → 应用 → 实例重启 → 列表刷新
- [ ] 接口契约：ajv 加在所有 API 边界
- [ ] 没引入 `any`
- [ ] `.research/U3-SDK` 未动
- [ ] `unturned-sop.md` / `prohibitions.md` / `reference_ui_terms.md` / `reference_config_files.md §3` 同步更新

---

## 6. 风险与待验证项

| 风险 | 缓解 | 验证方法 |
|---|---|---|
| LDM 主框架未装场景（`Rocket/` 目录不存在） | 路由层捕获 → 返回 `ldm-not-installed` 404 → UI 友好提示 | 单测 + E2E |
| U3DS RUNNING 时改配置 → 文件覆盖崩溃 | 路由层校验 `ServerManager.getState(serverId) === STOPPED` | 单测 + 集成测试 |
| 写失败 → 配置文件损坏 | `atomicWrite` 备份 + 回滚 | 单测 |
| LDM .dll 版本号读取方式（mono / 读 AssemblyInfo） | LDM 文档回填后定 | 实机验证 |
| Configuration.xml 字段含义未知（插件开发者文档化 vs 面板不强解） | 通用 XML 编辑器（原文编辑） + 文档链接 | 设计决策已定 |
| LDM Steam Workshop tag 命名（`legally-distinct-missile` 是否官方） | LDM 仓库 README 实读后定 | 待 LDM 调研回填 |
| 启动 LDM 后 stdout 哪些 prefix 是 LDM 输出（前端日志过滤） | LDM 源码实读后定 | 待 LDM 调研回填 |
| `ServerManager.applyChangesCore` 抽象边界（与 `applyModChanges` 共用多少） | Phase B3 实施时定 | 编码阶段验证 |

---

## 7. LDM 文档调研回填（已完成 · 历史快照）

> **本节定位**：ADR 文件附带的「调研过程快照」，记录 2026-08-12 调研 agent 完成的 8 项回填结论（#1–#6 + 子任务补充 #1b+#7）。
> **权威内容**已迁移到 `docs/architecture/ldm-integration-design.md`：
> - §11.1「LDM 框架全功能盘点」全表（A1–A4 / B1–B5 / C1–C4 / D1–D5 / E1–E2 / F1–F4 / G1–G5 / H1–H3 / I1–I2 / J1–J8 列出了对应真源与接入决策）
> - §12「多期接入规划」按 Phase 1–4 切片，每期含能力清单 / 端点 / 前端组件 / 后端模块 / 验证门槛
> - 本节保留作为「调研过程快照 + A1/A2 决策时序记录」，不替代设计文档
> **A1/.dll 版本号读取** 后续在设计文档 §5.5 定为**自写 PE 流式解析**（ECMA-335 Partition II §22 真源；零依赖、不走 mono CLI；`pe-library` 已 archived 否决——2026-08-12 用户拍板）

`docs/architecture/ldm-integration-design.md` 原 §12「调研回填记录」列 8 项待回填项（#1–#6 + 子任务补充 #1b RUC.x + #7 多实例），**调研 agent 已全部完成**：

| # | 待填项 | 已填内容 | 真源 |
|---|---|---|---|
| 1 | Rocket.config.xml 字段表 | 16 字段（LanguageCode / MaxFrames / RCON 7 子字段 / AutomaticShutdown / WebPermissions / WebConfigurations）；删 Economy/Instance/Logging 系列（老 RocketMod 残留） | LDM 仓 `Rocket/Rocket.Core/Serialization/RocketSettings.cs` |
| 2 | LDM 控制台命令 | 12 命令（`/rocket`(空参=版本) `/rocket plugins` `/rocket load/unload/reload <p>` `/modules` `/p reload` 等；**无 `/rocket info`**——版本=空参 `/rocket`） | LDM 仓 `Rocket.Unturned/Commands/CommandRocket.cs` |
| 3 | LDM Steam Workshop | **不上**——走 GitHub Releases + LDM-Community | 实测 Steam Workshop Asset Type 无 Plugin 类 |
| 4 | Configuration.xml schema | **无统一标准**——通用 Monaco XML 编辑器 | LDM 仓 `Rocket.Core/Environment.cs` `PluginConfigurationFileTemplate = "{0}.configuration.xml"` |
| 5 | .dll 版本号读取 | 已定 → 自写 PE 流式解析（`pe-library` 已 archived 否决） | U3-SDK `ModuleConfig.cs` 65 行 + ECMA-335 §22 |
| 6 | LDM 启动日志格式 | 模块启动 banner = `Rocket Unturned v... for Unturned v...`（`U.cs:151`）；插件加载失败 = `Failed to load X, unloading now...`（`RocketPlugin.cs:132`，主要路径）+ `Failed to load plugin X.`（`U.cs:200`，次要路径）；**加载成功无 stdout 行**（不存在 `[LDM] Loaded plugin X.Y.Z`——2026-08-12 源码核对，旧 `Module.cs:249` 引证作废） | LDM 仓 `Rocket.Unturned/U.cs:151/200` + `Rocket.Core/Plugins/RocketPlugin.cs:132` |
| 1b | Rocket.Unturned.config.xml | 设计文档 §2.4b（AutomaticSave / CharacterNameValidation / LogSuspiciousPlayerMovement / Item/Vehicle Blacklist 9 字段） | `Rocket.Unturned/Serialisation/UnturnedSettings.cs` |
| 7 | 多实例隔离 | 设计文档 §8 + §11.1 E1–E2（`Environment.cs` 源码铁证） | `Rocket.Core/Environment.cs` |

**调研未填项**（不阻塞）：
- `RocketConfiguration.cs` 类名是子任务纠错过的 → 实际类名 `RocketSettings.cs`（XML 根元素仍是 `<RocketConfiguration>`）
- 子任务新发现 `Rocket.Unturned.config.xml`（`UnturnedSettings.cs`）——已加入设计文档 §2.4b

---

## 8. 关联文档

- **设计文档**：`docs/architecture/ldm-integration-design.md`
- **关系**：
  - 与 `mod-management-design.md` v2.5（资源包）平行独立
  - 与 `architecture-spec.md` §3 后端模块对齐（LDM 模块加入模块树）
  - 与 `unturned-sop.md` 目录布局对齐（`Rocket/` 章节已存在，需补 LDM 安装 SOP）
- **修改**：本 ADR 接受后需要更新：
  - `architecture-spec.md` §3 后端模块树加 `ldm/` 命名空间
  - `architecture-spec.md` §5 契约加 LDM 三个接口
  - `unturned-sop.md` 加 §LDM 安装步骤（5 步走）
  - `reference_config_files.md` 加 §3 Rocket.config.xml 字段表（待 LDM 文档回填）
  - `reference_ui_terms.md` 加「LDM → Mod 框架」对照
  - `prohibitions.md` 不动（已有钉死的「禁止自动跑 `rocket reload`」）

---

*状态：待评审 · 日期：2026-08-12*