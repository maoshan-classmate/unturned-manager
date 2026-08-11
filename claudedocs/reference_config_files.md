# Unturned 服务端配置文件完整参数参考

> 面向 Web UI 管理面板的可视化配置编辑器设计。  
> 每个字段标注：类型、默认值、取值范围、Web UI 控件建议、**SDK 真源（U3-SDK 代码行号，`.research/U3-SDK/`）**。

---

## 1. Commands.dat — 服务器启动/运行时指令

**路径**：`Servers/<ServerID>/Server/Commands.dat`  
**格式**：每行一条指令，空格分隔参数  
**加载**：服务器启动时读取，部分指令运行时也可通过控制台/RCON 执行  
**真源根**：`Provider.cs` 6615–6645（dedicated server init 段）

### 1.1 服务器身份与连接

| 指令 | 参数 | 类型 | 默认值 | SDK 真源 | 范围 | 分类 | Web UI 控件 |
|---|---|---|---|---|---|---|---|
| `Name` | `<Text>` | string | `Unturned`（EXPERIMENTAL 构建是 `Unturned Experimental`） | `Provider.cs:6617-6621` | 5–50 字符（`CommandName.cs:11-12` `MIN_LENGTH`/`MAX_LENGTH`） | any | 文本输入框 (maxlength=50) |
| `Password` | `<Text>` | string | `""` | `Provider.cs:6622` `serverPassword = ""` | 任意文本 | config | 密码输入框 (SHA-1 哈希存储) |
| `Port` | `<Number>` | int | `27015` | `Provider.cs:6625` `port = 27015`；查询端口 = Port+1 见 `Provider.cs:4476` `GetServerConnectionPort()` | 1024–65535 | config | 数字输入 + 提示"占用 2 个连续端口" |
| `Bind` | `<IP>` | string | `0`（IPv4 = `0.0.0.0`） | `Provider.cs:6624` `ip = 0` | 有效 IP | config | 文本输入 (IP 格式校验) |
| `MaxPlayers` | `<Number>` | int | `8` | `Provider.cs:6615` `maxPlayers = 8` | 1–200（`CommandMaxPlayers.cs:11-14`） | any | 数字滑块 |
| `Queue_Size` | `<Number>` | int | `8` | `Provider.cs:6616` `queueSize = 8` | 0–64 | any | 数字滑块 |
| `GSLT` | `<LoginToken>` | string | 无（`null`） | `CommandGSLT.cs:11` | — | config | 密码输入框 + 链接到 steamcommunity.com/dev/managegameservers |
| `Perspective` | `First\|Third\|Both\|Vehicle` | enum | `FIRST`（专用服务器；单机默认 `BOTH`，不同） | `Provider.cs:6645` `cameraMode = ECameraMode.FIRST`；单机对比 `Provider.cs:2081` `cameraMode = ECameraMode.BOTH` | — | config | 下拉选择 |

### 1.2 地图与游戏模式

| 指令 | 参数 | 类型 | 默认值 | SDK 真源 | 范围 | 分类 | Web UI 控件 |
|---|---|---|---|---|---|---|---|
| `Map` | `<Level>` | string | `PEI`（UNITY_EDITOR 自动加载覆写除外） | `Provider.cs:6627` `map = "PEI"` | 已安装地图 | config | 下拉选择（从 Maps/ 目录扫描） |
| `Mode` | `Easy\|Normal\|Hard` | enum | `Normal` | `Provider.cs:6642` `mode = EGameMode.NORMAL` | — | config | 下拉选择 |
| `GameMode` | `<ClassName>` | string | 无 | — | 已安装 GameMode | config | 下拉选择 |
| `PvE` | 无参数 | flag | 关闭（默认 PvP 模式） | `Provider.cs:6637` `isPvP = true`；切换 `CommandPvE.cs:24` 写 `isPvP = false` | — | config | 开关 (PvP / PvE) |
| `Cheats` | 无参数 | flag | 关闭 | `Provider.cs:6640` `hasCheats = false` | — | config | 开关 |

### 1.3 管理权限

| 指令 | 参数 | 类型 | 默认值 | SDK 真源 | 范围 | 分类 | Web UI 控件 |
|---|---|---|---|---|---|---|---|
| `Owner` | `<SteamID>` | SteamID64 | 无（`CSteamID.Nil`） | `SteamAdminlist.cs:19` `public static CSteamID ownerID;` | 单个 17 位 ID | config | 文本输入 (SteamID64 格式校验) |

### 1.4 安全与过滤

| 指令 | 参数 | 类型 | 默认值 | SDK 真源 | 范围 | 分类 | Web UI 控件 |
|---|---|---|---|---|---|---|---|
| `Gold` | 无参数 | flag | 关闭 | `Provider.cs:6643` `isGold = false` | — | config | 开关 |
| `Whitelisted` | 无参数 | flag | 关闭 | `Provider.cs:6638` `isWhitelisted = false` | — | config | 开关 |
| `Filter` | 无参数 | flag | 关闭 | `Provider.cs:6641` `filterName = false` | — | config | 开关 |
| `Hide_Admins` | 无参数 | flag | 关闭 | `Provider.cs:6639` `hideAdmins = false` | — | config | 开关 |
| `Sync` | 无参数 | flag | 关闭 | U3-SDK 无独立默认赋值行，参见 `CommandSync.cs` | — | config | 开关 |

### 1.5 RCON（原生 SDG RCON — 协议未公开，但 Commands.dat 支持配置）

| 指令 | 参数 | 类型 | 默认值 | SDK 真源 | 范围 | 分类 | Web UI 控件 |
|---|---|---|---|---|---|---|---|
| `RCON Enabled` | `true\|false` | bool | 未确认 | — | — | config | 开关 |
| `RCON Port` | `<Number>` | int | 同游戏端口 | — | 1024–65535 | config | 数字输入 |
| `RCON Password` | `<String>` | string | 无 | — | 任意文本 | config | 密码输入框 |

> **注意**：这三个指令的存在来自 Zonely 托管面板文档，SDG 官方文档未公开确认。面板命令通道是 PTY 终端（ADR-0004 Phase 6），不配置原生 RCON。建议在 UI 上标注"实验性 / 保持未配置"。

### 1.6 游戏参数

| 指令 | 参数 | 类型 | 默认值 | SDK 真源 | 范围 | 分类 | Web UI 控件 |
|---|---|---|---|---|---|---|---|
| `Timeout` | `<Number>` | int (ms) | `750` | 字段定义 `PlayConfigData.cs:404` `Max_Ping_Milliseconds = 750`；命令 `CommandTimeout.cs:42` 写入 `Provider.configData.Server.Max_Ping_Milliseconds` | 50–10000 | any | 数字滑块 |
| `Chatrate` | `<Number>` | float (秒) | `0.25` | `ChatManager.cs:74` `public static float chatrate = 0.25f;` | 0–60 | any | 数字输入 |
| `Cycle` | `<Number>` | int (秒) | `3600` | `LightingManager.cs:852/883` 关卡初始化 `_cycle = 3600`；第 973 行防零除也兜底 3600 | >0 | any | 数字输入（含 "现实时间对照" 提示） |

### 1.7 日志

| 指令 | 参数 | 类型 | 默认值 | SDK 真源 | 分类 | Web UI 控件 |
|---|---|---|---|---|---|---|
| `Log` | `Chat Y/N, Join/Leave Y/N, Death Y/N, Anticheat Y/N` | 4×bool | `Y/Y/Y/N` | `CommandWindow.cs:49-52`：`shouldLogChat`/`shouldLogJoinLeave`/`shouldLogDeaths` 默认 `true`，`shouldLogAnticheat` 默认 `false` | any | 四个独立开关（`#19 阶段2`） |

### 1.8 投票与开局物品

| 指令 | 参数 | 类型 | 默认值 | SDK 真源 | 分类 | Web UI 控件 |
|---|---|---|---|---|---|---|
| `Votify` | `Allow Y/N, PassCooldown, FailCooldown, Duration, Percentage, Players` | mixed | `voteAllowed=false` / `votePassCooldown=5.0f` / `voteFailCooldown=60.0f` / `voteDuration=15.0f` / `votePercentage=0.75f` / `votePlayers=3` | `ChatManager.cs:76-81`（6 个字段一次性定义） | any | 结构化表单（`#19 阶段3`：1 toggle + 5 number 输入，默认值与 SDK 对齐） |
| `Loadout` | `<SkillsetID>/<itemID>/<itemID>/...`（允许重复行，每个 SkillsetID 一行；同 ID 多行后写覆盖前写） | list | **不写 = SDK 默认**：`LOADOUT = {}` + `SKILLSETS_SERVER = [[]×11`——玩家开局**无任何额外物品** | 数组定义 `PlayerInventory.cs:30` `public static readonly ushort[] LOADOUT = { };` 和 `PlayerInventory.cs:32` `public static readonly ushort[][] SKILLSETS_SERVER = new ushort[11][] { new ushort[0] { }, ... };`；解析/写入语义 `CommandLoadout.cs:42-49` | any | LoadoutEditor（11 技能组下拉 + chip 列表，`#19 阶段4`） |

---

## 2. Config.txt — 高级游戏设置

**路径**：`Servers/<ServerID>/Config.txt`  
**格式**：`Key Value`（空格分隔），`>` 开头为注释行  
**版本**：≥3.25.8.0（2025-09），替代旧 Config.json

### 2.1 Browser 段（Steam 浏览器展示）

| 字段 | 类型 | 默认值 | SDK 真源 | 范围 | 说明 | Web UI 控件 |
|---|---|---|---|---|---|---|
| `Login_Token` | string | 空 | — | — | GSLT，在 steamcommunity.com/dev/managegameservers 用 AppID 304930 创建 | 密码输入框 + 外部链接 |
| `Desc_Full` | string | 空 | — | — | 服务器详情页的完整描述（支持多行） | 多行文本编辑器 |
| `Desc_Server_List` | string | 空 | — | — | 服务器列表中的简短描述 | 文本输入框 |
| `Icon` | string (URL) | 空 | — | — | 服务器图标 URL | 文本输入 + 预览 |
| `Thumbnail` | string (URL) | 空 | — | — | 缩略图 URL | 文本输入 + 预览 |
| `Links` | list of URLs | 空 | — | — | 额外链接列表 | URL 列表编辑器 |

### 2.2 Server 段（服务器行为）

| 字段 | 类型 | 默认值 | SDK 真源 | 范围 | 说明 | Web UI 控件 |
|---|---|---|---|---|---|---|
| `VAC_Secure` | bool | `true` | `PlayConfigData.cs:402` `VAC_Secure = true` | — | Valve Anti-Cheat 开关 | 开关 |
| `BattlEye_Secure` | bool | — | U3-SDK 本地副本未找到字段定义（`.research/U3-SDK/Assets/Runtime/Assembly-CSharp/Unturned/` 全搜无结果），需实机验证 | — | BattlEye 反作弊 | 开关 |
| `Max_Ping_Milliseconds` | uint | `750` | `PlayConfigData.cs:404` `Max_Ping_Milliseconds = 750` | — | Ping 超时（`Commands.dat Timeout` 命令同步写到这里，见 `CommandTimeout.cs:42`） | 数字滑块 |
| `Timeout_Queue_Seconds` | float | `15` | `PlayConfigData.cs:405` `Timeout_Queue_Seconds = 15` | — | 队列中无响应超时（秒） | 数字输入 |
| `Timeout_Game_Seconds` | float | `30` | `PlayConfigData.cs:406` `Timeout_Game_Seconds = 30` | — | 游戏中无响应超时（秒） | 数字输入 |
| `Max_Clients_With_Same_IP_Address` | int | `64` | `PlayConfigData.cs:279` `Max_Clients_With_Same_IP_Address = 64` | — | 同 IP 最大并发连接数 | 数字输入 |