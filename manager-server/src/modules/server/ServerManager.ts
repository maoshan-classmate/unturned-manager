import type Database from 'better-sqlite3';
import type {
  ServerId,
  SteamId64,
  Port,
  ServerConfig,
  IServerManager,
  IProcessSupervisor,
  IRconManager,
  IA2SClient,
  IConfigService,
  IBroadcaster,
  ActiveOperation,
  WorkshopFileId,
} from '@unturned-manager/shared';
import { ServerState } from '@unturned-manager/shared';
import { logger } from '../../utils/logger.js';

// ─── 常量 ────────────────────────────────────────────

const A2S_POLL_INTERVAL = 3_000;   // 3s 轮询
const A2S_POLL_TIMEOUT = 30_000;   // CLAUDE.md §4.6: 30s 总超时，超时报错
const SHUTDOWN_TIMEOUT = 30_000;   // 等待进程退出

// ─── 运行时状态 (in-memory, backed by DB) ────────────

interface RuntimeServerState {
  state: ServerState;
  activeOperation: ActiveOperation;
  config: ServerConfig;
}

export class ServerManager implements IServerManager {
  private servers = new Map<ServerId, RuntimeServerState>();

  constructor(
    private db: Database.Database,
    private processSupervisor: IProcessSupervisor,
    private rconManager: IRconManager,
    private a2sClient: IA2SClient,
    private configService: IConfigService,
    private broadcaster: IBroadcaster,
  ) {
    this.loadServersFromDb();

    // CLAUDE.md §4.7: DEGRADED 状态接线——RCON 断连 → 降级
    this.rconManager.onStateChange((serverId, state) => {
      if (state === 'degraded' as any) {
        this.transition(serverId as ServerId, ServerState.DEGRADED);
      } else if (state === 'connected' as any) {
        const current = this.getState(serverId as ServerId);
        if (current === ServerState.DEGRADED) {
          this.transition(serverId as ServerId, ServerState.RUNNING);
        }
      }
    });

    // CLAUDE.md §4.7: 崩溃检测——进程异常退出 → STOPPED
    this.processSupervisor.onCrash((serverId, exitCode) => {
      logger.warn({ serverId, exitCode }, 'U3DS 进程崩溃');
      this.transition(serverId, ServerState.STOPPED);
      this.auditLog(serverId, 'server.crash', { exitCode });
    });
  }

  // ── 持久化加载 ──────────────────────────────────────

  private loadServersFromDb(): void {
    const rows = this.db
      .prepare('SELECT id, name, game_port, state, install_dir, rcon_port, rcon_password_enc, owner_steam_id FROM servers')
      .all() as Array<{
        id: string; name: string; game_port: number; state: string; install_dir: string;
        rcon_port: number | null; rcon_password_enc: string | null;
        owner_steam_id: string | null;
      }>;

    for (const row of rows) {
      this.servers.set(row.id as ServerId, {
        state: row.state as ServerState,
        activeOperation: { type: 'none' },
        config: {
          id: row.id as ServerId,
          name: row.name,
          gamePort: row.game_port as Port,
          ownerSteamId: (row.owner_steam_id ?? '') as SteamId64,
          installDir: row.install_dir || '/opt/unturned',
        },
      });
      this.a2sClient.register(row.id as ServerId, '127.0.0.1', row.game_port);
    }
    logger.info({ count: rows.length }, '已从 DB 加载服务器');
  }

  // ── 查询 ────────────────────────────────────────────

  getState(serverId: ServerId): ServerState {
    return this.servers.get(serverId)?.state ?? ServerState.STOPPED;
  }

  getActiveOperation(serverId: ServerId): ActiveOperation {
    return this.servers.get(serverId)?.activeOperation ?? { type: 'none' };
  }

  async listServers(): Promise<ServerConfig[]> {
    return Array.from(this.servers.values()).map((s) => s.config);
  }

  /**
   * 同步版——直接读 in-memory Map（启动时给 LogStreamer 接线用）。
   * 不走 await DB，启动期间不会卡。
   */
  listServersSync(): string[] {
    return Array.from(this.servers.keys());
  }

  // ── 创建 / 配置 ─────────────────────────────────────

  async createServer(config: ServerConfig): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO servers (id, name, game_port, state, install_dir, owner_steam_id)
         VALUES (?, ?, ?, 'STOPPED', ?, ?)`,
      )
      .run(config.id, config.name, config.gamePort, config.installDir, config.ownerSteamId);

    this.servers.set(config.id, {
      state: ServerState.STOPPED,
      activeOperation: { type: 'none' },
      config,
    });

    // 注册到下游模块
    this.a2sClient.register(config.id, '127.0.0.1', config.gamePort as unknown as number);
    if (config.rconPassword) {
      this.rconManager.register(config.id, {
        host: '127.0.0.1',
        gamePort: config.gamePort as unknown as number,
        // v1: 用户填的是一个密码，优先作为 RocketMod 裸密码
        // OpenMod 用户需通过 configureServer 单独设置 openModCredential
        rocketModPassword: config.rconPassword,
        ownerSteamId: config.ownerSteamId as string,
      });
    }

    this.auditLog(config.id, 'server.create', { name: config.name });
    logger.info({ serverId: config.id }, '服务器已创建');
  }

  async configureServer(serverId: ServerId, patch: Partial<ServerConfig>): Promise<void> {
    const existing = this.servers.get(serverId);
    if (!existing) throw new Error(`服务器不存在: ${serverId}`);

    const updated = { ...existing.config, ...patch };
    this.db
      .prepare('UPDATE servers SET name = ?, game_port = ?, owner_steam_id = ?, updated_at = datetime(?) WHERE id = ?')
      .run(updated.name, updated.gamePort, updated.ownerSteamId, 'now', serverId);

    existing.config = updated;
    if (patch.gamePort != null) {
      this.a2sClient.register(serverId, '127.0.0.1', patch.gamePort as unknown as number);
    }

    this.auditLog(serverId, 'server.configure', patch);
    logger.info({ serverId }, '服务器配置已更新');
  }

  // ── 生命周期 ───────────────────────────────────────

  async start(serverId: ServerId): Promise<void> {
    const entry = this.ensureServer(serverId);

    if (entry.activeOperation.type !== 'none') {
      throw Object.assign(new Error(`操作冲突: ${entry.activeOperation.type}`), { status: 409 });
    }

    if (entry.state === ServerState.RUNNING) return;

    entry.activeOperation = { type: 'manual_start', startedAt: new Date().toISOString() };
    this.transition(serverId, ServerState.STARTING);

    try {
      const { id, installDir } = entry.config;
      if (!installDir) {
        throw new Error('未配置服务器安装目录 (installDir)');
      }
      const command = `${installDir}/ServerHelper.sh`;
      const pid = await this.processSupervisor.spawn(
        id,
        command,
        [`+InternetServer/${id}`, '-ThreadedConsole'],
        installDir, // cwd = U3DS 安装根目录
      );
      logger.info({ serverId, pid, installDir }, 'U3DS 进程已启动，等待 A2S 就绪');

      // 轮询 A2S 直到就绪（CLAUDE.md §4.6: 30s 超时报错）
      await this.pollA2S(serverId);

      this.transition(serverId, ServerState.RUNNING);

      // 连接 RCON
      try {
        await this.rconManager.connect(serverId);
      } catch (err) {
        logger.warn({ serverId, err }, 'RCON 连接失败，服务仍在运行');
      }

      this.auditLog(serverId, 'server.start', { pid });
    } catch (err) {
      logger.error({ serverId, err }, '启动失败');
      this.transition(serverId, ServerState.STOPPED);
      throw err;
    } finally {
      entry.activeOperation = { type: 'none' };
    }
  }

  async stop(serverId: ServerId, reason: string): Promise<void> {
    const entry = this.ensureServer(serverId);

    if (entry.activeOperation.type !== 'none') {
      throw Object.assign(new Error(`操作冲突: ${entry.activeOperation.type}`), { status: 409 });
    }

    entry.activeOperation = { type: 'manual_stop', startedAt: new Date().toISOString() };
    this.transition(serverId, ServerState.STOPPING);

    try {
      // 尝试 RCON Save + Shutdown
      if (this.rconManager.isReachable(serverId)) {
        try {
          await this.rconManager.execute(serverId, 'Save');
        } catch { /* RCON 可能已断开 */ }
        try {
          await this.rconManager.execute(serverId, `Shutdown 30 "${reason}"`);
        } catch { /* Shutdown 可能不受支持 */ }
      }

      await this.processSupervisor.waitForExit(serverId, SHUTDOWN_TIMEOUT);
      this.transition(serverId, ServerState.STOPPED);
      this.rconManager.disconnect(serverId);

      this.auditLog(serverId, 'server.stop', { reason });
    } catch {
      // 进程未在超时内退出
      logger.warn({ serverId }, '停止超时，SIGKILL');
      this.processSupervisor.forceKill(serverId);
      this.transition(serverId, ServerState.STOPPED);
    } finally {
      entry.activeOperation = { type: 'none' };
    }
  }

  async restart(serverId: ServerId, reason: string): Promise<void> {
    const entry = this.ensureServer(serverId);

    // CLAUDE.md §4.7: restart 全过程由一个 activeOperation 覆盖，防止竞态
    if (entry.activeOperation.type !== 'none') {
      throw Object.assign(new Error(`操作冲突: ${entry.activeOperation.type}`), { status: 409 });
    }
    entry.activeOperation = { type: 'manual_restart', startedAt: new Date().toISOString() };

    try {
      // 内部 stop（绕过 stop() 的 activeOperation 检查）
      await this.stopInternal(serverId, reason);
      // 内部 start
      await this.startInternal(serverId);
      this.auditLog(serverId, 'server.restart', { reason });
    } finally {
      entry.activeOperation = { type: 'none' };
    }
  }

  /**
   * 内部 stop——不检查 activeOperation（由 restart 统一管理）。
   */
  private async stopInternal(serverId: ServerId, reason: string): Promise<void> {
    this.transition(serverId, ServerState.STOPPING);

    if (this.rconManager.isReachable(serverId)) {
      try { await this.rconManager.execute(serverId, 'Save'); } catch { /* noop */ }
      try { await this.rconManager.execute(serverId, `Shutdown 30 "${reason}"`); } catch { /* noop */ }
    }

    try {
      await this.processSupervisor.waitForExit(serverId, SHUTDOWN_TIMEOUT);
    } catch {
      this.processSupervisor.forceKill(serverId);
    }

    this.transition(serverId, ServerState.STOPPED);
    this.rconManager.disconnect(serverId);
  }

  /**
   * 内部 start——不检查 activeOperation（由 restart 统一管理）。
   */
  private async startInternal(serverId: ServerId): Promise<void> {
    const entry = this.ensureServer(serverId);
    if (entry.state === ServerState.RUNNING) return;

    this.transition(serverId, ServerState.STARTING);

    const { id, installDir } = entry.config;
    if (!installDir) throw new Error('未配置服务器安装目录 (installDir)');

    const pid = await this.processSupervisor.spawn(
      id,
      `${installDir}/ServerHelper.sh`,
      [`+InternetServer/${id}`, '-ThreadedConsole'],
      installDir,
    );

    logger.info({ serverId, pid, installDir }, 'U3DS 进程已启动，等待 A2S 就绪');
    await this.pollA2S(serverId);
    this.transition(serverId, ServerState.RUNNING);

    try { await this.rconManager.connect(serverId); } catch { /* noop */ }
  }

  async forceStop(serverId: ServerId): Promise<void> {
    const entry = this.ensureServer(serverId);
    logger.warn({ serverId }, '强制停止');

    this.processSupervisor.forceKill(serverId);
    this.rconManager.disconnect(serverId);
    this.transition(serverId, ServerState.STOPPED);
    entry.activeOperation = { type: 'none' };

    this.auditLog(serverId, 'server.force_stop', {});
  }

  // ── Mod / Update (Phase 2: Mod apply 流水线) ─────────

  /**
   * 9 步 Mod 应用流水线（详见 ADR-0002 §6.2）：
   * ① 备份 WorkshopDownloadConfig.json
   * ② writeWorkshopFileIds 写新 ID
   * ③ RCON `Say` 公告即将重启
   * ④ 每 10s 广播一次倒计时（共 5 次：50→10 剩余）
   * ⑤ RCON `Save`
   * ⑥ RCON `Shutdown 10 "<原因>"`
   * ⑦ waitForExit（30s 超时则 forceKill）
   * ⑧ spawn（走 startInternal + pollA2S）
   * ⑨ RCON `Say "Mod 变更已应用"` + activeOperation 释放 + audit + final broadcast
   *
   * 全程在 `mod_apply` activeOperation 覆盖下，外部 stop/start 不会 409（仅 cancel 走 9）
   */
  async applyModChanges(serverId: ServerId, modIds: WorkshopFileId[]): Promise<void> {
    const entry = this.ensureServer(serverId);

    // 锁：与 restart 同模式，但 mod_apply 暴露给前端「应用变更」按钮
    if (entry.activeOperation.type !== 'none') {
      throw Object.assign(new Error(`操作冲突: ${entry.activeOperation.type}`), { status: 409 });
    }
    entry.activeOperation = { type: 'mod_apply', startedAt: new Date().toISOString(), modIds: modIds as string[] };

    // 当前必须是 RUNNING（DEGRADED 也允许）才能 mod_apply
    if (entry.state !== ServerState.RUNNING && entry.state !== ServerState.DEGRADED) {
      entry.activeOperation = { type: 'none' };
      throw Object.assign(
        new Error(`Mod 应用要求服务器运行中，当前状态: ${entry.state}`),
        { status: 409 },
      );
    }

    // 进度 helper
    const announce = (stage: string, remainingSeconds?: number) => {
      try {
        this.broadcaster.broadcast({
          type: 'mod_apply_progress',
          serverId,
          stage,
          remainingSeconds,
        } as never);
      } catch { /* 广播失败不阻塞主流程 */ }
    };

    try {
      // ① 备份
      announce('backing_up');
      try {
        await this.configService.backup(serverId, 'Servers/' + serverId + '/Server/WorkshopDownloadConfig.json');
      } catch (err) {
        // 备份失败：文件可能还不存在（首次启动），降级为 warn，不阻塞
        logger.warn({ serverId, err }, 'WorkshopDownloadConfig.json 备份失败（文件可能不存在）');
      }

      // ② 写新 File_IDs
      announce('writing_config');
      await this.configService.writeWorkshopFileIds(serverId, modIds);

      // ③ RCON Say 公告——只有 RCON 通了才发
      if (this.rconManager.isReachable(serverId)) {
        announce('broadcasting', 60);
        try {
          await this.rconManager.execute(serverId, 'Say "服务器将在 60 秒后重启以应用 Mod 变更"');
        } catch { /* ignore */ }
      }

      // ④ 5 次倒计时广播（10s 间隔）——不真正等，只是发事件
      // 注意：真实停下来等 Shutdown 用 A2S/RCON 超时；前端靠 mod_apply_progress 事件驱动 UI
      for (const remaining of [50, 40, 30, 20, 10]) {
        announce('countdown', remaining);
      }

      // ⑤ Save
      if (this.rconManager.isReachable(serverId)) {
        announce('saving');
        try { await this.rconManager.execute(serverId, 'Save'); } catch { /* ignore */ }
      }

      // ⑥ Shutdown
      announce('shutting_down', 10);
      if (this.rconManager.isReachable(serverId)) {
        try {
          await this.rconManager.execute(serverId, 'Shutdown 10 "Mod 变更重启"');
        } catch { /* Shutdown 可能受限 */ }
      }

      // ⑦ 等进程退出
      announce('waiting_exit');
      try {
        await this.processSupervisor.waitForExit(serverId, SHUTDOWN_TIMEOUT);
      } catch {
        // 30s 未退出 → 强杀
        logger.warn({ serverId }, 'Shutdown 超时，SIGKILL');
        this.processSupervisor.forceKill(serverId);
      }
      this.transition(serverId, ServerState.STOPPED);
      this.rconManager.disconnect(serverId);

      // ⑧ 重新拉起
      await this.startInternal(serverId);

      // ⑨ 收尾
      if (this.rconManager.isReachable(serverId)) {
        try {
          await this.rconManager.execute(serverId, 'Say "Mod 变更已应用"');
        } catch { /* ignore */ }
      }
      announce('completed');
      this.auditLog(serverId, 'mod.apply', { modIds: modIds as string[] });
      logger.info({ serverId, modCount: modIds.length }, 'Mod 变更流水线完成');
    } catch (err) {
      logger.error({ serverId, err }, 'Mod 变更流水线失败');
      announce('failed');
      // try 兜底：把进程拉回 STOPPED
      try { this.transition(serverId, ServerState.STOPPED); } catch { /* noop */ }
      throw err;
    } finally {
      entry.activeOperation = { type: 'none' };
    }
  }

  async updateServerBinaries(_installDir: string): Promise<void> {
    // 卡 C（Phase 3）实装：spawn steamcmd + ... +validate
    throw new Error('updateServerBinaries: Phase 3 卡 C 待实现');
  }

  // ── 内部方法 ────────────────────────────────────────

  private ensureServer(serverId: ServerId): RuntimeServerState {
    const entry = this.servers.get(serverId);
    if (!entry) throw new Error(`服务器不存在: ${serverId}`);
    return entry;
  }

  private transition(serverId: ServerId, to: ServerState): void {
    const entry = this.servers.get(serverId);
    if (!entry) return;
    const from = entry.state;
    entry.state = to;

    // 持久化
    this.db
      .prepare('UPDATE servers SET state = ?, updated_at = datetime(?) WHERE id = ?')
      .run(to, 'now', serverId);

    // 广播
    try {
      this.broadcaster.broadcast({
        type: 'state_change',
        serverId,
        from,
        to,
      });
    } catch { /* 广播失败不影响主流程 */ }

    logger.info({ serverId, from, to }, '状态转换');
  }

  private async pollA2S(serverId: ServerId): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < A2S_POLL_TIMEOUT) {
      try {
        const info = await this.a2sClient.query(serverId);
        if (info.players >= 0) {
          logger.info({ serverId, elapsed: Date.now() - start, info }, 'A2S 就绪');
          return;
        }
      } catch {
        // 继续轮询
      }
      await new Promise((r) => setTimeout(r, A2S_POLL_INTERVAL));
    }
    // CLAUDE.md §4.6: "超时 30 秒就报错"
    throw new Error(`A2S 轮询超时 (${A2S_POLL_TIMEOUT / 1000}s): ${serverId}`);
  }

  private auditLog(serverId: ServerId, action: string, detail: Record<string, unknown>): void {
    try {
      this.db
        .prepare(
          'INSERT INTO audit_logs (server_id, action, actor, detail, created_at) VALUES (?, ?, ?, ?, datetime(?))',
        )
        .run(serverId, action, 'admin', JSON.stringify(detail), 'now');
    } catch (err) {
      logger.error({ err, serverId, action }, '审计日志写入失败');
    }
  }
}
