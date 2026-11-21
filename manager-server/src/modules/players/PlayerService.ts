import fs from "fs/promises";
import path from "path";
import type {
  IPlayerService,
  IPtyManager,
  IServerManager,
  PlayerActionRequest,
  PlayerActionResult,
  PlayerInfo,
  PlayersResponse,
  ServerId,
} from "@unturned-manager/shared";
import { resolveServerPath } from "../server/pathResolver.js";
import { AppError } from "../../utils/AppError.js";

/** 日志中玩家连接行：`Connecting: PlayerID: 76561198... Name: 昼白 Character: ACE` */
const CONNECT_RE =
  /Connecting:\s*PlayerID:\s*(\d{10,20})\s+Name:\s*(.+?)(?:\s+Character:\s*(.*))?$/;
/** 队列加入行：`Added 76561198...[0] "昼白" to queue` */
const QUEUE_RE = /Added\s+(\d{10,20})\[\d+\]\s+"([^"]+)"\s+to queue/;
/** 玩家接受进服：`Accepting queued player 76561198...[0] "昼白"` */
const ACCEPT_RE = /Accepting queued player\s+(\d{10,20})/;
/** 管理员命令成功日志 */
const ADMIN_SUCCESS_RE = /Successfully admined\s+(\d{10,20})/;
const UNADMIN_SUCCESS_RE = /Successfully unadmined\s+(\d{10,20})/;
/** 封禁成功日志（格式可能因版本不同，宽松匹配） */
const BAN_SUCCESS_RE = /Successfully banned\s+(\d{10,20})/;
/** 解除封禁成功日志 */
const UNBAN_SUCCESS_RE = /Successfully unbanned\s+(\d{10,20})/;
/** 玩家断开——Unturned 日志格式：`Disconnected: <名字>` 或 `<名字> disconnected` */
const DISCONNECT_RE = /Disconnected:\s*(.+)$/i;

/** 最多从日志尾部读取的字节数（避免大日志全量读） */
const LOG_TAIL_BYTES = 512 * 1024;
/** 最多保留的在线玩家数 */
const MAX_PLAYERS = 100;

/**
 * 玩家服务——Unturned 不提供玩家查询 API，数据来自实例日志与配置文件。
 *
 * 在线判定：日志尾部的 Connecting / Accepting 事件加入，Disconnected 事件移除。
 * 管理员：Commands.dat 的 Owner/Admin 行 + 日志中运行时 admin 命令结果。
 * 黑名单：Blacklist.dat + 日志中运行时 ban 命令结果。
 * 管理操作：写 Unturned 原生控制台命令到 PTY（owner-trust）。
 */
export class PlayerService implements IPlayerService {
  constructor(
    private ptyManager: IPtyManager,
    private serverManager: IServerManager,
  ) {}

  async getPlayers(serverId: ServerId): Promise<PlayersResponse> {
    // 校验实例存在
    if (!this.serverManager.listServersSync().includes(serverId)) {
      throw new AppError("server-not-found", `服务器实例不存在：${serverId}`, 404);
    }

    const logFile = path.join(
      resolveServerPath(serverId, ""),
      "..",
      "..",
      "Logs",
      `Server_${serverId}.log`,
    );
    const logTail = await readTail(logFile, LOG_TAIL_BYTES);

    const players = parseOnlinePlayers(logTail);
    const adminIds = new Set<string>();
    const bannedIds = new Set<string>();

    // Owner/Admin 来自 Commands.dat
    const commands = await readText(resolveServerPath(serverId, "Server/Commands.dat"));
    for (const line of commands.split(/\r?\n/)) {
      const m = /^(?:Owner|Admin)\s+(\d{10,20})/i.exec(line.trim());
      if (m?.[1]) adminIds.add(m[1]);
    }

    // 运行时命令结果来自日志
    for (const line of logTail.split(/\r?\n/)) {
      let m = ADMIN_SUCCESS_RE.exec(line);
      if (m?.[1]) adminIds.add(m[1]);
      m = UNADMIN_SUCCESS_RE.exec(line);
      if (m?.[1]) adminIds.delete(m[1]);
      m = BAN_SUCCESS_RE.exec(line);
      if (m?.[1]) bannedIds.add(m[1]);
      m = UNBAN_SUCCESS_RE.exec(line);
      if (m?.[1]) bannedIds.delete(m[1]);
    }

    // 持久名单文件（文本格式每行一个 SteamID；二进制格式含 ID 时也能提取）
    for (const id of await readIdList(resolveServerPath(serverId, "Server/Adminlist.dat"))) {
      adminIds.add(id);
    }
    for (const id of await readIdList(resolveServerPath(serverId, "Server/Blacklist.dat"))) {
      bannedIds.add(id);
    }

    const result = players.map((p): PlayerInfo => ({
      ...p,
      isAdmin: adminIds.has(p.steamId),
      isBanned: bannedIds.has(p.steamId),
    }));

    return {
      serverId,
      players: result.slice(0, MAX_PLAYERS),
      adminIds: [...adminIds],
      bannedIds: [...bannedIds],
      live: this.serverManager.getState(serverId) === "RUNNING",
    };
  }

  async act(
    serverId: ServerId,
    request: PlayerActionRequest,
  ): Promise<PlayerActionResult> {
    // 校验实例存在且运行中
    if (!this.serverManager.listServersSync().includes(serverId)) {
      throw new AppError("server-not-found", `服务器实例不存在：${serverId}`, 404);
    }
    if (this.serverManager.getState(serverId) !== "RUNNING") {
      throw new AppError(
        "server-not-running",
        "服务端未运行，无法管理玩家",
        409,
      );
    }
    if (!/^\d{10,20}$/.test(request.steamId)) {
      throw new AppError("invalid-steam-id", "玩家标识格式不正确", 400);
    }

    const { steamId, action } = request;
    let command: string;
    let message: string;

    switch (action) {
      case "admin":
        command = `admin ${steamId}`;
        message = "已下发设置管理员命令";
        break;
      case "unadmin":
        command = `unadmin ${steamId}`;
        message = "已下发取消管理员命令";
        break;
      case "kick":
        command = `kick ${steamId}`;
        message = "已下发踢出命令";
        break;
      case "ban": {
        const minutes = request.durationMinutes ?? 0;
        const reason = (request.reason ?? "").replace(/[\r\n]/g, " ").trim();
        command = `ban ${steamId} ${minutes}${reason ? ` ${reason}` : ""}`;
        message = minutes === 0 ? "已下发永久封禁命令" : `已下发封禁 ${minutes} 分钟命令`;
        break;
      }
      case "unban":
        command = `unban ${steamId}`;
        message = "已下发解除封禁命令";
        break;
      default:
        throw new AppError("unsupported-action", "不支持的操作", 400);
    }

    if (!this.ptyManager.isRunning(serverId)) {
      throw new AppError("terminal-not-ready", "控制台未就绪，请稍后重试", 409);
    }
    this.ptyManager.write(serverId, `${command}\n`);
    return { ok: true, message };
  }
}

/**
 * 从日志尾部解析在线玩家——按时间顺序处理连接与断开事件。
 * 同一 SteamID 后连接覆盖前连接；断开事件按昵称或 SteamID 移除。
 */
function parseOnlinePlayers(logTail: string): Omit<PlayerInfo, "isAdmin" | "isBanned">[] {
  const online = new Map<string, Omit<PlayerInfo, "isAdmin" | "isBanned">>();
  const lines = logTail.split(/\r?\n/);

  for (const line of lines) {
    const connect = CONNECT_RE.exec(line);
    if (connect?.[1]) {
      const steamId = connect[1];
      const name = (connect[2] ?? "").trim();
      const character = (connect[3] ?? "").trim();
      online.set(steamId, {
        steamId,
        name,
        ...(character ? { character } : {}),
        connectedAt: extractTimestamp(line) ?? new Date().toISOString(),
      });
      continue;
    }

    const accept = ACCEPT_RE.exec(line);
    if (accept?.[1] && !online.has(accept[1])) {
      // 队列接受但未记录 Connecting 行时，用队列行的名字补一条
      const queueName = findQueueName(lines, accept[1]);
      online.set(accept[1], {
        steamId: accept[1],
        name: queueName ?? "未知玩家",
        connectedAt: extractTimestamp(line) ?? new Date().toISOString(),
      });
      continue;
    }

    const disconnect = DISCONNECT_RE.exec(line);
    if (disconnect?.[1]) {
      const name = disconnect[1].trim();
      // Unturned 断开日志通常带名字；按名字反查 SteamID
      for (const [id, player] of online) {
        if (player.name === name) online.delete(id);
      }
      // 裸 "Disconnected"（服务器关闭）不带名字——在 getPlayers 里按 live 状态处理
    }
  }

  return [...online.values()];
}

/** 在同一段日志里找某 SteamID 的队列名字 */
function findQueueName(lines: string[], steamId: string): string | null {
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = QUEUE_RE.exec(lines[i] ?? "");
    if (m?.[1] === steamId) return m[2] ?? null;
  }
  return null;
}

/** 从日志行首提取时间戳 `[2026-11-21 08:59:12]` 转 ISO */
function extractTimestamp(line: string): string | null {
  const m = /^\[(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})\]/.exec(line);
  if (!m) return null;
  const date = new Date(`${m[1]}T${m[2]}Z`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** 读取文件尾部指定字节 */
async function readTail(filePath: string, maxBytes: number): Promise<string> {
  try {
    const handle = await fs.open(filePath, "r");
    try {
      const stat = await handle.stat();
      const length = Math.min(stat.size, maxBytes);
      const buffer = Buffer.alloc(length);
      await handle.read(buffer, 0, length, stat.size - length);
      return buffer.toString("utf8");
    } finally {
      await handle.close();
    }
  } catch {
    return "";
  }
}

/** 读取文本文件，失败返回空串 */
async function readText(filePath: string): Promise<string> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    return "";
  }
}

/**
 * 从 dat 文件提取 SteamID——兼容文本格式（每行一个）与二进制格式（连续 8 字节小端）。
 * 空列表文件（如 `02 00 00`）不产生任何 ID。
 */
async function readIdList(filePath: string): Promise<string[]> {
  const buffer = await readBuffer(filePath);
  if (buffer.length === 0) return [];

  const text = buffer.toString("utf8");
  if (/^\s*\d{10,20}\s*$/m.test(text)) {
    return text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => /^\d{10,20}$/.test(line));
  }

  const ids: string[] = [];
  // 二进制：跳过前 4 字节（版本/计数），之后每 8 字节一个小端 UInt64
  for (let offset = 4; offset + 8 <= buffer.length; offset += 8) {
    const bigint = buffer.readBigUInt64LE(offset);
    const id = bigint.toString();
    if (/^\d{10,20}$/.test(id)) ids.push(id);
  }
  return ids;
}

async function readBuffer(filePath: string): Promise<Buffer> {
  try {
    return await fs.readFile(filePath);
  } catch {
    return Buffer.alloc(0);
  }
}
