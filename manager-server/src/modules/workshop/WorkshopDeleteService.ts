import fs from 'fs/promises';
import path from 'path';
import type Database from 'better-sqlite3';
import type {
  ServerId,
  WorkshopFileId,
  IWorkshopDeleteService,
  IWorkshopAcfService,
  IConfigService,
  ModDeleteResult,
} from '@unturned-manager/shared';
import { logger } from '../../utils/logger.js';

const U3DS_APPID = '1110390';

/** content 目录（U3DS 实际加载的 mod 位置） */
const CONTENT_SUBDIR = path.join('Workshop', 'steamapps', 'workshop', 'content', U3DS_APPID);

/** WorkshopDownloadConfig.json 相对路径 */
const WORKSHOP_CONFIG_REL = path.join('Workshop', 'WorkshopDownloadConfig.json');

/**
 * Mod 删除服务——acf + content + File_IDs 三处同步
 *
 * 前置条件：U3DS 已 STOPPED（routes 层校验 activeOperation）
 */
export class WorkshopDeleteService implements IWorkshopDeleteService {
  constructor(
    private db: Database.Database,
    private acfService: IWorkshopAcfService,
    private configService: IConfigService,
  ) {}

  /**
   * 删除单个 Mod（acf 删项 + content 目录删 + File_IDs 同步）
   * 任一失败 → 全部回滚
   */
  async deleteMod(serverId: ServerId, fileId: WorkshopFileId): Promise<ModDeleteResult> {
    const removedFrom: Array<'acf' | 'content' | 'file_ids'> = [];

    // 备份 WorkshopDownloadConfig.json（File_IDs 写前备份）
    let configBackupPath: string | null = null;
    try {
      configBackupPath = await this.configService.backup(serverId, WORKSHOP_CONFIG_REL);
    } catch (err) {
      // Config 不存在时无法备份（首次删除），跳过
      logger.info({ serverId }, 'WorkshopDownloadConfig.json 不存在，跳过备份');
    }

    // 备份 acf（如存在）
    let acfBackupPath: string | null = null;
    const acfItems = await this.acfService.listItems(serverId);
    const inAcf = acfItems.some((item) => item.fileId === fileId);
    if (inAcf) {
      try {
        acfBackupPath = await this.acfService.backup(serverId);
      } catch (err) {
        logger.error({ err, serverId }, 'acf 备份失败，终止删除');
        throw err;
      }
    }

    try {
      // ① acf 删项
      if (inAcf) {
        await this.acfService.removeItem(serverId, fileId);
        removedFrom.push('acf');
      }

      // ② 删 content/<id>/ 目录
      const contentDir = await this.resolveContentDir(serverId, fileId);
      if (await this.fileExists(contentDir)) {
        await fs.rm(contentDir, { recursive: true, force: true });
        removedFrom.push('content');
        logger.info({ serverId, fileId, contentDir }, 'content 目录已删');
      }

      // ③ 更新 File_IDs（从 acf 重新读最新列表）
      if (configBackupPath !== null) {
        const finalAcf = await this.acfService.parse(serverId);
        const fileIds = Array.from(finalAcf.items.keys()) as WorkshopFileId[];
        await this.configService.writeWorkshopFileIds(serverId, fileIds);
        removedFrom.push('file_ids');
      }

      logger.info({ serverId, fileId, removedFrom }, 'Mod 已删除');
      return { success: true, fileId, removedFrom };
    } catch (err) {
      // 失败回滚
      logger.error({ err, serverId, fileId }, 'Mod 删除失败，开始回滚');
      if (acfBackupPath) {
        try {
          await this.acfService.rollback(serverId, acfBackupPath);
        } catch (rollbackErr) {
          logger.error({ rollbackErr, serverId }, 'acf 回滚失败');
        }
      }
      if (configBackupPath !== null) {
        try {
          await this.configService.rollback(serverId, WORKSHOP_CONFIG_REL, configBackupPath);
        } catch (rollbackErr) {
          logger.error({ rollbackErr, serverId }, 'WorkshopDownloadConfig.json 回滚失败');
        }
      }
      throw err;
    }
  }

  // ── 私有 ────────────────────────────────────────────

  /**
   * 从 DB 查 install_dir，拼 content/<id>/ 绝对路径
   */
  private async resolveContentDir(serverId: ServerId, fileId: WorkshopFileId): Promise<string> {
    const row = this.db
      .prepare('SELECT install_dir FROM servers WHERE id = ?')
      .get(serverId) as { install_dir: string } | undefined;
    if (!row?.install_dir) {
      throw new Error(`Server ${serverId} 未配置 install_dir`);
    }
    return path.join(row.install_dir, 'Servers', serverId, CONTENT_SUBDIR, fileId);
  }

  private async fileExists(p: string): Promise<boolean> {
    try {
      await fs.access(p);
      return true;
    } catch {
      return false;
    }
  }
}
