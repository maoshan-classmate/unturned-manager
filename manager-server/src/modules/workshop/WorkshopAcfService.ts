import fs from 'fs/promises';
import path from 'path';
import type Database from 'better-sqlite3';
import type {
  ServerId,
  WorkshopFileId,
  IWorkshopAcfService,
  WorkshopAcf,
  WorkshopAcfItem,
  IConfigService,
} from '@unturned-manager/shared';
import { parseVdf, serializeVdf, VdfParseError, VdfSerializeError } from './VdfParser.js';
import { logger } from '../../utils/logger.js';

// ─── 常量 ────────────────────────────────────────────────

/** U3DS AppID（WorkshopDownloadConfig + acf 命名都用此 ID） */
const U3DS_APPID = '1110390';

/** acf 文件相对 Servers/<ID>/ 目录的路径 */
const WORKSHOP_ACF_REL_PATH = path.join('Workshop', 'steamapps', 'workshop', `appworkshop_${U3DS_APPID}.acf`);

/** staging 目录 acf（SteamCMD 下载完成后生成） */
const STAGING_ACF_REL_PATH = path.join('Workshop', 'staging', 'steamapps', 'workshop', `appworkshop_${U3DS_APPID}.acf`);

/** acf 根 key（VDF 格式约束：根必须只有一个 key） */
const ACF_ROOT_KEY = 'AppWorkshop';

// ─── 实现 ────────────────────────────────────────────────

/**
 * Workshop acf 真源维护服务
 *
 * 职责（对齐 DST utils/acf.go）：
 * - 读盘 + 解析 acf 文件（每次实时，无缓存）
 * - 添加/删除 mod 项
 * - 原子写 + 自动备份
 * - 失败回滚
 *
 * 路径：`Servers/<ID>/Workshop/steamapps/workshop/appworkshop_1110390.acf`
 */
export class WorkshopAcfService implements IWorkshopAcfService {
  constructor(
    private db: Database.Database,
    private configService: IConfigService,
  ) {}

  // ─── 公开方法 ────────────────────────────────────────

  /**
   * 读盘 + 解析 acf 文件
   * @throws {VdfParseError} acf 文件损坏
   * @returns WorkshopAcf 对象；acf 不存在时返回空 acf
   */
  async parse(serverId: ServerId): Promise<WorkshopAcf> {
    const acfPath = await this.resolveAcfPath(serverId);
    let content: string;
    try {
      content = await fs.readFile(acfPath, 'utf-8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        // acf 不存在 = 空 acf
        return { appid: U3DS_APPID, items: new Map() };
      }
      throw err;
    }
    return this.parseContent(content);
  }

  /**
   * 原子写 acf + 自动备份（先 .bak.<UTC-ISO> 再覆盖原文件）
   *
   * @throws {VdfSerializeError} 序列化失败
   */
  async write(serverId: ServerId, acf: WorkshopAcf): Promise<void> {
    const acfPath = await this.resolveAcfPath(serverId);
    // 备份原文件
    if (await this.fileExists(acfPath)) {
      await this.backupFile(acfPath);
    }
    const content = serializeVdf({ [ACF_ROOT_KEY]: { appid: acf.appid, WorkshopItemsInstalled: this.itemsToVdf(acf.items) } });
    // 写临时文件 + rename 原子
    const tmpPath = `${acfPath}.tmp.${Date.now()}`;
    await fs.writeFile(tmpPath, content, { encoding: 'utf-8', mode: 0o644 });
    await fs.rename(tmpPath, acfPath);
    logger.info({ serverId, itemCount: acf.items.size }, 'acf 已原子写');
  }

  /**
   * 列出全部已下载 mod（read → parse）
   */
  async listItems(serverId: ServerId): Promise<WorkshopAcfItem[]> {
    const acf = await this.parse(serverId);
    return Array.from(acf.items.values());
  }

  /**
   * 读 staging 目录的 acf，提取单个 mod 的元数据（下载完成后调）
   * @returns 单个 mod 的 acf 元数据；mod 不在 staging acf 中则返回 null
   */
  async parseStagingItem(serverId: ServerId, fileId: WorkshopFileId): Promise<WorkshopAcfItem | null> {
    const stagingAcfPath = await this.resolveStagingAcfPath(serverId);
    let content: string;
    try {
      content = await fs.readFile(stagingAcfPath, 'utf-8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        logger.warn({ serverId, fileId }, 'staging acf 不存在，下载可能未完成');
        return null;
      }
      throw err;
    }
    const acf = this.parseContent(content);
    return acf.items.get(fileId) ?? null;
  }

  /**
   * 添加 mod 到 acf（apply 流水线内调用）
   * 先备份原 acf，写失败回滚
   */
  async addItem(serverId: ServerId, fileId: WorkshopFileId, meta: WorkshopAcfItem): Promise<void> {
    const acf = await this.parse(serverId);
    const before = acf.items.get(fileId);
    acf.items.set(fileId, meta);
    try {
      await this.write(serverId, acf);
    } catch (err) {
      // 写失败 → 回滚
      if (before !== undefined) {
        acf.items.set(fileId, before);
      } else {
        acf.items.delete(fileId);
      }
      throw err;
    }
    logger.info({ serverId, fileId, size: meta.size }, 'acf 添加 mod');
  }

  /**
   * 从 acf 删除项（delete 端点调用）
   */
  async removeItem(serverId: ServerId, fileId: WorkshopFileId): Promise<void> {
    const acf = await this.parse(serverId);
    if (!acf.items.has(fileId)) {
      return; // 已不存在，幂等
    }
    const before = acf.items.get(fileId)!;
    acf.items.delete(fileId);
    try {
      await this.write(serverId, acf);
    } catch (err) {
      acf.items.set(fileId, before);
      throw err;
    }
    logger.info({ serverId, fileId }, 'acf 删除 mod');
  }

  /**
   * 手动备份 acf（apply 流水线前置）
   * @returns 备份文件绝对路径
   */
  async backup(serverId: ServerId): Promise<string> {
    const acfPath = await this.resolveAcfPath(serverId);
    if (!(await this.fileExists(acfPath))) {
      throw new Error(`acf 不存在，无法备份：${acfPath}`);
    }
    return this.backupFile(acfPath);
  }

  /**
   * 失败回滚——从备份恢复 acf
   */
  async rollback(serverId: ServerId, backupPath: string): Promise<void> {
    const acfPath = await this.resolveAcfPath(serverId);
    if (!(await this.fileExists(backupPath))) {
      throw new Error(`备份文件不存在：${backupPath}`);
    }
    await fs.copyFile(backupPath, acfPath);
    logger.warn({ serverId, backupPath }, 'acf 已从备份回滚');
  }

  // ─── 私有 ────────────────────────────────────────────

  /**
   * 从 servers 表查 install_dir，拼 acf 绝对路径
   */
  private async resolveAcfPath(serverId: ServerId): Promise<string> {
    const row = this.db
      .prepare('SELECT install_dir FROM servers WHERE id = ?')
      .get(serverId) as { install_dir: string } | undefined;
    if (!row?.install_dir) {
      throw new Error(`Server ${serverId} 未配置 install_dir`);
    }
    return path.join(row.install_dir, 'Servers', serverId, WORKSHOP_ACF_REL_PATH);
  }

  /**
   * staging acf 路径
   */
  private async resolveStagingAcfPath(serverId: ServerId): Promise<string> {
    const row = this.db
      .prepare('SELECT install_dir FROM servers WHERE id = ?')
      .get(serverId) as { install_dir: string } | undefined;
    if (!row?.install_dir) {
      throw new Error(`Server ${serverId} 未配置 install_dir`);
    }
    return path.join(row.install_dir, 'Servers', serverId, STAGING_ACF_REL_PATH);
  }

  /**
   * 解析 VDF 文本 → WorkshopAcf
   */
  private parseContent(content: string): WorkshopAcf {
    let parsed: ReturnType<typeof parseVdf>;
    try {
      parsed = parseVdf(content);
    } catch (err) {
      if (err instanceof VdfParseError) {
        throw new Error(`acf 文件解析失败：${err.message}`);
      }
      throw err;
    }

    const root = parsed[ACF_ROOT_KEY] as Record<string, unknown> | undefined;
    if (!root || typeof root !== 'object') {
      // 非预期结构，视为空
      return { appid: U3DS_APPID, items: new Map() };
    }

    const appid = typeof root.appid === 'string' ? root.appid : U3DS_APPID;
    const items = new Map<WorkshopFileId, WorkshopAcfItem>();

    const installed = root.WorkshopItemsInstalled as Record<string, Record<string, string>> | undefined;
    if (installed && typeof installed === 'object') {
      for (const [fileId, meta] of Object.entries(installed)) {
        if (typeof meta !== 'object' || meta === null) continue;
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
    }

    return { appid, items };
  }

  /**
   * WorkshopAcfItem Map → VDF 嵌套对象
   */
  private itemsToVdf(items: Map<WorkshopFileId, WorkshopAcfItem>): Record<string, Record<string, string>> {
    const out: Record<string, Record<string, string>> = {};
    for (const [fileId, item] of items) {
      out[fileId] = {
        timeupdated: String(item.timeupdated),
        size: String(item.size),
        ...(item.manifest ? { manifest: item.manifest } : {}),
      };
    }
    return out;
  }

  /**
   * 备份指定文件到 `<file>.bak.<UTC-ISO>`
   */
  private async backupFile(absPath: string): Promise<string> {
    const iso = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = `${absPath}.bak.${iso}`;
    await fs.copyFile(absPath, backupPath);
    return backupPath;
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
