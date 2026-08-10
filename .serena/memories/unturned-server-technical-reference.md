## U3DS 服务端关键信息
- Dedicated Server AppID: 1110390 (anonymous 登录)
- 客户端 AppID: 304930
- 启动: ServerHelper.sh +InternetServer/<ID> -ThreadedConsole
- 运行时需 Mono（Unity 2020.3 LTS 默认脚本后端）
- 配置：Commands.dat (启动参数), Config.txt (游戏玩法, ≥3.25.8.0), WorkshopDownloadConfig.json (Mod 订阅)

## RCON 四层体系
1. Native SDG RCON - 协议未公开，ICommandInputOutput 接口
2. RocketMod/LDM RCON - Telnet 明文，端口=游戏端口+2
3. OpenMod RCON - Valve Source RCON 二进制，推荐
4. BattlEye RCON - UDP+CRC32，仅反作弊

## 命令通道（ADR-0004 Phase 6 更新）
- RCON/A2S 通道已整体删除——命令统一走 PTY 持久终端 owner-trust 模型
- 后端：node-pty 常驻 bash；前端：xterm.js（WS console_line 出站 + terminal_input 入站）
- 上方「RCON 四层体系」仅作历史参考，若未来恢复 RCON 按 rcon-protocol.md 重建

## Steam Workshop（2026-08 调研更新）
- 元数据获取：IPublishedFileService/QueryFiles + GetDetails（需 WebAPI Key，Settings 配置，AES-GCM 加密存储）
- QueryFiles 用 appid=304930（客户端 AppID，非服务端 1110390）
- ?xml=1 零凭证接口已废弃（2026-08 实测返回 HTML）
- 两阶段查询：QueryFiles 取 ID → GetDetails 批量补 title/preview/creator
- query_type 官方枚举（实测有效）：3=最热门 0=评分 1=最近发行 21=最新更新 9=订阅数 12=搜索相关度
- days 参数仅 RankedByTrend 生效：day=1 week=7 month=30 months3=90 months6=180 year=365（发布至今=不传）
- date_range_created/updated、requiredtags 时间 tag 实测全被 Steam WebAPI 忽略
- 全局代理绕过：index.ts setGlobalDispatcher(new Agent({connectTimeout:30000}))
- 浏览失败不降级缓存，抛 AppError（workshop-key-missing/timeout/upstream-error）
- Workshop 内容分类：Map/Item/Vehicle/Skin/Object/Localization/Server Curation
- Mod 变更必须重启服务器（不存在热加载）