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

/** 单服务器最大广播速率（行/秒） */
const MAX_LINES_PER_SEC = 100;

// ─── 运行时状态 ──────────────────────────────────────────

interface StreamState {
  serverId: ServerId;
  stdoutHandle?: number;       // ProcessSupervisor callback index
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
      lineBudget: { count: 0, resetAt: Date.now() + 1000 },
      active: true,
    };

    // stdout pipe（如果进程在运行）。注意：PTY 模式下 isRunning 始终 false，
    // 此分支不触发——PTY 的 stdout 由 ServerManager.pipePtyOutput（PtyManager.onData）
    // 单独推 console_line，本类只承担 ProcessSupervisor 子进程的 stdout 兜底。
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

    this.streams.delete(serverId);
    logger.info({ serverId }, '日志流已停止');
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
   * PTY 模式下 U3DS 一边写终端一边 append 文件, 两路推同一行造成控制台重复显示；
   * 保留 ProcessSupervisor.onStdout 兜底。
   */
  private resolveU3dsLogFile(serverId: ServerId): string | null {
    return path.join(resolveInstallDir(), 'Logs', `Server_${serverId}.log`);
  }
}
