import fs from 'fs/promises';
import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import type Database from 'better-sqlite3';
import type {
  ServerId,
  WorkshopFileId,
  IWorkshopApplyService,
  IWorkshopAcfService,
  IConfigService,
  IBroadcaster,
} from '@unturned-manager/shared';
import { logger } from '../../utils/logger.js';

const execFileAsync = promisify(execFile);

const U3DS_APPID = '1110390';

/** staging acf 内容目录（SteamCMD 下载后落点） */
const STAGING_CONTENT_SUBDIR = path.join('Workshop', 'staging', 'steamapps', 'workshop', 'content', U3DS_APPID);

/** content acf 内容目录（U3DS 启动读取） */
const CONTENT_SUBDIR = path.join('Workshop', 'steamapps', 'workshop', 'content', U3DS_APPID);

/** WorkshopDownloadConfig.json 相对路径 */
const WORKSHOP_CONFIG_REL = path.join('Workshop', 'WorkshopDownloadConfig.json');

/**
 * apply 流水线服务——在 ServerManager.applyModChanges 流水线内、U3DS 已 STOPPED 时调用
 *
 * 9 步流程：
 *  1. 备份 WorkshopDownloadConfig.json（SOP 铁律）
 *  2. 备份 acf
 *  3. 解析 staging acf → 拿 mod 元数据
 *  4. acf.addItem（addItem 内部自带备份 + 回滚）
 *  5. 原子写 content/acf（addItem 已完成）
 *  6. mv staging/content/<id>/ → content/<id>/
 *  7. 解析 content/acf → 拿最新 File_IDs
 *  8. writeWorkshopFileIds
 *  9. 任一失败 → 全部回滚（acf 备份 + Config 备份）
 */
export class WorkshopApplyService implements IWorkshopApplyService {
  constructor(
    private db: Database.Database,
    private acfService: IWorkshopAcfService,
    private configService: IConfigService,
    private broadcaster: IBroadcaster,
  ) {}

  async applyStaged(serverId: ServerId): Promise<void> {
    // ── ① 备份 WorkshopDownloadConfig.json ──
    const configBackupPath = await this.configService.backup(serverId, WORKSHOP_CONFIG_REL);

    // ── ② 备份 acf（仅当 acf 存在时；新装时 acf 可能还不存在）──
    let acfBackupPath: string | null = null;
    const acfItems = await this.acfService.listItems(serverId);
    try {
      acfBackupPath = await this.acfService.backup(serverId);
    } catch (err) {
      // acf 不存在不算错（首次 apply）
      logger.info({ serverId }, 'acf 不存在，跳过备份');
    }

    try {
      // ── ③ 解析 staging acf → 拿所有 mod 元数据 ──
      const { acf: stagingAcf } = await this.parseStagingAcf(serverId);
      if (stagingAcf.items.size === 0) {
        logger.warn({ serverId }, 'staging acf 为空，无可应用的 mod');
        return;
      }

      // ── ④-⑤ acf.addItem（每个新 mod）──
      // 先 addItem 全部，再 mv，最后同步 File_IDs
      for (const [fileId, item] of stagingAcf.items) {
        if (!acfItems.some((existing) => existing.fileId === fileId)) {
          await this.acfService.addItem(serverId, fileId as WorkshopFileId, item);
          logger.info({ serverId, fileId, size: item.size }, 'staging mod → content acf');
        }
      }

      // ── ⑥ mv staging/content/<id>/ → content/<id>/ ──
      const { installDir, stagingDir, contentDir } = await this.resolvePaths(serverId);
      for (const fileId of stagingAcf.items.keys()) {
        const src = path.join(stagingDir, fileId);
        const dst = path.join(contentDir, fileId);
        await this.moveDir(src, dst);
        logger.info({ serverId, fileId }, 'staging content → content');
      }

      // ── ⑦ 重新读 acf 拿最新 items ──
      const finalAcf = await this.acfService.parse(serverId);

      // ── ⑧ writeWorkshopFileIds ──
      const fileIds = Array.from(finalAcf.items.keys()) as WorkshopFileId[];
      await this.configService.writeWorkshopFileIds(serverId, fileIds);

      this.broadcaster.broadcast({
        type: 'mod_apply_progress',
        serverId,
        stage: 'ready',
        message: `${fileIds.length} 个 mod 已应用`,
      } as never);

      logger.info({ serverId, count: fileIds.length }, 'apply 流水线完成');

      // installDir 保留供未来扩展使用（无操作仅消 unused）
      void installDir;
    } catch (err) {
      // ── ⑨ 失败回滚 ──
      logger.error({ err, serverId }, 'apply 流水线失败，开始回滚');
      if (acfBackupPath) {
        try {
          await this.acfService.rollback(serverId, acfBackupPath);
        } catch (rollbackErr) {
          logger.error({ rollbackErr, serverId }, 'acf 回滚失败');
        }
      }
      try {
        await this.configService.rollback(serverId, WORKSHOP_CONFIG_REL, configBackupPath);
      } catch (rollbackErr) {
        logger.error({ rollbackErr, serverId }, 'WorkshopDownloadConfig.json 回滚失败');
      }
      this.broadcaster.broadcast({
        type: 'mod_apply_progress',
        serverId,
        stage: 'failed',
        message: err instanceof Error ? err.message : 'unknown',
      } as never);
      throw err;
    }
  }

  // ── 私有 ────────────────────────────────────────────

  /**
   * 读 staging acf → 直接解析（不经过 AcfService，因为 staging 路径不同）
   */
  private async parseStagingAcf(serverId: ServerId): Promise<{ acf: { items: Map<string, { fileId: WorkshopFileId; timeupdated: number; size: number; manifest?: string }> } }> {
    // 收集所有 staging 中已下载的 mod（acf 给元数据 + content/ 目录给存在性）
    const { stagingDir, installDir } = await this.resolvePaths(serverId);
    const stagingAcfPath = path.join(installDir, 'Servers', serverId, 'Workshop', 'staging', 'steamapps', 'workshop', `appworkshop_${U3DS_APPID}.acf`);

    let content: string;
    try {
      content = await fs.readFile(stagingAcfPath, 'utf-8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return { acf: { items: new Map() } };
      }
      throw err;
    }

    // 复用 VdfParser 解析
    const { parseVdf } = await import('./VdfParser.js');
    const parsed = parseVdf(content);
    const root = parsed.AppWorkshop as Record<string, unknown> | undefined;
    const installed = (root?.WorkshopItemsInstalled ?? {}) as Record<string, Record<string, string>>;
    const items = new Map<WorkshopFileId, { fileId: WorkshopFileId; timeupdated: number; size: number; manifest?: string }>();
    for (const [fileId, meta] of Object.entries(installed)) {
      // 仅保留 content/ 目录里真正存在的（避免 acf 残留）
      try {
        await fs.access(path.join(stagingDir, fileId));
      } catch {
        continue;
      }
      const timeupdated = parseInt(meta.timeupdated ?? '0', 10);
      const size = parseInt(meta.size ?? '0', 10);
      const manifest = meta.manifest;
      items.set(fileId as WorkshopFileId, {
        fileId: fileId as WorkshopFileId,
        timeupdated: Number.isFinite(timeupdated) ? timeupdated : 0,
        size: Number.isFinite(size) ? size : 0,
        ...(typeof manifest === 'string' ? { manifest } : {}),
      });
    }
    return { acf: { items } };
  }

  /**
   * 跨设备的目录移动：先尝试 rename，失败降级 cp -r + rm
   */
  private async moveDir(src: string, dst: string): Promise<void> {
    // 如果 dst 已存在，先删（U3DS 内容目录是 mod 的数据目录，不存在冲突）
    if (await this.fileExists(dst)) {
      await fs.rm(dst, { recursive: true, force: true });
    }
    try {
      await fs.rename(src, dst);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== 'EXDEV') throw err;
      // 跨设备降级
      await execFileAsync('cp', ['-r', src, dst]);
      await fs.rm(src, { recursive: true, force: true });
    }
  }

  private async fileExists(p: string): Promise<boolean> {
    try {
      await fs.access(p);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 从 DB 查 install_dir，拼 staging / content 绝对路径
   */
  private async resolvePaths(serverId: ServerId): Promise<{ installDir: string; stagingDir: string; contentDir: string }> {
    const row = this.db
      .prepare('SELECT install_dir FROM servers WHERE id = ?')
      .get(serverId) as { install_dir: string } | undefined;
    if (!row?.install_dir) {
      throw new Error(`Server ${serverId} 未配置 install_dir`);
    }
    const installDir = row.install_dir;
    const serverDir = path.join(installDir, 'Servers', serverId);
    return {
      installDir,
      stagingDir: path.join(serverDir, STAGING_CONTENT_SUBDIR),
      contentDir: path.join(serverDir, CONTENT_SUBDIR),
    };
  }
}
