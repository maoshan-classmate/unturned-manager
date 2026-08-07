-- 002: Add install_dir to servers
ALTER TABLE servers ADD COLUMN install_dir TEXT NOT NULL DEFAULT '';
