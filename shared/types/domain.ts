import type { ServerId, SteamId64, WorkshopFileId, Port } from './branded.js';

// 服务端实例配置
export interface ServerConfig {
  id: ServerId;
  name: string;
  gamePort: Port;
  ownerSteamId: SteamId64;
  installDir: string;
  rconPassword?: string;
}

// Commands.dat 解析结果
// CLAUDE.md §4.3 硬约束：保留未知键，面板不能删除不认识的指令
export interface CommandsDatRecord {
  known: Map<string, string>;
  unknown: Map<string, string>;
  comments: string[];
}

// Config.txt 解析结果
export interface ConfigTxtRecord {
  sections: ConfigSection[];
}

export interface ConfigSection {
  name: string;
  entries: ConfigEntry[];
}

export interface ConfigEntry {
  key: string;
  value: string | null;
  comment: string | null;
  known: boolean;
  type?: 'string' | 'bool' | 'int';
}

// WorkshopDownloadConfig.json
export interface WorkshopConfig {
  File_IDs: WorkshopFileId[];
  Should_Monitor_Updates: boolean;
  Query_Cache_Max_Age_Seconds: number;
  Max_Query_Retries: number;
  Use_Cached_Downloads: boolean;
  Shutdown_Update_Detected_Timer: number;
  Shutdown_Update_Detected_Message: string;
  Shutdown_Kick_Message: string;
}

// A2S 查询结果
export interface A2SInfo {
  players: number;
  maxPlayers: number;
  map: string;
  version: string;
  latency: number;
}

// Workshop Mod 元数据
export interface WorkshopModMeta {
  fileId: WorkshopFileId;
  title: string;
  author: string;
  description: string;
  previewUrl?: string;
  fileSize?: number;
  updatedAt?: string;
  tags?: string[];
}

// 文件条目
export interface FileEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number;
  modifiedAt: string;
}

export interface FilePermissions {
  owner: 'read' | 'write' | 'none';
  group: 'read' | 'write' | 'none';
  other: 'read' | 'write' | 'none';
}

// SteamCMD 状态
export interface SteamCmdStatus {
  isInstalled: boolean;
  version?: string;
  installPath?: string;
  lastChecked?: string;
}
