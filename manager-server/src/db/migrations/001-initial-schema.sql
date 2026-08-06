-- 001: Initial schema — 6 tables + 4 indexes

CREATE TABLE IF NOT EXISTS servers (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL DEFAULT '',
  game_port       INTEGER NOT NULL DEFAULT 27015,
  state           TEXT NOT NULL DEFAULT 'STOPPED',
  rcon_protocol   TEXT,
  rcon_port       INTEGER,
  rcon_password_enc TEXT,
  owner_steam_id  TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS users (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  username        TEXT NOT NULL UNIQUE,
  password_hash   TEXT NOT NULL,
  is_admin        INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS refresh_tokens (
  jti             TEXT PRIMARY KEY,
  user_id         INTEGER NOT NULL REFERENCES users(id),
  expires_at      TEXT NOT NULL,
  revoked_at      TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS config_snapshots (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  server_id       TEXT NOT NULL REFERENCES servers(id),
  file_path       TEXT NOT NULL,
  content         TEXT NOT NULL,
  version         INTEGER NOT NULL,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS workshop_mods (
  file_id         TEXT PRIMARY KEY,
  title           TEXT NOT NULL DEFAULT '',
  author          TEXT NOT NULL DEFAULT '',
  description     TEXT NOT NULL DEFAULT '',
  preview_url     TEXT,
  file_size       INTEGER,
  updated_at_steam TEXT,
  cached_at       TEXT NOT NULL DEFAULT (datetime('now')),
  raw_xml         TEXT
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  server_id       TEXT,
  action          TEXT NOT NULL,
  actor           TEXT NOT NULL DEFAULT 'admin',
  detail          TEXT,
  ip_address      TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_servers_state ON servers(state);
CREATE INDEX IF NOT EXISTS idx_config_snapshots_server_file ON config_snapshots(server_id, file_path);
CREATE INDEX IF NOT EXISTS idx_audit_logs_server ON audit_logs(server_id, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action, created_at);
