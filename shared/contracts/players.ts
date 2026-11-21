import type { ServerId } from "../types/branded.js";

/**
 * 在线玩家信息——从实例日志解析得到（Unturned 不提供玩家查询 API）。
 *
 * SteamID 是 64 位数字，超出 JavaScript 安全整数范围，必须用字符串传递。
 */
export interface PlayerInfo {
  /** Steam64 ID（字符串，避免精度丢失） */
  steamId: string;
  /** 玩家昵称（可能随游戏内改名变化） */
  name: string;
  /** 角色名（Unturned 的 Character 名，可能为空） */
  character?: string;
  /** 首次连接时间（ISO 8601） */
  connectedAt: string;
  /** 是否管理员（来自 Commands.dat 的 Owner / 运行时 admin 命令） */
  isAdmin: boolean;
  /** 是否在黑名单（来自 Blacklist.dat） */
  isBanned: boolean;
}

/** 玩家列表响应 */
export interface PlayersResponse {
  serverId: ServerId;
  /** 当前在线玩家（日志解析，最多保留最近 100 条连接记录） */
  players: PlayerInfo[];
  /** 管理员 SteamID 列表（来自 Commands.dat / Adminlist.dat / 运行时命令） */
  adminIds: string[];
  /** 黑名单 SteamID 列表（来自 Blacklist.dat） */
  bannedIds: string[];
  /** 数据是否来自运行中的实例；STOPPED 时为 false */
  live: boolean;
}

/** 玩家操作类型 */
export type PlayerAction =
  | "admin"
  | "unadmin"
  | "kick"
  | "ban"
  | "unban";

/** 玩家操作请求 */
export interface PlayerActionRequest {
  /** Steam64 ID（字符串） */
  steamId: string;
  /** 操作类型 */
  action: PlayerAction;
  /** 封禁原因（仅 ban 使用，可选） */
  reason?: string;
  /** 封禁时长（分钟，0 = 永久；仅 ban 使用） */
  durationMinutes?: number;
}

/** 玩家操作结果 */
export interface PlayerActionResult {
  /** 是否成功下发命令 */
  ok: boolean;
  /** 给用户的中文说明 */
  message: string;
}

/** 玩家服务契约 */
export interface IPlayerService {
  /** 读取指定实例的玩家数据 */
  getPlayers(serverId: ServerId): Promise<PlayersResponse>;
  /** 执行玩家管理命令 */
  act(serverId: ServerId, request: PlayerActionRequest): Promise<PlayerActionResult>;
}
