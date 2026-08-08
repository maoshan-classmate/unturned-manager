import type Database from 'better-sqlite3';
import type {
  WorkshopFileId,
  IWorkshopMetadataService,
  WorkshopModMeta,
} from '@unturned-manager/shared';
import { logger } from '../../utils/logger.js';
import { getSteamWebApiKey } from '../settings/settingsStorage.js';

// ─── 常量 ────────────────────────────────────────────────

/** Steam WebAPI 端点（卡 C 修复 C6：`?xml=1` 已废弃——见 research_dst_mod_reference_2026-08-08.md §5.1） */
const STEAM_API_BASE = 'https://api.steampowered.com';
const API_GET_DETAILS = `${STEAM_API_BASE}/IPublishedFileService/GetDetails/v1/`;
const API_QUERY_FILES = `${STEAM_API_BASE}/IPublishedFileService/QueryFiles/v1/`;

/** 缓存 TTL：600s 内直接返回，600-3600s stale-while-revalidate */
const CACHE_FRESH_MS = 600_000;
const CACHE_STALE_MS = 3_600_000;

const FETCH_TIMEOUT_MS = 10_000;

const U3DS_APPID = '1110390';

// ─── 实现 ────────────────────────────────────────────────

export class WorkshopMetadataService implements IWorkshopMetadataService {
  constructor(private db: Database.Database) {}

  async getModDetails(modId: WorkshopFileId): Promise<WorkshopModMeta | null> {
    // 1. 查缓存
    const cached = this.dbGet(modId);
    const now = Date.now();

    if (cached) {
      const cachedAt = (cached as CachedMod & { cached_at?: string }).cached_at
        ?? (cached as CachedMod).cachedAt;
      const age = now - new Date(cachedAt).getTime();
      if (age < CACHE_FRESH_MS) return this.toModMeta(cached);
      if (age < CACHE_STALE_MS) {
        this.refreshInBackground(modId);
        return this.toModMeta(cached);
      }
    }

    // 2. 缓存不可用：拉新数据
    return this.fetchAndCache(modId);
  }

  async searchMods(query: string): Promise<WorkshopModMeta[]> {
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

  // ── 私有 ──────────────────────────────────────────────

  private dbGet(modId: WorkshopFileId): CachedMod | null {
    const row = this.db
      .prepare('SELECT * FROM workshop_mods WHERE file_id = ?')
      .get(modId) as CachedMod | undefined;
    return row ?? null;
  }

  private dbUpsert(meta: WorkshopModMeta): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO workshop_mods
         (file_id, title, author, description, preview_url, file_size, updated_at_steam, cached_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      )
      .run(
        meta.fileId,
        meta.title,
        meta.author,
        meta.description,
        meta.previewUrl ?? null,
        meta.fileSize ?? null,
        meta.updatedAt ?? null,
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

  /**
   * 卡 C：WebAPI Key 优先；无则降级零凭证（仅保留 try，参考 research 报告）
   *
   * IPublishedFileService/GetDetails/v1（key required）
   * 返回结构：response.publishedfiledetails = Array<{
   *   publishedfileid, title, creator, file_description, preview_url,
   *   file_size, time_updated, ...
   * }>
   */
  private async fetchAndCache(modId: WorkshopFileId): Promise<WorkshopModMeta | null> {
    const apiKey = getSteamWebApiKey(this.db);
    if (!apiKey) {
      logger.warn({ modId }, 'WebAPI Key 未配置，getModDetails 走 DB 缓存（不命中则返 null）');
      return null;
    }
    const url = `${API_GET_DETAILS}?key=${encodeURIComponent(apiKey)}&publishedfileids[]=${encodeURIComponent(modId)}`;
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!res.ok) {
        logger.warn({ modId, status: res.status }, 'IPublishedFileService/GetDetails 失败');
        return null;
      }
      const json = (await res.json()) as {
        response: { publishedfiledetails: Array<{
          publishedfileid: string;
          title?: string;
          creator?: string;
          file_description?: string;
          preview_url?: string;
          file_size?: number;
          time_updated?: number;
        }> };
      };
      const detail = json.response.publishedfiledetails[0];
      if (!detail || !detail.title) {
        return null;
      }
      const meta: WorkshopModMeta = {
        fileId: modId,
        title: detail.title,
        author: detail.creator ?? 'Unknown',
        description: detail.file_description ?? '',
        previewUrl: detail.preview_url,
        fileSize: detail.file_size,
        updatedAt: detail.time_updated
          ? new Date(detail.time_updated * 1000).toISOString()
          : undefined,
      };
      this.dbUpsert(meta);
      return meta;
    } catch (err) {
      logger.warn({ modId, err }, 'IPublishedFileService 网络错误');
      return null;
    }
  }

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
