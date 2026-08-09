import type { ServerId, WorkshopFileId } from '../types/branded.js';
import type { CommandsDatRecord, ConfigTxtRecord, WorkshopConfig } from '../types/domain.js';

export interface IConfigService {
  readCommandsDat(serverId: ServerId): Promise<CommandsDatRecord>;
  writeCommandsDat(serverId: ServerId, config: CommandsDatRecord, expectedVersion?: number): Promise<void>;

  readConfigTxt(serverId: ServerId): Promise<ConfigTxtRecord>;
  writeConfigTxt(serverId: ServerId, entries: ConfigTxtRecord, expectedVersion?: number): Promise<void>;

  // WorkshopDownloadConfig.json — 面板只写 File_IDs（CLAUDE.md §4.4）
  // 其他字段只读展示；写前自动备份
  readWorkshopConfig(serverId: ServerId): Promise<WorkshopConfig>;
  writeWorkshopFileIds(serverId: ServerId, fileIds: WorkshopFileId[], expectedVersion?: number): Promise<void>;

  backup(serverId: ServerId, filePath: string): Promise<string>;
  /**
   * 从备份恢复配置文件（apply 流水线失败回滚用）
   * @param serverId - ServerID
   * @param filePath - 相对 Servers/<ID>/ 路径
   * @param backupPath - backup() 返回的绝对路径
   */
  rollback(serverId: ServerId, filePath: string, backupPath: string): Promise<void>;

  readOpenModConfig(serverId: ServerId, pluginId: string): Promise<Record<string, unknown>>;
  writeOpenModConfig(serverId: ServerId, pluginId: string, config: Record<string, unknown>): Promise<void>;
  readRocketModConfig(serverId: ServerId, pluginName: string): Promise<Record<string, unknown>>;
  writeRocketModConfig(serverId: ServerId, pluginName: string, config: Record<string, unknown>): Promise<void>;
}
