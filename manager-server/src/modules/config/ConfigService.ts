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
import { WorkshopConfigSchema } from "@unturned-manager/shared";
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

/**
 * 面板拆写 Log/Votify 复合字段时遗留的独立子键（LogChat true / VotifyPassCooldown 5 等）。
 * U3DS 不识别这些键（Unknown entry）；面板走合成单行 Log/Votify，这些子键是脏数据——
 * 解析时直接丢弃，让下次保存自动清理文件中的残留行（保留未知键契约只适用于面板不认识的键）。
 */
const LEGACY_KEYS = new Set([
  "LogChat",
  "LogJoin",
  "LogDeath",
  "LogAnticheat",
  "VotifyAllow",
  "VotifyPassCooldown",
  "VotifyFailCooldown",
  "VotifyDuration",
  "VotifyPercentage",
  "VotifyPlayers",
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
    // ★ 255 互斥校验（D4，后端兜底）——SDK `bestowLoadout()` 是 if/else if：
    // 基础层（255）非空时跳过技能组分支，并存时技能组条目不生效。
    // 前端禁用是主防线；此处防 API 层绕过，且强制用户先消解磁盘上已存在的冲突配置。
    const loadouts = record.loadouts ?? [];
    const has255 = loadouts.some((l) => l.skillsetId === 255);
    const hasSkillset = loadouts.some((l) => l.skillsetId !== 255);
    if (has255 && hasSkillset) {
      throw new AppError(
        "loadout-mutually-exclusive",
        "「所有技能组」与具体技能组不能同时配置——具体技能组条目会被覆盖、实际不生效",
        400,
      );
    }
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

  /**
   * 解析 Config.txt（U3-SDK 原生格式，真源 DatTokenizer.cs/DatParser.cs）。
   *
   * 语法：
   * - `//` 起注释（含 U3DS 自动生成的 `// >` 默认值说明）——保留并关联到下一个 key
   * - `Section {` 起字典块，`}` 收——每个块是一个 ConfigSection
   * - 块内行首非空白 = key；key 后空格 + 非空白 = value；裸 key（无 value）= 默认值
   * - `[ ]` 列表与未知嵌套结构（如 `Links` 的 `{ Message/URL }`）——面板只读，
   *   整块捕获为 `rawLines` 保留，不进 entries，保证 round-trip 不丢
   * - `Version 1` 头跳过
   */
  private parseConfigTxt(content: string): ConfigTxtRecord {
    const sections: Record<string, ConfigSection> = {};
    let currentSection: ConfigSection = { name: "_unlabeled", entries: [] };
    let hasCurrent = false;
    let pendingComment: string | null = null;
    let pendingKey: string | null = null;
    // 待确认的区块名（`Browser` 独占一行，下一行 `{` 才确认是区块开）
    let pendingSectionKey: string | null = null;
    // 待确认区块的注释（与 pendingSectionKey 绑定，避免裸 key 注释串位）
    let pendingSectionKeyComment: string | null = null;
    // 当前 section 是否处于未知嵌套结构（[ ] 列表 / 嵌套 { } 块）内部
    let inNestedBlock = false;
    // 当前正在收集的嵌套块原始行（含块首行）
    let currentRawBlock: string[] | null = null;

    /** 把当前 section 的 entries + rawBlocks 落进 sections */
    const flushSection = () => {
      if (!hasCurrent) return;
      const raw = currentSection.rawBlocks ?? [];
      if (currentSection.entries.length > 0 || raw.length > 0) {
        // ★ 2026-08-15 Bug 修复：合并重复 key（U3-SDK DatParser.cs:145 DatDictionary 唯一 key，
        // 重复时后者覆盖前者）。真实 U3DS 写回的 Config.txt 每 section 有「基础裸 key + override 带值」
        // 双份；面板若保留双份，读取/保存只碰第一条，而 U3DS 实际读最后一条 → 用户配置被旧值覆盖
        // （启动后"变默认"）。这里与 U3DS 解析语义对齐：同 section 同 key 只保留最后一条。
        const deduped: ConfigEntry[] = [];
        for (const entry of currentSection.entries) {
          const prevIdx = deduped.findIndex((e) => e.key === entry.key);
          if (prevIdx >= 0) {
            deduped[prevIdx] = entry;
          } else {
            deduped.push(entry);
          }
        }
        currentSection.entries = deduped;
        sections[currentSection.name] = currentSection;
      }
    };

    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      // Version 头
      if (/^Version\s+\d+$/.test(trimmed)) continue;

      // 注释——累积到 pendingComment（多行合并，用 \n 连接）。
      // U3DS 自动注释是 `// > text`（`>` 标记自动生成），剥离 `// ` 前缀后文本即为注释正文
      if (trimmed.startsWith("//")) {
        const text = trimmed
          .replace(/^\/\/\s*>\s*/, "")
          .replace(/^\/\/\s*/, "")
          .trim();
        pendingComment = pendingComment ? `${pendingComment}\n${text}` : text;
        continue;
      }

      // 待确认区块：`Section` 独占一行，遇到下一行 `{` 确认是区块开
      if (pendingSectionKey !== null && !inNestedBlock && trimmed === "{") {
        flushSection();
        currentSection = { name: pendingSectionKey, entries: [] };
        hasCurrent = true;
        pendingSectionKey = null;
        pendingSectionKeyComment = null;
        pendingKey = null;
        pendingComment = null;
        continue;
      }
      if (pendingSectionKey !== null && trimmed !== "{" && trimmed !== "[") {
        // 上一行不是区块名而是普通 key——回落为裸 key entry
        const entry: ConfigEntry = {
          key: pendingSectionKey,
          value: null,
          comment: pendingSectionKeyComment,
          known: true,
          type: this.inferType(""),
        };
        currentSection.entries.push(entry);
        pendingComment = null;
        pendingSectionKey = null;
        pendingSectionKeyComment = null;
      }

      // 已知区块开 `Section {` 同行（兼容写法）
      const sectionOpen = /^(\w+)\s*\{$/.exec(trimmed);
      if (sectionOpen && !inNestedBlock) {
        flushSection();
        currentSection = { name: sectionOpen[1]!, entries: [] };
        hasCurrent = true;
        pendingKey = null;
        pendingSectionKey = null;
        pendingComment = null;
        continue;
      }

      // 嵌套结构开：pendingKey 或 pendingSectionKey 紧跟 { 或 [ —— 该 key 是列表/嵌套字典
      const nestedOwner = pendingKey ?? pendingSectionKey;
      if (
        nestedOwner !== null &&
        !inNestedBlock &&
        (trimmed === "{" || trimmed === "[")
      ) {
        inNestedBlock = true;
        // 首行 = owner + 触发符（如 `Links [` 或 `SomeKey {`）——触发符不能丢
        currentRawBlock = [`${nestedOwner} ${trimmed}`];
        pendingKey = null;
        pendingSectionKey = null;
        pendingSectionKeyComment = null;
        continue;
      }

      // 嵌套结构内部——原样收集，遇到闭合（} 或 ]）结束块
      if (inNestedBlock) {
        if (currentRawBlock) {
          currentRawBlock.push(trimmed);
        }
        if (trimmed === "}" || trimmed === "]") {
          inNestedBlock = false;
          if (currentRawBlock) {
            if (!currentSection.rawBlocks) {
              currentSection.rawBlocks = [];
            }
            currentSection.rawBlocks.push(currentRawBlock.join("\n"));
            currentRawBlock = null;
          }
        }
        continue;
      }

      // 区块收 `}`
      if (trimmed === "}") {
        flushSection();
        // 保持 hasCurrent=true：区块闭合后 root 层紧跟的散落字段（如 `VAC_Secure false`）
        // 继续归入刚结束的区块，由下一次 flush 一起 dedup 落盘；重复 flush 幂等。
        pendingKey = null;
        pendingSectionKey = null;
        pendingSectionKeyComment = null;
        continue;
      }

      // 普通行——key 或 key+value（空格分隔；引号值原样保留）。
      // 也可能是区块名（独占一行，下一行 `{`）——先记 pendingSectionKey，下轮确认
      const keyValueMatch = /^([^\s{}]+)(?:\s+(.+))?$/.exec(trimmed);
      if (keyValueMatch) {
        const key = keyValueMatch[1]!;
        const value = keyValueMatch[2] ?? null;
        if (value === null) {
          // 无值——可能是裸 key，也可能是区块名（下一行 {）。
          // 裸 key 的注释此刻就应锁定，否则 pendingComment 会串到下一个 key
          pendingSectionKey = key;
          pendingSectionKeyComment = pendingComment;
          pendingComment = null;
          pendingKey = null;
        } else {
          const entry: ConfigEntry = {
            key,
            value,
            comment: pendingComment,
            known: true,
            type: this.inferType(value),
          };
          currentSection.entries.push(entry);
          pendingComment = null;
          pendingKey = key; // 记录——下一行可能 { } / [ ]
        }
      } else {
        pendingKey = null;
        pendingSectionKey = null;
      }
    }

    // 收尾（根级 _unlabeled 若有内容也保留）
    flushSection();
    if (!hasCurrent && (sections["_unlabeled"]?.entries.length ?? 0) === 0) {
      // 根级无内容时不产生 _unlabeled 节
      delete sections["_unlabeled"];
    }
    return { sections };
  }

  /**
   * 序列化 Config.txt 为 U3-SDK 原生格式（真源 DatWriter.cs）：
   * - `Version 1` 头（首次写时；round-trip 时保留原文件版本号）
   * - 区块 `Section\n{` 名字独占一行 + 大括号另起一行（U3-SDK DatTokenizer/DatWriter 原生格式）+ Tab 缩进
   * - 裸 key（value null）= 字段名独占一行；覆盖 key = `key value`（空格分隔）
   * - entry.comment（// 注释文本）写回 `// > ...` 前缀
   * - rawBlocks（未知嵌套结构）原样还原
   */
  private serializeConfigTxt(record: ConfigTxtRecord): string {
    const lines: string[] = [];
    lines.push("Version 1");
    lines.push("");

    for (const section of Object.values(record.sections)) {
      if (section.name === "_unlabeled") {
        // 根级无明确 section 的内容——原样输出 entries（罕见）
        for (const entry of section.entries) {
          if (entry.comment) {
            lines.push(`// ${entry.comment}`);
          }
          lines.push(
            entry.key + (entry.value !== null ? ` ${entry.value}` : ""),
          );
        }
        lines.push("");
        continue;
      }

      // 区块头 = 名字独占一行 + `{` 另起一行（U3-SDK DatTokenizer/DatWriter 原生格式）。
      // `Section {` 同行会让 DatTokenizer 把 `{` 当字段值、区块不打开。
      lines.push(section.name);
      lines.push("{");
      // entries：面板认识的字段
      for (const entry of section.entries) {
        if (entry.comment) {
          // 多行注释：每行都加 // > 前缀（U3DS 自动注释格式），否则后续行变裸行
          for (const commentLine of entry.comment.split("\n")) {
            lines.push(`\t// > ${commentLine}`);
          }
        }
        lines.push(
          `\t${entry.key}${entry.value !== null ? ` ${entry.value}` : ""}`,
        );
      }
      // rawBlocks：未知嵌套结构原样还原
      for (const raw of section.rawBlocks ?? []) {
        for (const rawLine of raw.split("\n")) {
          lines.push(`\t${rawLine}`);
        }
      }
      lines.push("}");
      lines.push("");
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
      // ★ 2026-08-14 实机根因：U3DS `WorkshopDownloadConfig.cs:30` 用 `List<ulong>` 写 number，
      // Zod schema 通过 union + transform 归一为 string——避免 /mods/downloaded 的
      // `fileIdsSet.has(stringFileId)` 因类型错位永远 false。
      // 解析后 cast 为 WorkshopConfig（zod 输出 string，brand 由调用层保证）。
      return WorkshopConfigSchema.parse(JSON.parse(raw)) as WorkshopConfig;
    } catch {
      logger.warn(
        { serverId, path: absPath },
        "WorkshopDownloadConfig.json 不存在",
      );
      return {
        File_IDs: [] as WorkshopFileId[],
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
    // ★ 2026-08-14 修复：归一为 string 写盘——避免 U3DS 启动时把数字
    // 改回 number（U3DS `WorkshopDownloadConfig.cs:30` 字段为 `List<ulong>`，JSON 序列化为 number），
    // 后续面板 re-read 时 Zod transform 仍能正确转回 string，但写盘统一 string 减少歧义。
    current.File_IDs = fileIds.map(String) as WorkshopFileId[];

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
      if (LEGACY_KEYS.has(key)) continue; // 拆写遗留子键——直接丢弃
      if (KNOWN_KEYS.has(key)) {
        known[key] = "";
      } else {
        unknown[key] = "";
      }
    } else {
      const key = trimmed.slice(0, spaceIdx);
      const value = trimmed.slice(spaceIdx + 1).trim();

      // 拆写遗留子键（LogChat/VotifyPassCooldown 等）——直接丢弃，由合成单行 Log/Votify 替代
      if (LEGACY_KEYS.has(key)) continue;

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
