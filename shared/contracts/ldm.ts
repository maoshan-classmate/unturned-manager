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
