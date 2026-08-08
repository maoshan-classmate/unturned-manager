# Unturned 服务端 Web 管理面板 — 前提调研报告

> **日期**：2026-08-03  
> **阶段**：`/sc:research` 输出物，不做实现、不做架构决策  
> **下一步**：用户确认后走 `/sc:design` 做架构设计  
> **原始产物**：详见 `claudedocs/research_raw_*.md`（6 份原始交付 + 1 份 SDK 笔记）

---

## 1. 执行摘要

本项目目标是构建一个 **Unturned Linux 专用服务器的 Web UI 管理面板**（前端 React，后端 Node.js）。本报告覆盖六条调研线，聚焦于"能做"而非"假设"：围绕 Unturned 3.26.x 的实际文件、实际协议、实际社区生态做判断。

**核心结论（一句话版）**：
- Unturned 服务端通过 SteamCMD (AppID 1110390, anonymous) 安装，启动后不依赖 Mono/.NET SDK
- RCON 有四层实现——Node.js 生态有成熟方案：`rcon-srcds`（OpenMod） + `net` 模块（RocketMod Telnet fallback）
- Workshop Mod 管理本质是编辑 JSON 数组 + 滚动重启，不存在无宕机热加载
- Steam WebAPI 可通过 `?xml=1` 无登录获取 Workshop 元数据，也可以免费注册 API Key（10万次/天）
- 没有任何开源项目提供了 Unturned 专用 Web 管理面板（社区靠 Pterodactyl Egg + 命令行凑合）
- 这个领域有一个明确的"差异化空间"：一个轻量的、React 前端的、专门面向 Unturned 的自托管面板

**详细参考文档**：
- `claudedocs/reference_config_files.md` — 配置文件完整参数表（Commands.dat / Config.txt / WorkshopDownloadConfig.json / Rocket XML / OpenMod YAML）
- `claudedocs/reference_console_commands.md` — 控制台指令完整参考（~64 条，含参数格式/权限/RCON 示例）
- `claudedocs/research_supplement_rcon_libraries.md` — Node.js RCON 生态 + Steam WebAPI + Mod 配置可视化

---

## 2. Unturned Linux 服务端安装与启动

### 2.1 SteamCMD 下载

| 参数 | 值 |
|---|---|
| Dedicated Server AppID | **1110390**（自发布未变） |
| 登录方式 | **anonymous**（匿名，无需 Steam 账号） |
| 安装命令 | `steamcmd +login anonymous +force_install_dir /opt/unturned +app_update 1110390 validate +quit` |

来源：SDG 官方文档 `docs.smartlydressedgames.com/en/stable/servers/steamcmd.html`、Valve Developer Wiki Dedicated Servers List。置信度：**高**。

### 2.2 运行时：Unity 内置 Mono

U3DS 运行在 Unity 2020.3 LTS 上，默认脚本后端是 **Mono**（非 IL2CPP）。`Unturned_Data/Managed/` 目录存放 Unity 自带 Mono 运行时和游戏 C# 程序集。

**实际部署建议**：LinuxGSM 截至 2026 年仍要求 `mono-complete`；建议部署时安装 Mono 以防缺失依赖。部分系统上 Unity headless 构建可能内嵌足够运行时而不需要完整系统 Mono——但以"安装 Mono"作为安全基线。

> ⚠️ 原调研中"不需要 Mono"的判断已被推翻。详见 `claudedocs/research_verification_tracker.md`。

### 2.3 启动

```bash
./ServerHelper.sh +InternetServer/MyServer -ThreadedConsole
```

- `+InternetServer/<ServerID>`：Internet 模式，指定存档/配置文件夹名
- `-ThreadedConsole`：Linux 控制台输入优化，推荐始终加上
- 旧 CLI 参数（-port, -map, -pvp, -password 等）当前版本写入 `Commands.dat`，不写命令行
- 默认端口：UDP 27015（游戏）+ 27016（查询 = port+1）

### 2.4 关键文件

| 文件 | 用途 |
|---|---|
| `Servers/<ID>/Server/Commands.dat` | Owner、Map、Port、Password、MaxPlayers、Cheats、RCON 开关 |
| `Servers/<ID>/Config.txt` | 游戏玩法（掉落/伤害/建造）、浏览器展示、GSLT Token（≥3.25.8.0，替代旧 Config.json） |
| `Servers/<ID>/Server/WorkshopDownloadConfig.json` | **Workshop Mod ID 列表** |
| `Servers/<ID>/Server/Adminlist.dat` | 管理员 SteamID64 白名单 |

### 2.5 systemd 部署

使用 `screen -dmS` + `ExecStartPre` SteamCMD 自动更新 + `ExecStop` 发 `save`/`shutdown` 优雅关闭。详见原始产物 `research_raw_linux_install.md`。

---

## 3. RCON 协议（四层体系）

**核心发现：RCON 不是一层，是互不兼容的四层。**

| 层 | 来源 | 协议 | 配置 | 端口 |
|---|---|---|---|---|
| ① Native SDG RCON | 官方 | ICommandInputOutput（**未公开**） | Commands.dat `RCON Enabled/Port/Password` | 同游戏端口 |
| ② RocketMod/LDM RCON | 社区 | **Telnet**（明文行） | Rocket.config.xml | 游戏端口+2 |
| ③ OpenMod RCON | 社区 | **Valve Source RCON**（TCP LE 二进制） | openmod.yaml | 可配置 |
| ④ BattlEye RCON | BE | 自定义 UDP + CRC32 | BEServer.cfg | 游戏端口+3 |

### 3.1 Web 面板推荐方案（Node.js）

**主力：OpenMod Valve Source RCON → `rcon-srcds` (npm, TypeScript, 零依赖)**

```js
import { Rcon } from 'rcon-srcds';
const rcon = new Rcon({ host: '127.0.0.1', port: 25545 });
await rcon.authenticate('ServerOwner:Jingle');  // OpenMod ID:PASSWORD 格式
const players = await rcon.execute('Players');
```

**Fallback：RocketMod Telnet RCON → Node.js `net` 模块（几十行代码）**

```js
const net = require('net');
const client = net.createConnection({ host: '127.0.0.1', port: 27117 }, () => {
  client.write('login YourPassword\n');
  client.write('Players\n');
});
```

**辅助：服务器状态查询 → `@fabricio-191/valve-server-query` (npm)**
支持完整的 Valve 协议套件：A2S_INFO（服务器名/地图/人数）、A2S_PLAYER、A2S_RULES + RCON。

**其他 Node.js 备选**：`node-rcon` (pushrax, 53 commits, 不活跃)、`ts-rcon` (TypeScript 重写)、`working-rcon` (跨游戏兼容性)。详见 `claudedocs/research_supplement_rcon_libraries.md`。

### 3.2 权限与命令

| 层级 | 设置方式 | 范围 |
|---|---|---|
| Owner | Commands.dat `Owner <SteamID64>` | 全部命令 |
| Admin | Adminlist.dat 或 /admin 命令 | 除 Owner-only 外 |
| Default | 所有人 | 无管理命令 |

完整命令列表 ~60+ 条（来源 `unturned.wiki.gg/wiki/Console_commands`），涵盖：玩家管理（kick/ban/slay/spy）、世界控制（time/day/night/weather/save）、物品载具（give/vehicle）、配置（name/password/port/maxplayers/mode）、生命周期（shutdown/reload）。

RCON/控制台命令无前缀空格分隔；游戏内聊天用 `/` 或 `@` 前缀。

### 3.3 待验证

- 原生 SDG RCON 线协议格式（需反编译 Assembly-CSharp.dll）
- 2018 Devlog #012 描述的 JSON HTTP API (`/rcon/teleport?key=...`) 是否在 U3DS 中实际存在

---

## 4. Steam Workshop 集成

### 4.1 WorkshopDownloadConfig.json（权威配置）

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

- `File_IDs`：Steam Workshop File ID（取自 URL `?id=` 参数）
- `Ignore_Children_File_IDs`：排除指定 mod 的子依赖
- `Should_Monitor_Updates=true`：运行时监控 Workshop 更新，检测到后倒计时关机

### 4.2 Mod 加载流程

1. 启动 → 读取 WorkshopDownloadConfig.json
2. Steam Workshop API 下载/更新 File_IDs 中的 mod
3. 自动解析依赖（除非在 Ignore_Children_File_IDs 中排除）
4. 地图 → `Servers/<ID>/Workshop/Maps/`，其他 → `Content/`
5. 解析 MasterBundle.dat + .masterbundle

### 4.3 客户端同步

官方："Players will automatically begin downloading any mods while connecting to the server." 客户端连接时自动订阅并下载服务端配置的所有 Workshop mod，完全无需玩家手动操作。GameServerKings 2026-08-01 明确："Older guidance telling you to make players subscribe manually is wrong."

### 4.4 Steam WebAPI：无需 Steam 登录即可获取 Workshop 数据

**核心结论：可以。** 有三种方式获取 Workshop Mod 元数据，其中有两种不需要 Steam 账号登录：

| 方式 | 需要登录？ | 需要 API Key？ | 数据丰富度 |
|---|---|---|---|
| `steamcommunity.com/sharedfiles/filedetails/?id=<ID>&xml=1` | **否** | **否** | 中等（标题/作者/描述/预览图/文件大小/更新时间） |
| `ISteamRemoteStorage/GetPublishedFileDetails/v1` (POST) | 否 | **可能不需要**（xPaw 文档参数表无 key） | 中等 |
| `IPublishedFileService/GetDetails` (GET) | 否 | **是**（免费注册） | **最高**（含 children/requiredItems/tags/votes） |

**Steam WebAPI Key 获取**：`steamcommunity.com/dev/apikey`
- 免费，每日 100,000 次请求
- 需 Steam 账号有 $5+ 消费记录 + 手机令牌
- Key 可随时撤销重生成

**建议**：面板首次发布用 `?xml=1` 零门槛方案；后续升级到 `IPublishedFileService/GetDetails`（需要用户在面板设置中填自己的 API Key 或面板自带 Key）。

### 4.5 私有 Mod Workaround

U3DS 不能登录 Steam 账号。私有/Friends-Only mod 需：SteamCMD + 认证账号下载 → symlink 到服务器目录 → 仍把 File ID 写入 WorkshopDownloadConfig.json。置信度：**高**。

### 4.5 Allowed IPs

mod 作者可设置 "Allowed IPs" 限制**服务端**自动下载。**不影响客户端订阅/连接时自动下载**。SDG 官方："only the servers with that IP address will be able to automatically download"。置信度：**高**。

---

## 5. Mod 可视化管理

### 5.1 核心约束：不存在无宕机热加载

- Workshop Mod 修改后**必须重启服务器**才能生效
- Rocket 的 `/rocket reload` 被官方确认 "breaks most current plugins"（U3-SDK Issue #1794）
- OpenMod 的 `openmod reload` 也要求重启
- 官方唯一背书的"优雅升级"模式：`Should_Monitor_Updates=true` + 倒计时关机 + 外部重启

### 5.2 面板应展示的 Mod 字段（最小可用）

```
[✓/✗ Enable] [Icon]  Name (Workshop File ID)  v Version
  ├── Author | Description
  ├── Dependencies → Steam WebAPI children/requiredItems
  ├── Last Update | File Size
  ├── Status: mounted / error / missing / updating
  └── [Configure] → 打开此 Mod 的配置文件编辑器
```

- **元数据来源**：`Bundles/<mod>/meta.dat`（Name/Author/Description/Version）+ Steamodded smods 字段（dependencies, icon_path, badge_colour）+ `?xml=1` Steam 页面解析
- **依赖解析**：Steam WebAPI `ISteamRemoteStorage/GetPublishedFileDetails/v1` 或 `?xml=1` 解析

### 5.3 Mod 配置文件可视化

许多 Mod（特别是 RocketMod 和 OpenMod 插件）有自己的配置文件，需要在面板中可视化编辑：

| 框架 | 格式 | 路径 | 热重载 |
|---|---|---|---|
| RocketMod | XML (`Configuration.xml`) | `Rocket/Plugins/<Name>/` | `/rocket reload` — **不推荐**（会破坏插件） |
| RocketModFix | JSON | `Rocket/Plugins/<Name>/` | 同上 |
| OpenMod | YAML (`config.yaml`) | `openmod/plugins/<Id>/` | `openmod reload <Id>` — **官方支持** ✅ |

**Web 面板实现策略**：
1. 扫描 `Rocket/Plugins/` 和 `openmod/plugins/` 目录，收集所有配置文件
2. XML → `fast-xml-parser` (npm) 转 JSON → 动态表单渲染
3. JSON → 直接渲染表单
4. YAML → `js-yaml` (npm) 解析 → 嵌套表单渲染
5. 保存时写回原格式
6. 对 OpenMod 插件，修改后可尝试通过 RCON 执行 `openmod reload <PluginId>` 热生效
7. 对 RocketMod 插件，UI 上提示"配置已保存，需重启服务器生效"

### 5.3 变更流水线

```
编辑 Mod 列表 → JSON 校验 → 备份 WorkshopDownloadConfig.json.bak
  → 写入新 File_IDs → 广播"Mod 变更，N 秒后重启"
  → 触发 Shutdown → 外部进程重启 → 等待 "Server ready"
```

---

## 6. 同类 Web 面板竞品分析

### 6.1 竞品总表

| 面板 | 开源 | 许可证 | 前端 | 后端 | 内置 Workshop 浏览器 |
|---|---|---|---|---|---|
| **Pterodactyl** | ✅ | MIT | React+TS+Tailwind | PHP(Laravel)+Wings(Go) | ❌ |
| **Pelican** | ✅ | AGPL-3.0 | FilamentPHP(Blade) | PHP(Laravel)+Wings(Go) | ❌ |
| **AMP** | ❌ | $10-40 买断 | 原生 HTML/JS | .NET/C# | ✅ (唯一) |
| **PufferPanel** | ✅ | Apache-2.0 | Vue.js | Go(单体) | ❌ |
| **TCAdmin** | ❌ | $7.95/月起 | 原生 HTML | .NET/C# | 插件化 |
| **Crafty** | ✅ | GPL-3.0 | AdminLTE(jQuery) | Python(Tornado) | ❌ |
| **LinuxGSM** | ✅ | MIT | 无 Web UI | Bash | ❌ |

### 6.2 关键发现

- **Pterodactyl** (9.1k★ MIT)：最成熟。Panel(React) + Wings(Go) + Docker。Egg 模板管理 SteamCMD。WebSocket 实时控制台。50+ 粒度权限。**但无面板级 RCON 抽象，无 Workshop 浏览器。**
- **Pelican** (2.2k★ AGPLv3)：Pterodactyl 社区 Fork，FilamentPHP 替代 React，更活跃。
- **AMP** (.NET 商业)：**唯一内置 Steam Workshop 浏览器的面板**（2.7 Deimos 版还支持 Modrinth/CurseForge）。ADS 实例管理器。无 Docker 依赖。付费。
- **PufferPanel** (1.7k★ Apache-2.0)：最轻量。Go 单体 + Vue.js。
- **Unturned 专用 Web 面板**：**不存在活跃的开源项目**。社区靠 Pterodactyl Egg + RocketMod 命令行。

### 6.3 对本项目的启示

1. **不需要另一个 Pterodactyl**——Pterodactyl 是通用游戏面板，对 Unturned 而言过重（Docker 强制、PHP 后端、无 Workshop 集成）
2. **AMP 的 Workshop 浏览器是标杆**——但它是闭源商业产品，且技术栈老旧
3. **差异化空间明确**：一个轻量、React 前端、专门针对 Unturned 的自托管面板，内置 Workshop Mod 浏览器 + RCON 控制台 + 实时日志
4. **前端 React 选型正确**——所有开源竞品中只有 Pterodactyl 用 React，Pelican 退回了 Blade，PufferPanel 用 Vue。用 React+TypeScript+Tailwind 做 Unturned 面板是差异化优势

---

## 7. 架构方向建议（不决策，仅供下一阶段输入）

以下是在调研事实基础上提出的**候选方向**，不是设计决策。`/sc:design` 阶段会做正式选型。

### 7.1 后端选型：Node.js

用户已选定 **Node.js** 后端。基于调研结果的技术栈建议：

| 层 | 推荐 | 备选 |
|---|---|---|
| HTTP 框架 | Express + TypeScript | Fastify |
| RCON 通信 | `rcon-srcds` (npm) | `@fabricio-191/valve-server-query` |
| WebSocket | `ws` 或 Socket.IO | SSE (EventSource) |
| XML 解析 | `fast-xml-parser` | — |
| YAML 解析 | `js-yaml` | — |
| 进程管理 | `child_process` (spawn systemd/screen) | pm2 |
| Steam WebAPI | `?xml=1` 抓取（零门槛）→ 升级到 API Key | `steamapi` (npm) |

### 7.2 关键能力矩阵

| 能力 | 优先级 | 实现方式 |
|---|---|---|
| 服务器启停/重启 | P0 | 管理 systemd unit 或直接 spawn 进程 |
| RCON 控制台（实时） | P0 | RconSharp + WebSocket/SSE 推送 |
| Workshop Mod 列表展示 | P1 | 读 WorkshopDownloadConfig.json + Steam WebAPI 补齐元数据 |
| Mod 增删 + 重启 | P1 | 写 JSON → 备份 → shutdown 命令 → 等进程退出 → 重 spawn |
| 实时日志 tail | P1 | WebSocket push stdout/stderr + Servers/*/Logs/ |
| Config.txt 可视化编辑 | P2 | 解析 Key Value 格式 → 表单 UI |
| 玩家列表 + 操作 | P2 | RCON `players` 命令解析 |
| 多用户权限 | P2 | Owner/Admin/Viewer 三级 |
| 多服务器管理 | P3 | 配置多个 ServerID |
| Steam Workshop 浏览器 | P3 | Steam WebAPI 搜索 + 一键添加 ID 到 File_IDs |

---

## 8. 信息来源与置信度

### 一手/官方来源（高置信度）

| URL | 标题 |
|---|---|
| `docs.smartlydressedgames.com/en/stable/servers/steamcmd.html` | Using SteamCMD |
| `docs.smartlydressedgames.com/en/stable/servers/server-hosting.html` | Server Hosting |
| `docs.smartlydressedgames.com/en/latest/servers/server-configuration.html` | Server Configuration |
| `docs.smartlydressedgames.com/en/stable/servers/server-auto-restart.html` | Server Auto Restart |
| `docs.smartlydressedgames.com/en/stable/servers/command-io.html` | Command IO |
| `docs.smartlydressedgames.com/en/latest/about/steam-workshop.html` | Steam Workshop |
| `docs.smartlydressedgames.com/en/latest/sdg/hosting-servers-using-private-workshop-files.html` | Private Workshop Files |
| `docs.smartlydressedgames.com/en/stable/servers/openmod.html` | OpenMod |
| `docs.smartlydressedgames.com/en/stable/assets/asset-bundles.html` | Asset Bundles |
| `steamcommunity.com/app/304930/workshop` | Steam Workshop (Unturned) |
| `developer.valvesoftware.com/wiki/SteamCMD` | SteamCMD (Valve) |
| `developer.valvesoftware.com/wiki/Source_RCON_Protocol` | Source RCON Protocol (Valve) |
| `developer.valvesoftware.com/wiki/Dedicated_Servers_List` | Dedicated Servers List (Valve) |
| `battleye.com/downloads/BERConProtocol.txt` | BattlEye RCON v2 |
| `blog.smartlydressedgames.com/posts/2018-07-01-unturned-ii-devlog-012/` | Unturned II Devlog #012 |

### 社区/半官方来源

| URL | 说明 |
|---|---|
| `unturned.wiki.gg/wiki/Console_commands` | 完整命令列表 (~60+ 条) |
| `unturned.wiki.gg/wiki/Linux_dedicated_server` | Linux 服务端完整指南 |
| `github.com/SmartlyDressedGames/U3-SDK/issues/1794` | Rocket reload 风险确认 |
| `github.com/SmartlyDressedGames/U3-SDK/issues/3836` | Workshop 列表讨论 |
| `docs.57studios.net/items/project-folder-structure-and-guids` | Mod 文件结构 |
| `github.com/Steamodded/smods/wiki/Mod-Metadata` | Mod 元数据字段 |
| `github.com/stefanodriussi/rconsharp` | RconSharp (C# RCON 库) |
| `github.com/openmod/openmod` | OpenMod 框架 |
| `github.com/pterodactyl/panel` | Pterodactyl 面板 |
| `github.com/pelican-dev/panel` | Pelican 面板 |
| Multiple hosting providers | 交叉验证配置格式 |

### 待二次确认 → 详见 `claudedocs/research_verification_tracker.md`

已将所有"待确认/置信度中低"条目收拢到独立的验证追踪文档。关键结论：

| # | 条目 | 核查结果 |
|---|---|---|
| 1 | Devlog #012 HTTP API 存在？ | ❌ 不存在（Unturned II only，已取消） |
| 2 | Config.txt 含 RCON 段？ | ❌ 不含 |
| 3 | Should_Monitor_Updates 行为？ | ✅ 已确认：检测更新→广播→强制踢出→关机 |
| 4 | 原生 RCON 配置存在？ | ✅ 确认，但线协议仍未知 |
| 5 | Steam WebAPI 无 Key？ | `?xml=1` ✅ / WebAPI ❓ 待实测 |
| 6 | OpenMod RCON 可靠性？ | 无已知问题，但缺大规模数据 |
| 7 | Game Labs/SynUW？ | ❌ 不存在于 Unturned 生态 |
| 8 | **不需要 Mono？** | **❌ 被推翻**，LinuxGSM 2026 仍要求 Mono |

**对开发有阻塞影响的两项需优先实测**：
- Steam WebAPI `GetPublishedFileDetails` 对 Unturned 304930 的无 Key 调用
- OpenMod `reload` 在生产中的实际成功率

其余验证项可在开发过程中逐步清除，不阻塞 `/sc:design` 启动。

---

## 9. 子产物索引

| 文件 | 类型 | 内容 |
|---|---|---|
| `claudedocs/research_unturned_panel_2026-08-03.md` | **总报告** | 本文档 |
| `claudedocs/reference_config_files.md` | **配置参考** | Commands.dat / Config.txt / WorkshopDownloadConfig.json / Rocket XML / OpenMod YAML 完整参数表 |
| `claudedocs/reference_console_commands.md` | **命令参考** | ~64 条控制台指令完整语法/权限/RCON 示例 |
| `claudedocs/research_supplement_rcon_libraries.md` | **补充调研** | Node.js RCON 生态 + Steam WebAPI 匿名访问 + Mod 配置可视化 |
| `claudedocs/research_raw_linux_install.md` | 原始交付 | #1 Linux 安装与启动 |
| `claudedocs/research_raw_rcon.md` | 原始交付 | #2 RCON 协议 |
| `claudedocs/research_raw_steam_workshop.md` | 原始交付 | #3 Steam Workshop |
| `claudedocs/research_raw_mods_visualization.md` | 原始交付 | #4 Mod 可视化 |
| `claudedocs/research_raw_competitor_panels.md` | 原始交付 | #5 同类面板 |
| `claudedocs/research_unturned_panel_sdk_notes.md` | 原始交付 | #6 U3-SDK 阅读笔记 |

---

*报告结束。`/sc:research` 阶段完成，等待用户确认后进入下一阶段。*
