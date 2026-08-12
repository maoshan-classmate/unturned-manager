# LDM 接入 Phase 1 详细规格（"看得到 + 启停得了"）

> **状态**：v0.1 设计稿 · **日期**：2026-08-12
> **位置**：`claudedocs/workflow_sprint5_ldm_phase1.md`（Sprint 5 工作流；Phase 1 实施完成时按 `document-organization.md` 生命周期收尾）
> **承接**：`docs/architecture/ldm-integration-design.md` §12.2（Phase 1 切片）
> **范围**：仅 Phase 1 详细规格；Phase 2/3/4 留白待后续文档
> **驱动**：用户 2026-08-12「针对 Phase 1 设计具体方案 开始做 Phase 1 --focus quality」

---

## 0. 一句话范围

**Phase 1 交付 5 端点（4 主端点 + 1 PAT-test 端点）+ 4 后端模块 + 2 个前端 Tab + 1 个 PE 解析工具**，让用户能：
- 看到已装插件列表（含 .dll 版本号、运行时加载状态）
- 通过 PTY 加载 / 卸载插件（**不停服**）
- 上传 / 替换 / 删除 .dll
- 浏览 LDM-Community 公开插件列表（5min 进程内缓存）

**不交付**（Phase 2-4 范围）：
- 配置 XML 编辑（A1–A4 / C1–C4）
- 重启流水线（LdmApplyService + applyChangesCore 抽出）
- 引导 SOP 卡片
- 全局 reload / 高级 UX

---

## 1. 范围对齐（钉死的边界）

| 边界 | 出处 | Phase 1 怎么落地 |
|---|---|---|
| 唯一命令通道 = PTY 终端 owner-trust | ADR-0004 Phase 6 | `LdmPluginCommandsService` 走现有 `PtyManager.write` |
| 状态机 = 4 态 | ADR-0004 §3.3 | Phase 1 启停命令**不触发状态机转换**（轻量操作） |
| 多实例隔离 | `Rocket/Rocket.Core/Environment.cs` `RocketDirectory = "Servers/{0}/Rocket/"` | 路径解析走 `pathResolver.resolveServerPath` |
| Linux 大小写敏感 | `Plugins/Uconomy/` ≠ `Plugins/uconomy/` | 上传 + 列表阶段都校验 .dll 名与子目录名一致 |
| 禁止自动跑 `rocket reload` | `prohibitions.md` 钉死 | Phase 1 不暴露全局 reload（Phase 4 才加 warn 后暴露单插件） |
| 不自动装 LDM | `decision-no-auto-install-steamcmd-u3ds.md` | 列表为空时返回 `not-detected`，UI 引导用户 cp 命令 |
| 复用 5min 进程内缓存 | `WorkshopMetadataService.browseMods` 模式 | LDM-Community 列表复用 |

---

## 2. shared 层（types / schemas / contracts）

### 2.1 类型（`shared/types/domain.ts`）

```typescript
/**
 * 已装插件描述（Phase 1 视图模型）。
 * @field name 插件目录名 = 插件标识（Linux 大小写敏感）
 * @field version .dll 元数据 AssemblyVersionAttribute；解析失败时 null，前端显示「未知」
 * @field sizeBytes .dll 文件大小（前端做合规校验显示，非 LDM 自身关注）
 * @field hasConfig <插件名>.configuration.xml 是否存在
 * @field modifiedAtIso .dll 文件 mtime（ISO）—— 用户判断插件是否最近改过
 * @field runtimeStatus 运行时加载状态；STOPPED 时为 unknown，UI 提示「实例未运行」
 */
export interface InstalledPlugin {
  name: string;
  version: string | null;
  sizeBytes: number;
  hasConfig: boolean;
  modifiedAtIso: string;
  runtimeStatus: 'loaded' | 'unloaded' | 'failure' | 'cancelled' | 'unknown';
}

/**
 * LDM-Community 公开插件条目（Phase 1 单端点）。
 * @field slug 唯一键（用于详情抽屉——Phase 3 才接）
 * @field name 显示名
 * @field author GitHub 仓库 owner
 * @field description 截断前 280 字
 * @field repoUrl GitHub Releases 页（点击外链）
 * @field latestVersion 来自 LDM-Community 公开 JSON（Phase 1 不点击深入查 GitHub API）
 * @field updatedAtIso 仓库最近发版时间
 */
export interface CommunityPlugin {
  slug: string;
  name: string;
  author: string;
  description: string;
  repoUrl: string;
  latestVersion: string;
  updatedAtIso: string;
}
```

### 2.2 Zod Schema（`shared/schemas/ldm.schema.ts`，Phase 1 增量）

> 命名约定：Phase 1 6 个 schema，加 `// @phase1` 标记供后续 Phase 复用时识别。

```typescript
import { z } from 'zod';

/**
 * @phase1 GET /api/servers/:id/ldm/installed 响应
 */
export const InstalledPluginSchema = z.object({
  name: z.string().regex(/^[A-Za-z0-9._-]+$/, '插件名只能含字母数字 . _ -'),
  version: z.string().nullable(),
  sizeBytes: z.number().int().nonnegative(),
  hasConfig: z.boolean(),
  modifiedAtIso: z.string().datetime(),
  runtimeStatus: z.enum(['loaded', 'unloaded', 'failure', 'cancelled', 'unknown']),
});
export type InstalledPluginDto = z.infer<typeof InstalledPluginSchema>;

/**
 * @phase1 GET /api/servers/:id/ldm/installed 响应包装
 */
export const InstalledPluginsResponseSchema = z.object({
  serverId: z.string(),
  plugins: z.array(InstalledPluginSchema),
  /** LDM 主框架未装 / Rocket/ 目录缺失时 = true；UI 引导 5 步 SOP */
  ldmNotDetected: z.boolean(),
  /** LDM 状态检测时间（ISO）—— UI 显示「3 分钟前检测」 */
  detectedAtIso: z.string().datetime(),
});
export type InstalledPluginsResponse = z.infer<typeof InstalledPluginsResponseSchema>;

/**
 * @phase1 POST /api/servers/:id/ldm/load-plugin 与 unload-plugin 请求
 */
export const PluginCommandRequestSchema = z.object({
  pluginName: z.string().regex(/^[A-Za-z0-9._-]+$/, '插件名只能含字母数字 . _ -'),
});
export type PluginCommandRequest = z.infer<typeof PluginCommandRequestSchema>;

/**
 * @phase1 load-plugin / unload-plugin 响应（仅 status 变化不算"重启"）
 */
export const PluginCommandResponseSchema = z.object({
  serverId: z.string(),
  pluginName: z.string(),
  /** 终态：succ = LDM 接受；fail = LDM 拒绝（插件不存在 / 依赖缺失 / 已是目标态） */
  outcome: z.enum(['success', 'failure']),
  /** LDM stdout 末尾 ≤ 256 字（失败时给前端 toast 显示原文） */
  ldmOutput: z.string().max(256),
});
export type PluginCommandResponse = z.infer<typeof PluginCommandResponseSchema>;

/**
 * @phase1 GET /api/ldm/community-plugins 响应
 */
export const CommunityPluginSchema = z.object({
  slug: z.string(),
  name: z.string(),
  author: z.string(),
  description: z.string(),
  repoUrl: z.string().url(),
  latestVersion: z.string(),
  updatedAtIso: z.string().datetime(),
});
export type CommunityPluginDto = z.infer<typeof CommunityPluginSchema>;

export const CommunityPluginsResponseSchema = z.object({
  plugins: z.array(CommunityPluginSchema),
  /** 缓存元数据：前端「刷新」按钮 hover 显示「N 分钟前更新」 */
  fetchedAtIso: z.string().datetime(),
  /** fetch 失败但用 stale 缓存兜底时 = true；UI 提示「LDM-Community 不可达，正在展示缓存」 */
  stale: z.boolean(),
});
export type CommunityPluginsResponse = z.infer<typeof CommunityPluginsResponseSchema>;
```

### 2.3 契约（`shared/contracts/ldm.ts`，Phase 1 增量）

```typescript
import type { ServerId } from './server';
import type { InstalledPlugin, CommunityPlugin } from '../types/domain';

/**
 * LDM 插件发现服务（Phase 1 子集）。
 * Phase 2 会扩展 readRocketConfig / readPermissionsConfig / readPluginConfig 等方法。
 */
export interface ILdmDiscoveryService {
  /**
   * 列已装插件——扫描 Servers/<id>/Rocket/Plugins/ 目录，解析 .dll 元数据。
   * @param serverId 实例标识
   * @returns 插件列表 + LDM 状态检测结果
   * @throws AppError('server-not-found') 实例不存在
   * @throws AppError('filesystem-error') 读取失败（Permission denied / IO 错误）
   * 单实例扫描 ≤ 50 个插件性能 ≤ 200ms（PE 解析 1 个 ≤ 5ms）
   */
  listInstalledPlugins(serverId: ServerId): Promise<{
    plugins: InstalledPlugin[];
    ldmNotDetected: boolean;
  }>;
}

/**
 * LDM 插件命令服务（PTY 终端 owner-trust）。
 * Phase 1 仅 load / unload；Phase 4 加 reload（带警告）。
 */
export interface ILdmPluginCommandsService {
  /**
   * PTY 写 `/rocket load <name>`——加载已卸载插件。
   * 不停服，不触发状态机转换。
   * @param serverId 实例标识
   * @param pluginName 插件名（Linux 大小写敏感，与 .dll 文件名去扩展严格一致）
   * @returns outcome + LDM stdout 末尾（≤ 256 字）
   * @throws AppError('server-not-running') 实例未运行
   * @throws AppError('plugin-not-found') 插件未安装
   * @throws AppError('pty-write-failed') PTY 写入失败
   * @throws AppError('pty-timeout') 10s 内未收到 LDM 响应
   * @throws AppError('operation-conflict') 已有同 server 的 plugin command 在跑
   */
  loadPlugin(serverId: ServerId, pluginName: string): Promise<{
    outcome: 'success' | 'failure';
    ldmOutput: string;
  }>;

  /**
   * PTY 写 `/rocket unload <name>`。
   * 同 loadPlugin 错误定义。
   */
  unloadPlugin(serverId: ServerId, pluginName: string): Promise<{
    outcome: 'success' | 'failure';
    ldmOutput: string;
  }>;
}

/**
 * LDM 插件来源服务（LDM-Community 公开列表）。
 */
export interface ILdmPluginSourceService {
  /**
   * 拉取 LDM-Community 公开插件列表——HTML 解析 + GitHub API 双源融合，5min 进程内缓存。
   * @param pat - GitHub PAT（可选；用户从 LdmPage 「插件来源」Tab 顶部配置）；null = 匿名调用
   * @returns 列表 + 缓存元数据
   * @throws AppError('community-source-unreachable') 上游不可达且无 stale 缓存
   * @throws AppError('community-source-malformed') 上游 HTML 结构异常或 0 plugin
   * @throws AppError('community-source-rate-limited') GitHub API 二次调用全部 403 限流
   */
  listCommunityPlugins(pat: string | null): Promise<{
    plugins: CommunityPlugin[];
    fetchedAtIso: string;
    stale: boolean;
  }>;
}

/**
 * .NET DLL 版本号读取器（PE 元数据流式解析）。
 * 抽象接口——实现可换（pe-library / 自写 / AsmResolver），契约不变。
 */
export interface ILdmAssemblyVersionReader {
  /**
   * @param dllPath 绝对路径
   * @returns `'1.2.3.4'` 形式（按 AssemblyVersionAttribute）；解析失败 / 非 .NET / 不存在 = null
   * @throws AppError('version-read-failed') 文件存在但解析过程出错（区别于文件不存在）
   *
   * 性能：单文件 ≤ 5ms（流式读，限制 4KB 扫描窗口——PE 头 + CLI 头 + 关键 metadata stream）
   */
  readVersion(dllPath: string): Promise<string | null>;
}
```

### 2.4 shared 增量总结

| 文件 | Phase 1 增量 |
|---|---|
| `shared/types/domain.ts` | + `InstalledPlugin` / `CommunityPlugin` |
| `shared/schemas/ldm.schema.ts` | + 6 个 schema（`InstalledPluginSchema` / `InstalledPluginsResponseSchema` / `PluginCommandRequestSchema` / `PluginCommandResponseSchema` / `CommunityPluginSchema` / `CommunityPluginsResponseSchema`） |
| `shared/contracts/ldm.ts` | + 4 个接口（`ILdmDiscoveryService` / `ILdmPluginCommandsService` / `ILdmPluginSourceService` / `ILdmAssemblyVersionReader`） |

**Phase 1 暂不动**：`LdmConfigWriter` / `LdmApplyService` / `RocketConfigXmlParser` / `applyChangesCore` 重构——这些是 Phase 2 范围。

---

## 3. PE 元数据解析范式（关键 A1 决策）

### 3.1 选型回顾

| 方案 | 优点 | 缺点 | 决策 |
|---|---|---|---|
| `pe-library` MIT 零依赖 | 单一 Node 库，纯 TypeScript | 仓库 2026 年已 archived；社区维护停滞 | ❌ |
| `AsmResolver` 强大 .NET 解析 | 功能完整（编辑 PE 也能） | 体积大（2MB+）、依赖多（AsmResolver 家族） | ❌ |
| **自写 PE 元数据流式解析** | 零依赖、≤ 200 行代码可控制、性能最佳 | 需自测覆盖 | ✅ **拍板** |
| `mono --assembly` CLI 反射 | 真源一致 | 需装 mono（生产环境假设已有）；CI 跑 jest 需装 mono | ❌ |

**自写实现技术规范**（ECMA-335 Partition II §22 Metadata Format，**Microsoft 官方文档**）：

```
1. PE 头 → 找 DOS 头 e_magic='MZ' → 跳转 e_lfanew → NT 头 PE\x00\x00
2. NT 头 → Optional Header → DataDirectory[14] = CLR Runtime Header 索引
3. CLR Runtime Header → 结构体第 0 字段 = Metadata 相对地址 + Size
4. Metadata root → 头 4 字节 = 'BSJB'（0x424A5342）签名
5. Metadata root → 找 #~ stream（heap flag = 0x0000 0x0000006C）
6. #~ stream → 解析 .NET 表集合 → 找 Assembly 表 (0x2000 + 0x20) → 提取 Name/Version 等
7. Assembly 表 → AssemblyVersionAttribute custom attribute → 解析字符串
```

### 3.2 解析范式

```typescript
/**
 * PE 元数据流式解析 .NET AssemblyVersionAttribute——A1 准确方案。
 * 注：完整实现可独立发包；Phase 1 内联在 LdmAssemblyVersionReader.ts 中。
 */
export class LdmAssemblyVersionReader implements ILdmAssemblyVersionReader {
  /** 单文件最大允许 100MB（LDM 插件一般 < 5MB；100MB 兜底防恶意大文件） */
  private static readonly MAX_FILE_SIZE = 100 * 1024 * 1024;
  /** 解析累计最大读 4KB（够定位 AssemblyVersion——无需 mmap 整文件） */
  private static readonly CHUNK_SIZE = 4096;

  async readVersion(dllPath: string): Promise<string | null> {
    try {
      const stat = await fs.stat(dllPath);
      if (stat.size === 0) return null;
      if (stat.size > LdmAssemblyVersionReader.MAX_FILE_SIZE) return null;
      // 流式：先读 4KB 探索 PE 头位置；定位到后再 seek 读 metadata
      const fd = await fs.open(dllPath, 'r');
      try {
        // ...省略 200 行 PE 解析实现（ECMA-335 标准流程）...
      } finally {
        await fd.close();
      }
    } catch (err) {
      if (err instanceof AppError) throw err;
      return null;  // 失败安全降级
    }
  }
}
```

### 3.3 错误降级矩阵

| 场景 | 返回 | 原因 |
|---|---|---|
| 文件不存在 | `null` | Discovery 层过滤掉，无需走 Reader |
| 文件为空（0 字节） | `null` | 不是有效 .NET 程序集 |
| 非 .NET 程序集（Native / VC++） | `null` | 没有 metadata，DOS 头后立即 COFF |
| 没有 `AssemblyVersionAttribute` | `null` | 合法——版本可能来自 `AssemblyFileVersion`（Phase 1 不读） |
| 文件 mmap 失败（Permission denied） | `null` | 上层 AppError 抛 filesystem-error |
| 解析过程抛 syntax 异常 | `null` | 静默降级——日志 warn，单插件失败不影响列表 |
| 文件 > 100MB | `null` | 防恶意大文件 |
| 解析正常但 AssemblyVersion 不合法 | `null` | 比如「1.2」「v1.2.3」 等不规范字符串 |

**降级即返回 `null`——前端拿 `version: null` 显示「未知」徽章**；用户从 GitHub Releases 页可查实际版本。

### 3.4 单测用例（≥ 6 个）

| # | 场景 | 期望 |
|---|---|---|
| 1 | 真 .dll 带 `AssemblyVersionAttribute("1.2.3.4")` | 返回 `"1.2.3.4"` |
| 2 | 真 .dll 但**无** AssemblyVersionAttribute | 返回 `null` |
| 3 | 非 .NET（普通 .exe / .so / PNG 头） | 返回 `null` |
| 4 | 文件 0 字节 | 返回 `null` |
| 5 | 文件不存在（路径无效） | 抛 `AppError('version-read-failed')` |
| 6 | 文件存在但中间损坏（PE 头合法但 metadata 截断） | 返回 `null`（不抛） |
| 7 | 10 个文件并发 readVersion（不阻塞测试 1s） | 全部正确返回 |
| 8 | 100MB 假 .dll | 返回 `null`（不 OOM） |

**真 .dll fixture 准备**：从 LDM 仓库 `Rocket.Unturned.dll` / `Rocket.Core.dll` / `Rocket.API.dll` 拿（3 个官方主框架 + 1 个 LDM-Community 插件比如 Uconomy.dll）—— 4 个 fixture 覆盖正常路径。

### 3.5 性能预算

- 单文件 ≤ 5ms（流式读，4KB 探查 + 必要时 seek）
- 50 个插件全列表 ≤ 200ms（含 fs.stat × 50 + PE read × 50）

---

## 4. PTY 协议规格（`LdmPluginCommandsService`）

### 4.1 协议族

| 命令 | PTY 写入 | 期望 stdout 反应 | 期望 stdout 失败 | Phase |
|---|---|---|---|---|
| `/rocket load <name>\r` | 同步 | 含 `Loaded plugin <name>`（子串） | 含 `Failed to load plugin` / `Unknown plugin` | **1** |
| `/rocket unload <name>\r` | 同步 | 含 `Unloaded plugin <name>` | 含 `Failed to unload` / `Plugin not loaded` | **1** |
| `/rocket reload <name>\r` | 同步 | 含 `Reloaded plugin <name>` | 含 `Failed to reload` | **4**（Phase 1 不实现） |
| `/rocket reload` | — | — | — | ❌ 钉死（不暴露） |
| `/rocket plugins` | 同步 | 列表（用于解析 runtimeStatus） | — | **2**（Phase 1 用「最近已知状态」缓存） |
| `/rocket info` | 同步 | 版本信息 | — | **2** |
| `/modules` | 同步 | 验证 Rocket.Unturned 加载 | — | **2** |

### 4.2 写入 + 响应等待状态机

```
[Idle] ──loadPlugin()──> [Pending] ──ptyManager.write()──> [WaitingReply]
                                                                       │
                                          ┌────────────────────────────┼────────────┐
                                          │ (10s 内 stdout 命中)       │ (10s 超时)  │
                                          ▼                            ▼            │
                                     [Success/Failure]              [Timeout]       │
                                          │                            │            │
                                          └──────释放锁──────────────────┴──────►[Idle]
```

### 4.3 协议实现细节

```typescript
/**
 * LDM 插件命令服务——PTY 终端 owner-trust 唯一通道。
 * 落盘 `mananger-server/src/modules/ldm/LdmPluginCommandsService.ts`。
 */
export class LdmPluginCommandsService implements ILdmPluginCommandsService {
  /** 单次 PTY 写命令的最大等待时间（10s）—— LDM 加载 .dll 通常 < 1s，留 10x 余量 */
  private static readonly CMD_TIMEOUT_MS = 10_000;
  /** stdout 缓冲保留末尾 256 字 */
  private static readonly OUTPUT_TAIL = 256;
  /** 每 server 一个并发互斥锁（同实例上 load+unload 串行——防 stdout 串扰） */
  private readonly inFlight = new Map<ServerId, Promise<unknown>>();

  constructor(
    private readonly ptyManager: IPtyManager,
    private readonly serverManager: IServerManager,
    private readonly discovery: ILdmDiscoveryService,
  ) {}

  async loadPlugin(serverId: ServerId, pluginName: string): Promise<{...}> {
    return this.runCommand(serverId, pluginName, 'load');
  }

  async unloadPlugin(serverId: ServerId, pluginName: string): Promise<{...}> {
    return this.runCommand(serverId, pluginName, 'unload');
  }

  private async runCommand(
    serverId: ServerId,
    pluginName: string,
    verb: 'load' | 'unload',
  ): Promise<{ outcome: 'success' | 'failure'; ldmOutput: string }> {
    // 1. 前置校验
    const state = this.serverManager.getState(serverId);
    if (state !== 'RUNNING') {
      throw new AppError('server-not-running', '实例未运行，无法执行插件命令', 409);
    }

    // 2. 插件存在性（已装列表里包含）
    const installed = await this.discovery.listInstalledPlugins(serverId);
    if (!installed.plugins.some(p => p.name === pluginName)) {
      throw new AppError('plugin-not-found', `插件 ${pluginName} 未安装`, 404);
    }

    // 3. 同 server 串行（互斥）—— 防止 stdout 串扰
    const prev = this.inFlight.get(serverId);
    if (prev) {
      throw new AppError('operation-conflict', '已有插件命令在执行，请稍后重试', 409);
    }

    const promise = this.runCommandInner(serverId, pluginName, verb);
    this.inFlight.set(serverId, promise);
    try {
      return await promise;
    } finally {
      this.inFlight.delete(serverId);
    }
  }

  private async runCommandInner(
    serverId: ServerId,
    pluginName: string,
    verb: 'load' | 'unload',
  ): Promise<{ outcome: 'success' | 'failure'; ldmOutput: string }> {
    // 1. PTY 写命令
    const cmd = `/rocket ${verb} ${pluginName}\r`;
    this.ptyManager.write(serverId, cmd);

    // 2. 等响应（订阅 console_line 事件，10s timeout）
    const collector = await this.waitForLdmReply(serverId, verb, pluginName);
    return collector;
  }

  /**
   * 订阅 PTY stdout 流，匹配 LDM 响应行。
   * 用 stdout buffer + 正则匹配「Loaded plugin X」「Failed to load plugin X」等。
   * 失败信号以 stderr 出现时也需要捕获。
   */
  private async waitForLdmReply(
    serverId: ServerId,
    verb: 'load' | 'unload',
    pluginName: string,
  ): Promise<{ outcome: 'success' | 'failure'; ldmOutput: string }> {
    // ...实现见 PtyManager 的 stdout 监听模式（与现有 applyModChanges 同款）...
    // 简版伪代码：
    const successRegex = new RegExp(`(Loaded|Unloaded|Reloaded) plugin [^\n]*${pluginName}[^\n]*`);
    const failureRegex = new RegExp(`(Failed to ${verb}|Unknown plugin|Plugin not loaded)[^\n]*`);
    // 10s 内 stdout 命中 successRegex → success；命中 failureRegex → failure；超时 → pty-timeout
  }
}
```

### 4.4 单测用例（≥ 4 个）

| # | 场景 | 期望 |
|---|---|---|
| 1 | 实例 STOPPED → loadPlugin | 抛 `server-not-running` |
| 2 | 插件未装 → loadPlugin | 抛 `plugin-not-found` |
| 3 | 实例 RUNNING + 插件已装 → PTY 写成功 + stdout 命中 Loaded | 返回 `outcome=success` |
| 4 | 实例 RUNNING + PTY 写成功 + stdout 命中 Failed | 返回 `outcome=failure` + ldmOutput 原文 |
| 5 | 实例 RUNNING + PTY 写成功 + 10s 超时 | 抛 `pty-timeout` |
| 6 | 同 server 并发 loadPlugin 两次 | 第二次抛 `operation-conflict` |
| 7 | 不同 server 并发 loadPlugin | 两条都正常执行（互斥锁按 server 维度） |

### 4.5 错误码汇总（`shared/types/errors.ts` 增量）

```typescript
/** PtyTimeoutMs 增量 */
PtyTimeoutMs = 10_000,

/** LDM Phase 1 新错误码 */
| 'server-not-running'        // 409 - 实例未运行
| 'plugin-not-found'          // 404 - 插件未安装
| 'pty-write-failed'          // 500 - PTY 写入失败（spawn 退出 / 句柄失效）
| 'pty-timeout'               // 504 - 10s 内未收到 LDM 响应
| 'operation-conflict'        // 409 - 同 server 已有命令在跑
| 'filesystem-error'          // 500 - 读写 Rocket/ 目录失败
| 'version-read-failed'       // 500 - PE 解析过程中抛出（区别于「解析失败返回 null」）
| 'community-source-unreachable' // 502 - LDM-Community 不可达且无 stale 缓存
| 'community-source-malformed'   // 502 - LDM-Community 主页 HTML 结构异常（解析出 0 plugin 或缺关键元素）
| 'community-source-rate-limited' // 429 - GitHub API 限流（x-ratelimit-remaining=0）
| 'github-pat-invalid'          // 401 - 用户提供的 PAT 无效或权限不足（需 public_repo）
```

---

## 5. LDM-Community 缓存规格（`LdmPluginSourceService`）

### 5.1 复用 WorkshopMetadataService 5min 模式

```typescript
/**
 * LDM-Community 公开插件列表——5min 进程内缓存。
 * 复用 WorkshopMetadataService.browseMods 的 Map<string, { result, expiresAt }> 模式。
 */
const COMMUNITY_CACHE_TTL_MS = 5 * 60 * 1000;
const COMMUNITY_FETCH_TIMEOUT_MS = 15_000;  // 短——LDM-Community 是 GitHub Pages 静态站，比 Steam API 快

type CacheEntry = {
  plugins: CommunityPlugin[];
  expiresAt: number;
  fetchedAtIso: string;
};

const communityCache: CacheEntry | null = null;  // 单例（不分页——Phase 1 一次性全集）

export function __resetCommunityCacheForTest(): void {
  communityCache = null;
}
```

### 5.2 上游真相（已调研 2026-08-12）

> **调研报告**：`claudedocs/research_ldm_community_source_2026-08-12.md`（完整证据链 + 字段提取规则 + 25 插件种子清单 + 性能预算 + 错误降级矩阵 + GitHub API 7 节范式）
>
> **核心结论**（用户拍板 2026-08-12「要调 GitHub API」）：
> - LDM-Community pluginlist **无公开 JSON API**（feed.json / plugins.json / plugins.yaml 全部 404）
> - 主页 `https://ldm-community.github.io/pluginlist/` 是 **GitHub Pages 静态 HTML**（Bootstrap card 模板，54KB / 287ms / 25 插件）
> - Phase 1 走 **HTML 解析 + GitHub API 批量补充** 双源融合：
>   - **第一源（HTML 解析）**：`cheerio@^1.0.0` 解析主页拿 `slug` / `name` / `author` / `description` / `repoUrl`
>   - **第二源（GitHub API 批量）**：每个 repo 调 2 个 endpoint
>     - `GET /repos/{owner}/{repo}` → `pushed_at`（`updatedAtIso`）
>     - `GET /repos/{owner}/{repo}/releases/latest` → `tag_name`（`latestVersion`）；404 = 无 release → `'unknown'`
>   - 50 调用/全量，5min 进程内缓存复用；5min 内 0 调用
> - **PAT 配置位置**（用户拍板 2026-08-12）：**LdmPage「插件来源」Tab 顶部**，不是 SettingsPage
>   - 理由：PAT 只服务 LDM 社区插件列表，不属于「系统级设置」，不污染 SettingsPage 的 Steam WebAPI Key 域
>   - 存储：React useState + localStorage 兜底（**不动后端 settingsStorage**）
>   - 后端透传：每次请求通过 `X-GitHub-PAT` 请求头传 PAT（不持久化在后端）
> - 重复条目（`JoinLeaveMessages` × 2 个 owner）按 `slug::author` 去重

### 5.3 实现要点（HTML 解析 + GitHub API 双源融合）

```typescript
import * as cheerio from 'cheerio';
import { logger } from '../../utils/logger.js';
import { AppError } from '../../utils/AppError.js';
import { httpClient } from '../../utils/httpClient.js';

const LDM_COMMUNITY_LIST_URL = 'https://ldm-community.github.io/pluginlist/';
const GITHUB_API_BASE = 'https://api.github.com';
const COMMUNITY_CACHE_TTL_MS = 5 * 60 * 1000;
const GITHUB_BATCH_SIZE = 5;          // 5 个仓库并发
const GITHUB_REQUEST_TIMEOUT_MS = 5_000;
const GITHUB_TOTAL_TIMEOUT_MS = 15_000;

let communityCache: { plugins: CommunityPlugin[]; expiresAt: number; fetchedAtIso: string } | null = null;

export function __resetCommunityCacheForTest(): void {
  communityCache = null;
}

export class LdmPluginSourceService implements ILdmPluginSourceService {
  /**
   * 列社区插件——HTML 解析 + GitHub API 批量补充双源融合。
   * @param pat 用户在 LdmPage 插件来源 Tab 顶部配置的 GitHub PAT（不持久化）
   */
  async listCommunityPlugins(pat: string | null = null): Promise<{
    plugins: CommunityPlugin[];
    fetchedAtIso: string;
    stale: boolean;
  }> {
    // 1. 缓存命中
    if (communityCache && communityCache.expiresAt > Date.now()) {
      return { plugins: communityCache.plugins, fetchedAtIso: communityCache.fetchedAtIso, stale: false };
    }

    // 2. 缓存过期 → 重新拉
    try {
      const rawPlugins = await this.fetchHtmlList();
      const enriched = await this.enrichWithGitHub(rawPlugins, pat);
      const now = new Date().toISOString();
      communityCache = { plugins: enriched, expiresAt: Date.now() + COMMUNITY_CACHE_TTL_MS, fetchedAtIso: now };
      return { plugins: enriched, fetchedAtIso: now, stale: false };
    } catch (err) {
      // 3. 上游不可达 + 有 stale 缓存 → 兜底展示
      if (communityCache) {
        logger.warn({ err }, 'LDM-Community 不可达，使用 stale 缓存');
        return { plugins: communityCache.plugins, fetchedAtIso: communityCache.fetchedAtIso, stale: true };
      }
      throw new AppError('community-source-unreachable',
        'LDM-Community 插件列表不可达，且无本地缓存', 502);
    }
  }

  /** 第一源：HTML 解析 */
  private async fetchHtmlList(): Promise<RawCommunityPlugin[]> {
    const res = await httpClient.get(LDM_COMMUNITY_LIST_URL, { timeout: GITHUB_TOTAL_TIMEOUT_MS });
    if (!res.ok) throw new AppError('community-source-unreachable', `LDM-Community 主页返回 HTTP ${res.status}`, 502);
    return parseLdmCommunityPluginlist(res.body);  // cheerio 解析（见调研报告 §2.3）
  }

  /** 第二源：GitHub API 批量补充 latestVersion + updatedAtIso（5 仓库/批并发） */
  private async enrichWithGitHub(rawPlugins: RawCommunityPlugin[], pat: string | null): Promise<CommunityPlugin[]> {
    const seen = new Set<string>();
    const results: CommunityPlugin[] = [];
    for (let i = 0; i < rawPlugins.length; i += GITHUB_BATCH_SIZE) {
      const batch = rawPlugins.slice(i, i + GITHUB_BATCH_SIZE);
      const enriched = await Promise.all(batch.map(async (raw) => {
        const key = `${raw.slug}::${raw.author}`;
        if (seen.has(key)) return null;
        seen.add(key);
        try {
          const [repoData, latestRelease] = await Promise.all([
            this.fetchRepo(raw.author, raw.slug, pat),
            this.fetchLatestRelease(raw.author, raw.slug, pat),
          ]);
          return this.mapToCommunityPlugin(raw, repoData, latestRelease);
        } catch (err) {
          // 单仓库失败——降级 unknown + 占位
          logger.warn({ err, repo: `${raw.author}/${raw.slug}` }, 'GitHub API 单仓库失败，降级');
          return this.mapToCommunityPluginFallback(raw);
        }
      }));
      results.push(...enriched.filter((p): p is CommunityPlugin => p !== null));
    }
    return results;
  }

  private async fetchRepo(owner: string, repo: string, pat: string | null): Promise<{ pushed_at: string }> {
    const headers = this.buildGithubHeaders(pat);
    const res = await httpClient.get(`${GITHUB_API_BASE}/repos/${owner}/${repo}`, { headers, timeout: GITHUB_REQUEST_TIMEOUT_MS });
    if (res.status === 403 && res.headers['x-ratelimit-remaining'] === '0') {
      throw new AppError('community-source-rate-limited', `GitHub API 限流`, 429);
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.body;
  }

  private async fetchLatestRelease(owner: string, repo: string, pat: string | null): Promise<{ tag_name: string } | null> {
    const headers = this.buildGithubHeaders(pat);
    const res = await httpClient.get(`${GITHUB_API_BASE}/repos/${owner}/${repo}/releases/latest`, { headers, timeout: GITHUB_REQUEST_TIMEOUT_MS });
    if (res.status === 404) return null;  // 仓库无 release
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.body;
  }

  private buildGithubHeaders(pat: string | null): Record<string, string> {
    const headers: Record<string, string> = {
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'unturned-manager',
    };
    if (pat) headers['Authorization'] = `Bearer ${pat}`;
    return headers;
  }

  private mapToCommunityPlugin(raw: RawCommunityPlugin, repo: { pushed_at: string }, release: { tag_name: string } | null): CommunityPlugin {
    return {
      slug: raw.slug,
      name: raw.name,
      author: raw.author,
      description: raw.description,
      repoUrl: raw.repoUrl,
      latestVersion: release?.tag_name ?? 'unknown',
      updatedAtIso: repo.pushed_at,
    };
  }

  private mapToCommunityPluginFallback(raw: RawCommunityPlugin): CommunityPlugin {
    return {
      slug: raw.slug,
      name: raw.name,
      author: raw.author,
      description: raw.description,
      repoUrl: raw.repoUrl,
      latestVersion: 'unknown',
      updatedAtIso: new Date().toISOString(),  // 降级为当前时间（占位）
    };
  }

  /**
   * 测试连通性（Phase 1 给前端「测试」按钮用）。
   * 401/403 视为 PAT 无效；其他 4xx/5xx 视为网络问题；2xx 返回速率上限。
   *
   * @param pat - GitHub PAT；null/空字符串视为匿名调用
   * @returns 测试结果——ok / 错误码 / 速率上限
   *   - ok=true：rateLimit 有值，code/message 为 null
   *   - ok=false：code 区分 'github-pat-invalid'（401/403）|'network-error'（5xx/超时/解析失败）
   *   - 测试路径**不**抛 AppError（与列表查询不同）——前端按钮反馈专用结构
   */
  async testPat(pat: string): Promise<{
    ok: boolean;
    code: 'github-pat-invalid' | 'network-error' | null;
    rateLimit: { limit: number; remaining: number; reset: number } | null;
    message: string | null;
  }> {
    let res;
    try {
      res = await httpClient.get(`${GITHUB_API_BASE}/rate_limit`, {
        headers: { ...this.buildGithubHeaders(pat) },
        timeout: GITHUB_REQUEST_TIMEOUT_MS,
      });
    } catch (err) {
      return { ok: false, code: 'network-error', rateLimit: null, message: '网络请求失败' };
    }
    if (res.status === 401 || res.status === 403) {
      return { ok: false, code: 'github-pat-invalid', rateLimit: null, message: 'GitHub PAT 无效或权限不足' };
    }
    if (!res.ok) {
      return { ok: false, code: 'network-error', rateLimit: null, message: `HTTP ${res.status}` };
    }
    return {
      ok: true,
      code: null,
      rateLimit: {
        limit: res.body.resources.core.limit,
        remaining: res.body.resources.core.remaining,
        reset: res.body.resources.core.reset,
      },
      message: null,
    };
  }
}
```

### 5.4 单测用例（≥ 7 个）

| # | 场景 | 期望 |
|---|---|---|
| 1 | 缓存空 + 主页 HTML 含 25 插件 + PAT 有效 | 返回 24 插件（JoinLeaveMessages × 2 去重）+ `latestVersion` 真实 + `stale=false` |
| 2 | 5min 内再次调用 | 缓存命中，0 HTTP + 0 GitHub |
| 3 | 5min 后 + 主页 HTML 同 25 插件 | 重新拉 + 刷新缓存 |
| 4 | 5min 后 + 主页 503 + 有 stale 缓存 | 返回 stale + `stale=true` |
| 5 | 缓存空 + 主页 503 | 抛 `community-source-unreachable` |
| 6 | 主页 HTML 缺 `h5.card-title`（结构变化） | 抛 `community-source-malformed` |
| 7 | 主页 HTML 解析出 0 plugin | 抛 `community-source-malformed` |
| 8 | 单仓库 GitHub /releases/latest 返回 404（无 release） | 该条 `latestVersion='unknown'`，其他字段正常 |
| 9 | GitHub API 撞限流（403 + x-ratelimit-remaining=0） | 抛 `community-source-rate-limited`，stale 缓存兜底 |
| 10 | 缓存空 + GitHub API 撞限流 | 抛 `community-source-rate-limited` |
| 11 | 单仓库 GitHub API 5xx | 该条降级 + warn log，其他正常 |
| 12 | `testPat(有效 token)` | 返回 `ok=true` + `code=null` + `rateLimit.limit=5000` |
| 13 | `testPat(无效 token)` | 返回 `ok=false` + `code='github-pat-invalid'` + `message='GitHub PAT 无效或权限不足'` |

---

## 6. LDM 状态检测（`LdmDiscoveryService.listInstalledPlugins` 实现要点）

### 6.1 状态机

```
呼叫 listInstalledPlugins(serverId)
  │
  ▼
resolveServerPath(serverId) → <Servers/<id>/Rocket/>
  │
  ▼
fs.access(Rocket/, F_OK) → 失败 → { plugins: [], ldmNotDetected: true }
  │
  ▼
fs.readdir(Plugins/) → 过滤 .dll 结尾
  │
  ▼
并行 N 个 LdmAssemblyVersionReader.readVersion(dllPath)  // Promise.all
  │
  ▼
fs.stat(dllPath)  // 取 sizeBytes / modifiedAtIso
  │
  ▼
fs.access(<插件名>.configuration.xml) → hasConfig
  │
  ▼
runtimeStatus: 内存缓存 → 「实例 RUNNING 时上次 /rocket plugins 解析」/ 非 RUNNING → 'unknown'
  │
  ▼
{ plugins: [...], ldmNotDetected: false }
```

### 6.2 关键点

- **并行解析**：50 个 Promise.all(PE reader) 比串行快 10x
- **runtimeStatus 缓存**：Discovery 不持有 live state；当 ServerManager 即将做 PTY 切换时清缓存（Phase 2 引入）
- **LDM 未装场景**：`ldmNotDetected: true` 时返回空列表 + 标志，前端引导 5 步 SOP
- **大小写校验**：上传时（Files API 已有）做 `.dll` 名与子目录名严格一致；Phase 1 先读列表不强制，仅在该 .dll 没有同名 `<Name>/` 子目录时给 `hasConfig=false`（plugin 仍可加载，只是没配置）

### 6.3 单测用例（≥ 5 个）

| # | 场景 | 期望 |
|---|---|---|
| 1 | Rocket/ 不存在 | 返回 `{ plugins: [], ldmNotDetected: true }` |
| 2 | Rocket/ 存在但 Plugins/ 空 | 返回 `{ plugins: [], ldmNotDetected: false }` |
| 3 | Rocket/Plugins/Uconomy.dll + Uconomy/Uconomy.configuration.xml | 1 插件 + hasConfig=true |
| 4 | Rocket/Plugins/Foo.dll 无 Foo/ 子目录 | 1 插件 + hasConfig=false |
| 5 | Runner 读 .dll 抛 IO 错 | 整列表失败 → 抛 `filesystem-error` |
| 6 | 50 个 .dll（mock PE reader 全返回 "1.0.0"） | 性能 ≤ 200ms |

---

## 7. 前端 2 Tab 详细规格

### 7.1 路由 + 页面

- 路径：`/servers/:serverId/ldm`（顶层页面，与 Mods/Config 同级）
- 页面：`<LdmPage>`（**Phase 1 含 2 Tab**，其他 2 Tab 留占位 + 「Phase 2 启用」徽章）
- Tab 命名（UI 文案 oneliner）：
  - **Tab 1**：「已装插件」—— Phase 1 主 Tab
  - **Tab 2**：「插件来源」—— Phase 1 完整 Tab（含 PAT 配置卡 + 社区列表，详见 §7.8）
  - Tab 3：「框架配置」—— Phase 2 启用
  - Tab 4：「权限组」—— Phase 2 启用

### 7.2 Tab 1「已装插件」组件清单

| 组件 | 复用 | 备注 |
|---|---|---|
| `<LdmPage>` 容器 | 新建 | `<PageState>` 包裹（loading/error/empty） |
| `<InstalledTab>` | 新建 | 列表 + 工具栏 |
| `<PluginCard>` | 新建 | 单插件卡片（满足 ≥ 3 次重复原则前先放页面内） |
| `<UploadPluginDialog>` | 复用 `FilesUpload` 模式 | Files API 已支持多文件上传 |
| `<CommunityPluginDrawer>` | 新建 | 抽屉 + 列表，点击外链 |
| `<RuntimeStatusBadge>` | 新建 | 4 色徽章：loaded（绿）/ unloaded（灰）/ failure（红）/ unknown（黄） |
| `<ConfirmDialog>` | 复用 `confirm-dialog.tsx` | 删除 .dll 前确认 |
| `<Tooltip>` | 复用 shadcn/ui | 版本号显示「未知」悬浮解释 |

### 7.3 UI 状态机

```
[Loading] ──fetchInstalled──> [Loaded] ──Upload/Load/Unload/Delete──> [Mutating] ──刷新──> [Loaded]
                                  │                                                          │
                                  │ ldmNotDetected=true                                       │ 任何错误
                                  ▼                                                          ▼
                              [NotDetected]                                              [Error]
                                  │ 引导 5 步 SOP
                                  ▼
                              [Loaded] (用户 cp 完后, 列表自动重拉)
```

**重拉策略**：mutating 完成后用 `useQuery.invalidate` 触发重拉（不要乐观更新——LDM 状态多变）。

### 7.4 列表字段（每行）

| 列 | 字段 | UI 控件 | 控件库 |
|---|---|---|---|
| 插件名 | `name` | `<span>` + copy 按钮（点击复制文件夹路径） | shadcn Tooltip |
| 版本号 | `version` | `version ?? "未知"` + 悬浮解释 | — |
| 大小 | `sizeBytes` | `formatBytes(sizeBytes)` | utils.ts |
| 配置 | `hasConfig` | 「✓ 有 / ✗ 无」chip | shadcn Badge |
| 修改时间 | `modifiedAtIso` | `<RelativeTime>` 「3 分钟前」 | dayjs relativeTime |
| 运行时状态 | `runtimeStatus` | `<RuntimeStatusBadge>` | shadcn Badge |
| 操作 | — | 加载 / 卸载 / 编辑 / 删除（4 按钮） | shadcn Button |

### 7.5 错误状态 UI 文案

> **遵循** `frontend-development.md` §界面文案规范（不出现项目内部术语）

| 错误码 | UI 文案 |
|---|---|
| `server-not-running` | 「实例未运行。启动实例后再操作」 |
| `plugin-not-found` | 「找不到该插件。可能已被卸载」 |
| `pty-timeout` | 「Mod 框架未在 10 秒内响应。请在控制台查看详情」 |
| `operation-conflict` | 「已有插件操作在执行。请稍候再试」 |
| `filesystem-error` | 「读取插件目录失败。请检查磁盘权限」 |
| `community-source-unreachable` | 「LDM 插件市场不可达，且无本地缓存」 |

### 7.6 复用工作（前端的 9 项复用）

| 复用对象 | 位置 | 用途 |
|---|---|---|
| `<PageState>` | `components/shared/PageState.tsx` | 列表 loading/error/empty 三件套 |
| `<ConfirmDialog>` | `components/shared/confirm-dialog.tsx` | 删除 .dll 二次确认 |
| `<ToolbarBtn>` | `components/shared/` | 工具栏按钮 |
| `useServer()` | `hooks/useServer.ts` | 实例基础信息 |
| `useToast` / `sonner` | 已集成 | 错误提示 |
| `formatBytes` | `lib/utils.ts` | 文件大小 |
| `cn()` | `lib/utils.ts` | className 合并 |
| shadcn `Button` / `Badge` / `Dialog` / `Drawer` / `Tooltip` | `components/ui/` | 基础控件 |
| React Query `useQuery` / `useMutation` | `main.tsx` 已配 | 数据流（staleTime 5min 与后端缓存对齐） |

### 7.7 否决项（Phase 1 不做）

- 全文搜索插件（Phase 4 加）
- 运行时状态实时刷新（Phase 2 引入 WS 推送时再做）
- 插件版本号变更检测（Phase 2）
- 批量操作（多选 / 批量 load）（Phase 3+ UX）

### 7.8 Tab 2「插件来源」详细规格（PAT 配置 + 社区列表 + .dll 上传）

> **位置**：LdmPage 第 2 个 Tab（与已装插件 Tab 同级）
> **用户决策**（2026-08-12）：PAT 配置放在这里，**不放在 SettingsPage**——PAT 只服务 LDM 社区列表，不是系统级设置

#### 7.8.1 组件结构

| 组件 | 复用 | 备注 |
|---|---|---|
| `<PluginSourceTab>` | 新建 | Tab 容器 |
| `<GithubPatCard>` | 新建 | PAT 输入 + 测试按钮 + 限流状态（**Tab 顶部固定**） |
| `<CommunityPluginList>` | 新建 | 社区列表（25 条） |
| `<CommunityPluginCard>` | 新建 | 单条（满足 ≥ 3 次重复原则前先放列表内） |
| `<UploadPluginDialog>` | 复用 Tab 1 | 同 §7.2 的对话框；从社区列表点击「下载」后弹出 |
| shadcn `Input` / `Button` / `Card` | `components/ui/` | PAT 卡基础控件 |
| shadcn `Badge` | `components/ui/` | 限流状态显示 |

#### 7.8.2 `<GithubPatCard>` 详细规格

**布局**（Tab 顶部第一项，Card 包裹）：

```
┌─────────────────────────────────────────────────┐
│  GitHub 个人访问令牌（可选）                       │
│  ─────────────────────────────────────────────  │
│  ┌──────────────────────────────┐  [测试] [清空]  │
│  │ ghp_xxxxxxxxxxxxxxxxxxxx     │                 │
│  └──────────────────────────────┘                 │
│  限流状态：5000/h，剩余 4987（重置于 4 小时 23 分后） │
│                                                   │
│  填写 GitHub Personal Access Token（classic，      │
│  public_repo 权限）可提高 Mod 框架插件列表的        │
│  拉取频率。未填写时 60/h 限流。                     │
│  → [如何创建？](https://github.com/settings/...)  │
└─────────────────────────────────────────────────┘
```

**字段**：

| 字段 | 控件 | 默认值 | 持久化 |
|---|---|---|---|
| `pat` | `<Input type="password">` | 空 | localStorage key = `ldm.github_pat` |
| `rateLimit` | `<Badge>` | null | 不持久化（每次页面打开调 `testPat`） |
| `testResult` | `<Alert>` | null | 不持久化 |

**交互**：

- **输入框**：onChange 同步到 React state + localStorage（debounce 500ms 写盘）
- **测试按钮**：调 `POST /api/ldm/community-plugins/test-pat { pat }` → 返回 `ok` / `rateLimit` / `error`
  - 成功：显示限流状态 + 「✓ Token 有效」
  - 失败：显示错误（`HTTP 401` / `Token 无效` / `网络错误`）
- **清空按钮**：清空 React state + localStorage
- **Tab 首次打开**：自动用 localStorage 的 PAT 调一次 `testPat` 显示限流状态

**store 形态**（不复用 useServer 模式——PAT 跨 server 共享）：

```typescript
// hooks/useGithubPat.ts
export function useGithubPat(): {
  pat: string | null;
  setPat: (pat: string) => void;
  clearPat: () => void;
  rateLimit: { limit: number; remaining: number; reset: number } | null;
  testResult: 'ok' | 'invalid' | 'network-error' | null;
  testing: boolean;
  testPat: () => Promise<void>;
} {
  const [pat, setPatState] = useState<string | null>(() => localStorage.getItem('ldm.github_pat'));
  // ... debounce 500ms 写 localStorage ...
  // ... testPat 调 /api/ldm/community-plugins/test-pat ...
}
```

**`<CommunityPluginList>` 列表调用 PAT**：

```typescript
// 调用 LdmPluginSourceService 时透传 PAT
useQuery({
  queryKey: ['community-plugins', githubPat],
  queryFn: () => fetch('/api/ldm/community-plugins', {
    headers: githubPat ? { 'X-GitHub-PAT': githubPat } : {},
  }).then(r => r.json()),
  staleTime: 5 * 60_000,
});
```

#### 7.8.3 列表行字段

| 列 | 字段 | UI 控件 |
|---|---|---|
| 插件名 | `name` | `<span>` + copy 按钮 |
| 作者 | `author` | 文本 |
| 描述 | `description` | 截断 1 行（hover 全） |
| 最新版本 | `latestVersion` | `<Badge>`；`'unknown'` = 「未知」徽章 |
| 最后更新 | `updatedAtIso` | `<RelativeTime>` 「3 天前」 |
| 标签 | `tags` | 多个 `<Badge>`（从 HTML 解析：Open Source / Unmaintained） |
| 操作 | — | 「查看 GitHub」外链 / 「下载 .dll」上传按钮 |

#### 7.8.4 错误状态 UI 文案

| 错误码 | UI 文案 |
|---|---|
| `community-source-unreachable` | 「LDM 插件市场不可达，且无本地缓存」 |
| `community-source-malformed` | 「LDM 插件市场结构异常，请稍后重试」 |
| `community-source-rate-limited` | 「GitHub API 限流，N 小时后重置。建议填写 PAT 提升到 5000/h」 |
| `github-pat-invalid` | 「Token 无效，请检查 public_repo 权限」 |

#### 7.8.5 否决项（Phase 1 不做）

- PAT 加密存储（localStorage 明文存——单用户系统 + 浏览器安全模型）—— Phase 2 再考虑 IndexedDB 加密
- PAT 历史记录（最近使用过的 PAT 列表）
- 批量下载多个 .dll
- 搜索 / 筛选（Phase 4 一起做）

---

## 8. 验证门槛清单（Phase 1）

### 8.1 类型检查 / Lint / 单元测试

| 门槛 | 通过标准 | 工具 |
|---|---|---|
| **类型检查** | `pnpm run typecheck` 零错误 | tsc --noEmit |
| **ESLint** | 零警告 | `pnpm run lint` |
| **单测覆盖率** | 改到的文件行覆盖 ≥ 80% | `pnpm run test:cov` |
| **PE reader** | ≥ 6 用例（§3.4） | vitest |
| **Plugin commands** | ≥ 4 用例（§4.4） | vitest |
| **Discovery** | ≥ 5 用例（§6.3） | vitest |
| **Community source** | ≥ 3 用例（§5.4） | vitest |
| **合计新增单测** | ≥ 18 用例 | vitest |

### 8.2 E2E（Playwright）

**主流程 1 用例**：5 步全跑通

```
GIVEN 已装 LDM 主框架（MOCK Rocket/ 目录含 2 个 .dll）
WHEN  ① 打开 Mod 框架页面
       ② 上传 Uconomy.dll（mock Files API）
       ③ 列表出现 3 插件
       ④ 点击「加载」→ toast「加载成功」
       ⑤ 点击「卸载」→ toast「卸载成功」
THEN  列表操作按钮可点 + 状态徽章变更
```

### 8.3 接口契约

- ajv 加在以下 4 端点：所有响应都用 `InstalledPluginsResponseSchema` / `PluginCommandResponseSchema` / `CommunityPluginsResponseSchema` 校验
- 入参用 `PluginCommandRequestSchema` 校验

### 8.4 文档同步

- [ ] `unturned-sop.md` §LDM 章节补 5 步 SOP 引导文案（§7.5 错误文案）
- [ ] `reference_config_files.md` §3-5 不动（Phase 2 范围）
- [ ] `reference_ui_terms.md` 已有「LDM → Mod 框架」对照，**不新增**
- [ ] `architecture-spec.md` §3 后端模块树加 `ldm/` 命名空间（4 模块）
- [ ] `architecture-spec.md` §5 契约加 4 个接口

### 8.5 提交规范

- **commit 1**：「Phase 1 共享类型 + Zod schema + 6 契约接口」+ PE reader fixture
- **commit 2**：「Phase 1 PE 解析准确方案 + 单测 6 用例」
- **commit 3**：「Phase 1 LDM-Community 进程内缓存 + 单测 3 用例」
- **commit 4**：「Phase 1 Discovery 单测 5 用例 + filesystem-error 错误码」
- **commit 5**：「Phase 1 PTY 写 /rocket load/unload + stdout 解析 + 单测 7 用例」
- **commit 6**：「Phase 1 4 REST 端点 + WS 事件注册 + composition-root 注入」
- **commit 7**：「Phase 1 <LdmPage> 2 Tab（已装插件 / 插件来源）+ 全部前端组件 + 路由」
- **commit 8**：「Phase 1 E2E 主流程 + 文档同步 + 收尾」

每个 commit 独立 `tsc --noEmit` 通过。

---

## 9. 路线图（Phase 1 → Phase 2 接口稳定性）

| 关注点 | Phase 1 落定 | Phase 2 扩展方向 |
|---|---|---|
| `InstalledPlugin` | 5 字段 | + `configPath` / `dependencies: string[]` |
| `CommunityPlugin` | 7 字段 | + `tags` / `screenshots` |
| `ILdmDiscoveryService` | `listInstalledPlugins` | + `readRocketConfig` / `readPermissionsConfig` / `readPluginConfig` |
| `ILdmPluginCommandsService` | `loadPlugin` / `unloadPlugin` | + `reloadPlugin`（Phase 4） |
| `ILdmPluginSourceService` | `listCommunityPlugins` | + `getCommunityPlugin(slug)` |
| `ILdmAssemblyVersionReader` | `readVersion` | 不变 |
| `LdmPluginCommandsService` 互斥锁 | per-server 单锁 | 升级为 `activeOperation` 互斥（与 mod_apply/ldm_apply 共享） |
| `LdmDiscoveryService` runtimeStatus | 内存缓存「上次解析」 | 改 WS 推送事件驱动 |

---

## 10. 风险与回滚

| 风险 | 缓解 | 回滚方案 |
|---|---|---|
| PE 解析写错——读错字段返回乱字符串 | 单测覆盖真 .dll fixture；CI 每次跑全 6 用例 | 入口统一 `LdmAssemblyVersionReader`，版本号返回 `null` 不影响主功能 |
| LDM-Community 上游改格式 | 解析失败 → 静默 fallback + stale 缓存 | 旧格式保留 30 天兜底 |
| PTY stdout 串扰（前端控制台同时打其他命令） | successRegex / failureRegex 用 pluginName 锚定 | 失败概率极低；timeout 兜底 |
| `/rocket load <name>` 子串匹配歧义 | pluginName 走 Zod 校验 `[A-Za-z0-9._-]+`；Linux 大小写校验 | 失败 → outcome=failure + ldmOutput 兜底 |
| race：同 server load + unload 同时 | inFlight 互斥锁 | 第二次抛 operation-conflict |
| PE 解析 OOM（恶意大文件） | MAX_FILE_SIZE = 100MB | 超限返回 null |

---

*版本：v0.1 设计稿 · 2026-08-12 · 承接 ldm-integration-design.md v0.2 §12.2*
