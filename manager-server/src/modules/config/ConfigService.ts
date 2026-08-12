import fs from "fs/promises";
import path from "path";
import type {
  ServerId,
  WorkshopFileId,
  IConfigService,
  IFileLockProvider,
  CommandsDatRecord,
  ConfigTxtRecord,
  WorkshopConfig,
  ConfigSection,
  ConfigEntry,
  LoadoutEntry,
} from "@unturned-manager/shared";
import { logger } from "../../utils/logger.js";
import { resolveServerPath } from "../server/pathResolver.js";
import { AppError } from "../../utils/AppError.js";

// ─── 常量 ────────────────────────────────────────────────

/** 已知 Commands.dat 键（来源：CLAUDE.md §4.3 + reference_config_files.md §1） */
const KNOWN_KEYS = new Set([
  "Name",
  "Port",
  "MaxPlayers",
  "Map",
  "Mode",
  "Owner",
  "Perspective",
  "Chatrate",
  "Cycle",
  "Timeout",
  "Queue_Size",
  "Filter",
  "Whitelisted",
  "Gold",
  "Hide_Admins",
  "Sync",
  "Cheats",
  "GSLT",
  "Log",
  "Votify",
  "Password",
  "PvE",
  "Bind",
  "Loadout",
]);

/** 允许重复出现的已知键——Loadout 是 Commands.dat 唯一允许重复的已知键 */
const REPEATABLE_KEYS = new Set(["Loadout"]);

/** Loadout 合法 SkillsetID（CommandLoadout.cs:22 校验：byte，255 或 ≤10） */
const VALID_LOADOUT_SKILLSET_IDS = new Set([
  0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 255,
]);

/** 开关型字段——出现即启用，不带 value */
const FLAG_KEYS = new Set([
  "Filter",
  "Whitelisted",
  "Gold",
  "Hide_Admins",
  "Sync",
  "Cheats",
  "PvE",
]);

const BACKUP_DIR = "backups";

/**
 * WorkshopDownloadConfig.json 相对 Servers/<id>/ 的路径。
 * ★ BUG-2 修复（2026-08-13 实机根因）：U3-SDK `WorkshopDownloadConfig.cs:99` 读的是
 * `ServerSavedata.fileExists("/WorkshopDownloadConfig.json")` = `Servers/<id>/WorkshopDownloadConfig.json`，
 * **没有 Server/ 子目录**。旧实现写成 `Server/WorkshopDownloadConfig.json` 导致 U3DS 永远读不到
 * 面板启用的 mod（客户端显示「创意工坊：禁用」）。
 */
const WORKSHOP_CONFIG_REL = "WorkshopDownloadConfig.json";

// ─── 实现 ────────────────────────────────────────────────

export class ConfigService implements IConfigService {
  constructor(private fileLock: IFileLockProvider) {}

  // ── 路径解析 ──────────────────────────────────────────

  /** 拼接服务器文件路径（ADR-0003 / T2：真源 = config.installDir 全局） */
  private resolvePath(serverId: ServerId, relativePath: string): string {
    return resolveServerPath(serverId, relativePath);
  }

  // ── 原子写 + 备份 + mtime 乐观锁 ───────────────────────

  /**
   * 原子写配置文件，附带 mtime 乐观锁（ADR-0003 / T3）。
   *
   * - expectedMtime 提供时，先 stat 磁盘文件 mtime；不匹配抛 AppError('config_conflict', 409)
   * - 不提供 expectedMtime 时跳过检查（兼容初始化场景）
   *
   * @throws {AppError} code=config_conflict, status=409 当 mtime 不一致
   */
  private async atomicWrite(
    serverId: ServerId,
    filePath: string,
    content: string,
    expectedMtime?: number,
  ): Promise<void> {
    const absPath = this.resolvePath(serverId, filePath);

    // mtime 乐观锁检查
    if (expectedMtime !== undefined) {
      let currentMtime: number;
      try {
        const stat = await fs.stat(absPath);
        currentMtime = Math.floor(stat.mtimeMs);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") {
          // 文件不存在但客户端要求 mtime——视为冲突
          throw new AppError(
            "config_conflict",
            "配置文件不存在，无法基于 mtime 写入",
            409,
          );
        }
        throw err;
      }

      if (currentMtime !== expectedMtime) {
        throw new AppError(
          "config_conflict",
          `配置文件已被修改：磁盘 mtime=${currentMtime}, 客户端预期=${expectedMtime}`,
          409,
        );
      }
    }

    // 获取文件锁
    await this.fileLock.acquire(absPath, "ConfigService");

    try {
      // 备份（如果原文件存在）
      await this.backupIfExists(serverId, absPath, filePath);

      // 原子写：先写 .tmp 再 rename
      const tmpPath = absPath + ".tmp." + Date.now();
      await fs.writeFile(tmpPath, content, "utf-8");
      await fs.rename(tmpPath, absPath);

      logger.info({ serverId, filePath }, "配置文件已写入");
    } finally {
      this.fileLock.release(absPath, "ConfigService");
    }
  }

  private async backupIfExists(
    serverId: ServerId,
    absPath: string,
    logicalPath: string,
  ): Promise<void> {
    try {
      await fs.access(absPath);
    } catch {
      return; // 文件不存在，无需备份
    }
    await this.backup(serverId, logicalPath);
  }

  // ── Commands.dat ──────────────────────────────────────

  async readCommandsDat(serverId: ServerId): Promise<CommandsDatRecord> {
    const absPath = this.resolvePath(serverId, "Server/Commands.dat");

    let content: string;
    try {
      content = await fs.readFile(absPath, "utf-8");
    } catch {
      logger.warn(
        { serverId, path: absPath },
        "Commands.dat 不存在，返回空记录",
      );
      return { known: {}, unknown: {}, comments: [], loadouts: [] };
    }

    return parseCommandsDatContent(content);
  }

  async writeCommandsDat(
    serverId: ServerId,
    record: CommandsDatRecord,
    expectedMtime?: number,
  ): Promise<void> {
    const serialized = this.serializeCommandsDat(record);
    await this.atomicWrite(
      serverId,
      "Server/Commands.dat",
      serialized,
      expectedMtime,
    );
  }

  /** 序列化：comments → known → loadouts → unknown，保留原始顺序 */
  private serializeCommandsDat(record: CommandsDatRecord): string {
    const lines: string[] = [];

    // 注释
    for (const c of record.comments) {
      lines.push(c);
    }

    // 已知键（Loadout 从 known 中拿出，留到下面统一序列化）
    for (const [key, value] of Object.entries(record.known)) {
      if (REPEATABLE_KEYS.has(key)) continue; // Loadout 在 loadouts 段统一输出
      if (FLAG_KEYS.has(key)) {
        lines.push(key); // flag 型不带 value
      } else {
        lines.push(key + " " + value);
      }
    }

    // Loadout 重复行——每行：Loadout <SkillsetID>/<itemID>/<itemID>/...
    // 同 SkillsetID 多行由面板去重处理（U3DS 后写覆盖前写——面板策略：每 ID 一行）
    if (record.loadouts && record.loadouts.length > 0) {
      for (const entry of record.loadouts) {
        if (!VALID_LOADOUT_SKILLSET_IDS.has(entry.skillsetId)) {
          logger.warn(
            { serverId: "unknown", skillsetId: entry.skillsetId },
            "Loadout 序列化跳过非法 SkillsetID（CommandLoadout.cs:22 约束）",
          );
          continue;
        }
        const parts = [String(entry.skillsetId), ...entry.itemIds.map(String)];
        lines.push("Loadout " + parts.join("/"));
      }
    }

    // 未知键
    for (const [key, value] of Object.entries(record.unknown)) {
      if (value) {
        lines.push(key + " " + value);
      } else {
        lines.push(key);
      }
    }

    return lines.join("\n") + "\n";
  }

  // ── Config.txt ────────────────────────────────────────

  async readConfigTxt(serverId: ServerId): Promise<ConfigTxtRecord> {
    const absPath = this.resolvePath(serverId, "Config.txt");

    let content: string;
    try {
      content = await fs.readFile(absPath, "utf-8");
    } catch {
      logger.warn({ serverId, path: absPath }, "Config.txt 不存在，返回空记录");
      return { sections: {} };
    }

    return this.parseConfigTxt(content);
  }

  async writeConfigTxt(
    serverId: ServerId,
    record: ConfigTxtRecord,
    expectedMtime?: number,
  ): Promise<void> {
    const serialized = this.serializeConfigTxt(record);
    await this.atomicWrite(serverId, "Config.txt", serialized, expectedMtime);
  }

  private parseConfigTxt(content: string): ConfigTxtRecord {
    const sections: Record<string, ConfigSection> = {};
    let currentSection: ConfigSection = { name: "_unlabeled", entries: [] };
    let hasCurrent = false;

    const flush = () => {
      if (hasCurrent && currentSection.entries.length > 0) {
        sections[currentSection.name] = currentSection;
      }
    };

    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      // 节头
      if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
        flush();
        currentSection = { name: trimmed.slice(1, -1), entries: [] };
        hasCurrent = true;
        continue;
      }

      // 注释
      if (
        trimmed.startsWith(">") ||
        trimmed.startsWith("#") ||
        trimmed.startsWith(";")
      ) {
        continue; // 注释不保留在结构化数据中（可在后续增强）
      }

      // 键值对
      const sepMatch = /^([^=:]+)[=:]\s*(.*)$/.exec(trimmed);
      if (sepMatch) {
        const key = sepMatch[1]!.trim();
        const value = sepMatch[2]!.trim();
        const entry: ConfigEntry = {
          key,
          value: value || null,
          comment: null,
          known: true,
          type: this.inferType(value),
        };
        currentSection.entries.push(entry);
      } else {
        // 可能是裸键（布尔开关）
        const entry: ConfigEntry = {
          key: trimmed,
          value: null,
          comment: null,
          known: false,
          type: "bool",
        };
        currentSection.entries.push(entry);
      }
    }

    flush();
    return { sections };
  }

  private serializeConfigTxt(record: ConfigTxtRecord): string {
    const lines: string[] = [];
    for (const section of Object.values(record.sections)) {
      if (section.name !== "_unlabeled") {
        lines.push("[" + section.name + "]");
      }
      for (const entry of section.entries) {
        if (entry.value !== null) {
          lines.push(entry.key + " = " + entry.value);
        } else {
          lines.push(entry.key);
        }
      }
      lines.push(""); // 节间空行
    }
    return lines.join("\n");
  }

  private inferType(value: string): "string" | "bool" | "int" {
    if (value === "true" || value === "false") return "bool";
    if (/^-?\d+$/.test(value)) return "int";
    return "string";
  }

  // ── WorkshopDownloadConfig.json ───────────────────────

  async readWorkshopConfig(serverId: ServerId): Promise<WorkshopConfig> {
    const absPath = this.resolvePath(serverId, WORKSHOP_CONFIG_REL);

    // ★ BUG-2：U3-SDK 读 Servers/<id>/WorkshopDownloadConfig.json（无 Server/ 层）。
    // 旧面板在 Server/ 子目录的残留文件 U3DS 不读——不做迁移，由 U3DS 在根自动生成。
    try {
      const raw = await fs.readFile(absPath, "utf-8");
      return JSON.parse(raw) as WorkshopConfig;
    } catch {
      logger.warn(
        { serverId, path: absPath },
        "WorkshopDownloadConfig.json 不存在",
      );
      return {
        File_IDs: [],
        Should_Monitor_Updates: true,
        Query_Cache_Max_Age_Seconds: 600,
        Max_Query_Retries: 2,
        Use_Cached_Downloads: true,
        Shutdown_Update_Detected_Timer: 600,
        Shutdown_Update_Detected_Message:
          "Workshop file update detected, shutdown in: {0}",
        Shutdown_Kick_Message: "Shutdown for Workshop file update.",
      };
    }
  }

  async writeWorkshopFileIds(
    serverId: ServerId,
    fileIds: WorkshopFileId[],
    expectedMtime?: number,
  ): Promise<void> {
    // 读取现有配置，只替换 File_IDs
    const current = await this.readWorkshopConfig(serverId);
    current.File_IDs = fileIds as string[] as WorkshopFileId[];

    await this.atomicWrite(
      serverId,
      WORKSHOP_CONFIG_REL,
      JSON.stringify(current, null, 2),
      expectedMtime,
    );
  }

  // ── 备份 ──────────────────────────────────────────────

  async backup(serverId: ServerId, filePath: string): Promise<string> {
    const absPath = this.resolvePath(serverId, filePath);
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const backupPath = path.join(
      BACKUP_DIR,
      serverId,
      ts + "_" + path.basename(filePath),
    );

    await fs.mkdir(path.dirname(backupPath), { recursive: true });
    await fs.copyFile(absPath, backupPath);

    logger.info({ serverId, filePath, backupPath }, "配置文件已备份");
    return backupPath;
  }

  /**
   * 从备份恢复配置文件（apply 流水线失败回滚用）
   * @param backupPath - backup() 返回的相对 backups/ 路径
   */
  async rollback(
    serverId: ServerId,
    filePath: string,
    backupPath: string,
  ): Promise<void> {
    const absTargetPath = this.resolvePath(serverId, filePath);
    await fs.mkdir(path.dirname(absTargetPath), { recursive: true });
    await fs.copyFile(backupPath, absTargetPath);
    logger.warn({ serverId, filePath, backupPath }, "配置文件已从备份回滚");
  }
}

// ─── Commands.dat 行解析（导出纯函数——ServerDiscovery 复用）──────────────

/**
 * 解析 Commands.dat 文本（ADR-0003 B2 §3.1：ServerDiscovery 身份读取复用）。
 * 行语义：`key value` 或单独 `key`（flag 型）；`#`/`;` 起注释。
 * 硬约束：保留未知键——面板不能删除不认识的指令（CLAUDE.md §4.3）。
 * Loadout 是唯一允许重复出现的已知键——每行解析为独立 LoadoutEntry。
 *
 * @param content - Commands.dat 原始文本
 * @returns 结构化记录 { known, unknown, comments, loadouts }
 */
export function parseCommandsDatContent(content: string): CommandsDatRecord {
  const known: Record<string, string> = {};
  const unknown: Record<string, string> = {};
  const comments: string[] = [];
  const loadouts: LoadoutEntry[] = [];

  for (const line of content.split("\n")) {
    const trimmed = line.trim();

    // 空行跳过
    if (!trimmed) continue;

    // 注释行
    if (trimmed.startsWith("#") || trimmed.startsWith(";")) {
      comments.push(trimmed);
      continue;
    }

    // 解析 key value
    const spaceIdx = trimmed.indexOf(" ");
    if (spaceIdx === -1) {
      // 无空格：flag 型或单键
      const key = trimmed;
      if (KNOWN_KEYS.has(key)) {
        known[key] = "";
      } else {
        unknown[key] = "";
      }
    } else {
      const key = trimmed.slice(0, spaceIdx);
      const value = trimmed.slice(spaceIdx + 1).trim();

      // Loadout 重复行——结构化解析（CommandLoadout.cs:13-49）
      if (key === "Loadout") {
        const parsed = parseLoadoutLine(value);
        if (parsed) loadouts.push(parsed);
        continue; // 不进 known，Loadout 走 loadouts 数组
      }

      if (KNOWN_KEYS.has(key)) {
        known[key] = value;
      } else {
        unknown[key] = value;
      }
    }
  }

  return { known, unknown, comments, loadouts };
}

/**
 * 解析单条 Loadout 行（CommandLoadout.cs:13-49 / PlayerSkills.cs:43-97）。
 * 格式：`SkillsetID/itemID/itemID/...`——第一个段是 byte SkillsetID，
 * 其余段是 ushort ItemID。非法行返回 null（解析失败但保留为注释式丢弃）。
 *
 * @param value - Loadout 行 value 部分（已去掉 'Loadout ' 前缀）
 * @returns LoadoutEntry 或 null（非法格式）
 */
function parseLoadoutLine(value: string): LoadoutEntry | null {
  if (!value) return null;
  const parts = value.split("/");
  if (parts.length < 1) return null;

  const skillsetId = Number(parts[0]);
  if (!Number.isInteger(skillsetId) || skillsetId < 0 || skillsetId > 255)
    return null;
  if (skillsetId !== 255 && skillsetId > 10) return null; // CommandLoadout.cs:22 校验

  const itemIds: number[] = [];
  for (let i = 1; i < parts.length; i++) {
    const id = Number(parts[i]);
    if (!Number.isInteger(id) || id < 0 || id > 65535) return null; // ushort 校验
    itemIds.push(id);
  }

  return { skillsetId, itemIds };
}
