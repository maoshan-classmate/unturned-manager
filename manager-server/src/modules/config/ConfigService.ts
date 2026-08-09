import fs from 'fs/promises';
import path from 'path';
import yaml from 'js-yaml';
import { XMLParser, XMLBuilder } from 'fast-xml-parser';
import type Database from 'better-sqlite3';
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
} from '@unturned-manager/shared';
import { logger } from '../../utils/logger.js';

// ─── 常量 ────────────────────────────────────────────────

/** 已知 Commands.dat 键（来源：CLAUDE.md §4.3 + reference_config_files.md §1） */
const KNOWN_KEYS = new Set([
  'Name', 'Port', 'MaxPlayers', 'Map', 'Mode', 'Owner',
  'Perspective', 'Chatrate', 'Cycle', 'Timeout', 'Queue_Size',
  'Filter', 'Whitelisted', 'Gold', 'Hide_Admins', 'Sync',
  'Cheats', 'GSLT', 'Log', 'Votify', 'Password', 'PvE',
]);

/** 开关型字段——出现即启用，不带 value */
const FLAG_KEYS = new Set([
  'Filter', 'Whitelisted', 'Gold', 'Hide_Admins', 'Sync', 'Cheats', 'PvE',
]);

const BACKUP_DIR = 'backups';

// ─── 实现 ────────────────────────────────────────────────

export class ConfigService implements IConfigService {
  constructor(
    private db: Database.Database,
    private fileLock: IFileLockProvider,
  ) {}

  // ── 路径解析 ──────────────────────────────────────────

  /** 从 DB 查 install_dir，拼接服务器文件路径 */
  private resolvePath(serverId: ServerId, relativePath: string): string {
    const row = this.db
      .prepare('SELECT install_dir FROM servers WHERE id = ?')
      .get(serverId) as { install_dir: string } | undefined;

    if (!row?.install_dir) {
      throw new Error(`Server ${serverId} 未配置安装路径`);
    }
    return path.join(row.install_dir, relativePath);
  }

  // ── 原子写 + 备份 + 乐观锁 ────────────────────────────

  private async atomicWrite(
    serverId: ServerId,
    filePath: string,
    content: string,
    expectedVersion?: number,
  ): Promise<void> {
    const absPath = this.resolvePath(serverId, filePath);

    // 乐观锁检查
    if (expectedVersion !== undefined) {
      const current = this.db
        .prepare('SELECT version FROM config_snapshots WHERE server_id = ? AND file_path = ? ORDER BY version DESC LIMIT 1')
        .get(serverId, filePath) as { version: number } | undefined;

      if (current && current.version !== expectedVersion) {
        throw new Error('VERSION_CONFLICT');
      }
    }

    // 获取文件锁
    await this.fileLock.acquire(absPath, 'ConfigService');

    try {
      // 备份（如果原文件存在）
      await this.backupIfExists(serverId, absPath, filePath);

      // 原子写：先写 .tmp 再 rename
      const tmpPath = absPath + '.tmp.' + Date.now();
      await fs.writeFile(tmpPath, content, 'utf-8');
      await fs.rename(tmpPath, absPath);

      // 更新版本快照
      const currentVersion = expectedVersion ?? 0;
      this.db
        .prepare('INSERT INTO config_snapshots (server_id, file_path, content, version) VALUES (?, ?, ?, ?)')
        .run(serverId, filePath, content, currentVersion + 1);

      logger.info({ serverId, filePath, version: currentVersion + 1 }, '配置文件已写入');
    } finally {
      this.fileLock.release(absPath, 'ConfigService');
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
    const absPath = this.resolvePath(serverId, 'Servers/' + serverId + '/Server/Commands.dat');

    let content: string;
    try {
      content = await fs.readFile(absPath, 'utf-8');
    } catch {
      logger.warn({ serverId, path: absPath }, 'Commands.dat 不存在，返回空记录');
      return { known: {}, unknown: {}, comments: [] };
    }

    return this.parseCommandsDat(content);
  }

  async writeCommandsDat(
    serverId: ServerId,
    record: CommandsDatRecord,
    expectedVersion?: number,
  ): Promise<void> {
    const serialized = this.serializeCommandsDat(record);
    await this.atomicWrite(
      serverId,
      'Servers/' + serverId + '/Server/Commands.dat',
      serialized,
      expectedVersion,
    );
  }

  /** 行解析：每行 `key value` 或 `key`（flag），`#`/`;` 为注释 */
  private parseCommandsDat(content: string): CommandsDatRecord {
    const known: Record<string, string> = {};
    const unknown: Record<string, string> = {};
    const comments: string[] = [];

    for (const line of content.split('\n')) {
      const trimmed = line.trim();

      // 空行跳过
      if (!trimmed) continue;

      // 注释行
      if (trimmed.startsWith('#') || trimmed.startsWith(';')) {
        comments.push(trimmed);
        continue;
      }

      // 解析 key value
      const spaceIdx = trimmed.indexOf(' ');
      if (spaceIdx === -1) {
        // 无空格：flag 型或单键
        const key = trimmed;
        if (KNOWN_KEYS.has(key)) {
          known[key] = '';
        } else {
          unknown[key] = '';
        }
      } else {
        const key = trimmed.slice(0, spaceIdx);
        const value = trimmed.slice(spaceIdx + 1).trim();
        if (KNOWN_KEYS.has(key)) {
          known[key] = value;
        } else {
          unknown[key] = value;
        }
      }
    }

    return { known, unknown, comments };
  }

  /** 序列化：comments → known → unknown，保留原始顺序 */
  private serializeCommandsDat(record: CommandsDatRecord): string {
    const lines: string[] = [];

    // 注释
    for (const c of record.comments) {
      lines.push(c);
    }

    // 已知键
    for (const [key, value] of Object.entries(record.known)) {
      if (FLAG_KEYS.has(key)) {
        lines.push(key); // flag 型不带 value
      } else {
        lines.push(key + ' ' + value);
      }
    }

    // 未知键
    for (const [key, value] of Object.entries(record.unknown)) {
      if (value) {
        lines.push(key + ' ' + value);
      } else {
        lines.push(key);
      }
    }

    return lines.join('\n') + '\n';
  }

  // ── Config.txt ────────────────────────────────────────

  async readConfigTxt(serverId: ServerId): Promise<ConfigTxtRecord> {
    const absPath = this.resolvePath(serverId, 'Servers/' + serverId + '/Config.txt');

    let content: string;
    try {
      content = await fs.readFile(absPath, 'utf-8');
    } catch {
      logger.warn({ serverId, path: absPath }, 'Config.txt 不存在，返回空记录');
      return { sections: {} };
    }

    return this.parseConfigTxt(content);
  }

  async writeConfigTxt(
    serverId: ServerId,
    record: ConfigTxtRecord,
    expectedVersion?: number,
  ): Promise<void> {
    const serialized = this.serializeConfigTxt(record);
    await this.atomicWrite(
      serverId,
      'Servers/' + serverId + '/Config.txt',
      serialized,
      expectedVersion,
    );
  }

  private parseConfigTxt(content: string): ConfigTxtRecord {
    const sections: Record<string, ConfigSection> = {};
    let currentSection: ConfigSection = { name: '_unlabeled', entries: [] };
    let hasCurrent = false;

    const flush = () => {
      if (hasCurrent && currentSection.entries.length > 0) {
        sections[currentSection.name] = currentSection;
      }
    };

    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      // 节头
      if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
        flush();
        currentSection = { name: trimmed.slice(1, -1), entries: [] };
        hasCurrent = true;
        continue;
      }

      // 注释
      if (trimmed.startsWith('>') || trimmed.startsWith('#') || trimmed.startsWith(';')) {
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
          type: 'bool',
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
      if (section.name !== '_unlabeled') {
        lines.push('[' + section.name + ']');
      }
      for (const entry of section.entries) {
        if (entry.value !== null) {
          lines.push(entry.key + ' = ' + entry.value);
        } else {
          lines.push(entry.key);
        }
      }
      lines.push(''); // 节间空行
    }
    return lines.join('\n');
  }

  private inferType(value: string): 'string' | 'bool' | 'int' {
    if (value === 'true' || value === 'false') return 'bool';
    if (/^-?\d+$/.test(value)) return 'int';
    return 'string';
  }

  // ── WorkshopDownloadConfig.json ───────────────────────

  async readWorkshopConfig(serverId: ServerId): Promise<WorkshopConfig> {
    const absPath = this.resolvePath(
      serverId,
      'Servers/' + serverId + '/Server/WorkshopDownloadConfig.json',
    );

    try {
      const raw = await fs.readFile(absPath, 'utf-8');
      return JSON.parse(raw) as WorkshopConfig;
    } catch {
      logger.warn({ serverId, path: absPath }, 'WorkshopDownloadConfig.json 不存在');
      return {
        File_IDs: [],
        Should_Monitor_Updates: true,
        Query_Cache_Max_Age_Seconds: 600,
        Max_Query_Retries: 2,
        Use_Cached_Downloads: true,
        Shutdown_Update_Detected_Timer: 600,
        Shutdown_Update_Detected_Message: 'Workshop file update detected, shutdown in: {0}',
        Shutdown_Kick_Message: 'Shutdown for Workshop file update.',
      };
    }
  }

  async writeWorkshopFileIds(
    serverId: ServerId,
    fileIds: WorkshopFileId[],
    expectedVersion?: number,
  ): Promise<void> {
    // 读取现有配置，只替换 File_IDs
    const current = await this.readWorkshopConfig(serverId);
    current.File_IDs = fileIds as string[] as WorkshopFileId[];

    await this.atomicWrite(
      serverId,
      'Servers/' + serverId + '/Server/WorkshopDownloadConfig.json',
      JSON.stringify(current, null, 2),
      expectedVersion,
    );
  }

  // ── 备份 ──────────────────────────────────────────────

  async backup(serverId: ServerId, filePath: string): Promise<string> {
    const absPath = this.resolvePath(serverId, filePath);
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = path.join(
      BACKUP_DIR,
      serverId,
      ts + '_' + path.basename(filePath),
    );

    await fs.mkdir(path.dirname(backupPath), { recursive: true });
    await fs.copyFile(absPath, backupPath);

    logger.info({ serverId, filePath, backupPath }, '配置文件已备份');
    return backupPath;
  }

  /**
   * 从备份恢复配置文件（apply 流水线失败回滚用）
   * @param backupPath - backup() 返回的相对 backups/ 路径
   */
  async rollback(serverId: ServerId, filePath: string, backupPath: string): Promise<void> {
    const absTargetPath = this.resolvePath(serverId, filePath);
    await fs.mkdir(path.dirname(absTargetPath), { recursive: true });
    await fs.copyFile(backupPath, absTargetPath);
    logger.warn({ serverId, filePath, backupPath }, '配置文件已从备份回滚');
  }

  // ── OpenMod YAML ──────────────────────────────────────

  async readOpenModConfig(
    serverId: ServerId,
    pluginId: string,
  ): Promise<Record<string, unknown>> {
    const absPath = this.resolvePath(
      serverId,
      'Servers/' + serverId + '/openmod/plugins/' + pluginId + '/config.yaml',
    );

    try {
      const raw = await fs.readFile(absPath, 'utf-8');
      return yaml.load(raw) as Record<string, unknown>;
    } catch {
      logger.warn({ serverId, pluginId, path: absPath }, 'OpenMod 插件配置不存在');
      return {};
    }
  }

  async writeOpenModConfig(
    serverId: ServerId,
    pluginId: string,
    config: Record<string, unknown>,
  ): Promise<void> {
    const yamlStr = yaml.dump(config, { indent: 2 });
    await this.atomicWrite(
      serverId,
      'Servers/' + serverId + '/openmod/plugins/' + pluginId + '/config.yaml',
      yamlStr,
    );
  }

  // ── RocketMod XML ─────────────────────────────────────

  async readRocketModConfig(
    serverId: ServerId,
    pluginName: string,
  ): Promise<Record<string, unknown>> {
    const absPath = this.resolvePath(
      serverId,
      'Servers/' + serverId + '/Rocket/Plugins/' + pluginName + '/Configuration.xml',
    );

    try {
      const raw = await fs.readFile(absPath, 'utf-8');
      const parser = new XMLParser({ ignoreAttributes: false });
      return parser.parse(raw) as Record<string, unknown>;
    } catch {
      logger.warn({ serverId, pluginName, path: absPath }, 'RocketMod 插件配置不存在');
      return {};
    }
  }

  async writeRocketModConfig(
    serverId: ServerId,
    pluginName: string,
    config: Record<string, unknown>,
  ): Promise<void> {
    const builder = new XMLBuilder({ format: true, ignoreAttributes: false });
    const xmlStr = builder.build(config) as string;
    await this.atomicWrite(
      serverId,
      'Servers/' + serverId + '/Rocket/Plugins/' + pluginName + '/Configuration.xml',
      xmlStr,
    );
  }
}
