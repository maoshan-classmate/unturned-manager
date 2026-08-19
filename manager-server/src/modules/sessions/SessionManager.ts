import fs from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import type {
  ISessionManager,
  PersistedTerminalSession,
  ServerId,
  TerminalSessionsConfig,
} from "@unturned-manager/shared";
import type { Logger } from "pino";

/**
 * 终端会话持久化管理器。
 *
 * - 日志用 pino（构造函数接收 pino Logger）
 * - 配置目录由调用方传入（构造时 cwd 默认 process.cwd()）
 * - id 类型为 ServerId（branded string）
 * - touchActivity 节流刷新
 * - 无 updateSessionName（多 tab 才需要）
 *
 * 存储：`<configDir>/terminal-sessions.json`，原子写（临时文件 + rename）+ mutationQueue 串行防并发。
 */
export class SessionManager implements ISessionManager {
  private readonly configDir: string;
  private readonly configPath: string;
  private readonly logger: Logger;
  private config: TerminalSessionsConfig;
  private mutationQueue: Promise<void> = Promise.resolve();

  /** touchActivity 节流：5 秒内不重复刷新 */
  private readonly lastTouch = new Map<ServerId, number>();
  private static readonly TOUCH_INTERVAL_MS = 5_000;

  /** 7 天过期硬编码 */
  private static readonly EXPIRATION_MS = 7 * 24 * 60 * 60 * 1000;

  /**
   * @param logger - pino logger
   * @param configDir - 配置文件目录（默认 process.cwd()）
   */
  constructor(logger: Logger, configDir: string = process.cwd()) {
    this.logger = logger;
    this.configDir = configDir;
    this.configPath = path.join(this.configDir, "terminal-sessions.json");

    this.config = {
      sessions: [],
      lastUpdated: new Date().toISOString(),
    };
  }

  // ─── 公开 API ───────────────────────────────────────────

  /**
   * 初始化会话管理器：确保目录存在 + 加载配置。
   */
  async initialize(): Promise<void> {
    try {
      await this.ensureConfigDirectory();
      await this.loadConfig();
      this.logger.info("终端会话管理器初始化完成");
    } catch (error) {
      this.logger.error({ err: error }, "终端会话管理器初始化失败");
      throw error;
    }
  }

  /**
   * 保存/更新会话（同 id 已存在则覆盖，否则追加）。
   */
  async saveSession(sessionData: PersistedTerminalSession): Promise<void> {
    try {
      await this.enqueueMutation(async () => {
        const existingIndex = this.config.sessions.findIndex(
          (session) => session.id === sessionData.id,
        );
        if (existingIndex >= 0) {
          this.config.sessions[existingIndex] = sessionData;
          this.logger.debug(
            { sessionId: sessionData.id, name: sessionData.name },
            "更新终端会话",
          );
        } else {
          this.config.sessions.push(sessionData);
          this.logger.debug(
            { sessionId: sessionData.id, name: sessionData.name },
            "保存新终端会话",
          );
        }
        await this.saveConfig();
      });
    } catch (error) {
      this.logger.error({ err: error, sessionId: sessionData.id }, "保存终端会话失败");
      throw error;
    }
  }

  /**
   * 切换会话 isActive 标记。
   */
  async setSessionActive(id: ServerId, isActive: boolean): Promise<void> {
    try {
      await this.enqueueMutation(async () => {
        const session = this.config.sessions.find((s) => s.id === id);
        if (session) {
          session.isActive = isActive;
          session.lastActivity = new Date().toISOString();
          await this.saveConfig();
          this.logger.debug({ sessionId: id, isActive }, "切换会话活动状态");
        }
      });
    } catch (error) {
      this.logger.error({ err: error, sessionId: id }, "切换会话活动状态失败");
    }
  }

  /**
   * 节流刷新 lastActivity。
   *
   * PtyManager.onData 回调每收到一行 stdout 调一次——但每行 fs.write 太频繁，
   * 节流 5 秒内只刷一次（用 mutationQueue 串行保护）。
   */
  async touchActivity(id: ServerId): Promise<void> {
    const last = this.lastTouch.get(id) ?? 0;
    const now = Date.now();
    if (now - last < SessionManager.TOUCH_INTERVAL_MS) return;
    this.lastTouch.set(id, now);

    try {
      await this.enqueueMutation(async () => {
        const session = this.config.sessions.find((s) => s.id === id);
        if (session) {
          session.lastActivity = new Date().toISOString();
          await this.saveConfig();
        }
      });
    } catch (error) {
      this.logger.error({ err: error, sessionId: id }, "刷新 lastActivity 失败");
    }
  }

  /**
   * 移除会话。
   */
  async removeSession(id: ServerId): Promise<void> {
    try {
      await this.enqueueMutation(async () => {
        const initialLength = this.config.sessions.length;
        this.config.sessions = this.config.sessions.filter((s) => s.id !== id);
        if (this.config.sessions.length < initialLength) {
          await this.saveConfig();
          this.logger.info({ sessionId: id }, "删除终端会话");
        } else {
          this.logger.debug({ sessionId: id }, "尝试删除不存在的终端会话");
        }
      });
    } catch (error) {
      this.logger.error({ err: error, sessionId: id }, "删除终端会话失败");
    }
  }

  /**
   * 获取所有持久化的会话（含 isActive=false 的历史会话）。
   */
  getSavedSessions(): PersistedTerminalSession[] {
    return [...this.config.sessions];
  }

  /**
   * 获取单条会话记录。
   */
  getSession(id: ServerId): PersistedTerminalSession | undefined {
    return this.config.sessions.find((s) => s.id === id);
  }

  /**
   * 清理 7 天未活动会话。
   */
  async cleanupExpiredSessions(): Promise<number> {
    try {
      return await this.enqueueMutation(async () => {
        const now = Date.now();
        const initialLength = this.config.sessions.length;
        this.config.sessions = this.config.sessions.filter((session) => {
          const lastActivity = new Date(session.lastActivity).getTime();
          return now - lastActivity < SessionManager.EXPIRATION_MS;
        });
        const removedCount = initialLength - this.config.sessions.length;
        if (removedCount > 0) {
          await this.saveConfig();
          this.logger.info({ removedCount }, "清理过期终端会话");
        }
        return removedCount;
      });
    } catch (error) {
      this.logger.error({ err: error }, "清理过期终端会话失败");
      return 0;
    }
  }

  /** 调试用——暴露配置文件绝对路径。 */
  getConfigPath(): string {
    return this.configPath;
  }

  // ─── 私有辅助 ─────────────────────────────────────────

  /**
   * 串行 mutationQueue 防并发写。
   */
  private enqueueMutation<T>(mutation: () => Promise<T>): Promise<T> {
    const operation = this.mutationQueue.then(mutation);
    this.mutationQueue = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  }

  /**
   * 确保配置目录存在。
   */
  private async ensureConfigDirectory(): Promise<void> {
    try {
      await fs.access(this.configDir);
    } catch {
      await fs.mkdir(this.configDir, { recursive: true });
      this.logger.info({ configDir: this.configDir }, "创建配置目录");
    }
  }

  /**
   * 加载 JSON 配置（ENOENT 建空，其他错误向上抛）。
   */
  private async loadConfig(): Promise<void> {
    try {
      const data = await fs.readFile(this.configPath, "utf-8");
      this.config = JSON.parse(data);
      this.logger.info("终端会话配置加载成功");
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        this.logger.info("终端会话配置文件不存在，使用默认配置");
        await this.saveConfig();
      } else {
        this.logger.error({ err: error }, "加载终端会话配置失败");
        throw error;
      }
    }
  }

  /**
   * 原子写：临时文件 + rename。
   */
  private async saveConfig(): Promise<void> {
    this.config.lastUpdated = new Date().toISOString();
    const tempPath = path.join(
      this.configDir,
      `.${path.basename(this.configPath)}.${process.pid}.${randomUUID()}.tmp`,
    );
    try {
      await fs.writeFile(tempPath, JSON.stringify(this.config, null, 2), "utf-8");
      await fs.rename(tempPath, this.configPath);
      this.logger.debug("终端会话配置保存成功");
    } catch (error) {
      await fs.rm(tempPath, { force: true }).catch(() => undefined);
      this.logger.error({ err: error }, "保存终端会话配置失败");
      throw error;
    }
  }
}