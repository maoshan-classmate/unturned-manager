# LDM 编辑器本体设计稿（Phase 5）

> **承接**：`ldm-integration-design.md` §11.1-§11.4（编辑器占位）+ Phase 2 commit `1f3f2c8` / `5cb7080` / Phase 4 commit `e6f12b4` + Phase 4 审计遗留 P2 backlog（`db5cd35`）
> **状态**：v0.1 设计稿 · 2026-08-16 · 待用户拍板
> **关系**：与 `mod-management-design.md` v2.5 平行但不交叉；编辑器本体只读不写 `.dll`（钉死 G5）

---

## §1 背景与现状

### 1.1 用户实机发现的问题（2026-08-16）

| 问题 | 现状 | 严重度 |
|---|---|---|
| 「已装插件」Tab 没有「上传 .dll」按钮 | 工具栏包在「等数据回来才显示」条件内 | P0（已修） |
| 框架配置 Tab 无法识别 Mod 框架模块 | LdmAboutCard 没 fallback 到「未安装」状态 | P1（已修） |
| 加载插件报 404 | 服务层抛 `plugin-not-found`（PTY 输出含「未找到」字样） | P2（用户先放着） |
| Rocket.config.xml 编辑器未实现 | FrameworkConfigTab 两张占位卡 | **本设计稿范围** |
| Rocket.Unturned.config.xml 编辑器未实现 | 同上 | **本设计稿范围** |
| 权限组 Tab 未实现 | PermissionsTab 单张占位卡 | **本设计稿范围** |

### 1.2 已沉淀的边界（钉死）

| 边界 | 出处 |
|---|---|
| 后端 PUT 写端点已实现（4 个：rocket-config / rocket-unturned-config / permissions-config / plugins/:name/config） | Phase 2 commit `1f3f2c8` |
| 后端**缺 GET 读端点**（3 个） | §3.1 待做 |
| applyChangesCore 已抽出（与 mod_apply 共用） | Phase 2b commit `5cb7080` |
| 「保存配置」与「应用变更」解耦（写运行时允许，不阻断 ServerManager 状态） | 用户 2026-08-15 拍板 |
| LDM-Community 列表 `hasReleases` 字段 | 用户 2026-08-15 拍板「先不管」 |
| 插件配置 `<Plugin>.configuration.xml` 编辑器 | 每插件 schema 不同，留独立 Phase |

---

## §2 范围与边界

### 范围内（本设计稿）

1. 后端补 3 个 GET 读端点（rocket-config / rocket-unturned-config / permissions-config）
2. 修 2 个旧账（P0 已修待补 + P2 backlog）：
   - P0：`serializePermissionsConfig` 未知键保留（Phase 2 审计遗留）
   - P2：writer 内 Zod 校验（绕过路由可写非法字段）
3. 前端做 3 个编辑器（Rocket.config.xml / Rocket.Unturned.config.xml / Permissions.config.xml）
4. 前端做全局「应用变更」按钮 + 流程

### 范围外（留后续 Phase）

- 插件配置 `.configuration.xml` 编辑器（每插件 schema 不同，需独立设计）
- LDM-Community 列表 `hasReleases` 字段
- 插件配置 Monaco XML 原文编辑器（设计 §2.6 决策：仅作权限组备选）

---

## §3 后端设计

### 3.1 新增 3 GET 读端点

| 方法 | 路径 | 调用方法 | 响应文件 |
|---|---|---|---|
| GET | `/api/servers/:id/ldm/rocket-config` | `LdmConfigReader.readRocketConfig(serverId)` | `Servers/<ID>/Rocket/Rocket.config.xml` |
| GET | `/api/servers/:id/ldm/rocket-unturned-config` | `LdmConfigReader.readRocketUnturnedConfig(serverId)` | `Servers/<ID>/Rocket/Rocket.Unturned.config.xml` |
| GET | `/api/servers/:id/ldm/permissions-config` | `LdmConfigReader.readPermissionsConfig(serverId)` | `Servers/<ID>/Rocket/Permissions.config.xml` |

### 3.2 响应契约（`shared/contracts/ldm.ts` 新增）

```typescript
// 读响应基础字段
const LdmConfigReadBaseSchema = z.object({
  serverId: z.string(),
  file: z.string(),
  raw: z.string(),              // 原文 XML（前端 Monaco 备选用）
  fields: z.record(z.unknown()), // 解析后结构化字段
  sizeBytes: z.number(),
  modifiedAtIso: z.string(),
});

// Rocket.config.xml：16 字段结构化（语言/帧预算/自动关服/远程同步）
const RocketConfigReadResponseSchema = LdmConfigReadBaseSchema.extend({
  file: z.literal("Rocket.config.xml"),
  fields: RocketConfigFieldsSchema,
});

// Rocket.Unturned.config.xml：9 字段结构化（自动存档/角色名校验/可疑日志/物品与载具黑名单）
const RocketUnturnedConfigReadResponseSchema = LdmConfigReadBaseSchema.extend({
  file: z.literal("Rocket.Unturned.config.xml"),
  fields: RocketUnturnedConfigFieldsSchema,
});

// Permissions.config.xml：树形 Groups
const PermissionsConfigReadResponseSchema = LdmConfigReadBaseSchema.extend({
  file: z.literal("Permissions.config.xml"),
  fields: PermissionsConfigFieldsSchema,
});
```

### 3.3 错误码

| 错误码 | HTTP | 触发条件 |
|---|---|---|
| `ldm-config-not-found` | 404 | 文件不存在（实例首次启动前） |
| `ldm-config-read-failed` | 500 | 读盘失败 / 解析失败 |
| `server-id-missing` | 400 | `:id` 参数缺失（沿用现有） |

> **不要求 RUNNING**：读端点是文件 I/O，与实例状态无关（PUT 写端点也类似）。

### 3.4 模块改动

#### 新增 `LdmConfigReader` 模块

- 文件：`manager-server/src/modules/ldm/LdmConfigReader.ts`
- 接口：`ILdmConfigReader { readRocketConfig / readRocketUnturnedConfig / readPermissionsConfig }`
- 实现：thin wrapper，调 `RocketConfigXmlParser.parseRocketConfig` / `parseRocketUnturnedConfig` / `parsePermissionsConfig`
- 返回：`{ serverId, file, raw, fields, sizeBytes, modifiedAtIso }`

#### 改造 `LdmConfigWriter` 加 Zod 校验

- 文件：`manager-server/src/modules/ldm/LdmConfigWriter.ts`
- 改动：4 个写方法入口强制 `safeParse(对应 Schema)`，失败抛 `AppError('ldm-config-invalid', ..., 400)`
- 目的：堵「绕过路由直调 writer 可写非法字段」漏洞（P2 backlog）

---

## §4 旧账修复

### 4.1 `：serializePermissionsConfig` 未知键保留

**根因**（Phase 4 审计遗留）：当前 `serializePermissionsConfig` 重建 Groups 树时丢弃手写未知键。

**修法**：

```typescript
// 1. parsePermissionsConfig 把所有未知属性挂在 Groups 节点 attributes 上
// 2. serializePermissionsConfig 按原 XML 节点顺序 + 属性顺序输出

serializeGeneric(groups: XmlNode[]): string {
  // 1. 已知属性先输出
  // 2. 未知属性按 parse 时记录的 key 顺序输出
  // 3. 节点 children 按 parse 时记录的顺序输出
}
```

**测试**：手写 `Permissions.config.xml` 含 `<Group Id="test"><UnknownAttr>1</UnknownAttr></Group>` → 读出来再写回去，属性保留。

### 4.2 writer 内 Zod 校验

**根因**：Zod 校验只在路由层，绕过路由直调 writer 可写非法字段。

**修法**：把 Zod schema 提到模块层（`LdmConfigWriter.ts`），所有写方法入口 `safeParse`：

```typescript
writeRocketConfig(serverId, fields) {
  const parsed = RocketConfigWriteSchema.safeParse(fields);
  if (!parsed.success) {
    throw new AppError("ldm-config-invalid", `字段非法：${parsed.error.issues.map(i => i.message).join("; ")}`, 400);
  }
  // 继续原写入流程（用 parsed.data 而非原始 fields）
}
```

**测试**：直接 `writer.writeRocketConfig(serverId, { 非法字段 })` → 抛 400。

---

## §5 前端设计

### 5.1 框架配置 Tab 改造

```
┌─ FrameworkConfigTab ──────────────────────────────────────┐
│ <LdmAboutCard serverId={serverId} />         ← 已修     │
│                                                            │
│ <Card title="Rocket.config.xml 编辑器">                    │
│   <RocketConfigEditor serverId={serverId} />               │
│ </Card>                                                    │
│                                                            │
│ <Card title="Rocket.Unturned.config.xml 编辑器">           │
│   <RocketUnturnedConfigEditor serverId={serverId} />        │
│ </Card>                                                    │
└────────────────────────────────────────────────────────────┘
```

**RocketConfigEditor**：16 字段结构化（语言/帧预算/自动关服/远程同步；**RCON 字段前端不渲染**——设计 §2.4 RCON 不在面板范围）。

**RocketUnturnedConfigEditor**：9 字段结构化（自动存档/角色名校验/可疑日志/物品与载具黑名单）。

**两个编辑器共用的字段渲染**：

| 字段类型 | 控件 |
|---|---|
| bool | `ConfigToggle`（沿用 ConfigPage） |
| int / float | `ConfigField`（沿用 ConfigPage，含 min/max clamp） |
| enum | `ConfigSection` 下拉（沿用 ConfigPage） |
| string | `Input`（沿用 shadcn/ui） |

### 5.2 权限组 Tab 改造

```
┌─ PermissionsTab ──────────────────────────────────────────┐
│ <Card title="权限组编辑器">                                │
│   <Tabs>                                                  │
│     <Tab label="结构化">                                  │
│       <PermissionsConfigEditor serverId={serverId} />     │
│     </Tab>                                                │
│     <Tab label="XML 原文（备选）">                        │
│       <MonacoXmlEditor serverId={serverId} />             │
│     </Tab>                                                │
│   </Tabs>                                                 │
│ </Card>                                                    │
└────────────────────────────────────────────────────────────┘
```

**结构化编辑器（默认）**：树形 Groups + Members + Permissions + Color + ParentGroup + Priority。

**XML 原文编辑器（备选）**：Monaco XML 编辑器（设计 §2.6 决策）。

### 5.3 编辑器组件

| 组件 | 路径 | 职责 |
|---|---|---|
| `RocketConfigEditor` | `manager-web/src/components/ldm/RocketConfigEditor.tsx` | 16 字段结构化编辑 |
| `RocketUnturnedConfigEditor` | `manager-web/src/components/ldm/RocketUnturnedConfigEditor.tsx` | 9 字段结构化编辑 |
| `PermissionsConfigEditor` | `manager-web/src/components/ldm/PermissionsConfigEditor.tsx` | 树形结构化编辑 |
| `MonacoXmlEditor` | `manager-web/src/components/ldm/MonacoXmlEditor.tsx` | XML 原文编辑（备选） |
| `LdmConfigApplyButton` | `manager-web/src/components/ldm/LdmConfigApplyButton.tsx` | 全局「应用变更」按钮 |

### 5.4 「应用变更」按钮位置 + 流程

**位置**：LdmPage 顶部（4 Tab 上方）**全局**按钮，与当前 SOP 一致。

**触发条件**：
- 有任何配置文件的字段被修改（与初始 GET 值不同）→ 按钮高亮可点
- 无修改 → 按钮 disabled

**流程**：

```
[用户改字段] → [本地 draft state 更新] → [「应用变更」按钮变可点]
                                              ↓
                              [用户点按钮] → [POST /api/servers/:id/ldm/apply]
                                              ↓
                              [ServerManager.applyChangesCore(hook='ldm_apply')]
                                              ↓
                              [Save + Shutdown 10 + forceKill + spawn]
                                              ↓
                              [WS ldm_apply_progress 推进度]
                                              ↓
                              [前端 Modal 展示进度（5 阶段：preparing/stopping/starting/verifying/ready）]
                                              ↓
                              [完成 → toast.success + 刷新当前 Tab]
```

**「保存配置」与「应用变更」解耦**：
- 改字段 → 点「保存配置」（写文件，不重启）
- 单独点「应用变更」（走重启流水线）

---

## §6 接口契约总览

### 6.1 新增契约（`shared/contracts/ldm.ts`）

```typescript
// §3.2 节已列读响应 schema

// 写请求 schema（已存在 writer 中，提到模块层统一校验）
RocketConfigWriteSchema.extend({  // 沿用现有
  fields: RocketConfigFieldsSchema,
});
```

### 6.2 新增端点（共 3 个）

| 方法 | 路径 | 用途 |
|---|---|---|
| GET | `/api/servers/:id/ldm/rocket-config` | 读 Rocket.config.xml |
| GET | `/api/servers/:id/ldm/rocket-unturned-config` | 读 Rocket.Unturned.config.xml |
| GET | `/api/servers/:id/ldm/permissions-config` | 读 Permissions.config.xml |

---

## §7 数据流与时序

### 7.1 读取流程

```
[用户进 Tab] → [编辑器 useQuery GET 读端点]
              ↓
[后端 LdmConfigReader.readRocketConfig]
              ↓
[fs.readFile + RocketConfigXmlParser.parseRocketConfig]
              ↓
[返回 { raw, fields, ... }]
              ↓
[编辑器初始化（fields 渲染为控件）]
```

### 7.2 保存流程

```
[用户改字段] → [本地 draft state 更新]
              ↓
[用户点「保存配置」] → [PUT 写端点]
              ↓
[LdmConfigWriter.writeRocketConfig (含 Zod 校验)]
              ↓
[AtomicFileWriter 原子写（备份 + temp + rename）]
              ↓
[toast.success「配置已保存」]
```

### 7.3 应用变更流程

```
[用户点「应用变更」]
              ↓
[POST /api/servers/:id/ldm/apply]
              ↓
[LdmApplyService.apply]
              ↓
[ServerManager.applyChangesCore({ hook: 'ldm_apply' })]
              ├─ preStopHook
              ├─ save config snapshot
              ├─ transition(STOPPING) + Shutdown 10s
              ├─ forceKill
              ├─ transition(STARTING) + spawn
              ├─ waitForState(RUNNING, 15s)
              └─ postStartHook → LdmPluginCommandsService.reloadPermissions
              ↓
[WS ldm_apply_progress 推进度（5 阶段）]
              ↓
[前端 Modal 展示进度 + 完成 toast]
```

---

## §8 升期门控（参考设计稿 §10）

| 项 | 通过标准 |
|---|---|
| typecheck | 0 错 |
| 单测覆盖 | 改到的文件行覆盖率 ≥ 80% |
| E2E | 改到的功能至少一个用例（编辑器改字段 → 保存 → 应用 → 验证） |
| 接口契约 | ajv 加在所有 API 边界校验通过 |
| 文档同步 | `reference_config_files.md` §3-5 字段表与编辑器对齐 |
| commit 规范 | `<操作名>: <简要概括>`，禁外部参考字样 |

---

## §9 工作量估算

| 阶段 | 文件数 | 工作量 |
|---|---|---|
| 后端 `LdmConfigReader` 模块 + 3 GET 读端点 | 4 文件 | 2h |
| 后端 `LdmConfigWriter` Zod 校验入口 | 1 文件 | 0.5h |
| 后端 `：serializePermissionsConfig` 未知键保留 | 1 文件 | 1h |
| 前端 `RocketConfigEditor` + `RocketUnturnedConfigEditor` | 3 文件 | 3h |
| 前端 `PermissionsConfigEditor` 树形 | 2 文件 | 4h |
| 前端 `MonacoXmlEditor` 备选 | 1 文件 | 1.5h |
| 前端 `LdmConfigApplyButton` + WS 进度 Modal | 2 文件 | 1.5h |
| 单测 + 文档同步 + commit 收尾 | 5+ 文件 | 2h |
| **合计** | **20+ 文件** | **15.5h ≈ 2-3 个 Sprint** |

---

## §10 待用户拍板

1. **Monaco XML 原文编辑器是否本期做？**——设计 §2.6 决策为备选，但实现成本不低（1.5h）；可推到「权限组编辑器 V2」
2. **「应用变更」按钮的全局位置**——LdmPage 顶部 vs LdmConfigApplyButton 嵌入每个编辑器 Card 内
3. **顺序**：先做后端 3 GET 读端点 → 修 2 旧账 → 前端 3 编辑器 → 应用变更按钮 → Monaco 备选？
4. **范围**：是否本期也做插件配置 `.configuration.xml` 编辑器？（每插件 schema 不同，可能要独立 Phase）

---

**关联文档**：
- `ldm-integration-design.md` §11.1-§11.4（编辑器占位）
- `ldm-phase2-design.md`（Phase 2 实施契约层）
- `ADR-0006-ldm-framework-integration.md`（边界决策）
- `unturned-sop.md` §LDM（重启流水线 + G5 边界）
- `claudedocs/reference_config_files.md` §3-5（字段细节）
- `mod-management-design.md` v2.5（mod_apply 平行链路）