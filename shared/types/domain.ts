import type { ServerId, SteamId64, WorkshopFileId, Port } from "./branded.js";
import type { ServerState } from "./state.js";

// 服务端实例配置
export interface ServerConfig {
  id: ServerId;
  name: string;
  gamePort: Port;
  ownerSteamId: SteamId64;
  installDir: string;
  /**
   * U3DS 启动命令（ADR-0004 §6.1）。
   * Phase 2：后端用 detectStartScript 自动生成 `./ServerHelper.sh +InternetServer/<id> -ThreadedConsole`；
   * Phase 4：用户可在控制卡片编辑并持久化到 SQLite。留空 = 用默认模板。
   */
  startCommand?: string;
  /**
   * 当前运行态——服务端内存由 ServerManager.listServers 实时注入。
   * 不持久化（启动时全部初始化为 STOPPED）。前端 UI 是「内存态」的真源，
   * 避免「按钮状态错位」「Dashboard 显示 STOPPED 但实际已 RUNNING」等状态漂移。
   */
  state?: ServerState;
}

// Commands.dat 解析结果
// CLAUDE.md §4.3 硬约束：保留未知键，面板不能删除不认识的指令
// Phase 0 修复：Map → Record，JSON.stringify 兼容（C4 根因）
// Loadout 是 Commands.dat 唯一允许重复出现的已知键（每 SkillsetID 一行），
// 故独立成 loadouts 字段而不是塞进 known，避免与"已知键只能出现一次"的契约打架。
export interface CommandsDatRecord {
  known: Record<string, string>;
  unknown: Record<string, string>;
  comments: string[];
  /** Loadout 重复行结构化结果——格式：Loadout <SkillsetID>/<itemID>/<itemID>... */
  loadouts?: LoadoutEntry[];
}

/**
 * 单条 Loadout 行结构（CommandLoadout.cs:13-49 / PlayerSkills.cs:43-97）。
 * 权威约束：SkillsetID ∈ {0,1,2,3,4,5,6,7,8,9,10,255}（255 = 默认全部技能组），
 *           ItemID ∈ [0, 65535] ushort。同一 SkillsetID 多行 = 后写覆盖前写。
 */
export interface LoadoutEntry {
  /** 0–10 = 11 个技能组，255 = 默认全部技能组 */
  skillsetId: number;
  /** 该技能组开局携带的物品 ID 列表；空数组表示该技能组无物品加成 */
  itemIds: number[];
}

// Config.txt 解析结果
// Phase 0 修复：[] → Record<string, ConfigSection>，贴合前端现状（C2 根因）
export interface ConfigTxtRecord {
  sections: Record<string, ConfigSection>;
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
  type?: "string" | "bool" | "int";
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

// Workshop Mod 元数据
// v2.2: 加 authorName 字段（GetPlayerSummaries 实时补全）
export interface WorkshopModMeta {
  fileId: WorkshopFileId;
  title: string;
  author: string; // SteamID64 数字串
  authorName?: string; // 实时补全的作者昵称
  description: string;
  previewUrl?: string;
  fileSize?: number;
  updatedAt?: string;
  voteScore?: number; // 0-5 星级（Steam vote_data.score * 5）
  tags?: string[];
}

// acf 真源条目（VDF 解析结果）
export interface WorkshopAcfItem {
  fileId: WorkshopFileId;
  timeupdated: number; // Unix 时间戳（秒）
  size: number; // 字节
  manifest?: string;
}

// acf 文件整体结构
export interface WorkshopAcf {
  appid: string;
  items: Map<WorkshopFileId, WorkshopAcfItem>;
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
  owner: "read" | "write" | "none";
  group: "read" | "write" | "none";
  other: "read" | "write" | "none";
}

// SteamCMD 状态
export interface SteamCmdStatus {
  isInstalled: boolean;
  version?: string;
  installPath?: string;
  lastChecked?: string;
}

// Unturned 服务端（U3DS）安装状态——与上面的 SteamCmdStatus 是两回事：
// 前者是下载工具装没装，本类型是被下载的服务端程序装没装。
export interface U3dsStatus {
  /** Steam 应用编号，恒为 STEAM_APP_IDS.U3DS_SERVER */
  appId: string;
  /** 是否已安装——判据是安装目录下有无启动脚本 */
  isInstalled: boolean;
  /** 安装根目录 */
  installPath: string;
  /** 游戏版本号，形如 `3.24.5.0`；读不到版本文件时为 undefined */
  version?: string;
  /** 上次更新时间（ISO 字符串）；取自安装清单，回落清单文件自身修改时间 */
  lastUpdated?: string;
  /** 模组数——当前不由后端填充：模组按实例统计，而本类型是安装级 */
  modCount?: number;
}
