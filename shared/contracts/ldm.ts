import type { ServerId } from "../types/branded.js";
import type { InstalledPlugin, CommunityPlugin, PluginRuntimeStatus } from "../types/domain.js";

/**
 * LDM 运行时状态读取器——实例 RUNNING 时同步解析一次 `/rocket plugins` 填充 runtimeStatus。
 * 由 PtyManager 的 stdout 订阅实现（写入 `/rocket plugins\r` 后收集 4 行分组输出解析）。
 * Discovery 经此注入获得运行时状态，不直接持 PTY 引用（对齐主设计文档 §12.2 D1）。
 *
 * @param serverId 实例标识
 * @returns 插件名 → 运行时状态映射；解析失败 / 超时返回空对象（上层统一回退 unknown）
 */
export type LdmRuntimeStatusReader = (
  serverId: ServerId,
) => Promise<Record<string, PluginRuntimeStatus>>;

/**
 * LDM 插件发现服务（Phase 1 子集）。
 * Phase 2 会扩展 readRocketConfig / readPermissionsConfig / readPluginConfig 等方法。
 */
export interface ILdmDiscoveryService {
  /**
   * 列已装插件——扫描 Servers/<id>/Rocket/Plugins/ 目录，解析 .dll 元数据。
   * @param serverId 实例标识
   * @returns 插件列表 + LDM 状态检测结果（runtimeStatus 填充：实例 RUNNING 时列表加载同步调一次
   *   `/rocket plugins`（D1）解析；非 RUNNING 或解析失败 = 'unknown'）
   * @throws AppError('server-not-found') 实例不存在
   * @throws AppError('filesystem-error') 读取失败（Permission denied / IO 错误）
   */
  listInstalledPlugins(serverId: ServerId): Promise<{
    plugins: InstalledPlugin[];
    ldmNotDetected: boolean;
  }>;

  /**
   * LDM 统一状态（Phase 3）——前端「LDM 状态」卡用。
   * @param serverId - 实例标识
   * @returns ldmInstalled (Rocket.Unturned.module 是否存在) + rocketDirExists + pluginCount
   */
  getStatus(serverId: ServerId): Promise<LdmStatus>;
}

/**
 * LDM 统一状态——Phase 3 GET /api/servers/:id/ldm/status 响应。
 */
export interface LdmStatus {
  serverId: string;
  ldmInstalled: boolean;
  rocketDirExists: boolean;
  pluginCount: number;
  /** 检测时间戳（ISO） */
  detectedAtIso: string;
}

/**
 * LDM 插件命令服务（PTY 终端 owner-trust）。
 * Phase 1 仅 load / unload；Phase 4 加 reload（带警告）。
 */
export interface ILdmPluginCommandsService {
  /**
   * PTY 写 `/rocket load <name>`——加载已卸载插件。不停服，不触发状态机转换。
   * @param serverId 实例标识
   * @param pluginName 插件名（Linux 大小写敏感，与 .dll 文件名去扩展严格一致）
   * @returns outcome + LDM stdout 末尾（≤ 256 字）
   *   success = 命令已接受（加载已触发，非加载最终成功——成功零日志）；failure = LDM 拒绝
   * @throws AppError('server-not-running') 实例未运行
   * @throws AppError('plugin-not-found') 插件未安装
   * @throws AppError('pty-write-failed') PTY 写入失败
   * @throws AppError('pty-timeout') 10s 内未收到 LDM 响应
   * @throws AppError('operation-conflict') 已有同 server 的 plugin command 在跑
   */
  loadPlugin(
    serverId: ServerId,
    pluginName: string,
  ): Promise<{ outcome: "success" | "failure"; ldmOutput: string }>;

  /**
   * PTY 写 `/rocket unload <name>`。同 loadPlugin 错误定义。
   * @param serverId 实例标识
   * @param pluginName 插件名（Linux 大小写敏感）
   * @returns outcome + LDM stdout 末尾（≤ 256 字）
   * @throws AppError('server-not-running') | 'plugin-not-found' | 'pty-write-failed' | 'pty-timeout' | 'operation-conflict'
   */
  unloadPlugin(
    serverId: ServerId,
    pluginName: string,
  ): Promise<{ outcome: "success" | "failure"; ldmOutput: string }>;

  /**
   * PTY 写 `/p reload`——重载 Permissions.config.xml（Phase 2b D4）。
   * 不停服，不触发状态机转换——Permissions.config.xml 变更后由 LdmApplyService 在 postStartHook 触发。
   * @param serverId - 实例标识
   * @returns outcome + LDM stdout 末尾（≤ 256 字）
   * @throws AppError('server-not-running') 实例未运行
   * @throws AppError('pty-write-failed') PTY 写入失败
   * @throws AppError('pty-timeout') 10s 内未收到 LDM 响应
   */
  reloadPermissions(
    serverId: ServerId,
  ): Promise<{ outcome: "success" | "failure"; ldmOutput: string }>;

  /**
   * 读 LDM 主框架版本（D2）——PTY 写空 `/rocket` 解析 stdout 中的 `Rocket v<ver> for Unturned v<gameVer>`。
   * @param serverId - 实例标识
   * @returns ldmVersion + gameVersion + 原文；解析失败返回 null/null
   * @throws AppError('server-not-running') 实例未运行
   */
  readLdmVersion(
    serverId: ServerId,
  ): Promise<{ ldmVersion: string | null; gameVersion: string | null; raw: string }>;

  /**
   * 读 Rocket.Unturned 模块加载状态（D3）——PTY 写 `/modules` 解析 stdout。
   * @param serverId - 实例标识
   * @returns rocketUnturnedLoaded + 原文（前端「LDM 状态」卡用）
   * @throws AppError('server-not-running') 实例未运行
   */
  readModulesState(
    serverId: ServerId,
  ): Promise<{ rocketUnturnedLoaded: boolean; raw: string }>;
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

  /**
   * 测试 GitHub PAT 连通性——调 /rate_limit 返回限流配额。
   * 测试路径不抛 AppError——前端按钮反馈专用结构。
   * @param pat - GitHub PAT；空字符串视为匿名调用
   * @returns ok / code / rateLimit / message（code 区分 github-pat-invalid | network-error）
   */
  testPat(pat: string): Promise<{
    ok: boolean;
    code: "github-pat-invalid" | "network-error" | null;
    rateLimit: { limit: number; remaining: number; reset: number } | null;
    message: string | null;
  }>;

  /**
   * 插件详情（Phase 3）——前端详情抽屉用。
   * @param slug - 仓库 slug（如 "XanderCodes/AppleAdminControl"）
   * @param pat - GitHub PAT（可选；提升限流）
   * @returns 详情；找不到 / 不可达返回 null
   */
  getPluginDetail(
    slug: string,
    pat: string | null,
  ): Promise<CommunityPluginDetail | null>;
}

/**
 * LDM 社区插件详情——Phase 3 GET /api/ldm/community-plugins/:slug 响应。
 */
export interface CommunityPluginDetail {
  slug: string;
  name: string;
  author: string;
  description: string;
  repoUrl: string;
  latestVersion: string;
  updatedAtIso: string;
  /** GitHub Releases URL——前端「下载 .dll」外链按钮用（由 caller 判定是否有 Release） */
  releasesUrl: string;
  /** README 截断预览（≤ 500 字）——详情抽屉展示 */
  readmePreview: string | null;
}

/**
 * .NET DLL 版本号读取器（PE 元数据流式解析）。
 * 抽象接口——实现可换（自写 / AsmResolver；pe-library 已 archived 否决），契约不变。
 */
export interface ILdmAssemblyVersionReader {
  /**
   * @param dllPath 绝对路径
   * @returns `'1.2.3.4'` 形式（按 AssemblyVersionAttribute）；解析失败 / 非 .NET / 不存在 = null
   * 永不抛错——解析失败一律返回 null（失败安全降级语义，与文件不存在的 null 无差别）
   */
  readVersion(dllPath: string): Promise<string | null>;
}

// ─── Phase 2 ───────────────────────────────────────────

/**
 * XML 节点类型——保留原始字节偏移（写回时定位）。
 * RocketConfigXmlParser 内部数据结构；通用 XML 解析用。
 */
export type XmlNodeType = "element" | "text" | "comment" | "cdata";

/**
 * XML 节点（自写解析器保留注释 / CDATA / 属性顺序 / 嵌套 / 未知键）。
 * RocketConfigXmlParser.parseGeneric 返回此类型。
 *
 * @field type 节点类型
 * @field name 元素名（仅 element）
 * @field attrs 属性集合（仅 element；属性顺序保留在原始 XML 中）
 * @field children 子节点数组（仅 element）
 * @field value 文本值（text / cdata）
 * @field rawStart 原始字节偏移起点（parseGeneric 时填充，serializeGeneric 时使用）
 * @field rawEnd 原始字节偏移终点（parseGeneric 时填充，serializeGeneric 时使用）
 */
export interface XmlNode {
  type: XmlNodeType;
  name?: string;
  attrs?: Record<string, string>;
  children?: XmlNode[];
  value?: string;
  rawStart?: number;
  rawEnd?: number;
}

/**
 * Rocket.config.xml 结构化字段——LDM 仓 RocketSettings.cs 16 字段真源。
 * UI 编辑器 / 序列化往返用。
 */
export interface RocketConfigFields {
  languageCode: string;
  maxFrames: number;
  automaticShutdownEnabled: boolean;
  automaticShutdownInterval: number;
  webPermissionsEnabled: boolean;
  webPermissionsUrl: string;
  webPermissionsInterval: number;
  webConfigurationsEnabled: boolean;
  webConfigurationsUrl: string;
}

/**
 * Rocket.Unturned.config.xml 结构化字段——LDM 仓 UnturnedSettings.cs 9 字段真源。
 */
export interface RocketUnturnedConfigFields {
  automaticSaveEnabled: boolean;
  automaticSaveInterval: number;
  characterNameValidation: boolean;
  characterNameValidationRule: string;
  logSuspiciousPlayerMovement: boolean;
  enableItemBlacklist: boolean;
  enableItemSpawnLimit: boolean;
  maxSpawnAmount: number;
  enableVehicleBlacklist: boolean;
}

/**
 * Permissions.config.xml 树形——LDM RocketPermissions XML 结构。
 */
export interface PermissionsGroup {
  id: string;
  displayName: string;
  color: string;
  members: string[];
  parentGroup?: string;
  priority: number;
  permissions: string[];
}

export interface PermissionsConfigFields {
  defaultGroup: string;
  groups: PermissionsGroup[];
}

/**
 * RocketConfigXmlParser——自写 XML 解析器（保留注释/属性顺序/CDATA/嵌套/未知键，零依赖）。
 * Phase 2a 核心模块：parseRocketConfig / parseRocketUnturnedConfig / parsePermissionsConfig
 * 各自从 XML 字符串提取结构化字段；序列化用 **字段合并** 策略——不改原文未在 fields 中的部分。
 */
export interface IRocketConfigXmlParser {
  /**
   * Rocket.config.xml 字符串 → 结构化字段 + 原文（高级视图用）
   * @param xml 原始 XML 字符串（首次启动 U3DS 自动生成）
   * @returns 16 字段结构化 + 原文（不变）
   */
  parseRocketConfig(xml: string): { fields: RocketConfigFields; raw: string };

  /**
   * Rocket.Unturned.config.xml 字符串 → 9 字段结构化 + 原文
   * @param xml 原始 XML 字符串
   */
  parseRocketUnturnedConfig(xml: string): { fields: RocketUnturnedConfigFields; raw: string };

  /**
   * Permissions.config.xml 字符串 → 树形结构 + 原文
   * @param xml 原始 XML 字符串
   */
  parsePermissionsConfig(xml: string): { fields: PermissionsConfigFields; raw: string };

  /**
   * 结构化字段 → XML 字符串——**字段合并**（不整体重写）。
   * 在原 XML 树中查找对应子元素/属性更新值；fields 中未提及的元素原样保留（注释/CDATA/未知键）。
   *
   * @param fields 16 字段结构化（待写入）
   * @param originalXml 原 XML 字符串（parseRocketConfig 返回的 raw 字段）
   * @returns 新 XML 字符串——保证 round-trip = 等价（结构化字段值正确 + 未提及节点不变）
   */
  serializeRocketConfig(fields: RocketConfigFields, originalXml: string): string;

  /** 同 serializeRocketConfig 语义——9 字段结构化 + 原 XML */
  serializeRocketUnturnedConfig(
    fields: RocketUnturnedConfigFields,
    originalXml: string,
  ): string;

  /** 同上——树形结构 + 原 XML */
  serializePermissionsConfig(
    fields: PermissionsConfigFields,
    originalXml: string,
  ): string;

  /**
   * 通用 XML 字符串 → 树（保留注释/CDATA）——插件 Configuration.xml 原文读写用。
   * @param xml 原始 XML
   * @returns XmlNode 树（包含 rawStart / rawEnd 字节偏移，serializeGeneric 写回时定位）
   */
  parseGeneric(xml: string): XmlNode;

  /**
   * XmlNode 树 → XML 字符串（保留原始字节偏移处的注释/CDATA/未知元素）。
   * @param node parseGeneric 返回的树
   * @returns XML 字符串
   */
  serializeGeneric(node: XmlNode): string;
}

/**
 * LdmConfigWriter 写入结果——返回备份路径 + 时间戳。
 */
export interface LdmConfigWriteResult {
  success: boolean;
  backupPath: string;
  writtenAtIso: string;
}

/**
 * LDM 应用变更结果（POST /apply 响应）。
 */
export interface LdmApplyResult {
  serverId: string;
  success: boolean;
  stage: "preparing" | "stopping" | "starting" | "verifying" | "ready" | "failed";
  message?: string;
  startedAtIso: string;
  completedAtIso: string;
}

/**
 * LDM 应用变更服务（Phase 2b）——薄业务层，调 ServerManager.applyChangesCore。
 *
 * 行为契约（用户 2026-08-15 拍板）：
 *   - 「保存配置」与「应用变更」是两独立动作——前者走 LdmConfigWriter（写文件），
 *     后者由本服务触发（调 ServerManager.applyChangesCore 重启流水线）
 *   - 应用变更由用户主动触发——写配置时不自动
 *   - preStopHook 推 WS ldm_apply_progress 'preparing'
 *   - postStartHook PTY 写 /p reload（LDM 权限重载——D4）+ 推 'verifying' → 'ready'
 */
export interface ILdmApplyService {
  /**
   * 应用 LDM 配置变更（走 PTY 重启流水线）
   * @param serverId 实例标识
   * @param opts.changedPlugins 受影响的插件名列表（可选；用于日志/未来细粒度 hook）
   * @returns 应用结果（最终 stage）
   * @throws AppError('operation-conflict') 已有 activeOperation
   * @throws AppError('server-not-running') 实例未运行
   * @throws AppError('pty-write-failed') PTY 写 /p reload 失败
   */
  apply(
    serverId: ServerId,
    opts?: { changedPlugins?: string[] },
  ): Promise<LdmApplyResult>;
}

/**
 * LDM 配置写入服务——3 XML + 各 Configuration.xml 原子写 + 备份 + 回滚。
 * 写配置运行时允许（文件 I/O 不阻断 ServerManager 状态）；
 * 生效需用户主动触发「应用变更」走 PTY 重启流水线（不自动）。
 */
export interface ILdmConfigWriter {
  /**
   * 写 Rocket.config.xml（结构化字段 → XML 字符串 → 原子写）
   * @param serverId 实例标识
   * @param fields 16 字段结构化
   * @returns 写入结果（含备份路径）
   * @throws AppError('ldm-config-corrupted') 原 XML 解析失败
   * @throws AppError('ldm-config-write-failed') atomic write 失败（已自动回滚）
   */
  writeRocketConfig(
    serverId: ServerId,
    fields: RocketConfigFields,
  ): Promise<LdmConfigWriteResult>;

  /** 写 Rocket.Unturned.config.xml */
  writeRocketUnturnedConfig(
    serverId: ServerId,
    fields: RocketUnturnedConfigFields,
  ): Promise<LdmConfigWriteResult>;

  /** 写 Permissions.config.xml */
  writePermissionsConfig(
    serverId: ServerId,
    fields: PermissionsConfigFields,
  ): Promise<LdmConfigWriteResult>;

  /**
   * 写单个插件 Configuration.xml（通用 XML 原文）。
   * 不强解 schema——面板用 Monaco XML 编辑器直接传字符串。
   *
   * @param serverId 实例标识
   * @param pluginName 插件名（Linux 大小写敏感；用作子目录名）
   * @param rawXml 完整 XML 字符串（parseGeneric 校验合法性）
   * @returns 写入结果
   * @throws AppError('plugin-name-invalid') pluginName 含非法字符
   * @throws AppError('plugin-config-invalid') XML 解析失败
   */
  writePluginConfig(
    serverId: ServerId,
    pluginName: string,
    rawXml: string,
  ): Promise<LdmConfigWriteResult>;
}
