# 子 Agent #4 产物：Unturned Mod 可视化管理（原始交付）

> 来源：deep-research agent 完成于 2026-08-03。
> 用途：合稿时引用本文件 → 最终 `claudedocs/research_unturned_panel_<timestamp>.md`。

---

## 0. TL;DR

| 维度 | 现状结论 | 置信度 |
|---|---|---|
| **配置入口** | 启用 Mod 的权威文件是 `Servers/<name>/WorkshopDownloadConfig.json` 的 `File_IDs` 数组；`Server/Config.json` 与 `Server/Commands.dat` 不存 Mod 列表，只存全局开关/难度/地图 | 高 |
| **运行时增删** | **没有任何官方机制**支持热加载 Workshop Mod；Rocket 插件层面 `/rocket reload` 已被多次讨论下线；OpenMod 仍要求重启服务器 | 高 |
| **Mod 元数据** | 标准是 `Bundles/<mod>/meta.dat`：Name / Author / Description；Steamodded ("smods") 扩展字段更完整，含 `version`、`dependencies`、`icon_path`、`badge_colour` 等 | 高 |
| **错误反馈** | 主要在 GPanel 控制台 + 服务器日志（不是结构化 API），需要面板主动 tail 文件 | 中 |
| **现代等价物** | 官方未提供 WebAPI；主流面板走"修改 JSON + 重启" | 高 |
| **业界参考** | ARMA3 / Rust / Township / CRDA / BetterCrewLink-Network / txAdmin（最佳参考） | 中 |

---

## 1. 服务端启用 Mod：三层文件结构

按 SDG 官方文档：

| 文件 | 作用 | 是否管 Mod |
|---|---|---|
| `Servers/<name>/Commands.dat` | Map/Owner/Password/Mode/PvP/Perspective/Port/Cheats | 否 |
| `Servers/<name>/Server/Config.json` | 难度细节、刷新规则等 | 否 |
| `Servers/<name>/WorkshopDownloadConfig.json` | **真正的 Mod/地图列表** | **是** |

### 1.2 WorkshopDownloadConfig.json 完整字段

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

### 1.3 单地图覆盖
Mod 是完整地图（curated / Arena）时，需在 `Commands.dat` 写 `Map <map_folder_name>` 指向地图导出文件夹名。

### 1.4 手动放置 Mod（不依赖 Steam Workshop）
- 拷贝 `.unity3d` 到 `Servers/<name>/Bundles/Workshop/Content/`（地图放 `Maps/`），`WorkshopDownloadConfig.json` 只填 ID。
- U3-SDK Issue #3836 更简单方式：把解压文件夹丢入 `Servers/<name>/Workshop/Content/`，配置只写 ID。

## 2. 运行时启用 / 停用：重启是唯一可靠路径

1. **Workshop Mod**：每次启动时扫描 `File_IDs`；修改后必须重启。
2. **Rocket 插件**：U3-SDK Issue #1794 作者明确 `/rocket reload "breaks most current plugins"`（Mono 无 AppDomain 卸载；类型/事件/Unity 原生绑定泄漏）。社区共识：改 Rocket 插件必须重启。
3. **OpenMod**：`openmod install <pkg>` 后需 `openmod reload`；NuGet 升/降版本需完整重启。
4. **Config-only**：`/p reload` 权限、`Save`、chat broadcast 可热生效，但不涉及 Mod 装载。

### 2.2 "优雅停服再起" 官方推荐
SDG `Enable_Scheduled_Shutdown` + 提前 chat 广播 — 唯一被官方背书的"零停机维护"模式。本质：定时滚动重启。

### 2.3 面板策略
- 拆操作：**改 JSON** + **滚动重启**。
- `Should_Monitor_Updates=true` 作为默认。
- 倒计时展示，使用 `Shutdown_Update_Detected_Message`。

## 3. Mod 元数据字段

### 3.1 传统 `meta.dat`（57 Studios Wiki）
位置：`Bundles/<mod>/meta.dat`
| 字段 | 含义 |
|---|---|
| Name | 显示名 |
| Author | 作者 |
| Description | 描述 |
| Version | 版本号 |

57 Studios 直接指出："some server admin tools read it to display the mod's information to server operators"。

### 3.2 Steamodded ("smods") 现代字段表

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | string | 唯一 ID |
| `name` | string | 内部名 |
| `display_name` | string | 徽章显示文本 |
| `author` | string | 作者 |
| `description` | string | 描述 |
| `prefix` | string | 命名空间前缀 |
| `main_file` | string | 入口 lua 文件 |
| `priority` | int | 加载顺序 |
| `badge_colour` | hex | 徽章背景 |
| `badge_text_colour` | hex | 徽章文字 |
| `no_marquee` | bool | 禁用 marquee |
| `icon_path` | string | 需 1x 与 2x |
| `icon_fps` / `icon_width` | int | 动图参数 |
| `version` | string | `major.minor.patchrev` |
| `dependencies` | list | 例如 `Lovely (>=0.6)` |

### 3.3 Web 面板字段映射

```
[✓/✗ Enable]   [Icon]   Name (id)     v Version
   ├── Author
   ├── Description
   ├── Dependencies  → 自动解析 Steam Workshop 父 Mod
   ├── Last Update
   ├── File Size
   └── Source:  Steam Workshop ID / Manual upload (.unity3d)
```

## 4. 冲突、热加载、错误反馈

### 4.1 冲突检测
官方无依赖解析器。`WorkshopDownloadConfig.json` 仅识别 ID。依赖图完全靠客户端比对。
- Steam Web API `GetWorkshopItem` 返回 `children`/`requiredItems`，面板回填依赖子树。
- `Ignore_Children_File_IDs` 手动排除。
- U3-SDK Issue #3836：未携带 Workshop 项的玩家会"requested workshop downloads"。

### 4.2 热加载
不存在官方热加载。

### 4.3 错误反馈

| 输出位置 | 内容 |
|---|---|
| `Servers/<name>/Server/Logs/*.log` | 启动解析错误、Mod 装配失败 |
| 服务器控制台 stdout | 实时 parse error |
| Steam API 调用日志 | Workshop 下载失败 |
| GPanel 控制台 | 第三方商业面板把 stdout 内嵌展示 |

## 5. 客户端可视化补丁（历史）

| 项目 | 类型 | 简述 |
|---|---|---|
| `UnturnedIIIPatch` | 客户端 DLL patch | 主要用于绕过 BattlEye |
| `Ubisoft/UUI` | 客户端内 UI | 给玩家一个 Mod 列表面板，只读 |
| `RockMod` | RocketMod 自带 | 提供 `/rocket` 命令列表，无 Web 面板 |
| `SDG_UUI` / `smods UI` | Rocket / OpenMod 插件 | 游戏内 Mod 列表、徽章、信息面板 |

共同问题：**只影响客户端显示，不影响服务端 Mod 列表管理**。

## 6. 现代等价物（2025–2026）

- **UUPool**：搜不到独立项目。各家面板把 Unturned 集成进 Pterodactyl/Custom Panel 模板。
- **SDG 官方管理界面**：无 WebAPI；仅有客户端与文档。
- **OpenMod**：YAML + NuGet；**未提供 REST/GraphQL**；一切仍是 RCON/控制台。
- **BepInEx**：Unturned 主流是 .unity3d + Rocket/OpenMod，**不混**。

### 6.4 是否都用 WebAPI？
**否**。当前所有方案：
- 前台：Web 文件管理（修改 JSON、上传 .zip）
- 后台：服务端进程（Pterodactyl Wings / systemd / Windows ServerHelper）
- 控制面：SSH、SteamCMD、`/rocket`、面板封装 Run Command

`Socket RCON` 类 Unturned **官方无**；RocketMod / OpenMod 仅暴露 Steam 客户端层而非 RCON。

任何 Web 面板若想 "远程控制 Mod 增删" 必须自建 agent，两种：
- **agent-on-host（推荐）**：面板通过 SSH / gRPC / 本机 Unix socket 改 JSON + 重启。
- **WebAPI in-process**：把 OpenMod 嵌入进程 + ASP.NET Core 暴露 /api/mods（**尚无成熟开源项目**）。

## 7. 业界参考

| 项目 | 游戏 | 经验 |
|---|---|---|
| ARMA 3 WebAdmin | Bohemia | Telnet 命令流 |
| Rust WebAdmin (Oxide) | Rust | uMod 插件 + 权限组 + 数据表读写，**Mod 列表持久化在 SQLite** |
| Rust Rusty / IOAdmin | Rust | WebSocket + JSON-RPC，**WebSocket 实时日志** |
| CRDA | WoW private | **跨 Realm Mod 拖拽** — 主控 → 多从服管道 |
| DayZ Server Mod Launcher | Bohemia | JSON-based Mod 列表 + Workshop ID + **客户端/服务端版本比对** |
| **FiveM txAdmin** | CFX | **最佳参考**：实时控制台、文件编辑、配置热重载、scheduled restart |

借鉴 txAdmin：
- 实时控制台 WebSocket 推送。
- Files 标签：可视化编辑 `WorkshopDownloadConfig.json`、自动 JSON 校验。
- Mods 标签：基于 Steam WebAPI 拉 Workshop 标题、作者、版本、依赖，关联 meta.dat。
- 操作流水线：**Confirm Diff** → 写入 JSON（带 backup） → 设置 `Should_Monitor_Updates=true` + 短 timer（如 60s）→ 广播 → 重启。

## 8. 行动建议

1. **页面字段清单**（最小可用）：
   - Toggle、Workshop File ID、Name、Author、Version、Description、依赖列表、最后更新时间、文件大小、订阅数/评分、当前状态。

2. **变更流程**：
   - 校验 JSON → 备份 `WorkshopDownloadConfig.json.bak` → 写入新 ID → 触发"滚动重启"。

3. **错误反馈**：把 `Logs/*.log` 与 OpenMod/Rocket stdout 统一打到 WebSocket；模式化匹配。

4. **依赖解析**：用 Steam WebAPI `GetWorkshopItem(id)` 取 children/requiredItems；解析失败降级到 Ignore_Children_File_IDs。

5. **热加载就别承诺**：UI 上写"加 Mod 需要 30 秒滚动重启"。

## 9. 来源与可信度

| 来源 | URL | 类型 | 时间 | 置信度 |
|---|---|---|---|---|
| SDG 官方文档 | https://docs.smartlydressedgames.com/en/stable/servers/server-hosting.html | 一手 | 持续维护 | 高 |
| SDG 滚动重启 | https://docs.smartlydressedgames.com/en/latest/servers/server-auto-restart.html | 一手 | 2025+ | 高 |
| U3-SDK Issue #1794 (Rocket reload 风险) | https://github.com/SmartlyDressedGames/U3-SDK/issues/1794 | 一手 issue | 2019–2025 | 高 |
| U3-SDK Issue #3836 (Workshop 列表) | https://github.com/SmartlyDressedGames/U3-SDK/issues/3836 | 一手 issue | 2023 | 高 |
| Steamodded smods Mod Metadata | https://github.com/Steamodded/smods/wiki/Mod-Metadata | 一手 wiki | 持续维护 | 高 |
| 57 Studios Modding Wiki | https://docs.57studios.net/items/project-folder-structure-and-guids | 半官方 wiki | 2024+ | 高 |
| Restore Monarchy | https://restoremonarchy.com/docs/servers/unturned-server/workshopdownloadconfig-json | 商业面板 | 2024+ | 中 |
| Flux Docs | https://docs.runonflux.com/fluxcloud/marketplace/games/unturned | 商业面板 | 2025+ | 中 |
| GameServerKings | https://www.gameserverkings.com/knowledge-base/unturned/how-to-install-rocketmod-plugins-for-unturned | 商业面板 | 2025+ | 中 |
| OpenMod 仓库 | https://github.com/openmod/openmod | 一手 | 持续维护 | 高 |
| OpenMod - OpenMod.Unturned | https://docs.smartlydressedgames.com/en/stable/servers/openmod.html | 一手 | 持续维护 | 高 |
| Apex Hosting | https://apexminecrafthosting.com/guides/unturned/unturned-rocketmod-commands | 商业面板 | 2022+ | 中 |
| RocketModFix Redist Server.Publicized | https://www.nuget.org/packages/RocketModFix.Unturned.Redist.Server.Publicized | 一手包 | 2026 | 高 |
| RedSwitches 2026 指南 | https://www.redswitches.com/blog/how-to-set-up-an-unturned-dedicated-server | 营销博客 | 2026 | 低-中 |

## 10. 仍疑

- `Should_Monitor_Updates` 最新 3.x 是否仍按"默认倒计时 10 分钟"工作（Restore Monarchy 给出默认 600）。
- OpenMod 是否暴露 Web 控制端点（搜到的都是 console / command）。
- `meta.dat` 的版本比较是否被游戏运行时真正消费。
- Steam Workshop 订阅图 vs `File_IDs` 同步行为（手动放置文件后 ID 是否仍需保留）。

以上标 **中**；生产代码前以一次实机实验复核。
