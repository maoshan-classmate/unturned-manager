-- 005: 删除 servers / config_snapshots / audit_logs 三表（ADR-0003 B2 目录扫描真源）
--
-- 原因：
--   - servers 行 = 实例身份派生缓存，真源已迁到目录扫描（<installDir>/Servers/<id>/Server/Commands.dat）
--   - config_snapshots = 死写（T3 乐观锁 mtime 化后无写入方）
--   - audit_logs = 死写（T4 审计退役，pino 承接）
--
-- 数据丢失风险评估：
--   - 无业务数据丢失——三表均为派生缓存/死写
--   - RCON 凭证本就不在 DB（缺口 1），已迁 settings K-V（rcon:<id>:openmod / :rocketmod）
--   - 实例身份 = 目录存在性，不写 DB
--
-- 保留的表（3 个）：
--   - settings         加密 K-V（含 RCON 凭证）
--   - users            用户
--   - refresh_tokens   JWT 刷新

DROP TABLE IF EXISTS servers;
DROP TABLE IF EXISTS config_snapshots;
DROP TABLE IF EXISTS audit_logs;
