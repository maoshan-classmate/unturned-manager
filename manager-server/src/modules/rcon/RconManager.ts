import * as net from 'net';
import type { ServerId } from '@unturned-manager/shared';
import type { IRconManager, RconServerConfig } from '@unturned-manager/shared';
import { RconProtocol, RconConnectionState } from '@unturned-manager/shared';
import { logger } from '../../utils/logger.js';

import { createRequire } from 'module';
const _require = createRequire(import.meta.url);
const RconSource = _require('rcon-srcds').default;

// ─── 常量 ────────────────────────────────────────────

/** OpenMod 自动探测端口：读取 openmod.yaml rcon.port，兜底 25545 */
const OPENMOD_DEFAULT_PORT = 25545;

/** Source RCON 连接/认证超时 */
const SOURCE_RCON_TIMEOUT = 2_000;

/** Telnet RCON 端口偏移（游戏端口 + 2） */
const TELNET_PORT_OFFSET = 2;

/** 协议缓存时间 */
const PROTOCOL_CACHE_MS = 60_000;

/** 心跳间隔 */
const HEARTBEAT_INTERVAL_MS = 30_000;

/** 连续 ping 失败次数阈值 → DEGRADED */
const PING_FAIL_THRESHOLD = 3;

/** 危险指令（需 ServerManager 级别二次确认，后端强制） */
const DANGEROUS_COMMANDS = new Set([
  'shutdown', 'ban', 'slay', 'resetconfig', 'unadmin', 'unban', 'cheats',
]);

/** 控制字符正则（剥离 \r \n \0 及所有 < 0x20 字符） */
const CONTROL_CHARS_RE = /[\x00-\x1F]/g;

// ─── 类型 ────────────────────────────────────────────

interface RconConnection {
  protocol: RconProtocol;
  client: RconSourceClient | null; // Source RCON 连接
  telnetSocket: net.Socket | null; // Telnet fallback
  cachedAt: number;
  failCount: number;
  state: RconConnectionState;
}

interface RconSourceClient {
  connect(): Promise<void>;
  authenticate(password: string): Promise<void>;
  execute(command: string): Promise<string>;
  disconnect(): void;
  isConnected(): boolean;
  isAuthenticated(): boolean;
}

// ─── 工具函数 ─────────────────────────────────────────

/** 剥离输入中的控制字符 */
function sanitizeCommand(command: string): string {
  return command.replace(CONTROL_CHARS_RE, '');
}

/** 检查命令是否需要二次确认 */
function isDangerous(command: string): boolean {
  const cmdName = command.trim().split(/\s+/)[0]?.toLowerCase() ?? '';
  return DANGEROUS_COMMANDS.has(cmdName);
}

// ─── 实现 ─────────────────────────────────────────────

export class RconManager implements IRconManager {
  private connections = new Map<ServerId, RconConnection>();
  private configs = new Map<ServerId, RconServerConfig>();
  private stateCallbacks: Array<(serverId: ServerId, state: RconConnectionState) => void> = [];
  private heartbeatTimers = new Map<ServerId, ReturnType<typeof setInterval>>();

  // ── 配置注册 ────────────────────────────────────────

  register(serverId: ServerId, config: RconServerConfig): void {
    this.configs.set(serverId, config);
  }

  unregister(serverId: ServerId): void {
    this.disconnect(serverId);
    this.configs.delete(serverId);
  }

  // ── connect ─────────────────────────────────────────

  async connect(serverId: ServerId): Promise<void> {
    const config = this.configs.get(serverId);
    if (!config) {
      throw new Error(`RCON: 未注册的服务器 ${serverId}`);
    }

    // 检查缓存
    const existing = this.connections.get(serverId);
    if (existing && existing.state === RconConnectionState.CONNECTED) {
      const elapsed = Date.now() - existing.cachedAt;
      if (elapsed < PROTOCOL_CACHE_MS) {
        return; // 缓存有效，直接复用
      }
    }

    // ① 尝试 OpenMod Valve Source RCON（凭证: "SteamID:密码"）
    const openModPort = config.openModPort ?? OPENMOD_DEFAULT_PORT;
    if (config.openModCredential) {
      try {
        await this.connectSourceRcon(serverId, config.host, openModPort, config.openModCredential);
        return;
      } catch (err) {
        logger.info({ serverId, err }, 'OpenMod Source RCON 连接失败，回落 Telnet');
      }
    }

    // ② 回落 RocketMod Telnet RCON（凭证: 裸密码）
    const telnetPort = config.gamePort + TELNET_PORT_OFFSET;
    if (config.rocketModPassword) {
      try {
        await this.connectTelnetRcon(serverId, config.host, telnetPort, config.rocketModPassword);
      } catch (err) {
        logger.error({ serverId, err }, 'RCON 全部协议连接失败');
        this.setState(serverId, RconConnectionState.DISCONNECTED);
        throw new Error(`无法连接到 RCON (${serverId}): OpenMod + Telnet 均失败`);
      }
    }
  }

  private async connectSourceRcon(
    serverId: ServerId,
    host: string,
    port: number,
    password: string,
  ): Promise<void> {
    const client = new RconSource({
      host,
      port,
      timeout: SOURCE_RCON_TIMEOUT,
      encoding: 'utf8',
    }) as RconSourceClient;

    await client.connect();
    const authStart = Date.now();

    // OpenMod 认证格式: "SteamID:密码" — 先尝试直接密码
    await client.authenticate(password);

    logger.info({ serverId, host, port, elapsed: Date.now() - authStart }, 'OpenMod RCON 连接成功');

    const conn: RconConnection = {
      protocol: RconProtocol.OPENMOD,
      client,
      telnetSocket: null,
      cachedAt: Date.now(),
      failCount: 0,
      state: RconConnectionState.CONNECTED,
    };
    this.connections.set(serverId, conn);
    this.startHeartbeat(serverId);
    this.setState(serverId, RconConnectionState.CONNECTED);
  }

  private connectTelnetRcon(
    serverId: ServerId,
    host: string,
    port: number,
    password: string,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = new net.Socket();
      let buffer = '';
      let authenticated = false;

      const timeout = setTimeout(() => {
        socket.destroy();
        reject(new Error(`Telnet RCON 连接超时 ${host}:${port}`));
      }, SOURCE_RCON_TIMEOUT);

      socket.connect(port, host, () => {
        // 等待登录提示或直接发送
        socket.write(`login ${password}\r\n`);
      });

      socket.on('data', (data: Buffer) => {
        buffer += data.toString('utf8');

        if (!authenticated && /success|logged in|authenticated|OK/i.test(buffer)) {
          authenticated = true;
          clearTimeout(timeout);

          logger.info({ serverId, host, port }, 'RocketMod Telnet RCON 连接成功');

          const conn: RconConnection = {
            protocol: RconProtocol.ROCKETMOD,
            client: null,
            telnetSocket: socket,
            cachedAt: Date.now(),
            failCount: 0,
            state: RconConnectionState.CONNECTED,
          };
          this.connections.set(serverId, conn);
          this.startHeartbeat(serverId);
          this.setState(serverId, RconConnectionState.CONNECTED);
          resolve();
        }

        // 错误响应
        if (/failed|denied|invalid|incorrect/i.test(buffer)) {
          clearTimeout(timeout);
          socket.destroy();
          reject(new Error(`Telnet RCON 认证失败: ${buffer.trim()}`));
        }
      });

      socket.on('error', (err: Error) => {
        clearTimeout(timeout);
        reject(err);
      });

      socket.on('close', () => {
        if (!authenticated) {
          clearTimeout(timeout);
          reject(new Error('Telnet RCON 连接在认证前关闭'));
        }
      });
    });
  }

  // ── disconnect ──────────────────────────────────────

  disconnect(serverId: ServerId): void {
    this.stopHeartbeat(serverId);
    const conn = this.connections.get(serverId);
    if (!conn) return;

    try {
      conn.client?.disconnect();
    } catch { /* noop */ }
    try {
      conn.telnetSocket?.destroy();
    } catch { /* noop */ }

    this.connections.delete(serverId);
    logger.info({ serverId }, 'RCON 已断开');
  }

  // ── execute ─────────────────────────────────────────

  async execute(serverId: ServerId, command: string): Promise<string> {
    const conn = this.connections.get(serverId);
    if (!conn || conn.state !== RconConnectionState.CONNECTED) {
      throw new Error(`RCON 未连接: ${serverId}`);
    }

    const cleaned = sanitizeCommand(command);
    logger.debug({ serverId, command: cleaned }, 'RCON 执行命令');

    try {
      let response: string;

      if (conn.protocol === RconProtocol.OPENMOD && conn.client) {
        response = await conn.client.execute(cleaned);
      } else if (conn.protocol === RconProtocol.ROCKETMOD && conn.telnetSocket) {
        response = await this.telnetExecute(conn.telnetSocket, cleaned);
      } else {
        throw new Error('RCON 连接状态异常');
      }

      // 成功后重置失败计数
      conn.failCount = 0;
      return response;
    } catch (err) {
      conn.failCount++;
      logger.warn({ serverId, command: cleaned, failCount: conn.failCount, err }, 'RCON 命令执行失败');

      if (conn.failCount >= PING_FAIL_THRESHOLD) {
        this.setState(serverId, RconConnectionState.DEGRADED);
      }

      throw err;
    }
  }

  private telnetExecute(socket: net.Socket, command: string): Promise<string> {
    return new Promise((resolve, reject) => {
      let buffer = '';
      const timeout = setTimeout(() => {
        reject(new Error('Telnet RCON 命令超时 (10s)'));
      }, 10_000);

      const onData = (data: Buffer) => {
        buffer += data.toString('utf8');
        // Telnet 响应通常以换行结束，简单判断
        if (buffer.includes('\n') || buffer.length > 4096) {
          clearTimeout(timeout);
          socket.removeListener('data', onData);
          resolve(buffer.trim());
        }
      };

      socket.on('data', onData);
      socket.write(`${command}\r\n`);
    });
  }

  // ── 查询 ────────────────────────────────────────────

  getProtocol(serverId: ServerId): RconProtocol {
    return this.connections.get(serverId)?.protocol ?? RconProtocol.UNREACHABLE;
  }

  isReachable(serverId: ServerId): boolean {
    return this.connections.get(serverId)?.state === RconConnectionState.CONNECTED;
  }

  // ── 心跳 ────────────────────────────────────────────

  private startHeartbeat(serverId: ServerId): void {
    this.stopHeartbeat(serverId);
    const timer = setInterval(() => {
      void this.ping(serverId);
    }, HEARTBEAT_INTERVAL_MS);
    this.heartbeatTimers.set(serverId, timer);
  }

  private stopHeartbeat(serverId: ServerId): void {
    const timer = this.heartbeatTimers.get(serverId);
    if (timer) {
      clearInterval(timer);
      this.heartbeatTimers.delete(serverId);
    }
  }

  private async ping(serverId: ServerId): Promise<void> {
    const conn = this.connections.get(serverId);
    if (!conn) return;

    try {
      // 发一个无害的 ping 命令
      if (conn.protocol === RconProtocol.OPENMOD && conn.client && conn.client.isConnected()) {
        await conn.client.execute('Help');
        conn.failCount = 0;
      } else if (conn.protocol === RconProtocol.ROCKETMOD && conn.telnetSocket && !conn.telnetSocket.destroyed) {
        await this.telnetExecute(conn.telnetSocket, 'Help');
        conn.failCount = 0;
      } else {
        conn.failCount++;
      }
    } catch {
      conn.failCount++;
      logger.warn({ serverId, failCount: conn.failCount }, 'RCON ping 失败');

      if (conn.failCount >= PING_FAIL_THRESHOLD) {
        this.setState(serverId, RconConnectionState.DEGRADED);
      }
    }
  }

  // ── 回调 ────────────────────────────────────────────

  onStateChange(callback: (serverId: ServerId, state: RconConnectionState) => void): void {
    this.stateCallbacks.push(callback);
  }

  private setState(serverId: ServerId, state: RconConnectionState): void {
    const conn = this.connections.get(serverId);
    if (conn) {
      conn.state = state;
    }
    for (const cb of this.stateCallbacks) {
      try {
        cb(serverId, state);
      } catch (err) {
        logger.error({ err, serverId, state }, 'RCON stateChange 回调异常');
      }
    }
  }

  // ── destroy ─────────────────────────────────────────

  async destroy(): Promise<void> {
    for (const id of Array.from(this.connections.keys())) {
      this.disconnect(id);
    }
    for (const timer of Array.from(this.heartbeatTimers.values())) {
      clearInterval(timer);
    }
    this.heartbeatTimers.clear();
    this.stateCallbacks.length = 0;
  }
}
