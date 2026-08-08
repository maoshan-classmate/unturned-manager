-- 卡 C #3：加密 settings 表（仅 K-V，AES-GCM）
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value_enc TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
