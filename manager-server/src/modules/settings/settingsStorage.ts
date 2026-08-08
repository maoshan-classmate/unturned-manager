import Database from 'better-sqlite3';
import { encrypt, decrypt } from '../../utils/cryptoBox.js';

const SETTINGS_KEY = 'steam_webapi_key';

/**
 * 卡 C 配卡 C #3：WebAPI Key 等加密 K-V 存取统一入口。
 *
 * 设计原则：**settings 模块只供其他模块内部读取**，路由层（routes/settings.ts）
 * 才负责 HTTP I/O。两边职责分离，避免循环依赖。
 */

export function setSetting(db: Database.Database, key: string, value: string): void {
  const enc = encrypt(value);
  db.prepare(
    `INSERT INTO settings (key, value_enc, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value_enc = excluded.value_enc, updated_at = excluded.updated_at`,
  ).run(key, enc);
}

export function getSetting(db: Database.Database, key: string): string | null {
  const row = db.prepare('SELECT value_enc FROM settings WHERE key = ?').get(key) as { value_enc: string } | undefined;
  if (!row) return null;
  try {
    return decrypt(row.value_enc);
  } catch {
    return null;
  }
}

export function deleteSetting(db: Database.Database, key: string): void {
  db.prepare('DELETE FROM settings WHERE key = ?').run(key);
}

/** WebAPI Key 便捷封装 */
const STEAM_WEBAPI_KEY = 'steam_webapi_key';
export function getSteamWebApiKey(db: Database.Database): string | null {
  return getSetting(db, STEAM_WEBAPI_KEY);
}
export function setSteamWebApiKey(db: Database.Database, value: string): void {
  setSetting(db, STEAM_WEBAPI_KEY, value);
}
export function deleteSteamWebApiKey(db: Database.Database): void {
  deleteSetting(db, STEAM_WEBAPI_KEY);
}
export function hasSteamWebApiKey(db: Database.Database): boolean {
  return getSetting(db, STEAM_WEBAPI_KEY) != null;
}
