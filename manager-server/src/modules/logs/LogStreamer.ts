import fs from 'fs';
import path from 'path';
import type Database from 'better-sqlite3';
import type {
  ServerId,
  ILogStreamer,
  IBroadcaster,
  IProcessSupervisor,
} from '@unturned-manager/shared';
import { logger } from '../../utils/logger.js';

// ─── 常量 ────────────────────────────────────────────────

/** 凭证脱敏规则 */
const REDACT_RULES: Array<[RegExp, string]> = [
  [/7656119\d{10}:[^\s]+/g, 'SteamID:[REDACTED]'],
  [/login\s+\S+/gi, 'login [REDACTED]'],
  [/GSLT\s+\S+/gi, 'GSLT [REDACTED]'],
  [/Login_Token\s+\S+/gi, 'Login_Token [REDACTED]'],
  [/Password\s+\S+/gi, 'Password [REDACTED]'],
];

/** 文件 tail 轮询间隔 */
const TAIL_POLL_MS = 500;

/** 单服务器最大广播速率（行/秒） */
const MAX_LINES_PER_SEC = 100;

// ─── 运行时状态 ──────────────────────────────────────────

interface StreamState {
  serverId: ServerId;
  stdoutHandle?: number;       // ProcessSupervisor callback index
  fileTailTimer?: NodeJS.Timeout;
  fileOffsets: Map<string, number>;  // 文件路径 → 上次读取偏移
  lineBudget: { count: number; resetAt: number };
  active: boolean;
}

// ─── 实现 ────────────────────────────────────────────────

export class LogStreamer implements ILogStreamer {
  private streams = new Map<ServerId, StreamState>();

  constructor(
    private broadcaster: IBroadcaster,
    private processSupervisor: IProcessSupervisor,
    private db: Database.Database,
  ) {}

  startStreaming(serverId: ServerId): void {
    if (this.streams.has(serverId)) {
      return; // 已在流式传输
    }

    const state: StreamState = {
      serverId,
      fileOffsets: new Map(),
      lineBudget: { count: 0, resetAt: Date.now() + 1000 },
      active: true,
    };

    // 文件 tail
    this.startFileTail(state);

    // stdout pipe（如果进程在运行）
    if (this.processSupervisor.isRunning(serverId)) {
      this.processSupervisor.onStdout(serverId, (line: string) => {
        if (!state.active) return;
        const sanitized = this.sanitize(line);
        this.broadcastLine(serverId, sanitized, 'stdout', state);
      });
    }

    this.streams.set(serverId, state);
    logger.info({ serverId }, '日志流已启动');
  }

  stopStreaming(serverId: ServerId): void {
    const state = this.streams.get(serverId);
    if (!state) return;

    state.active = false;

    if (state.fileTailTimer) {
      clearInterval(state.fileTailTimer);
    }

    this.streams.delete(serverId);
    logger.info({ serverId }, '日志流已停止');
  }

  // ── 文件 tail ─────────────────────────────────────────

  private startFileTail(state: StreamState): void {
    const logsDir = this.resolveLogsDir(state.serverId);
    if (!logsDir) return;

    state.fileTailTimer = setInterval(() => {
      if (!state.active) return;

      try {
        const files = fs.readdirSync(logsDir).filter((f) => f.endsWith('.log'));
        for (const file of files) {
          this.tailFile(state, path.join(logsDir, file));
        }
      } catch {
        // 日志目录可能还不存在
      }
    }, TAIL_POLL_MS);
  }

  private tailFile(state: StreamState, filePath: string): void {
    try {
      const stat = fs.statSync(filePath);
      const offset = state.fileOffsets.get(filePath) ?? 0;

      if (stat.size <= offset) return;

      const fd = fs.openSync(filePath, 'r');
      const buf = Buffer.alloc(stat.size - offset);
      fs.readSync(fd, buf, 0, buf.length, offset);
      fs.closeSync(fd);

      state.fileOffsets.set(filePath, stat.size);

      const lines = buf.toString('utf-8').split('\n').filter(Boolean);
      for (const line of lines) {
        const sanitized = this.sanitize(line);
        this.broadcastLine(state.serverId, sanitized, 'file', state);
      }
    } catch {
      // 文件可能被轮转或删除
    }
  }

  // ── 脱敏 + 广播 ───────────────────────────────────────

  private sanitize(line: string): string {
    for (const [pattern, replacement] of REDACT_RULES) {
      line = line.replace(pattern, replacement);
    }
    return line;
  }

  private broadcastLine(
    serverId: ServerId,
    line: string,
    source: 'stdout' | 'file',
    state: StreamState,
  ): void {
    // 速率限制
    const now = Date.now();
    if (now > state.lineBudget.resetAt) {
      state.lineBudget = { count: 0, resetAt: now + 1000 };
    }
    state.lineBudget.count++;
    if (state.lineBudget.count > MAX_LINES_PER_SEC) return;

    this.broadcaster.broadcast({
      type: 'console_line',
      serverId,
      line,
      source,
    } as never);
  }

  // ── 路径 ──────────────────────────────────────────────

  private resolveLogsDir(serverId: ServerId): string | null {
    const row = this.db
      .prepare('SELECT install_dir FROM servers WHERE id = ?')
      .get(serverId) as { install_dir: string } | undefined;

    if (!row?.install_dir) return null;
    return path.join(row.install_dir, 'Servers', serverId, 'Logs');
  }
}
