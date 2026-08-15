# LDM Phase 2 完整配置 — 实施契约层

> **承接**：`docs/architecture/ldm-integration-design.md` §5 后端模块设计 + §6 API 契约 + §12.3 Phase 2 简略规格
> **真源**：`.research/U3-SDK`（U3DS）+ LDM 仓 `SmartlyDressedGames/Legally-Distinct-Missile`（LDM）
> **状态**：2026-08-15 已实施（后端 65e24c9 / 1f3f2c8 / 5cb7080；前端骨架 f944bc8 + 4 Tab e6f12b4）· **审计修订见下**

> **实施修订（2026-08-15 审计后）**：
> - **applyChangesCore 时序**：`postStartHook` 在 `startInternal` 后等 RUNNING 再执行（`waitForState` 15s 超时）——P0-1 修复（原在 STARTING 执行导致 LDM `/p reload` 权限重载永远不执行）
> - **serializeRocketUnturnedConfig**：P0-2 修复——`root = tree`（原 `findElement` 找根元素永远找不到 → 9 字段修改不写回）
> - **PUT /rocket-unturned-config 路由**：P0-3 补充——原缺路由，`writeRocketUnturnedConfig` 是死代码
> - **错误码**：`plugin-not-found`(404) / `pty-timeout`(500) / `operation-conflict`(409) 三码在 load/unload/reload 统一真的抛（设计 §3.2 错误码表以此为准）
> - **Rocket.Unturned 测试**：round-trip 用例已补（原 0 覆盖）
> - **mod_apply 共用未兑现**：`applyChangesCore` 唯一调用方是 `LdmApplyService`（hook='ldm_apply'）；`WorkshopApplyService.applyStaged` 仍只在 `startInternal` 内跑（ServerManager.ts:558），`modpack_apply` 不存在。§5.6「与 mod_apply 共用」是评审稿预期，现状是单调用方——正文多处「与 mod_apply 共用」表述以本修订为准

## 0. 一句话结论

Phase 2 拆 2a（XML 解析 + 配置读写，7-9 人天）+ 2b（重启流水线 + UI 齐备，5-6 人天），合计 **12-15 人天**——和 §12.3 估算一致。核心交付：3 个新后端模块（`RocketConfigXmlParser` / `LdmConfigWriter` / `LdmApplyService`）+ `ServerManager.applyChangesCore` 抽出（与 `mod_apply` 共用，预留 `modpack_apply` 第三处）+ 6 端点 + 1 WS + 前端 4 Tab 完整。

## 1. 背景与目标

### 1.1 Phase 1 留下的 UX 闭环缺口

Phase 1（commit `cfa662b` 已闭环）做到「看得到 + 启停得了」，但**配置可改可不改**——用户要改 LDM 配置只能 ssh 上服务器手改 XML。Phase 2 目标：

- **结构化字段编辑器**——`Rocket.config.xml` 16 字段 + `Rocket.Unturned.config.xml` 9 字段 + `Permissions.config.xml` 树形（Groups / Members / Permissions / Color / ParentGroup / Priority / Prefix / Suffix / Cooldown）
- **通用 XML 编辑器**——各插件 `<Plugin>.configuration.xml` 原文编辑（不强解 schema）
- **改完走 PTY 终端 owner-trust 重启流水线**——**配置即生效**

### 1.2 钉死的边界

| 边界 | 出处 |
|---|---|
| **LDM 无热重载** | `prohibitions.md` 钉死；Issue #1794；设计 §11.1 B5 |
| **写配置允许运行时** | 写 = 文件 I/O（不阻断任何状态）；**生效需重启**——前端文案提醒 + 「应用变更」按钮单独触发（ADR-0004 §重启） |
| **改完走 PTY 重启流水线** | ADR-0004 §重启（Save + Shutdown 10 + forceKill + spawn）——**用户主动**，写配置时不自动触发 |
| **前端「保存配置」按钮必须有「需重启生效」提示** | UI 文案「配置已保存，需重启服务器才能生效」（不是 toast 强提示，而是保存按钮旁的常驻提示 + 「应用变更」按钮同时可见） |
| **配置原子写 + 备份 + 回滚** | `ConfigService.atomicWrite`（已存在）；写入前 `.bak.<UTC-ISO>` 备份 |
| **XML 解析自写** | 不引 fast-xml-parser / xml2js 等外部依赖（保留注释/属性顺序/CDATA 关键） |
| **不强解插件 schema** | 设计 §11.1 A4——每插件自定义，面板只做 Monaco XML 通用编辑器 |

## 2. 总体切片（2a + 2b）

| 期 | 主题 | 工作量 | 后端模块 | 端点 | 前端 | 升期依赖 |
|---|---|---|---|---|---|---|
| **Phase 2a** | XML 解析 + 配置读写 | 7-9 人天 | + `RocketConfigXmlParser` / `LdmConfigWriter` | +4 = 9 端点 | FrameworkConfigTab 骨架（只读 + 字段预览）+ PluginConfigDialog 框架 | Phase 1 全绿 + 实机验证 |
| **Phase 2b** | 重启流水线 + UI 齐备 | 5-6 人天 | + `LdmApplyService` + `ServerManager.applyChangesCore` 抽出 + `LdmPluginCommandsService` 增强 | +2 = 11 端点 + 1 WS | 4 Tab 完整 UI + 树形编辑器 + Monaco XML + 「关于 LDM」/「LDM 状态」卡 | Phase 2a 全绿 + 实机验证 |
| **合计** | — | **12-15 人天** | 7 模块 | 11 端点 + 1 WS | 1 页面 4 Tab | — |

**为什么 2a/2b 拆**：§12.8 推荐——Phase 2a 是「读改能力」（纯文件 I/O，可独立交付 + 单测覆盖 ≥ 8 用例 RocketConfigXmlParser），Phase 2b 是「生效能力」（依赖 PTY 状态机 + 抽出 applyChangesCore + 前端 Monaco 集成）。拆开后 2a 完成后用户能 SSH 改前先预览字段、2b 完成后用户能面板全流程。

## 3. Phase 2a — XML 解析 + 配置读写（7-9 人天）

### 3.1 `RocketConfigXmlParser`（新模块）

**职责**：自写 XML 解析，保留注释/属性顺序/CDATA/嵌套/未知键。

**核心约束**（与现有 `VdfParser` 同思路）：
- **注释保留**——`<!-- ... -->` 不丢（用户文档/版权声明/字段说明）
- **属性顺序保留**——`<Tag Attr1="x" Attr2="y">` 顺序写回不重排
- **CDATA 保留**——`<![CDATA[ ... ]]>` 原样
- **嵌套保留**——`<Parent><Child/></Parent>` 层级不破坏
- **未知键保留**——`<UnknownKey>value</UnknownKey>` 不删（用户手写配置）
- **文本节点保留**——`<Tag>text content</Tag>` 中间文本不丢

**接口**（`shared/contracts/ldm.ts` 加 `IRocketConfigXmlParser`）：

```typescript
export interface IRocketConfigXmlParser {
  /** Rocket.config.xml 字符串 → 结构化字段 + 原文（高级视图用） */
  parseRocketConfig(xml: string): { fields: RocketConfigFields; raw: string };
  /** Rocket.Unturned.config.xml 字符串 → 结构化字段 + 原文 */
  parseRocketUnturnedConfig(xml: string): { fields: RocketUnturnedConfigFields; raw: string };
  /** Permissions.config.xml 字符串 → 树形 + 原文 */
  parsePermissionsConfig(xml: string): { fields: PermissionsConfigFields; raw: string };
  /** 结构化字段 → XML 字符串（保留未改字段）—— 通过「字段合并」而非「整体重写」 */
  serializeRocketConfig(fields: RocketConfigFields, originalXml: string): string;
  serializeRocketUnturnedConfig(fields: RocketUnturnedConfigFields, originalXml: string): string;
  serializePermissionsConfig(fields: PermissionsConfigFields, originalXml: string): string;
  /** 通用 XML 字符串 ↔ 树（保留注释/CDATA）—— 用于 plugins Configuration.xml */
  parseGeneric(xml: string): XmlNode;
  serializeGeneric(node: XmlNode): string;
}
```

**关键技术**：

```typescript
// XmlNode 类型（保留原始信息）
interface XmlNode {
  type: 'element' | 'text' | 'comment' | 'cdata';
  name?: string;
  attrs?: Record<string, string>;
  children?: XmlNode[];
  value?: string;
  /** 原始字节偏移（写回时定位） */
  rawStart?: number;
  rawEnd?: number;
}
```

**序列化策略**——**字段合并**，不整体重写：

```typescript
serializeRocketConfig(fields, originalXml) {
  const tree = parseGeneric(originalXml);
  // 找到 <RocketSettings> 元素，遍历 fields
  // 每个字段：在树中查对应子元素/属性，更新值；未在 fields 中的子元素原样保留
  return serializeGeneric(tree);
}
```

**测试门槛**：`RocketConfigXmlParser.test.ts` ≥ 8 用例
- 注释保留（输入含 `<!-- comment -->`, 序列化后保留）
- 属性顺序保留（输入 `Attr1="x" Attr2="y"`, 序列化后顺序不变）
- CDATA 保留（输入 `<![CDATA[...]]>`, 序列化后保留）
- 嵌套保留（输入 3 层嵌套, 序列化后结构一致）
- 未知键保留（输入 `<UnknownKey>foo</UnknownKey>`, 不在 fields 中, 序列化后保留）
- 文本节点保留（输入 `<Tag>text</Tag>`, 中间文本不丢）
- 字段合并（修改一个字段, 其他字段未改）
- Round-trip（parseRocketConfig → serializeRocketConfig → parseRocketConfig = 等价）

### 3.2 `LdmConfigWriter`（新模块）

**职责**：3 XML 原子写 + 备份 + 回滚。

**接口**（`shared/contracts/ldm.ts` 加 `ILdmConfigWriter`）：

```typescript
export interface ILdmConfigWriter {
  /** 写 Rocket.config.xml（结构化字段 → XML 字符串 → 原子写） */
  writeRocketConfig(serverId: ServerId, fields: RocketConfigFields): Promise<WriteResult>;
  /** 写 Rocket.Unturned.config.xml */
  writeRocketUnturnedConfig(serverId: ServerId, fields: RocketUnturnedConfigFields): Promise<WriteResult>;
  /** 写 Permissions.config.xml */
  writePermissionsConfig(serverId: ServerId, fields: PermissionsConfigFields): Promise<WriteResult>;
  /** 写单个插件 Configuration.xml（通用 XML） */
  writePluginConfig(serverId: ServerId, pluginName: string, xml: string): Promise<WriteResult>;
}

interface WriteResult {
  success: boolean;
  backupPath: string;   // .bak.<UTC-ISO>
  writtenAtIso: string;
}
```

**实现**（复用 `ConfigService.atomicWrite`）：

```typescript
async writeRocketConfig(serverId, fields) {
  // 1. 读原文
  const originalXml = await fs.readFile(this.rocketConfigPath(serverId), 'utf-8');
  // 2. 字段合并 → XML 字符串
  const newXml = this.parser.serializeRocketConfig(fields, originalXml);
  // 3. 校验 Zod schema（防字段值非法）
  const validated = RocketConfigWriteSchema.parse(fields);
  // 4. 备份 + 原子写（复用 ConfigService.atomicWrite）
  //    不校验 ServerManager 状态——写是文件 I/O，可在任意状态执行；
  //    生效需用户主动点「应用变更」触发 PTY 重启流水线（ADR-0004 §重启）。
  return this.configService.atomicWrite({
    path: this.rocketConfigPath(serverId),
    content: newXml,
    backupSuffix: '.bak.' + new Date().toISOString(),
  });
}
```

**测试门槛**：`LdmConfigWriter.test.ts` ≥ 6 用例
- 写 Rocket.config.xml 成功 + 备份文件生成
- 写 Permissions.config.xml 成功 + 字段保留
- 写插件 Configuration.xml 成功（通用 XML）
- 运行时写成功（不阻断 ServerManager 状态——写是文件 I/O）
- 写失败回滚（备份恢复）
- Zod schema 校验失败报错

### 3.3 新增 4 端点（Phase 2a 阶段）

#### 3.3.1 `GET /api/servers/:id/ldm/plugins/:name/config`

- **职责**：读单个插件 `<Plugin>.configuration.xml` 原文
- **入参**：path `name`（pluginName）
- **响应**：`{ data: { name, raw, sizeBytes, modifiedAtIso } }`
- **错误码**：
  - `plugin-config-not-found` 404 — 文件不存在
  - `plugin-name-invalid` 400 — name 含非法字符（路径白名单）

#### 3.3.2 `PUT /api/servers/:id/ldm/plugins/:name/config`

- **职责**：写 Configuration.xml（通用 XML 原文）
- **入参**：`{ raw: string }`
- **响应**：`OperationResponseSchema`
- **错误码**：
  - `plugin-config-invalid` 400 — XML 解析失败
  - `plugin-name-invalid` 400 — name 含非法字符

#### 3.3.3 `PUT /api/servers/:id/ldm/rocket-config`

- **职责**：写 Rocket.config.xml（结构化字段）
- **入参**：`RocketConfigWriteSchema`
- **响应**：`OperationResponseSchema`
- **错误码**：
  - `rocket-config-invalid` 400 — Zod schema 校验失败

#### 3.3.4 `PUT /api/servers/:id/ldm/permissions-config`

- **职责**：写 Permissions.config.xml（结构化字段）
- **入参**：`PermissionsConfigWriteSchema`
- **响应**：`OperationResponseSchema`
- **错误码**：同上

### 3.4 前端 FrameworkConfigTab 骨架 + PluginConfigDialog 框架

**Phase 2a 范围**——**只读 + 字段预览**（不写）：

- `FrameworkConfigTab`：展示 Rocket.config.xml 字段（key-value 表格，禁用编辑）
- `PermissionsTab`：展示 Permissions.config.xml 树形（只读）
- `PluginConfigDialog`：Monaco XML 编辑器对话框——Phase 2a 只展示，Phase 2b 加「保存」按钮

**测试门槛**：`LdmPage.test.tsx` 加 4 用例
- FrameworkConfigTab 字段渲染
- PermissionsTab 树形渲染
- PluginConfigDialog 打开 + XML 渲染
- 只读状态断言（编辑控件 disabled）

## 4. Phase 2b — 重启流水线 + UI 齐备（5-6 人天）

### 4.1 `LdmApplyService`（新模块）

**职责**：薄业务层，调 `ServerManager.applyChangesCore`，**与 mod_apply 共用流水线本体**。

**接口**（`shared/contracts/ldm.ts` 加 `ILdmApplyService`）：

```typescript
export interface ILdmApplyService {
  /** 应用 LDM 配置变更（走 PTY 重启流水线）—— 用户主动触发，非写配置时自动 */
  apply(serverId: ServerId, opts?: { changedPlugins?: string[] }): Promise<ApplyResult>;
  /** 注册到 ServerManager.applyChangesCore 的 hook 名 */
  readonly hookName: 'ldm_apply';
}
```

**实现**：参考 `mod-management-design.md` v2.5 `WorkshopApplyService.applyStaged`——**只调共用核心，**不重复实现重启逻辑。

### 4.2 `ServerManager.applyChangesCore` 抽出

**背景**：当前 `ServerManager.applyChangesCore` 是与 `mod_apply` 共用的「重启流水线本体」（设计 §5.6）——但 `mod_apply` 的代码分散在 `ServerManager.startInternal` 里，**没有真抽出独立方法**。

**目标**：把「Save + Shutdown 10 + forceKill + spawn」+ 「PTY waitForMarker」抽出独立方法 `applyChangesCore(serverId, opts)`：

```typescript
// ServerManager.applyChangesCore（设计 §5.6，本节落地）
async applyChangesCore(
  serverId: ServerId,
  opts: {
    hook: 'mod_apply' | 'ldm_apply' | 'modpack_apply';  // 预留第三处
    preStopHook?: () => Promise<void>;  // LdmApplyService.apply 在停止前做的
    postStartHook?: () => Promise<void>; // 同上, 启动后做的
  }
): Promise<void>;
```

**`LdmApplyService.apply` 调用**：

```typescript
async apply(serverId, opts) {
  await this.serverManager.applyChangesCore(serverId, {
    hook: 'ldm_apply',
    preStopHook: async () => {
      // 1. 校验 3 XML 写完（Phase 2a 已落地）
      // 2. WS 推 'ldm_apply_progress' { stage: 'preparing', percent: 0 }
    },
    postStartHook: async () => {
      // 1. WS 推 'ldm_apply_progress' { stage: 'verifying', percent: 90 }
      // 2. PTY 写 /p reload（D4 重载 Permissions.config.xml）
      // 3. WS 推 'ldm_apply_progress' { stage: 'ready', percent: 100 }
    },
  });
}
```

**为什么 backend-development.md「重复 ≥3 模块共用→新建共享」原则**：当前是 2 个共用方（mod_apply + ldm_apply）；未来 `modpack_apply` 第三处会加入。预留位见设计 §11.3。

**测试门槛**：`ServerManager.test.ts` 加 4 用例
- `applyChangesCore` mod_apply 路径（写新 Mod）
- `applyChangesCore` ldm_apply 路径（写 LDM 配置）
- 重入保护（同时调两次第二次拒绝）
- preStopHook 失败 rollback

### 4.3 新增 2 端点 + 1 WS

#### 4.3.1 `POST /api/servers/:id/ldm/apply`

- **职责**：应用 LDM 配置变更（走 PTY 重启流水线）
- **入参**：`LdmApplyRequestSchema { changedPlugins?: string[] }`
- **响应**：`OperationResponseSchema`（异步任务 ID）
- **错误码**：
  - `operation-conflict` 409 — activeOperation 锁（审计修订：代码实际抛此码，非 `server-busy`）
  - `ldm-apply-failed` 500 — 流水线失败（审计修订：代码实际抛此码，非 `apply-failed`）

#### 4.3.2 WS `ldm_apply_progress`

- **职责**：推送 LDM 应用进度
- **事件 schema**：
  ```typescript
  {
    type: 'ldm_apply_progress';
    serverId: string;
    stage: 'preparing' | 'stopping' | 'starting' | 'verifying' | 'ready' | 'failed';
    percent: number;        // 0-100
    message?: string;       // 错误时填
  }
  ```

### 4.4 `LdmPluginCommandsService` 增强

**新增 3 方法**：

```typescript
export interface ILdmPluginCommandsService {
  // ... 已有 load/unload/reload
  /** 读 LDM 主框架版本（D2：空参 `/rocket` 解析） */
  readLdmVersion(serverId: ServerId): Promise<LdmVersion>;
  /** 读 Rocket.Unturned 模块加载状态（D3：`/modules`） */
  readModulesState(serverId: ServerId): Promise<ModulesState>;
  /** 重载 Permissions.config.xml（D4：`/p reload`） */
  reloadPermissions(serverId: ServerId): Promise<CommandResult>;
}
```

**stdout 解析正则**：
- D2: `Rocket v(?<ldmVersion>\S+) for Unturned v(?<gameVersion>\S+)`
- D3: `Rocket\.Unturned` 行出现 → 加载；不出现 → 未加载
- D4: `/p reload` 输出 `Reloaded permissions from 'Permissions.config.xml'`

**测试门槛**：`LdmPluginCommandsService.test.ts` 加 4 用例
- 读 LDM 版本（stdout 含 `Rocket v4.0.0.0 for Unturned v3.25.0.0` → 解析成功）
- 读模块状态（stdout 含 `Rocket.Unturned` → loaded=true）
- 重载 Permissions（PTY 写 `/p reload` + stdout 解析）
- 非 RUNNING 状态报错

### 4.5 前端 4 Tab 完整 UI

**`LdmPage` 顶部全局按钮**（用户 2026-08-15 拍板）：

- **「应用变更」按钮**——全局可见，4 Tab 都能触发。点击调 `POST /api/servers/:id/ldm/apply` 走 PTY 重启流水线（用户手动触发，**不在「保存配置」时自动**）。
  - **独立动作**——与「保存配置」**完全解耦**：任何时候都能点（保存前/保存后/不保存只重启均可）。是否需要重启、何时重启，由用户自己决定。

**4 Tab 内部按钮**：

| Tab | Phase 2a | Phase 2b |
|---|---|---|
| ① 已装插件 | Phase 1 继承 | + 「关于 LDM」卡显示版本（D2）<br>+ 「LDM 状态」卡显示模块加载（D3） |
| ② 框架配置 | 只读字段预览 | + 结构化字段编辑器（16 + 9 字段）<br>+ XML 高级视图切换（Toggle：「结构化 / 原文」）<br>+ 「保存配置」按钮（调 `PUT /rocket-config`） |
| ③ 权限组 | 只读树形 | + 树形编辑器（Groups / Members / Permissions / Cooldown）<br>+ 「保存配置」按钮 |
| ④ 插件配置 | 只读 Monaco XML | + 「保存配置」按钮（调 `PUT /plugins/:name/config`） |

**「保存配置」与「应用变更」是两独立动作**：

- 「保存配置」= 文件写入（运行时允许，不阻断 ServerManager 状态）
- 「应用变更」= 重启生效（用户主动触发，走 PTY 重启流水线）
- **二者不绑定**：保存配置不会自动触发应用变更；用户可以在不保存的情况下单独重启，也可以保存后选择稍后再重启。

## 5. 数据模型（Zod Schema）

`shared/schemas/ldm.schema.ts` 加：

```typescript
/** Rocket.config.xml 写请求 */
export const RocketConfigWriteSchema = z.object({
  languageCode: z.string().default('en'),
  maxFrames: z.number().int().min(60).default(60),
  automaticShutdown: z.object({
    enabled: z.boolean().default(false),
    interval: z.number().int().default(86400),
  }),
  webPermissions: z.object({
    enabled: z.boolean().default(false),
    url: z.string().default(''),
  }),
  webConfigurations: z.object({
    enabled: z.boolean().default(false),
    url: z.string().default(''),
  }),
  // ... 16 字段完整（见 ldm-integration-design.md §2.4）
});

/** Permissions.config.xml 写请求 */
export const PermissionsConfigWriteSchema = z.object({
  groups: z.array(z.object({
    id: z.string(),
    name: z.string(),
    parentGroup: z.string().optional(),
    priority: z.number().int().default(0),
    color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).default('#FFFFFF'),
    prefix: z.string().default(''),
    suffix: z.string().default(''),
    cooldown: z.number().int().default(0),
    permissions: z.array(z.string()),
    members: z.array(z.string().regex(/^7656119\d{10}$/)),  // SteamID64
  })),
});

/** 通用 XML 写请求（插件 Configuration.xml） */
export const PluginConfigWriteSchema = z.object({
  raw: z.string().min(1),
});

/** LDM 应用请求 */
export const LdmApplyRequestSchema = z.object({
  changedPlugins: z.array(z.string()).optional(),
});
```

## 6. 验证门槛

### Phase 2a 升期到 Phase 2b 门控

| 门控 | 检查项 | 工具 |
|---|---|---|
| **类型检查** | 双端 `tsc --noEmit` 0 错 | `npm run typecheck` |
| **单测覆盖率** | RocketConfigXmlParser ≥ 8 / LdmConfigWriter ≥ 6 / 改到的文件行覆盖 ≥ 80% | `npm run test:cov` |
| **E2E** | 「改 Rocket.config.xml 字段 → 保存 → 验证文件更新」 + 「改 Permissions.config.xml → 保存 → 验证文件更新」 | `playwright` |
| **接口契约** | ajv 加在 4 个新端点 | `npm run test:contract` |
| **实机验证** | Linux 真机 U3DS 跑通 4 端点（读 / 写） | Sprint 5 真机 |
| **文档同步** | `ldm-integration-design.md` §6.1 端点清单更新 + `reference_config_files.md` §LDM 加新字段 | `doc-outdated-guard` |

### Phase 2b 升期到 Phase 3 门控

| 门控 | 检查项 |
|---|---|
| **类型检查** | 0 错 |
| **单测覆盖率** | `applyChangesCore` ≥ 4 / `readLdmVersion` ≥ 2 / 改到的文件行覆盖 ≥ 80% |
| **E2E** | 「改 Rocket.config.xml → 应用 → 实例 STOPPED→STARTING→RUNNING → 配置落盘 + stdout 含新配置生效信号」 + 「框架配置 Tab 顶部显示 LDM 版本 + 模块加载状态」 |
| **实机验证** | Linux 真机跑通完整 4 Tab 操作 |

## 7. 边界与依赖

### 7.1 与现有架构的边界

| 能力簇 | 接入方式 | 复用现有模块 |
|---|---|---|
| 配置层 A1-A4 | XML 解析 + 原子写 | `ConfigService.atomicWrite`（已存在） |
| 插件生命周期 B3 | PTY 终端 | `LdmPluginCommandsService`（Phase 1 已实现 load/unload） |
| 控制台命令 D2-D4 | PTY stdout 解析 | `LdmPluginCommandsService` 增强 |
| 重启流水线 | `applyChangesCore` 抽出 | 与 `mod_apply` 共用 |

### 7.2 与 mod-management-design.md v2.5 的边界

| 维度 | 资源包（Workshop unity3d） | LDM 插件（.dll） |
|---|---|---|
| 下载 | SteamCMD（面板触发） | 浏览器手动（G5） |
| 安装 | Files API（Phase 1 落地） | Files API（2026-08-15 落地） |
| 应用 | `WorkshopApplyService.applyStaged` → `applyChangesCore` | `LdmApplyService.apply` → `applyChangesCore` |
| 共用 | **`ServerManager.applyChangesCore` 抽出**（§4.2） | 同左 |

### 7.3 升期依赖

- **Phase 1 全绿 + 实机验证**——升 Phase 2a 前置
- **Phase 2a 全绿 + 实机验证**——升 Phase 2b 前置
- **Phase 2b 全绿 + 实机验证**——升 Phase 3 前置

### 7.4 ADR / 文档影响

| 文档 | 影响 |
|---|---|
| ADR-0006 §3.2 模块树 | ✅ 已规划 7 模块（无需改） |
| `ldm-integration-design.md` §6.1 端点清单 | **需更新**——§12.3 拆分 2a/2b + 端点 6→4+2 |
| `reference_config_files.md` §3-5 | **需更新**——加 16 + 9 字段真源 + Permissions 树形 schema |
| `unturned-sop.md` §LDM | **需更新**——加「配置编辑 + 重启」流程 |
| `communication.md` §Serena 记忆纪律 | **待同步**——路径规则与本项目 `.serena/memories/` 不一致（用户 2026-08-15 拍板） |

## 8. 升期门控（Phase 1 → 2）

按 §12.7 升期门控原方案要求 Phase 1 全过。**用户 2026-08-15 拍板**：

- ✅ **4 个 Phase 1 遗留 fail 暂不修复**（PTY \r→\n 断言 / steamCmdManager mock 串台 / LdmPage E2E / Linux 真机验证）—— 不再是 Phase 2 启动阻断门控，作为 backlog 留待后续 Sprint 处理
- ✅ **Phase 2a 启动条件放宽**：双端 typecheck 0 错 + LDM 模块单测绿 + `§12.7` 文档同步门控通过

**实际启动 Phase 2a 前**仍需：
- ✅ 前端 typecheck 0 错（已满足：LdmPage 改动后 typecheck 通过）
- ✅ LdmPage.test.tsx + InfoCard.test.tsx 全绿（已满足：14/14）
- ✅ `ldm-integration-design.md` §6.1 端点清单 + `reference_config_files.md` §LDM 字段表同步更新
- ✅ doc-outdated-guard 提交时无 ✏️/🗑️/⚠️ 阻断

## 9. 实施计划（推荐节奏）

| Sprint | 工作 | 端点 / 模块 |
|---|---|---|
| Sprint N | 清 Phase 1 遗留 fail + E2E + 真机验证 | 0 |
| Sprint N+1 | **Phase 2a 前半**：`RocketConfigXmlParser`（核心解析器） | 0 |
| Sprint N+2 | **Phase 2a 后半**：`LdmConfigWriter` + 4 端点 + 前端只读 | 4 端点 |
| Sprint N+3 | **Phase 2b 前半**：`LdmApplyService` + `applyChangesCore` 抽出 | 1 端点 + 1 WS |
| Sprint N+4 | **Phase 2b 后半**：4 Tab 完整 UI + `LdmPluginCommandsService` 增强 + 实机验证 | 1 端点 |
| **合计** | 4 Sprint | 6 端点 + 1 WS |

## 10. 关联文档

- 主设计：`docs/architecture/ldm-integration-design.md`（§5 / §6 / §11 / §12）
- ADR：`docs/adr/0006-ldm-framework-integration.md`
- 资源包：`docs/architecture/mod-management-design.md` v2.5（共用 `applyChangesCore`）
- SOP：`.claude/rules/unturned-sop.md` §LDM
- 上一期：Phase 1 实施落档（`LdmPluginSourceService.ts` + 测试）
- 本期记忆：`.serena/memories/session-checkpoint-2026-08-15-ldm-b1-upload.md`

---

_版本：v0.1 设计稿 · 2026-08-15_
_待评审：用户对 2a/2b 拆解 + `applyChangesCore` 抽出时机的拍板_