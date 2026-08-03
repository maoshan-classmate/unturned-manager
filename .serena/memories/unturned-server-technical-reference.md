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

## Node.js RCON 库
- OpenMod: rcon-srcds (npm, 首选)
- RocketMod: Node.js net 模块 (Telnet fallback)
- A2S 查询: @fabricio-191/valve-server-query (npm)

## Steam Workshop
- 无需 API Key 获取 Mod 元数据: steamcommunity.com/sharedfiles/filedetails/?id=X&xml=1
- ISteamRemoteStorage/GetPublishedFileDetails/v1 不需要 Key
- Workshop 内容分类：Map/Item/Vehicle/Skin/Object/Localization/Server Curation
- Mod 变更必须重启服务器（不存在热加载）
- 客户端连接时自动订阅并下载服务端配置的 Workshop Mod