# 子 Agent #3 产物：Unturned Steam Workshop 接入（原始交付）

> 来源：deep-research agent 完成于 2026-08-03

## 1. Steam Workshop 分类

| 类型 | 英文 | Workshop 数量 (约) |
|---|---|---|
| 地图 | Map | 45,138 |
| 物品 | Item | 21,166 |
| 车辆 | Vehicle | 3,831 |
| 皮肤 | Skin | 3,989 |
| 物体 | Object | 38,915 |
| 本地化 | Localization | 1,009 |
| 服务器策展 | Server Curation | 138 |

分区：Ready-to-Use（普通mod）/ Curated（皮肤表决区）。置信度：高。

## 2. WorkshopDownloadConfig.json 完整结构

```json
{
  "File_IDs": [],
  "Ignore_Children_File_IDs": [],
  "Query_Cache_Max_Age_Seconds": 600,
  "Max_Query_Retries": 2,
  "Use_Cached_Downloads": true,
  "Should_Monitor_Updates": true,
  "Shutdown_Update_Detected_Timer": 600,
  "Shutdown_Update_Detected_Message": "Workshop file update detected, shutdown in: {0}",
  "Shutdown_Kick_Message": "Shutdown for Workshop file update."
}
```

- File_IDs 数组存 Workshop File ID (取自 URL `?id=` 参数)
- Ignore_Children_File_IDs 排除指定 mod 的子依赖
- Should_Monitor_Updates: 运行时监控 Workshop 更新，检测到后倒计时重启
- 启动时自动下载所有 mod 及依赖（除非在 Ignore_Children_File_IDs 中排除）。置信度：高。

## 3. SteamCMD 拉取

```bash
# 公开 Mod
steamcmd +login anonymous +workshop_download_item 304930 <workshop_file_id> +quit

# 私有 Mod
steamcmd +login <username> <password> +workshop_download_item 304930 <workshop_file_id> +quit
```

- App ID 304930 = Unturned
- 下载到 steamapps/workshop/content/304930/<id>/
- **U3DS 不能自行登录 Steam 下载私有 Workshop 文件**。Workaround: SteamCMD 下载 → 符号链接 → 仍把 File ID 加入 WorkshopDownloadConfig.json。置信度：高。

## 4. Mod 加载流程

| 路径 | 用途 |
|---|---|
| Servers/{ServerID}/Workshop/Maps/ | 地图 mod |
| Servers/{ServerID}/Workshop/Content/ | 物品/车辆/物体 mod |
| steamapps/workshop/content/304930/<id>/ | SteamCMD 下载位置 |

**Master Bundle** (自 3.22.4.0 起替代 .content 文件):
- MasterBundle.dat — 声明 Asset_Bundle_Name、Asset_Prefix、Asset_Bundle_Version
- .masterbundle — Unity AssetBundle 文件
- 各类 .dat 文件 — 定义具体资源 (Item.dat, Vehicle.dat, Object.dat 等)
- map.meta — 地图 mod 元数据

加载流程：启动 → 读取 WorkshopDownloadConfig.json → Steam Workshop API 下载/更新 → 自动解析依赖 → 地图→Maps/，其他→Content/ → 解析 .dat → 加载 .masterbundle。置信度：高。

## 5. Client 同步

官方文档: "Players will automatically begin downloading any mods while connecting to the server."

流程：客户端连接 → 服务端告知 Workshop File ID → 客户端自动订阅 → 下载到本地 → downloading_assets 提示 → 进入游戏。依赖自动处理。客户端必须能访问 Steam Workshop (需登录)。mod 作者可设 Allowed IPs 限制。置信度：高。

## 6. 官方对插件框架的接口/限制

- **RocketMod**: 社区维护，将 Rocket.Unturned 从 Extras/ 复制到 Modules/
- **OpenMod**: 官方文档正面推荐，可与 RocketMod 共存，NuGet 包管理 + 权限系统桥接
- **U3-SDK**: 2026-07-07 source-available 发布
- **Game Labs / SynUW**: 搜索未找到匹配项目

限制：专用服务器不能登录 Steam 下载私有 Workshop；Module 只从 Modules/ 加载；mod 作者可设 Allowed IPs；无官方 HTTP API；无内置权限系统。

## 来源 (20条)

| # | 来源 | URL | 可信度 |
|---|---|---|---|
| 1 | SDG 官方 - Server Hosting | docs.smartlydressedgames.com/en/stable/servers/server-hosting.html | 高 |
| 2 | SDG 官方 - Steam Workshop | docs.smartlydressedgames.com/en/latest/about/steam-workshop.html | 高 |
| 3 | SDG 官方 - Private Workshop Files | docs.smartlydressedgames.com/en/latest/sdg/hosting-servers-using-private-workshop-files.html | 高 |
| 4 | SDG 官方 - OpenMod | docs.smartlydressedgames.com/en/stable/servers/openmod.html | 高 |
| 5 | SDG 官方 - Asset Bundles | docs.smartlydressedgames.com/en/stable/assets/asset-bundles.html | 高 |
| 6 | SDG 官方 - SteamCMD Setup | docs.smartlydressedgames.com/en/stable/servers/steamcmd.html | 高 |
| 7 | Steam Workshop - Unturned | steamcommunity.com/app/304930/workshop | 高 |
| 8 | RestoreMonarchy | restoremonarchy.com/docs/servers/unturned-server/workshopdownloadconfig-json | 高 |
| 9-14 | 多家托管商 | nodecraft, apex, shockbyte, gameserverkings, supercraft | 中 |
| 15 | Valve Developer Wiki - SteamCMD | developer.valvesoftware.com/wiki/SteamCMD | 高 |
| 16-17 | r/unturned | reddit.com | 中 |
| 18 | SDG GitHub Issue #3836 | github.com/SmartlyDressedGames/Unturned-3.x-Community/issues/3836 | 高 |
| 19 | SuperCraft | supercraft.host | 中 |
| 20 | Wikipedia - Unturned | en.wikipedia.org/wiki/Unturned | 中 |

## 待确认（已补充回答）

### 1. Game Labs / SynUW
**结论：未找到匹配项目。** Steam Workshop、SDG 文档、OpenMod、RocketMod、Reddit、GitHub 均未命中。可能是托管商品牌名或特定社区运营组织的自定义命名。置信度：中。

### 2. anonymous 下载
**结论：分情况。** 公开 mod 通过 U3DS 或 SteamCMD anonymous 均可下载；私有/Friends-Only mod 必须用 SteamCMD + 认证账号 + symlink workaround。置信度：高。

### 3. Shutdown_Update_Detected_Timer 精确行为
**结论：检测到 Workshop 文件更新 → 广播倒计时 → 强制踢出所有玩家 → shutdown → 外部进程管理器重启 → 重启时重新下载 mod。** 字段语义来自 WorkshopDownloadConfig.json 结构推断，SDG 未提供此功能的独立详细文档。置信度：中。

### 4. Allowed IPs 影响范围
**结论：仅限制服务端自动下载，不影响客户端订阅/连接时自动下载。** SDG 官方文档明确写 "only the servers with that IP address"。客户端通过 Steam Workshop 获取，不经 Allowed IPs 检查。置信度：高。

### 补充发现：客户端同步
GameServerKings (2026-08-01): "Your players do not need to subscribe to anything. Steam delivers the server's configured workshop content to clients automatically. Older guidance telling you to make players subscribe manually is wrong."
