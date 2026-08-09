-- 004: 删除不再使用的 Mod 缓存表（真源唯一）
--
-- 原因：
--   - workshop_mods 表是 WebAPI 元数据的派生缓存
--     与真源（api.steampowered.com）一致性无法保证
--   - workshop_creators 表是作者名缓存
--     作者名实时调 GetPlayerSummaries/v2 即可
--   - acf 文件是 Mod 列表的真源，acf 解析即时进行
--   - WebAPI Key 已迁移到 settings 表
--
-- 删表后行为：
--   - browseMods() 每次都实时调 WebAPI（v2.0 决策）
--   - getModDetails() 每次都实时调 WebAPI（v2.0 决策）
--   - getAuthorNames() 每次都实时调 GetPlayerSummaries
--   - AcfService.listItems() 每次都实时读盘解析
--
-- 数据丢失风险评估：
--   - 无业务数据丢失——两表都是缓存
--   - 重启后 browseMods 重新拉 Steam API
--   - 作者名重新查 GetPlayerSummaries
--   - acf 数据本来就是文件，删表不影响

DROP TABLE IF EXISTS workshop_mods;
DROP TABLE IF EXISTS workshop_creators;

-- 本迁移执行时的保留表（6 个）：
--   - servers         服务端实例（ADR-0003 B2 后由目录扫描取代，005 中删除）
--   - users           用户
--   - refresh_tokens  JWT 刷新
--   - config_snapshots 配置文件快照（005 中删除）
--   - audit_logs      审计（005 中删除）
--   - settings        全局设置（含 webapi_key 等）
--
-- 注：ADR-0003 B2（005-drop-servers-tables.sql）最终将表收敛到 3 张——
--   users / refresh_tokens / settings。实例身份 = 目录存在性，不再落库。
