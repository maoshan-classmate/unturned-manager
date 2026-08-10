import Database from "better-sqlite3";
import { encrypt, decrypt } from "../../utils/cryptoBox.js";

/**
 * 卡 C 配卡 C #3：WebAPI Key 等加密 K-V 存取统一入口。
 *
 * 设计原则：**settings 模块只供其他模块内部读取**，路由层（routes/settings.ts）
 * 才负责 HTTP I/O。两边职责分离，避免循环依赖。
 */

export function setSetting(
  db: Database.Database,
  key: string,
  value: string,
): void {
  const enc = encrypt(value);
  db.prepare(
    `INSERT INTO settings (key, value_enc, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value_enc = excluded.value_enc, updated_at = excluded.updated_at`,
  ).run(key, enc);
}

export function getSetting(db: Database.Database, key: string): string | null {
  const row = db
    .prepare("SELECT value_enc FROM settings WHERE key = ?")
    .get(key) as { value_enc: string } | undefined;
  if (!row) return null;
  try {
    return decrypt(row.value_enc);
  } catch {
    return null;
  }
}

export function deleteSetting(db: Database.Database, key: string): void {
  db.prepare("DELETE FROM settings WHERE key = ?").run(key);
}

/** WebAPI Key 便捷封装 */
const STEAM_WEBAPI_KEY = "steam_webapi_key";
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

// ─── startCommand 明文 K-V（ADR-0004 Phase 4）────────────────────────────
// key 约定：`startCommand:<ServerID>`
// 设计：startCommand 是脚本命令字符串（非凭证），不需要 AES-GCM 加密。
//       直接走 db.prepare 写入 value_enc 字段（复用了列，但语义不加密）——
//       settingsStorage 的加密链路 setSetting/getSetting 不复用，避免污染。

const startCommandKey = (serverId: string): string =>
  `startCommand:${serverId}`;

/** 读取实例的 startCommand；未配置返回 null */
export function getStartCommand(
  db: Database.Database,
  serverId: string,
): string | null {
  const row = db
    .prepare("SELECT value_enc FROM settings WHERE key = ?")
    .get(startCommandKey(serverId)) as { value_enc: string } | undefined;
  return row?.value_enc ?? null;
}

/** 写入实例的 startCommand（明文落库） */
export function setStartCommand(
  db: Database.Database,
  serverId: string,
  value: string,
): void {
  db.prepare(
    `INSERT INTO settings (key, value_enc, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value_enc = excluded.value_enc, updated_at = excluded.updated_at`,
  ).run(startCommandKey(serverId), value);
}

/** 删除实例的 startCommand（removeServer 时调用） */
export function deleteStartCommand(
  db: Database.Database,
  serverId: string,
): void {
  db.prepare("DELETE FROM settings WHERE key = ?").run(
    startCommandKey(serverId),
  );
}
