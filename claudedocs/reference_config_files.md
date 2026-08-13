# Unturned 服务端配置文件参数参考（面板已实现字段）

> 面向 Web UI 管理面板的可视化配置编辑器设计。  
> 每个字段标注：类型、默认值、取值范围、Web UI 控件建议、**SDK 真源（U3-SDK 代码行号，`.research/U3-SDK/`）**。

> **字段细节自行溯源**：本文档只收录面板已实现字段的权威表，**不穷举所有配置项**。凡设计到具体字段名、枚举值、取值范围、解析/写入逻辑等细节，请直接到 U3-SDK 源码中查找对应类（`.research/U3-SDK/Assets/Runtime/Assembly-CSharp/Unturned/`），不要以本文档或社区教程为准。

---

## 1. Commands.dat — 服务器启动/运行时指令

**路径**：`Servers/<ServerID>/Server/Commands.dat`  
**格式**：每行一条指令，空格分隔参数  
**加载**：服务器启动时读取，部分指令运行时也可通过控制台执行（命令通道是 PTY 终端 owner-trust 模型，无 RCON）  
**真源根**：`Provider.cs` 6615–6645（dedicated server init 段）

### 1.1 服务器身份与连接

| 指令 | 参数 | 类型 | 默认值 | SDK 真源 | 范围 | 分类 | Web UI 控件 |
|---|---|---|---|---|---|---|---|
| `Name` | `<Text>` | string | `Unturned`（EXPERIMENTAL 构建是 `Unturned Experimental`） | `Provider.cs:6617-6621` | 5–50 字符（`CommandName.cs:11-12` `MIN_LENGTH`/`MAX_LENGTH`） | any | 文本输入框 (maxlength=50) |
| `Password` | `<Text>` | string | `""` | `Provider.cs:6622` `serverPassword = ""`；`CommandPassword.cs:31` `Provider.serverPassword = parameter.Trim()`（**明文存储，无哈希**——任何拿到 Commands.dat 的人都能看到密码） | 任意文本 | config | 密码输入框（写入明文，文件权限必须 600） |
| `Port` | `<Number>` | int | `27015` | `Provider.cs:6625` `port = 27015`；查询端口 = Port+1 见 `Provider.cs:4476` `GetServerConnectionPort()`；`CommandPort.cs:18-23` 用 `ushort.TryParse` 接受 0–65535 | 0–65535（`ushort` 全范围，无 SDK 强制下界；建议 1024+） | config | 数字输入 + 提示"占用 2 个连续端口" |
| `Bind` | `<IP>` | string | `0`（IPv4 = `0.0.0.0`） | `Provider.cs:6624` `ip = 0`；`CommandBind.cs:18` 用 `Parser.checkIP` 校验 + `CommandBind.cs:30` `Parser.getUInt32FromIP` 解析 | 有效 IP（含 `0` 特殊值=所有接口） | config | 文本输入 (IP 格式校验) |
| `MaxPlayers` | `<Number>` | int | `8` | `Provider.cs:6615` `maxPlayers = 8`；`CommandMaxPlayers.cs:11-14` `MIN_NUMBER=1 / MAX_NUMBER=200` | 1–200（`CommandMaxPlayers.cs:11-14`，注：`RECOMMENDED_NUMBER=24` 已 `[Obsolete]`） | any | 数字滑块 |
| `Queue_Size` | `<Number>` | int | `8` | `Provider.cs:6616` `queueSize = 8`；`CommandQueue.cs:12` `MAX_NUMBER=64`（无 MIN 校验）；运行时额外支持 `a/r/ad/rd` 调试参数（`CommandQueue.cs:21-54`） | 0–64（实际接受 0–255，但 `>64` 会被拒） | any | 数字滑块 |
| `GSLT` | `<LoginToken>` | string | 无（`null`） | `CommandGSLT.cs:11` `public static string loginToken { get; private set; }`；`CommandGSLT.cs:30` 直接 `loginToken = parameter`——**SDK 不校验格式** | 任意字符串（SDK 无校验；面板可加 32 位 token 长度提示但非强制） | config | 密码输入框 + 链接到 steamcommunity.com/dev/managegameservers |
| `Perspective` | `First\|Third\|Both\|Vehicle` | enum | `FIRST`（专用服务器；单机默认 `BOTH`，不同） | `Provider.cs:6645` `cameraMode = ECameraMode.FIRST`；单机对比 `Provider.cs:2081` `cameraMode = ECameraMode.BOTH`；`CommandCamera.cs:21-36` 4 枚举值与 `ECameraMode.cs` 一致 | — | config | 下拉选择 |

### 1.2 地图与游戏模式

| 指令 | 参数 | 类型 | 默认值 | SDK 真源 | 范围 | 分类 | Web UI 控件 |
|---|---|---|---|---|---|---|---|
| `Map` | `<Level>` | string | `PEI`（UNITY_EDITOR 自动加载覆写除外） | `Provider.cs:6627` `map = "PEI"` | 已安装地图 | config | 下拉选择（从 Maps/ 目录扫描） |
| `Mode` | `Easy\|Normal\|Hard` | enum | `Normal` | `Provider.cs:6642` `mode = EGameMode.NORMAL` | — | config | 下拉选择 |
| `PvE` | 无参数 | flag | 关闭（默认 PvP 模式） | `Provider.cs:6637` `isPvP = true`；切换 `CommandPvE.cs:24` 写 `isPvP = false` | — | config | 开关 (PvP / PvE) |
| `Cheats` | 无参数 | flag | 关闭 | `Provider.cs:6640` `hasCheats = false` | — | config | 开关 |

### 1.3 管理权限

| 指令 | 参数 | 类型 | 默认值 | SDK 真源 | 范围 | 分类 | Web UI 控件 |
|---|---|---|---|---|---|---|---|
| `Owner` | `<SteamID>` | ulong / SteamID64 | 无（`CSteamID.Nil`） | `SteamAdminlist.cs:19` `public static CSteamID ownerID;`；`CommandOwner.cs:25` `PlayerTool.tryGetSteamID(parameter, out steamID)`——`PlayerTool.cs:279-303` 接受任意 ulong 数字（**不强制 17 位**）或在线玩家名（`getSteamPlayer` 查表） | ulong 范围 / 在线玩家名 | config | 文本输入（**面板未做客户端校验**，依赖 SDK 拒绝非法值） |

### 1.4 安全与过滤

| 指令 | 参数 | 类型 | 默认值 | SDK 真源 | 范围 | 分类 | Web UI 控件 |
|---|---|---|---|---|---|---|---|
| `Gold` | 无参数 | flag | 关闭 | `Provider.cs:6643` `isGold = false` | — | config | 开关 |
| `Whitelisted` | 无参数 | flag | 关闭 | `Provider.cs:6638` `isWhitelisted = false` | — | config | 开关 |
| `Filter` | 无参数 | flag | 关闭 | `Provider.cs:6641` `filterName = false` | — | config | 开关 |
| `Hide_Admins` | 无参数 | flag | 关闭 | `Provider.cs:6639` `hideAdmins = false` | — | config | 开关 |
| `Sync` | 无参数 | flag | 关闭 | `PlayerSavedata.cs:9` `public static bool hasSync;`（C# 字段默认 `false`）；`CommandSync.cs:24` `PlayerSavedata.hasSync = true;` | — | config | 开关 |

### 1.5 游戏参数

| 指令 | 参数 | 类型 | 默认值 | SDK 真源 | 范围 | 分类 | Web UI 控件 |
|---|---|---|---|---|---|---|---|
| `Timeout` | `<Number>` | int (ms) | `750` | 字段定义 `PlayConfigData.cs:404` `Max_Ping_Milliseconds = 750`；命令 `CommandTimeout.cs:42` 写入 `Provider.configData.Server.Max_Ping_Milliseconds`（**双向同步**：写 `Timeout` 也覆盖 Config.txt 该字段） | 50–10000（`CommandTimeout.cs:11-12` `MIN_NUMBER`/`MAX_NUMBER`） | any | 数字滑块 |
| `Chatrate` | `<Number>` | float (秒) | `0.25` | `ChatManager.cs:74` `public static float chatrate = 0.25f;`；`CommandChatrate.cs:11-12` `MIN_NUMBER=0 / MAX_NUMBER=60` | 0–60 | any | 数字输入 |
| `Cycle` | `<Number>` | int (秒) | `3600` | `LightingManager.cs:852/883` 关卡初始化 `_cycle = 3600`；`LightingManager.cs:99` setter 内 `_cycle = value > 0 ? value : 3600; // Prevent division by zero`——**U3DS 自动把 0 改 3600**；HORDE/ARENA 地图禁止改（`CommandCycle.cs:23-33`） | 0+（U3DS 0→3600）；uint 全范围（`CommandCycle.cs:17` `uint.TryParse`） | any | 数字输入（含 "现实时间对照" 提示） |

### 1.6 日志

| 指令 | 参数 | 类型 | 默认值 | SDK 真源 | 分类 | Web UI 控件 |
|---|---|---|---|---|---|---|
| `Log` | `Chat Y/N / JoinLeave Y/N / Death Y/N / Anticheat Y/N`（**`/` 分隔**，见 `CommandLog.cs:18` `Parser.getComponentsFromSerial(parameter, '/')`，长度必须 = 4） | 4×bool | `Y/Y/Y/N` | `CommandWindow.cs:49-52`：`shouldLogChat`/`shouldLogJoinLeave`/`shouldLogDeaths` 默认 `true`，`shouldLogAnticheat` 默认 `false`；解析/校验 `CommandLog.cs:18-85` | any | 四个独立开关 |

### 1.7 投票与开局物品

| 指令 | 参数 | 类型 | 默认值 | SDK 真源 | 分类 | Web UI 控件 |
|---|---|---|---|---|---|---|
| `Votify` | `Allow Y/N / PassCooldown / FailCooldown / Duration / Percentage / Players`（**`/` 分隔**，见 `CommandVotify.cs:18` `Parser.getComponentsFromSerial(parameter, '/')`，长度必须 = 6；字段类型依次 `bool / float / float / float / float / byte`） | mixed | `voteAllowed=false` / `votePassCooldown=5.0f` / `voteFailCooldown=60.0f` / `voteDuration=15.0f` / `votePercentage=0.75f` / `votePlayers=3` | `ChatManager.cs:76-81`（6 个字段一次性定义）；解析/校验 `CommandVotify.cs:18-74` | any | 结构化表单（1 toggle + 5 number 输入，默认值与 SDK 对齐） |
| `Loadout` | `<SkillsetID>/<itemID>/<itemID>/...`（**`/` 分隔**，见 `CommandLoadout.cs:13` `Parser.getComponentsFromSerial(parameter, '/')`；允许重复行，每个 SkillsetID 一行；同 ID 多行后写覆盖前写） | list | **不写 = SDK 默认**：`LOADOUT = {}` + `SKILLSETS_SERVER = [[]×11`——玩家开局**无任何额外物品** | 数组定义 `PlayerInventory.cs:30` `public static readonly ushort[] LOADOUT = { };` 和 `PlayerInventory.cs:32` `public static readonly ushort[][] SKILLSETS_SERVER = new ushort[11][] { new ushort[0] { }, ... };`；解析/写入语义 `CommandLoadout.cs:42-49`；合法 SkillsetID 来自 `EPlayerSkillset.cs:12-22`：`0=NONE / 1=FIRE / 2=POLICE / 3=ARMY / 4=FARM / 5=FISH / 6=CAMP / 7=WORK / 8=CHEF / 9=THIEF / 10=MEDIC / 255=全部技能组`（中文映射见 `unturned-sop.md`） | any | LoadoutEditor（11 技能组下拉 + chip 列表） |

---

## 2. Config.txt — 高级游戏设置

**路径**：`Servers/<ServerID>/Config.txt`  
**格式**：`Key Value`（空格分隔），`>` 开头为注释行  
**版本**：≥3.25.8.0（2025-09），替代旧 Config.json

### 2.1 Browser 段（Steam 浏览器展示）

| 字段 | 类型 | 默认值 | SDK 真源 | 范围 | 说明 | Web UI 控件 |
|---|---|---|---|---|---|---|
| `Login_Token` | string | 空 | `PlayConfigData.cs:124` `BrowserConfigData.Login_Token`（注释：AppID 304930 GSLT） | — | GSLT，在 steamcommunity.com/dev/managegameservers 用 AppID 304930 创建 | 密码输入框 + 外部链接 |
| `Desc_Full` | string | 空 | `PlayConfigData.cs:113` `BrowserConfigData.Desc_Full` | — | 服务器详情页的完整描述（支持多行） | 多行文本编辑器 |
| `Desc_Server_List` | string | 空 | `PlayConfigData.cs:118` `BrowserConfigData.Desc_Server_List` | — | 服务器列表中的简短描述 | 文本输入框 |
| `Icon` | string (URL) | 空 | `PlayConfigData.cs:98` `BrowserConfigData.Icon` | — | 服务器图标 URL | 文本输入 + 预览 |
| `Thumbnail` | string (URL) | 空 | `PlayConfigData.cs:103` `BrowserConfigData.Thumbnail` | — | 缩略图 URL | 文本输入 + 预览 |

### 2.2 Server 段（服务器行为）

| 字段 | 类型 | 默认值 | SDK 真源 | 范围 | 说明 | Web UI 控件 |
|---|---|---|---|---|---|---|
| `VAC_Secure` | bool | `true` | `PlayConfigData.cs:402` `ServerConfigData.VAC_Secure = true` | — | Valve Anti-Cheat 开关 | 开关 |
| `BattlEye_Secure` | bool | — | U3-SDK 本地副本未找到字段定义（`.research/U3-SDK/Assets/Runtime/Assembly-CSharp/Unturned/` 全搜无结果），需实机验证 | — | BattlEye 反作弊 | 开关 |
| `Max_Ping_Milliseconds` | uint | `750` | `PlayConfigData.cs:404` `ServerConfigData.Max_Ping_Milliseconds = 750`；与 `Commands.dat Timeout` 双向同步（`CommandTimeout.cs:42`） | — | Ping 超时 | 数字滑块 |
| `Enable_Scheduled_Shutdown` | bool | `false` | `PlayConfigData.cs:318` `ServerConfigData.Enable_Scheduled_Shutdown`（默认未在构造器赋值，C# 字段默认 `false`） | — | 周期定时自动关服开关 | 开关 |
| `Enable_Update_Shutdown` | bool | `false` | `PlayConfigData.cs:350` `ServerConfigData.Enable_Update_Shutdown`（默认未在构造器赋值，C# 字段默认 `false`） | — | 检测到新版本时自动关服开关 | 开关 |

### 2.3 物品段（ItemsConfigData）

| 字段 | 类型 | 默认值 | SDK 真源 | 范围 | 说明 | Web UI 控件 |
|---|---|---|---|---|---|---|
| `Spawn_Chance` | float | 0.35（Easy/Normal）/ 0.15（Hard） | `PlayConfigData.cs:487` `ItemsConfigData.Spawn_Chance` | [0, 1] | 物品生成概率（百分比[0, 1]） | 数字输入 |
| `Despawn_Dropped_Time` | float | 600 | `PlayConfigData.cs:492` `ItemsConfigData.Despawn_Dropped_Time` | >0 | 玩家掉落物品多久后消失（秒） | 数字输入 |
| `Respawn_Time` | float | 50（Easy）/ 100（Normal）/ 150（Hard） | `PlayConfigData.cs:504` `ItemsConfigData.Respawn_Time` | >0 | 物品重生间隔（秒） | 数字输入 |
| `Has_Durability` | bool | true（非 EASY） | `PlayConfigData.cs:554` `ItemsConfigData.Has_Durability` | — | 物品是否启用耐久度 | 开关 |

### 2.4 玩法开关段（GameplayConfigData）

| 字段 | 类型 | 默认值 | SDK 真源 | 范围 | 说明 | Web UI 控件 |
|---|---|---|---|---|---|---|
| `Allow_Shoulder_Camera` | bool | `true` | `PlayConfigData.cs:2215` `GameplayConfigData.Allow_Shoulder_Camera = true` | — | 第三人称是否允许镜头越过肩膀 | 开关 |
| `Allow_Freeform_Buildables` | bool | `true` | `PlayConfigData.cs:2250` `GameplayConfigData.Allow_Freeform_Buildables = true` | — | 是否允许自由形态建造（无网格限制） | 开关 |
| `Friendly_Fire` | bool | `false` | `PlayConfigData.cs:2225` `GameplayConfigData.Friendly_Fire = false`（默认 `false`；UI 字段名「玩家伤害」取反为 true = 开火） | — | 组队内友军伤害开关 | 开关（label: 玩家伤害） |
| `Can_Suicide` | bool | `true` | `PlayConfigData.cs:2220` `GameplayConfigData.Can_Suicide = true` | — | 是否允许玩家自杀 | 开关 |

### 2.5 字段名映射（UI label → SDK 写入 key）

U3DS Config.txt 文件路径：`PlayConfigUtils.GetServerConfigPathV2(serverId)` → `Servers/<id>/Config.txt`（`PlayConfigData.cs:2546-2549`）。解析方式：`Provider.cs:2242/2255` 调 `ParseServerConfig` + `ParseModeConfig` 反序列化（`PlayConfigData.cs:2573-2607`），按 C# `FieldInfo.Name` 精确匹配 section 名与 key 名（`PlayConfigData.cs:2599` `rootDictionary.TryGetDictionary(categoryField.Name, ...)`；`:2618` `dictionary.TryGetNode(configField.Name, ...)`）。

**字段映射表**（UI label 左侧 → 写入 key 右侧，**写入 key 必须等于 SDK C# 字段名**）：

| UI label | 写入 key | SDK Section | SDK 字段（`PlayConfigData.cs`） |
|---|---|---|---|
| Steam 浏览器登录令牌 | `Login_Token` | `[Browser]` | `:124` `BrowserConfigData.Login_Token` |
| 完整描述 | `Desc_Full` | `[Browser]` | `:113` `BrowserConfigData.Desc_Full` |
| 列表描述 | `Desc_Server_List` | `[Browser]` | `:118` `BrowserConfigData.Desc_Server_List` |
| 图标URL | `Icon` | `[Browser]` | `:98` `BrowserConfigData.Icon` |
| 缩略图URL | `Thumbnail` | `[Browser]` | `:103` `BrowserConfigData.Thumbnail` |
| VAC反作弊 | `VAC_Secure` | `[Server]` | `:402` `ServerConfigData.VAC_Secure` |
| BattlEye | `BattlEye_Secure` | `[Server]` | SDK 本地副本未找到字段定义 |
| 最大Ping(ms) | `Max_Ping_Milliseconds` | `[Server]` | `:404` `ServerConfigData.Max_Ping_Milliseconds` |
| 定时关机 | `Enable_Scheduled_Shutdown` | `[Server]` | `:318` `ServerConfigData.Enable_Scheduled_Shutdown` |
| 更新自动关机 | `Enable_Update_Shutdown` | `[Server]` | `:350` `ServerConfigData.Enable_Update_Shutdown` |
| 生成倍率 | `Spawn_Chance` | `[Items]`（按当前 Mode） | `:487` `ItemsConfigData.Spawn_Chance` |
| 物品耐久 | `Has_Durability` | `[Items]`（按当前 Mode） | `:554` `ItemsConfigData.Has_Durability` |
| 掉落消失(s) | `Despawn_Dropped_Time` | `[Items]`（按当前 Mode） | `:492` `ItemsConfigData.Despawn_Dropped_Time` |
| 重生时间(s) | `Respawn_Time` | `[Items]`（按当前 Mode） | `:504` `ItemsConfigData.Respawn_Time` |
| 肩后视角 | `Allow_Shoulder_Camera` | `[Gameplay]`（按当前 Mode） | `:2215` `GameplayConfigData.Allow_Shoulder_Camera` |
| 自由建造 | `Allow_Freeform_Buildables` | `[Gameplay]`（按当前 Mode） | `:2250` `GameplayConfigData.Allow_Freeform_Buildables` |
| 玩家伤害（label 取反） | `Friendly_Fire` | `[Gameplay]`（按当前 Mode） | `:2225` `GameplayConfigData.Friendly_Fire` |
| 允许自杀 | `Can_Suicide` | `[Gameplay]`（按当前 Mode） | `:2220` `GameplayConfigData.Can_Suicide` |

---
