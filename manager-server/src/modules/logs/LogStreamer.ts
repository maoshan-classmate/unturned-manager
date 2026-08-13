import fs from 'fs';
import path from 'path';
import type {
  ServerId,
  ILogStreamer,
  IBroadcaster,
  IProcessSupervisor,
} from '@unturned-manager/shared';
import { logger } from '../../utils/logger.js';
import { resolveInstallDir } from '../server/pathResolver.js';

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
    // ★ 2026-08-14 实机根因：U3-SDK `Logs.cs:311` 把日志写到
    // `<installDir>/Logs/Server_<serverId>.log`（全局，非 `Servers/<id>/Logs`）。
    // 旧实现 tail `Servers/<id>/Logs` 目录——实机不存在 → 控制台首次进入空白无历史。
    const logFile = this.resolveU3dsLogFile(state.serverId);
    if (!logFile) return;

    state.fileTailTimer = setInterval(() => {
      if (!state.active) return;
      try {
        this.tailFile(state, logFile);
      } catch {
        // 日志文件可能还不存在（服务器未启动）
      }
    }, TAIL_POLL_MS);
  }

  private tailFile(state: StreamState, filePath: string): void {
    try {
      const stat = fs.statSync(filePath);
      let offset = state.fileOffsets.get(filePath) ?? 0;

      if (stat.size < offset) {
        // ★ 2026-08-14 修复：日志轮转（U3DS 滚动 Server_<id>_Prev.log）后新文件变小，
        // offset 归零从新文件头重读，否则永远 return 读不到新内容。
        state.fileOffsets.set(filePath, 0);
        offset = 0;
      }
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

  /**
   * U3DS 日志文件绝对路径（U3-SDK `Logs.cs:311`：`<installDir>/Logs/Server_<serverId>.log`）。
   * 全局 installDir 下，不在 Servers/<id>/ 内——与 resolveServerPath 无关。
   */
  private resolveU3dsLogFile(serverId: ServerId): string | null {
    return path.join(resolveInstallDir(), 'Logs', `Server_${serverId}.log`);
  }
}
