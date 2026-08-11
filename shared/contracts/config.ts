import type { ServerId, WorkshopFileId } from '../types/branded.js';
import type { CommandsDatRecord, ConfigTxtRecord, WorkshopConfig } from '../types/domain.js';

export interface IConfigService {
  readCommandsDat(serverId: ServerId): Promise<CommandsDatRecord>;
  /**
   * @param expectedMtime - 文件 mtime（Unix ms），客户端读时拿到、服务端写时比对——mtime 不一致抛 AppError('config_conflict')
   */
  writeCommandsDat(serverId: ServerId, config: CommandsDatRecord, expectedMtime?: number): Promise<void>;

  readConfigTxt(serverId: ServerId): Promise<ConfigTxtRecord>;
  writeConfigTxt(serverId: ServerId, entries: ConfigTxtRecord, expectedMtime?: number): Promise<void>;

  // WorkshopDownloadConfig.json — 面板只写 File_IDs（CLAUDE.md §4.4）
  // 其他字段只读展示；写前自动备份
  readWorkshopConfig(serverId: ServerId): Promise<WorkshopConfig>;
  writeWorkshopFileIds(serverId: ServerId, fileIds: WorkshopFileId[], expectedMtime?: number): Promise<void>;

  backup(serverId: ServerId, filePath: string): Promise<string>;
  /**
   * 从备份恢复配置文件（apply 流水线失败回滚用）
   * @param serverId - ServerID
   * @param filePath - 相对 Servers/<ID>/ 路径
   * @param backupPath - backup() 返回的绝对路径
   */
  rollback(serverId: ServerId, filePath: string, backupPath: string): Promise<void>;
}
