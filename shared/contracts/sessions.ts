import type { ServerId } from "../types/branded.js";

/**
 * 终端会话持久化记录（1:1 对齐 GSM3 `PersistedTerminalSession`）。
 *
 * 本项目 1 实例 1 PTY（`terminalSessionId = serverId`），所以会话 id 直接复用
 * serverId——不复用 GSM3 1 实例多 tab 的 `randomUUID()` 形态。
 *
 * 字段全部对齐 GSM3，便于直接迁移 .research/GameServerManager 的同名 JSON 文件
 * 形态（虽然本项目用 `config.dataDir` 而非 `process.cwd()/data`）。
 */
export interface PersistedTerminalSession {
  /** = serverId（1 实例 1 PTY 形态） */
  id: ServerId;
  /** 用户可命名，默认 `终端 - <serverId>` */
  name: string;
  /** PTY cwd（= installDir） */
  workingDirectory: string;
  /** ISO 8601，会话创建时间 */
  createdAt: string;
  /** ISO 8601，PTY 最后收到 stdout/input 的时间（5 秒节流） */
  lastActivity: string;
  /** PTY 进程是否在跑（重启后从 false 起步，PTY spawn 后置 true） */
  isActive: boolean;
}

/**
 * 终端会话持久化管理器接口（1:1 抄 GSM3 `TerminalSessionManager` 公共方法）。
 *
 * 存储路径：`<config.dataDir>/terminal-sessions.json`
 * 写时机：PTY spawn 成功后 saveSession；PTY 退出时 setSessionActive(false)；
 *        实例删除时 removeSession；后台 cron 每 24 小时清理 7 天未活动会话。
 */
export interface ISessionManager {
  /** 初始化：从 JSON 读现有配置；ENOENT 建空；其他错误向上抛 */
  initialize(): Promise<void>;
  /** 保存/更新会话（GSM3 同款：mutationQueue 串行 + 临时文件 rename 原子写） */
  saveSession(data: PersistedTerminalSession): Promise<void>;
  /** 切换 isActive 标记（PTY spawn 时 true、退出时 false） */
  setSessionActive(id: ServerId, isActive: boolean): Promise<void>;
  /**
   * 刷新 lastActivity（PTY 每收到 stdout/input 触发，5 秒节流）。
   *
   * 本地化新增：GSM3 没这层细化——GSM3 多 tab 各自管理 lastActivity 不需要外部刷新。
   * 本项目 1 实例 1 PTY，让 PtyManager onData 钩子刷 lastActivity，用于 7 天过期清理。
   */
  touchActivity(id: ServerId): Promise<void>;
  /** 移除单条记录（实例删除时调） */
  removeSession(id: ServerId): Promise<void>;
  /** 全部 JSON 记录（含 isActive=false 的历史会话） */
  getSavedSessions(): PersistedTerminalSession[];
  /** 单条记录 */
  getSession(id: ServerId): PersistedTerminalSession | undefined;
  /** 清理 7 天未活动会话，返回删除条数 */
  cleanupExpiredSessions(): Promise<number>;
}

/**
 * 终端会话配置 JSON 文件结构（1:1 对齐 GSM3 `TerminalSessionsConfig`）。
 * 内部结构——不导出，仅 SessionManager 内部使用。
 */
export interface TerminalSessionsConfig {
  sessions: PersistedTerminalSession[];
  /** ISO 8601，最后一次写入时间 */
  lastUpdated: string;
}