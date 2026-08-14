-- 006: 物品清单表（全局唯一；内置种子只读，自定义可 CRUD）
-- 设计来源：docs/architecture/loadout-item-editor-design.md §4.1
CREATE TABLE IF NOT EXISTS item_list (
  id         INTEGER PRIMARY KEY,              -- 物品 ID（0–65535，rowid 别名自带唯一）
  name       TEXT NOT NULL,
  source     TEXT NOT NULL DEFAULT 'custom'
               CHECK (source IN ('builtin','custom')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_item_list_source ON item_list(source);
CREATE INDEX IF NOT EXISTS idx_item_list_name   ON item_list(name);
