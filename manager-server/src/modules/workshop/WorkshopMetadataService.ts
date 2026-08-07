import type Database from 'better-sqlite3';
import type { WorkshopFileId, IWorkshopMetadataService, WorkshopModMeta } from '@unturned-manager/shared';
import { logger } from '../../utils/logger.js';

// ─── 常量 ────────────────────────────────────────────────

/** Steam Workshop XML 查询 URL（零凭证） */
const STEAM_XML_URL = 'https://steamcommunity.com/sharedfiles/filedetails/?id=';

/** 缓存 TTL：600s 内直接返回，600-3600s stale-while-revalidate */
const CACHE_FRESH_MS = 600_000;   // 10 分钟
const CACHE_STALE_MS = 3_600_000; // 1 小时

/** HTTP 请求超时 */
const FETCH_TIMEOUT_MS = 10_000;

// ─── 实现 ────────────────────────────────────────────────

export class WorkshopMetadataService implements IWorkshopMetadataService {
  constructor(
    private db: Database.Database,
    private apiKey?: string,
  ) {}

  // ── 公开接口 ──────────────────────────────────────────

  async getModDetails(modId: WorkshopFileId): Promise<WorkshopModMeta | null> {
    // 1. 查缓存
    const cached = this.dbGet(modId);
    const now = Date.now();

    if (cached) {
      const age = now - new Date(cached.cachedAt).getTime();

      if (age < CACHE_FRESH_MS) {
        // 新鲜缓存：直接返回
        return this.toModMeta(cached);
      }

      if (age < CACHE_STALE_MS) {
        // 过期但可容忍：返回旧数据 + 后台刷新
        this.refreshInBackground(modId);
        return this.toModMeta(cached);
      }
    }

    // 2. 缓存不可用：阻塞拉取
    return this.fetchAndCache(modId);
  }

  async searchMods(query: string): Promise<WorkshopModMeta[]> {
    // Sprint 2: 本地 DB 前缀搜索（Steam 全量搜索需要 WebAPI Key）
    const rows = this.db
      .prepare(
        `SELECT file_id, title, author, description, preview_url, file_size, updated_at_steam, cached_at
         FROM workshop_mods
         WHERE title LIKE ? OR author LIKE ?
         ORDER BY cached_at DESC
         LIMIT 20`,
      )
      .all('%' + query + '%', '%' + query + '%') as CachedMod[];

    return rows.map((r) => this.toModMeta(r));
  }

  async refreshCache(modId: WorkshopFileId): Promise<void> {
    await this.fetchAndCache(modId);
  }

  // ── 缓存操作 ──────────────────────────────────────────

  private dbGet(modId: WorkshopFileId): CachedMod | null {
    const row = this.db
      .prepare('SELECT * FROM workshop_mods WHERE file_id = ?')
      .get(modId) as CachedMod | undefined;
    return row ?? null;
  }

  private dbUpsert(meta: WorkshopModMeta, rawXml: string): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO workshop_mods
         (file_id, title, author, description, preview_url, file_size, updated_at_steam, cached_at, raw_xml)
         VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), ?)`,
      )
      .run(
        meta.fileId,
        meta.title,
        meta.author,
        meta.description,
        meta.previewUrl ?? null,
        meta.fileSize ?? null,
        meta.updatedAt ?? null,
        rawXml,
      );
  }

  private toModMeta(row: CachedMod): WorkshopModMeta {
    return {
      fileId: row.file_id as WorkshopFileId,
      title: row.title,
      author: row.author,
      description: row.description,
      previewUrl: row.preview_url ?? undefined,
      fileSize: row.file_size ?? undefined,
      updatedAt: row.updated_at_steam ?? undefined,
    };
  }

  // ── HTTP 拉取 + XML 解析 ──────────────────────────────

  private async fetchAndCache(modId: WorkshopFileId): Promise<WorkshopModMeta | null> {
    const xml = await this.fetchXml(modId);
    if (!xml) return null;

    const meta = this.parseXml(xml, modId);
    if (meta) {
      this.dbUpsert(meta, xml);
    }
    return meta;
  }

  private async fetchXml(modId: WorkshopFileId): Promise<string | null> {
    const url = STEAM_XML_URL + modId + '&xml=1';

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timeout);

      if (!res.ok) {
        logger.warn({ modId, status: res.status }, 'Steam Workshop XML 请求失败');
        return null;
      }

      return await res.text();
    } catch (err) {
      logger.warn({ modId, err }, 'Steam Workshop XML 网络错误');
      return null;
    }
  }

  private parseXml(xml: string, modId: WorkshopFileId): WorkshopModMeta | null {
    try {
      // 简单 XML 解析——不用 fast-xml-parser 减少依赖（Steam ?xml=1 结构固定）
      const text = (tag: string): string => {
        const m = new RegExp('<' + tag + '>([^<]*)</' + tag + '>', 'i').exec(xml);
        return (m ? m[1] : '') ?? '';
      };

      const title = text('filename') || text('title') || '';
      const author = text('creator') || text('author') || '';
      const description = text('description');
      const previewUrl = text('preview_url');
      const fileSizeStr = text('file_size');
      const updatedStr = text('time_updated');

      if (!title) {
        logger.warn({ modId }, 'Steam XML 缺少标题，可能不是有效的 Mod');
        return null;
      }

      return {
        fileId: modId,
        title: this.decodeEntities(title),
        author: this.decodeEntities(author) || 'Unknown',
        description: this.decodeEntities(description),
        previewUrl: previewUrl || undefined,
        fileSize: fileSizeStr ? parseInt(fileSizeStr, 10) : undefined,
        updatedAt: updatedStr
          ? new Date(parseInt(updatedStr, 10) * 1000).toISOString()
          : undefined,
      };
    } catch (err) {
      logger.warn({ modId, err }, 'Steam XML 解析失败');
      return null;
    }
  }

  /** 解码 HTML 实体（Steam XML 返回的内容可能有 &amp; 等） */
  private decodeEntities(text: string): string {
    return text
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");
  }

  // ── 后台刷新 ──────────────────────────────────────────

  private refreshInBackground(modId: WorkshopFileId): void {
    this.fetchAndCache(modId).catch((err) => {
      logger.warn({ modId, err }, '后台刷新 Mod 元数据失败');
    });
  }
}

// ─── 内部类型 ────────────────────────────────────────────

interface CachedMod {
  file_id: string;
  title: string;
  author: string;
  description: string;
  preview_url: string | null;
  file_size: number | null;
  updated_at_steam: string | null;
  cachedAt: string;
  cached_at?: string;
}
