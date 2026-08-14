# Unturned 服务端配置文件参数参考（面板已实现字段）

> 面向 Web UI 管理面板的可视化配置编辑器设计。  
> 每个字段标注：类型、默认值、取值范围、Web UI 控件建议、**SDK 真源（U3-SDK 代码行号，`.research/U3-SDK/`）**。
> 字段默认值 / 枚举值 / 类型以 **SDK 真源（U3-SDK `PlayConfigData.cs` 对应 ConfigData 类字段声明 + 实机生成文件注释）** 为准。

> **字段细节自行溯源**：本文档只收录面板已实现字段的权威表，**不穷举所有配置项**。凡设计到具体字段名、枚举值、取值范围、解析/写入逻辑等细节，请直接到 U3-SDK 源码中查找对应类（`.research/U3-SDK/Assets/Runtime/Assembly-CSharp/Unturned/`），不要以本文档或社区教程为准。

> **§2.1-2.4 托管字段**：面板「高级设置」页直接编辑（ConfigField/ConfigToggle 控件）。  
> **§2.6-2.14 未托管模块字段**：面板「细节调整」区只读展示 + 可编辑（bool 用开关、数值用输入框），字段默认值按当前难度（Commands.dat Mode）取值。两区字段表均含「中文 label + 允许值 + 默认值 + 说明」，供 UI 与文档对齐。

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
| `Loadout` | `<SkillsetID>/<itemID>/<itemID>/...`（**`/` 分隔**，见 `CommandLoadout.cs:13` `Parser.getComponentsFromSerial(parameter, '/')`；允许重复行，每个 SkillsetID 一行；同 ID 多行后写覆盖前写） | list | **不写 = SDK 默认**：`LOADOUT = {}` + `SKILLSETS_SERVER = [[]×11`——玩家开局**无任何额外物品** | 数组定义 `PlayerInventory.cs:30` `public static readonly ushort[] LOADOUT = { };` 和 `PlayerInventory.cs:32` `public static readonly ushort[][] SKILLSETS_SERVER = new ushort[11][] { new ushort[0] { }, ... };`；解析/写入语义 `CommandLoadout.cs:42-49`；合法 SkillsetID 来自 `EPlayerSkillset.cs:12-22`：`0=NONE / 1=FIRE / 2=POLICE / 3=ARMY / 4=FARM / 5=FISH / 6=CAMP / 7=WORK / 8=CHEF / 9=THIEF / 10=MEDIC / 255=所有技能组`（中文映射见 `unturned-sop.md`；255 与技能组互斥，见 `docs/architecture/loadout-item-editor-design.md` §4.8） | any | LoadoutEditor（技能组条目列表 + 物品选择 dialog + 「管理物品清单」） |

---

## 2. Config.txt — 高级游戏设置

**路径**：`Servers/<ServerID>/Config.txt`  
**格式**：U3-SDK 原生 DAT 语法（真源 `DatTokenizer.cs`/`DatParser.cs`）：`Section { }` 大括号块 + `Key Value` 空格分隔 + `//` 开头注释（`// >` 为 U3DS 自动生成）+ `Version 1` 头  
**版本**：≥3.25.8.0（2025-09），替代旧 Config.json  
**裸 key 语义**：`VAC_Secure`（无 value）= 该字段官方默认值（`DatValueEx.cs:158` parse 失败回落 defaultValue）；`VAC_Secure true` = 强制开启；`VAC_Secure false` = 强制关闭

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
| Steam 浏览器登录令牌 | `Login_Token` | `Browser` | `:124` `BrowserConfigData.Login_Token` |
| 完整描述 | `Desc_Full` | `Browser` | `:113` `BrowserConfigData.Desc_Full` |
| 列表描述 | `Desc_Server_List` | `Browser` | `:118` `BrowserConfigData.Desc_Server_List` |
| 图标URL | `Icon` | `Browser` | `:98` `BrowserConfigData.Icon` |
| 缩略图URL | `Thumbnail` | `Browser` | `:103` `BrowserConfigData.Thumbnail` |
| VAC反作弊 | `VAC_Secure` | `Server` | `:402` `ServerConfigData.VAC_Secure` |
| BattlEye | `BattlEye_Secure` | `Server` | SDK 本地副本未找到字段定义 |
| 最大Ping(ms) | `Max_Ping_Milliseconds` | `Server` | `:404` `ServerConfigData.Max_Ping_Milliseconds` |
| 定时关机 | `Enable_Scheduled_Shutdown` | `Server` | `:318` `ServerConfigData.Enable_Scheduled_Shutdown` |
| 更新自动关机 | `Enable_Update_Shutdown` | `Server` | `:350` `ServerConfigData.Enable_Update_Shutdown` |
| 生成倍率 | `Spawn_Chance` | `Items`（按当前 Mode） | `:487` `ItemsConfigData.Spawn_Chance` |
| 物品耐久 | `Has_Durability` | `Items`（按当前 Mode） | `:554` `ItemsConfigData.Has_Durability` |
| 掉落消失(s) | `Despawn_Dropped_Time` | `Items`（按当前 Mode） | `:492` `ItemsConfigData.Despawn_Dropped_Time` |
| 重生时间(s) | `Respawn_Time` | `Items`（按当前 Mode） | `:504` `ItemsConfigData.Respawn_Time` |
| 肩后视角 | `Allow_Shoulder_Camera` | `Gameplay`（按当前 Mode） | `:2215` `GameplayConfigData.Allow_Shoulder_Camera` |
| 自由建造 | `Allow_Freeform_Buildables` | `Gameplay`（按当前 Mode） | `:2250` `GameplayConfigData.Allow_Freeform_Buildables` |
| 玩家伤害（label 取反） | `Friendly_Fire` | `Gameplay`（按当前 Mode） | `:2225` `GameplayConfigData.Friendly_Fire` |
| 允许自杀 | `Can_Suicide` | `Gameplay`（按当前 Mode） | `:2220` `GameplayConfigData.Can_Suicide` |

### 2.6 载具段（VehiclesConfigData）— 20 字段

| 字段 | 类型 | 中文 label | 允许值 | 默认值 | 说明 |
|---|---|---|---|---|---|
| `Decay_Time` | float | 闲置损坏时间 | 数值（秒） | 604800 | 载具被闲置多久后开始受损 |
| `Decay_Damage_Per_Second` | float | 闲置损坏速度 | 数值 | 0.1 | 超过 Decay_Time 后每秒承受的伤害 |
| `Has_Battery_Chance` | float | 带电池概率 | 0–1 | 简单1 / 普通0.8 / 困难0.25 | 生成时带电池的概率 |
| `Min_Battery_Charge` | float | 电池最小电量 | 0–1 | 简单0.8 / 普通0.5 / 困难0.1 | 带电池时的最小初始电量 |
| `Max_Battery_Charge` | float | 电池最大电量 | 0–1 | 简单1 / 普通0.75 / 困难0.3 | 带电池时的最大初始电量 |
| `Has_Tire_Chance` | float | 带轮胎概率 | 0–1 | 简单1 / 普通0.85 / 困难0.7 | 每轮生成带轮胎的概率 |
| `Respawn_Time` | float | 消失时间 | 数值（秒） | 300 | 载具爆炸或卡水底后多久消失 |
| `Unlocked_After_Seconds_In_Safezone` | float | 安全区自动解锁 | 数值（秒） | 3600 | 上锁载具在安全区空置多久后自动解锁 |
| `Armor_Multiplier` | float | 护甲系数 | 数值 | 1 | 缩放载具受到的伤害 |
| `Child_Explosion_Armor_Multiplier` | float | 爆炸物护甲系数 | 数值 | 1 | 路障遮挡爆炸时对载具伤害的缩放 |
| `Gun_Lowcal_Damage_Multiplier` | float | 轻武器伤害系数 | 数值 | 1 | 非重型武器对载具的伤害缩放 |
| `Gun_Highcal_Damage_Multiplier` | float | 重型武器伤害系数 | 数值 | 1 | 重型武器对载具的伤害缩放 |
| `Melee_Damage_Multiplier` | float | 近战伤害系数 | 数值 | 1 | 近战武器和拳头对载具的伤害缩放 |
| `Melee_Repair_Multiplier` | float | 近战修复系数 | 数值 | 1 | 焊枪等近战工具的修复量缩放 |
| `Max_Instances_Tiny` | uint | 迷你图最大数量 | 整数 | 4 | 迷你尺寸地图自然生成载具上限 |
| `Max_Instances_Small` | uint | 小型图最大数量 | 整数 | 8 | 小型尺寸地图自然生成载具上限 |
| `Max_Instances_Medium` | uint | 中型图最大数量 | 整数 | 16 | 中型尺寸地图自然生成载具上限 |
| `Max_Instances_Large` | uint | 大型图最大数量 | 整数 | 32 | 大型尺寸地图自然生成载具上限 |
| `Max_Instances_Insane` | uint | 超大图最大数量 | 整数 | 64 | 超大尺寸地图自然生成载具上限 |
| `Min_Natural_Vehicles` | uint | 自然载具下限 | 整数 | 16 | 低于此数量时自然生成更多载具（与 Max_Instances 取较小值） |

### 2.7 僵尸段（ZombiesConfigData）— 42 字段

| 字段 | 类型 | 中文 label | 允许值 | 默认值 | 说明 |
|---|---|---|---|---|---|
| `Spawn_Chance` | float | 生成概率 | 0–1 | 简单0.2 / 普通0.25 / 困难0.3 | 僵尸生成概率 |
| `Loot_Chance` | float | 掉落概率 | 0–1 | 简单0.55 / 普通0.5 / 困难0.3 | 僵尸掉落物品的概率 |
| `Crawler_Chance` | float | 爬行者概率 | 0–1 | 简单0 / 普通0.15 / 困难0.125 | 生成爬行僵尸的概率 |
| `Sprinter_Chance` | float | 疾跑者概率 | 0–1 | 简单0 / 普通0.15 / 困难0.175 | 生成疾跑僵尸的概率 |
| `Flanker_Chance` | float | 侧翼者概率 | 0–1 | 简单0 / 普通0.025 / 困难0.05 | 生成侧翼僵尸的概率 |
| `Burner_Chance` | float | 燃烧者概率 | 0–1 | 简单0 / 普通0.025 / 困难0.05 | 生成燃烧僵尸的概率 |
| `Acid_Chance` | float | 酸液者概率 | 0–1 | 简单0 / 普通0.025 / 困难0.05 | 生成酸液僵尸的概率 |
| `Boss_Electric_Chance` | float | 电系首领概率 | 0–1 | 0 | 生成电系首领僵尸的概率 |
| `Boss_Wind_Chance` | float | 震地首领概率 | 0–1 | 0 | 生成震地首领僵尸的概率 |
| `Boss_Fire_Chance` | float | 喷火首领概率 | 0–1 | 0 | 生成喷火首领僵尸的概率 |
| `Spirit_Chance` | float | 幽灵概率 | 0–1 | 0 | 生成幽灵僵尸的概率 |
| `DL_Red_Volatile_Chance` | float | 红色夜魔概率 | 0–1 | 0 | 生成消逝的光芒红色夜魔僵尸的概率 |
| `DL_Blue_Volatile_Chance` | float | 蓝色夜魔概率 | 0–1 | 0 | 生成消逝的光芒蓝色夜魔僵尸的概率 |
| `Boss_Elver_Stomper_Chance` | float | 巨树首领概率 | 0–1 | 0 | 生成埃尔弗最终首领僵尸的概率 |
| `Boss_Kuwait_Chance` | float | 科威特首领概率 | 0–1 | 0 | 生成科威特最终首领僵尸的概率 |
| `Respawn_Day_Time` | float | 白天重生时间 | 数值（秒） | 360 | 死亡僵尸默认重生间隔（白天） |
| `Respawn_Night_Time` | float | 满月重生时间 | 数值（秒） | 30 | 满月时死亡僵尸重生间隔 |
| `Respawn_Beacon_Time` | float | 尸潮信标重生 | 数值（秒） | 0 | 尸潮信标时死亡僵尸重生间隔 |
| `Quest_Boss_Respawn_Interval` | float | 任务首领重生间隔 | 数值（秒） | 600 | 任务型首领僵尸的最小重生间隔 |
| `Damage_Multiplier` | float | 伤害系数 | 数值 | 简单0.75 / 普通1 / 困难1.5 | 僵尸造成的伤害缩放 |
| `Armor_Multiplier` | float | 护甲系数 | 数值 | 简单1.25 / 普通1 / 困难0.75 | 僵尸受到的伤害缩放 |
| `Backstab_Multiplier` | float | 背刺系数 | 数值 | 1.25 | 背后攻击僵尸时的伤害缩放 |
| `NonHeadshot_Armor_Multiplier` | float | 非爆头护甲系数 | 数值 | 1 | 身体/手臂/腿部的武器伤害系数 |
| `Beacon_Experience_Multiplier` | float | 信标经验系数 | 数值 | 1 | 尸潮信标期间击杀僵尸的经验缩放 |
| `Full_Moon_Experience_Multiplier` | float | 满月经验系数 | 数值 | 2 | 满月期间击杀僵尸的经验缩放 |
| `Min_Drops` | uint | 最小掉落 | 整数 | 1 | 普通僵尸最小掉落数 |
| `Max_Drops` | uint | 最大掉落 | 整数 | 1 | 普通僵尸最大掉落数 |
| `Min_Mega_Drops` | uint | 巨型最小掉落 | 整数 | 5 | 巨型僵尸最小掉落数 |
| `Max_Mega_Drops` | uint | 巨型最大掉落 | 整数 | 5 | 巨型僵尸最大掉落数 |
| `Min_Boss_Drops` | uint | 首领最小掉落 | 整数 | 8 | 首领僵尸最小掉落数 |
| `Max_Boss_Drops` | uint | 首领最大掉落 | 整数 | 10 | 首领僵尸最大掉落数 |
| `Slow_Movement` | bool | 缓慢移动 | 开关 | 简单开 / 普通关 / 困难关 | 开启后所有僵尸速度略慢，更易逃跑 |
| `Can_Stun` | bool | 可被眩晕 | 开关 | 简单开 / 普通开 / 困难关 | 关闭后僵尸无法被任何方式眩晕 |
| `Only_Critical_Stuns` | bool | 仅关键眩晕 | 开关 | 简单关 / 普通关 / 困难开 | 开启后仅特定武器/背刺可眩晕僵尸 |
| `Weapons_Use_Player_Damage` | bool | 武器用玩家伤害 | 开关 | 简单关 / 普通关 / 困难开 | 开启后打僵尸用武器 PvP 伤害 |
| `Can_Target_Barricades` | bool | 可攻击路障 | 开关 | 开 | 僵尸会攻击阻挡的路障 |
| `Can_Target_Structures` | bool | 可攻击建筑 | 开关 | 开 | 僵尸会攻击阻挡的建筑 |
| `Can_Target_Vehicles` | bool | 可攻击载具 | 开关 | 开 | 僵尸会攻击阻挡的载具 |
| `Can_Target_Objects` | bool | 可攻击世界物件 | 开关 | 开 | 僵尸会攻击阻挡的围栏等世界物件 |
| `Beacon_Max_Rewards` | uint | 信标最大奖励 | 整数 | 0 | 大于 0 时尸潮信标最大掉落数 |
| `Beacon_Max_Participants` | uint | 信标最大参与 | 整数 | 0 | 大于 0 时尸潮信标掉落缩放的最大人数 |
| `Beacon_Rewards_Multiplier` | float | 信标奖励系数 | 数值 | 1 | 尸潮信标总掉落缩放（先于 Beacon_Max_Rewards） |

### 2.8 动物段（AnimalsConfigData）— 9 字段

| 字段 | 类型 | 中文 label | 允许值 | 默认值 | 说明 |
|---|---|---|---|---|---|
| `Respawn_Time` | float | 重生时间 | 数值（秒） | 180 | 死亡动物多久重生 |
| `Damage_Multiplier` | float | 伤害系数 | 数值 | 简单0.75 / 普通1 / 困难1.5 | 动物造成的伤害缩放 |
| `Armor_Multiplier` | float | 护甲系数 | 数值 | 简单1.25 / 普通1 / 困难0.75 | 动物受到的伤害缩放 |
| `Max_Instances_Tiny` | uint | 迷你图最大数量 | 整数 | 4 | 迷你尺寸地图动物上限 |
| `Max_Instances_Small` | uint | 小型图最大数量 | 整数 | 8 | 小型尺寸地图动物上限 |
| `Max_Instances_Medium` | uint | 中型图最大数量 | 整数 | 16 | 中型尺寸地图动物上限 |
| `Max_Instances_Large` | uint | 大型图最大数量 | 整数 | 32 | 大型尺寸地图动物上限 |
| `Max_Instances_Insane` | uint | 超大图最大数量 | 整数 | 64 | 超大尺寸地图动物上限 |
| `Weapons_Use_Player_Damage` | bool | 武器用玩家伤害 | 开关 | 简单关 / 普通关 / 困难开 | 开启后打动物用武器 PvP 伤害 |

### 2.9 路障段（BarricadesConfigData）— 11 字段

| 字段 | 类型 | 中文 label | 允许值 | 默认值 | 说明 |
|---|---|---|---|---|---|
| `Decay_Time` | uint | 腐烂时间 | 整数（秒） | 604800 | 所有者/组多久未上线后路障不再保存 |
| `Armor_Lowtier_Multiplier` | float | 低阶护甲系数 | 数值 | 1 | 低阶护甲路障受到的伤害缩放 |
| `Armor_Hightier_Multiplier` | float | 高阶护甲系数 | 数值 | 0.5 | 高阶护甲路障受到的伤害缩放 |
| `Gun_Lowcal_Damage_Multiplier` | float | 轻武器伤害系数 | 数值 | 1 | 非重型武器对路障的伤害缩放 |
| `Gun_Highcal_Damage_Multiplier` | float | 重型武器伤害系数 | 数值 | 1 | 重型武器对路障的伤害缩放 |
| `Melee_Damage_Multiplier` | float | 近战伤害系数 | 数值 | 1 | 近战武器对路障的伤害缩放 |
| `Melee_Repair_Multiplier` | float | 近战修复系数 | 数值 | 1 | 焊枪等近战工具的修复量缩放 |
| `Allow_Item_Placement_On_Vehicle` | bool | 允许载具上放置 | 开关 | 开 | 玩家能否在载具上建造 |
| `Allow_Trap_Placement_On_Vehicle` | bool | 允许载具上放陷阱 | 开关 | 开 | 玩家能否在载具上放铁丝网等陷阱 |
| `Max_Item_Distance_From_Hull` | float | 最大建造距离 | 数值 | 64 | 玩家能在载具碰撞体多远处建造物品 |
| `Max_Trap_Distance_From_Hull` | float | 最大陷阱距离 | 数值 | 16 | 玩家能在载具碰撞体多远处放陷阱 |

### 2.10 建筑段（StructuresConfigData）— 7 字段

| 字段 | 类型 | 中文 label | 允许值 | 默认值 | 说明 |
|---|---|---|---|---|---|
| `Decay_Time` | uint | 腐烂时间 | 整数（秒） | 604800 | 所有者/组多久未上线后建筑不再保存 |
| `Armor_Lowtier_Multiplier` | float | 低阶护甲系数 | 数值 | 1 | 低阶护甲建筑受到的伤害缩放 |
| `Armor_Hightier_Multiplier` | float | 高阶护甲系数 | 数值 | 0.5 | 高阶护甲建筑受到的伤害缩放 |
| `Gun_Lowcal_Damage_Multiplier` | float | 轻武器伤害系数 | 数值 | 1 | 非重型武器对建筑的伤害缩放 |
| `Gun_Highcal_Damage_Multiplier` | float | 重型武器伤害系数 | 数值 | 1 | 重型武器对建筑的伤害缩放 |
| `Melee_Damage_Multiplier` | float | 近战伤害系数 | 数值 | 1 | 近战武器对建筑的伤害缩放 |
| `Melee_Repair_Multiplier` | float | 近战修复系数 | 数值 | 1 | 焊枪等近战工具的修复量缩放 |

### 2.11 玩家段（PlayersConfigData）— 47 字段

| 字段 | 类型 | 中文 label | 允许值 | 默认值 | 说明 |
|---|---|---|---|---|---|
| `Health_Default` | uint | 初始生命 | 0–100 | 100 | 玩家出生时的生命值 |
| `Health_Regen_Min_Food` | uint | 回血最低饱食 | 整数 | 90 | 饱食度高于此值才开始回血 |
| `Health_Regen_Min_Water` | uint | 回血最低饮水 | 整数 | 90 | 饮水量高于此值才开始回血 |
| `Health_Regen_Ticks` | uint | 回血速度 | 整数 | 60 | 饱食/饮水足够时回血的速度 |
| `Food_Default` | uint | 初始饱食 | 0–100 | 简单100 / 普通100 / 困难85 | 玩家出生时的饱食度 |
| `Food_Use_Ticks` | uint | 饱食消耗速度 | 整数 | 简单350 / 普通300 / 困难250 | 饱食度消耗速度 |
| `Food_Damage_Ticks` | uint | 饿死速度 | 整数 | 15 | 饱食度耗尽后饿死的速度 |
| `Water_Default` | uint | 初始饮水 | 0–100 | 简单100 / 普通100 / 困难85 | 玩家出生时的饮水量 |
| `Water_Use_Ticks` | uint | 饮水消耗速度 | 整数 | 简单320 / 普通270 / 困难220 | 饮水量消耗速度 |
| `Water_Damage_Ticks` | uint | 渴死速度 | 整数 | 20 | 饮水量耗尽后渴死的速度 |
| `Virus_Default` | uint | 初始免疫 | 0–100 | 100 | 玩家出生时的免疫力 |
| `Virus_Infect` | uint | 感染阈值 | 整数 | 50 | 免疫力低于此值时开始下降 |
| `Virus_Use_Ticks` | uint | 免疫消耗速度 | 整数 | 125 | 低于 Virus_Infect 后免疫下降速度 |
| `Virus_Damage_Ticks` | uint | 免疫为零死亡速度 | 整数 | 25 | 免疫力为零后死亡速度 |
| `Leg_Regen_Ticks` | uint | 断腿愈合速度 | 整数 | 750 | 断腿自动愈合的速度 |
| `Bleed_Damage_Ticks` | uint | 流血伤害速度 | 整数 | 10 | 流血期间掉血频率 |
| `Bleed_Regen_Ticks` | uint | 流血愈合速度 | 整数 | 750 | 流血自动愈合的速度 |
| `Armor_Multiplier` | float | 护甲系数 | 数值 | 1 | 玩家受到的伤害缩放 |
| `Experience_Multiplier` | float | 经验系数 | 数值 | 简单1.5 / 普通1 / 困难1.5 | 所有活动获得的经验缩放 |
| `Detect_Radius_Multiplier` | float | 侦测半径系数 | 数值 | 简单0.5 / 普通1 / 困难1.25 | 僵尸/动物侦测玩家的半径缩放 |
| `Ray_Aggressor_Distance` | float | 攻击判定距离 | 数值 | 8 | 攻击距玩家多近算「攻击行为」 |
| `Lose_Skills_PvP` | float | 玩家击杀保留技能 | 0–1 | 1 | 被玩家击杀后保留的技能比例 |
| `Lose_Skills_PvE` | float | 环境击杀保留技能 | 0–1 | 1 | 被环境击杀后保留的技能比例 |
| `Lose_Skill_Levels_PvP` | uint | 玩家击杀扣技能级 | 整数 | 简单0 / 普通1 / 困难2 | 被玩家击杀后扣除的技能等级 |
| `Lose_Skill_Levels_PvE` | uint | 环境击杀扣技能级 | 整数 | 简单0 / 普通1 / 困难2 | 被环境击杀后扣除的技能等级 |
| `Lose_Experience_PvP` | float | 玩家击杀保留经验 | 0–1 | 0.5 | 被玩家击杀后保留的经验比例 |
| `Lose_Experience_PvE` | float | 环境击杀保留经验 | 0–1 | 0.5 | 被环境击杀后保留的经验比例 |
| `Skill_Cost_Multiplier` | float | 技能花费系数 | 数值 | 1 | 购买/升级技能的经验花费缩放 |
| `Lose_Items_PvP` | float | 玩家击杀掉物概率 | 0–1 | 1 | 被玩家击杀时每件物品掉落的概率 |
| `Lose_Items_PvE` | float | 环境击杀掉物概率 | 0–1 | 1 | 被环境击杀时每件物品掉落的概率 |
| `Lose_Clothes_PvP` | bool | 玩家击杀掉衣服 | 开关 | 开 | 被玩家击杀时掉落所有衣物 |
| `Lose_Clothes_PvE` | bool | 环境击杀掉衣服 | 开关 | 开 | 被环境击杀时掉落所有衣物 |
| `Lose_Weapons_PvP` | bool | 玩家击杀掉武器 | 开关 | 开 | 被玩家击杀时掉落主副武器 |
| `Lose_Weapons_PvE` | bool | 环境击杀掉武器 | 开关 | 开 | 被环境击杀时掉落主副武器 |
| `Can_Hurt_Legs` | bool | 坠伤 | 开关 | 开 | 关闭后高空坠落不会掉血 |
| `Can_Break_Legs` | bool | 坠断腿 | 开关 | 简单关 / 普通开 / 困难开 | 关闭后高空坠落不会断腿 |
| `Can_Fix_Legs` | bool | 断腿自愈 | 开关 | 简单开 / 普通开 / 困难关 | 关闭后断腿不会自动愈合 |
| `Can_Start_Bleeding` | bool | 可流血 | 开关 | 简单关 / 普通开 / 困难开 | 关闭后伤害不会导致流血 |
| `Can_Stop_Bleeding` | bool | 流血自愈 | 开关 | 简单开 / 普通开 / 困难关 | 关闭后流血不会自动愈合 |
| `Spawn_With_Max_Skills` | bool | 满级技能出生 | 开关 | 关 | 所有技能是否默认满级 |
| `Spawn_With_Stamina_Skills` | bool | 满级耐力技能出生 | 开关 | 关 | 体能/潜水/锻炼/跑酷是否默认满级 |
| `Skillset_Reduces_Skill_Cost` | bool | 职业技能半价 | 开关 | 开 | 与玩家职业相关的技能花费减半 |
| `Skillset_Prevents_Skill_Loss` | bool | 职业技能不掉级 | 开关 | 开 | 与玩家职业相关的技能死亡不掉级 |
| `Prevent_Level_Skill_Overrides` | bool | 禁止等级覆盖技能 | 开关 | 关 | 关闭后等级不修改技能初始/花费/上限 |
| `Allow_Instakill_Headshots` | bool | 狙击爆头必杀 | 开关 | 简单关 / 普通关 / 困难开 | 带必杀爆头的枪是否无视护甲 |
| `Allow_Per_Character_Saves` | bool | 按角色存档 | 开关 | 关 | 每个角色栏是否有独立存档 |
| `Enable_Terrain_Color_Kick` | bool | 地形色踢出 | 开关 | 开 | 玩家肤色与地形色太接近时踢出 |

### 2.12 世界物件段（ObjectConfigData）— 8 字段

| 字段 | 类型 | 中文 label | 允许值 | 默认值 | 说明 |
|---|---|---|---|---|---|
| `Binary_State_Reset_Multiplier` | float | 电器关闭系数 | 数值 | 1 | 冰箱等交互物自动关闭的时间缩放 |
| `Fuel_Reset_Multiplier` | float | 燃油补充系数 | 数值 | 1 | 世界燃油源自动补充的时间缩放 |
| `Water_Reset_Multiplier` | float | 水源补充系数 | 数值 | 1 | 世界水源自动补充的时间缩放 |
| `Resource_Reset_Multiplier` | float | 资源生长系数 | 数值 | 1 | 树/岩石/灌木生长的速度缩放 |
| `Resource_Drops_Multiplier` | float | 资源掉落系数 | 数值 | 1 | 树/岩石等资源的掉落物缩放 |
| `Rubble_Reset_Multiplier` | float | 可毁物修复系数 | 数值 | 1 | 围栏等可毁物自动修复的时间缩放 |
| `Allow_Holiday_Drops` | bool | 节日掉落 | 开关 | 开 | 节日专属物件能否掉落特殊物品 |
| `Items_Obstruct_Tree_Respawns` | bool | 阻挡树重生 | 开关 | 开 | 树桩上的路障是否阻止树生长 |

### 2.13 事件段（EventsConfigData）— 30 字段

| 字段 | 类型 | 中文 label | 允许值 | 默认值 | 说明 |
|---|---|---|---|---|---|
| `Rain_Frequency_Min` | float | 雨最小间隔 | 数值（天） | 2.3 | 两次传统降雨的最小间隔天数 |
| `Rain_Frequency_Max` | float | 雨最大间隔 | 数值（天） | 5.6 | 两次传统降雨的最大间隔天数 |
| `Rain_Duration_Min` | float | 雨最短时长 | 数值（天） | 0.05 | 传统降雨最短时长；0 关闭 |
| `Rain_Duration_Max` | float | 雨最长时长 | 数值（天） | 0.15 | 传统降雨最长时长；0 关闭 |
| `Snow_Frequency_Min` | float | 雪最小间隔 | 数值（天） | 1.3 | 两次传统降雪的最小间隔天数 |
| `Snow_Frequency_Max` | float | 雪最大间隔 | 数值（天） | 4.6 | 两次传统降雪的最大间隔天数 |
| `Snow_Duration_Min` | float | 雪最短时长 | 数值（天） | 0.2 | 传统降雪最短时长；0 关闭 |
| `Snow_Duration_Max` | float | 雪最长时长 | 数值（天） | 0.5 | 传统降雪最长时长；0 关闭 |
| `Weather_Frequency_Multiplier` | float | 天气频率系数 | 数值 | 1 | 天气事件间隔天数缩放 |
| `Weather_Duration_Multiplier` | float | 天气时长系数 | 数值 | 1 | 天气事件持续天数缩放；0 完全关闭 |
| `Airdrop_Frequency_Min` | float | 空投最小间隔 | 数值（天） | 0.8 | 两次空投的最小间隔天数（依赖 Use_Airdrops） |
| `Airdrop_Frequency_Max` | float | 空投最大间隔 | 数值（天） | 6.5 | 两次空投的最大间隔天数（依赖 Use_Airdrops） |
| `Airdrop_Speed` | float | 空投飞机速度 | 数值（米/秒） | 128 | 空投飞机飞过地图的速度 |
| `Airdrop_Force` | float | 空投浮力 | 数值 | 9.5 | 抵抗重力的空投箱向上力 |
| `Arena_Min_Players` | uint | 竞技场最小人数 | 整数 | 2 | 开始竞技场匹配所需的最少队伍数 |
| `Arena_Compactor_Damage` | uint | 圈外基础伤害 | 整数 | 9 | 竞技场圈外每秒基础伤害 |
| `Arena_Compactor_Extra_Damage_Per_Second` | float | 圈外递增伤害 | 数值 | 1 | 竞技场圈外每秒累积的额外伤害 |
| `Arena_Clear_Timer` | uint | 传送前等待 | 整数（秒） | 5 | 匹配就绪到传送玩家进圈的时间 |
| `Arena_Finale_Timer` | uint | 决赛等待 | 整数（秒） | 10 | 宣布胜者后到重启的时间 |
| `Arena_Restart_Timer` | uint | 中场休息 | 整数（秒） | 15 | 中场到下一场比赛的时间 |
| `Arena_Compactor_Delay_Timer` | uint | 首圈延迟 | 整数（秒） | 1 | 第一圈开始收缩前的时间 |
| `Arena_Compactor_Pause_Timer` | uint | 圈收缩暂停 | 整数（秒） | 5 | 圈收缩完成到再次收缩的间隔 |
| `Use_Airdrops` | bool | 启用空投 | 开关 | 开 | 飞机是否飞过地图投放空投箱 |
| `Arena_Use_Compactor_Pause` | bool | 圈内多圈 | 开关 | 开 | 开启后圈内选择多个更小的圈 |
| `Arena_Compactor_Speed_Tiny` | float | 迷你图缩圈速度 | 数值（米/秒） | 0.5 | 迷你尺寸地图圈的收缩速度 |
| `Arena_Compactor_Speed_Small` | float | 小型图缩圈速度 | 数值（米/秒） | 1.5 | 小型尺寸地图圈的收缩速度 |
| `Arena_Compactor_Speed_Medium` | float | 中型图缩圈速度 | 数值（米/秒） | 3 | 中型尺寸地图圈的收缩速度 |
| `Arena_Compactor_Speed_Large` | float | 大型图缩圈速度 | 数值（米/秒） | 4.5 | 大型尺寸地图圈的收缩速度 |
| `Arena_Compactor_Speed_Insane` | float | 超大图缩圈速度 | 数值（米/秒） | 6 | 超大尺寸地图圈的收缩速度 |
| `Arena_Compactor_Shrink_Factor` | float | 缩圈保留系数 | 0–1 | 0.5 | 选择下一个更小圈时保留原圈的比例 |

### 2.14 Unity 事件段（UnityEventConfigData）— 4 字段

| 字段 | 类型 | 中文 label | 允许值 | 默认值 | 说明 |
|---|---|---|---|---|---|
| `Allow_Server_Messages` | bool | 服务端广播 | 开关 | 关 | 服务端文本聊天能否广播 |
| `Allow_Server_Commands` | bool | 服务端命令 | 开关 | 关 | 服务端文本聊天能否执行命令 |
| `Allow_Client_Messages` | bool | 客户端广播 | 开关 | 关 | 客户端文本聊天能否广播 |
| `Allow_Client_Commands` | bool | 客户端命令 | 开关 | 关 | 客户端文本聊天能否执行命令 |

---

## 3. Mod 框架（LDM）— Rocket.config.xml / Rocket.Unturned.config.xml / Permissions.config.xml

> **本章节**：维护 LDM（Legally-Distinct-Missile，Unturned 官方 Mod 框架）配置文件权威表。
> **激活前置**：游戏 Extras 复制到 Modules（见 `unturned-sop.md` §LDM 激活步骤）+ U3DS 首次启动自动生成 `Servers/<ID>/Rocket/`。
> **改完需重启**：写配置**运行时允许**（不强制 STOPPED），但生效需用户主动触发「应用变更」按钮走 PTY 重启流水线（ADR-0004 §重启）——前端「保存配置」按钮旁常驻「需重启生效」提示。
> **详细设计**：`docs/architecture/ldm-integration-design.md` §2.4 / §2.4b / §2.5 / §2.6 / §12.3 Phase 2。

## 3.1 Rocket.config.xml — LDM 主框架配置（16 字段）

> **路径**：`Servers/<ServerID>/Rocket/Rocket.config.xml`
> **真源**：LDM 仓 `Rocket/Rocket.Core/Serialization/RocketSettings.cs`
> **C# 类名 ≠ XML 根元素**：类名 `RocketSettings`，XML 根元素 `<RocketConfiguration>`（XmlSerializer 默认行为）。
> **生效**：改完需重启（点「应用变更」按钮走 PTY 重启流水线）。

| XML 元素 | 类型 | 默认 | 含义 | UI 控件 |
|---|---|---|---|---|
| `LanguageCode` | string | `"en"` | 翻译文件代码（`Rocket.{code}.translation.xml`） | 下拉（en/zh-CN/...） |
| `MaxFrames` | int | `60` | 帧预算（部分 Rocket API 用） | 数字 |
| `<RCON>` | group | — | Telnet RCON 配置（**本项目不用——ADR-0004 Phase 6 已删**，UI 标「实验性 / 保持未配置」） | **不暴露** |
| `RCON/Enabled` | bool | `false` | 开关 Telnet RCON | （隐藏） |
| `RCON/Port` | ushort | `27115` | TCP 端口 | （隐藏） |
| `RCON/Password` | string | `"changeme"` | **明文**（默认密码，必须改） | （隐藏） |
| `RCON/EnableMaxGlobalConnections` | bool | `true` | 全局连接限流 | （隐藏） |
| `RCON/MaxGlobalConnections` | ushort | `10` | 全局连接上限 | （隐藏） |
| `RCON/EnableMaxLocalConnections` | bool | `true` | 本地连接限流 | （隐藏） |
| `RCON/MaxLocalConnections` | ushort | `3` | 本地连接上限 | （隐藏） |
| `<AutomaticShutdown>` | group | — | 周期自动关服 | — |
| `AutomaticShutdown/Enabled` | bool | `false` | 启用 | 开关 |
| `AutomaticShutdown/Interval` | int | `86400` | 间隔秒数（24h） | 数字 |
| `<WebPermissions>` | group | — | 远程权限同步 | — |
| `WebPermissions/Enabled` | bool | `false` | 启用 | 开关 |
| `WebPermissions/Url` | string | `""` | 同步 URL | 文本 |
| `WebPermissions/Interval` | int | `180` | 同步间隔秒 | 数字 |
| `<WebConfigurations>` | group | — | 远程插件配置同步 | — |
| `WebConfigurations/Enabled` | bool | `false` | 启用 | 开关 |
| `WebConfigurations/Url` | string | `""` | 同步 URL | 文本 |

> ⚠️ Rocket.config.xml 写入 RCON 节点时必须**警告**——默认密码是明文 `"changeme"`。本项目 UI 完全隐藏 RCON 字段，**禁止**让用户触碰。

## 3.2 Rocket.Unturned.config.xml — Unturned 特有配置（9 字段）

> **路径**：`Servers/<ServerID>/Rocket/Rocket.Unturned.config.xml`
> **真源**：LDM 仓 `Rocket/Rocket.Unturned/Serialisation/UnturnedSettings.cs`
> **何时生成**：首次启动 U3DS（与 Rocket.config.xml 同时）。
> **生效**：改完需重启（同 3.1）。

| XML 元素 | 类型 | 默认 | 含义 | UI 控件 |
|---|---|---|---|---|
| `<AutomaticSave>/Enabled` | bool | `true` | 定时触发 U3DS `/save` 命令 | 开关 |
| `<AutomaticSave>/Interval` | int | `1800` | 间隔秒数（30 分钟） | 数字 |
| `<CharacterNameValidation>` | bool | `false` | 启用角色名正则校验 | 开关 |
| `<CharacterNameValidationRule>` | string | `"([\x00-\xAA]\|[\w_\ \.\+\-])+"` | 正则模式（防注入） | 文本（高级） |
| `<LogSuspiciousPlayerMovement>` | bool | `true` | 记录瞬移速度违规 | 开关 |
| `<EnableItemBlacklist>` | bool | `false` | 限制 `/i` 物品（黑名单模式） | 开关 |
| `<EnableItemSpawnLimit>` | bool | `false` | 限制单次刷物品数 | 开关 |
| `<MaxSpawnAmount>` | int | `10` | 配合上一项的单次刷物品上限 | 数字 |
| `<EnableVehicleBlacklist>` | bool | `false` | 限制 `/v` 载具 | 开关 |

## 3.3 Permissions.config.xml — 权限组树形

> **路径**：`Servers/<ServerID>/Rocket/Permissions.config.xml`
> **真源**：[wasabihosting.com](https://docs.wasabihosting.com/games/unturned/server-configuration) + [restoremonarchy.com](https://restoremonarchy.com/docs/servers/rocket/permissions)
> **生效**：改后需 PTY 终端输入 `/p reload` 或走「应用变更」按钮重启服务。

**Schema 结构**：

```xml
<?xml version="1.0" encoding="utf-8"?>
<RocketPermissions xmlns:xsd="http://www.w3.org/2001/XMLSchema"
                   xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <DefaultGroup>default</DefaultGroup>
  <Groups>
    <Group>
      <Id>default</Id>                          <!-- 组唯一 ID（kebab-case 推荐） -->
      <DisplayName>Player</DisplayName>         <!-- 玩家聊天显示的组名 -->
      <Color>white</Color>                      <!-- black/blue/clear/cyan/gray/green/grey/magenta/red/white/yellow/rocket/#RRGGBB -->
      <Members>
        <Member>76561198012345678</Member>      <!-- 玩家 17 位 SteamID64 -->
      </Members>
      <ParentGroup>default</ParentGroup>        <!-- 父组 Id（继承父组所有权限） -->
      <Priority>100</Priority>                  <!-- 数字越小权限越高；同优先级位置靠上者胜出 -->
      <Permissions>
        <Permission>rocket.kits</Permission>    <!-- 权限字符串（rocket.kits / rocket.tpa / rocket.home / kit.survival 等，由各插件定义） -->
      </Permissions>
    </Group>
    <Group>
      <Id>vip</Id>
      <DisplayName>VIP</DisplayName>
      <Color>yellow</Color>
      <ParentGroup>default</ParentGroup>
      <Priority>50</Priority>
      <Permissions>
        <Permission>rocket.kits.vip</Permission>
        <Permission>rocket.warp</Permission>
      </Permissions>
    </Group>
  </Groups>
</RocketPermissions>
```

**面板处理**：树形 Groups 编辑器 + 成员 SteamID64 列表 + 颜色选择器（Color 枚举 + hex）+ 通配符权限（`rocket.*` / `*`）原样展示。

## 3.4 LDM 插件 Configuration.xml — 通用原文模式

> **路径**：`Servers/<ServerID>/Rocket/Plugins/<PluginName>/<PluginName>.configuration.xml`
> **真源**：每插件自定义（LDM 不强解 schema）
> **生效**：改后需重启（同 3.1）。

**面板处理**：通用 Monaco XML 编辑器——原文读写 + 实时校验；**不强解字段**（插件 schema 由插件开发者决定，维护成本无限）。Phase 2 用 `RocketConfigXmlParser.parseGeneric / serializeGeneric`（保留注释/CDATA/嵌套）做底层读写。

---

# 4. 字段细节自行溯源指引

> 字段默认值 / 枚举值 / 类型以 **U3-SDK 真源**（`.research/U3-SDK/Assets/Runtime/Assembly-CSharp/Unturned/`）为准；
> LDM 字段以 **LDM 仓源码**（`.research/Legally-Distinct-Missile/Rocket/Rocket.Core/Serialization/`）为准。
> 凡设计到具体字段名、枚举值、取值范围、解析/写入逻辑，直接到对应源码查找，不要以本文档或社区教程为准。
