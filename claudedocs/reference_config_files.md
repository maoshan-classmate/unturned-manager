# Unturned 服务端配置文件参数参考（面板已实现字段）

> 面向 Web UI 管理面板的可视化配置编辑器设计。  
> 每个字段标注：类型、默认值、取值范围、Web UI 控件建议、**SDK 真源（U3-SDK 代码行号，`.research/U3-SDK/`）**。

> **字段细节自行溯源**：本文档只收录面板已实现字段的权威表，**不穷举所有配置项**。凡设计到具体字段名、枚举值、取值范围、解析/写入逻辑等细节，请直接到 U3-SDK 源码中查找对应类（`.research/U3-SDK/Assets/Runtime/Assembly-CSharp/Unturned/`），不要以本文档或社区教程为准。

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

### 2.3 前后端契约（BUG-2 防回归，2026-08-13）

> **契约形状**：Config.txt 读写两侧必须走 `shared/schemas/config.schema.ts` 的 `ConfigSectionSchema`——`sections: Record<sectionName, { name, entries: ConfigEntry[] }>`，**不是**裸 kv map。

**踩坑实录（BUG-2）**：前端曾把 `sections` 写成 `{ "浏览器": { Login_Token: "..." } }`（裸 kv map），后端 Zod 校验 400 拒绝 + read 侧 `sections["浏览器"].Login_Token` 直接解构读不到值（实际在 `entries[]` 里）→ 保存必失败 + 编辑内容全空。

**防回归铁律**：
- 前端读写 Config.txt 走 `manager-web/src/pages/configTxtAdapter.ts` 的 5 个 helper（`readStringEntry` / `readBoolEntry` / `boolEntry` / `stringEntry` / `buildTxtSections`）——**禁止**手写 `sections[中文][字段]` 形态
- UI 新增字段必须同步改 `buildTxtSections`（helper 文件有注释声明）
- helper 的 owner 网：`manager-web/src/pages/configTxtAdapter.test.ts` 17 用例——新增/改 helper 必须同步更新单测
- 后端 `ConfigService.parseConfigTxt` 输出 `{name, entries}`，`serializeConfigTxt` 接受同构——两侧契约以 schema 为唯一权威

**bool 字段细节**：
- 勾选 = `value: null` + `type: 'bool'`（后端 serialize 写裸 key 行 = 开关）
- 未勾选 = `value: 'false'` + `type: 'bool'`（保留已知键，显式 false——CLAUDE.md §unturned-sop 解析器契约：面板不能把不认识的指令删了）
- 空 string 字段 = `value: null`（避免空 `key=` 行污染文件）

**TS 重载陷阱**：helper 曾用 TS 重载 `readSectionEntry(isBool: true/false)` 区分返回值——**运行时 JS 不区分重载**，`isBool=false` 时实际返回 `false` 而非 `''`（单测 1/14 失败捕获）。已拆为 `readStringEntry` / `readBoolEntry` 两个独立函数，**后续禁止用 TS 重载实现运行时类型分支**。

---

## 3. Rocket.config.xml — LDM 主框架配置

**路径**：`Servers/<ServerID>/Rocket/Rocket.config.xml`
**格式**：XML（XmlSerializer，C# 类 `RocketSettings.cs`，XML 根元素 `<RocketConfiguration>`）
**生成**：**首次启动 U3DS 自动生成**——**不可手写预创建**（[gameserverkings.com](https://www.gameserverkings.com/knowledge-base/unturned/how-to-install-rocketmod-plugins-for-unturned) 警告）
**真源**：[`Rocket/Rocket.Core/Serialization/RocketSettings.cs`](https://github.com/SmartlyDressedGames/Legally-Distinct-Missile) + [wasabihosting.com](https://docs.wasabihosting.com/games/unturned/server-configuration)
**版本核对（2026-08-12）**：`.research/Legally-Distinct-Missile`（master `c5f8062`）与游戏自带 `Extras/Rocket.Unturned`（`Rocket.API/Core=4.9.3.16` + `Rocket.Unturned=4.9.3.18`）的 schema 字段**零差异**（git diff v4.9.3.15/18 vs master 验证）——本字段表对实际运行版本成立
**生效**：改后需 PTY 终端 `Save` + `Shutdown 10` 重启（**无官方热重载**——U3-SDK Issue #1794）

### 3.1 顶层字段

| XML 元素 | .NET 类型 | 默认 | 含义 | SDK 真源 | Web UI 控件 |
|---|---|---|---|---|---|
| `LanguageCode` | string | `"en"` | 翻译文件代码（`Rocket.{code}.translation.xml`） | `RocketSettings.cs` | 下拉（en/zh-CN/...） |
| `MaxFrames` | int | `60` | 帧预算（部分 Rocket API 用） | `RocketSettings.cs` | 数字 |

### 3.2 `<RCON>` 子组（**本项目不暴露**）

> ⚠️ **ADR-0004 Phase 6 已删 RCON 通道**——UI 隐藏此字段组，避免误改导致明文密码 `"changeme"` 暴露。

| XML 元素 | 类型 | 默认 | 含义 |
|---|---|---|---|
| `RCON/Enabled` | bool | `false` | 开关 Telnet RCON |
| `RCON/Port` | ushort | `27115` | TCP 端口 |
| `RCON/Password` | string | **`"changeme"`（明文，必须改）** | 凭证 |
| `RCON/EnableMaxGlobalConnections` | bool | `true` | 全局连接限流 |
| `RCON/MaxGlobalConnections` | ushort | `10` | 全局连接上限 |
| `RCON/EnableMaxLocalConnections` | bool | `true` | 本地连接限流 |
| `RCON/MaxLocalConnections` | ushort | `3` | 本地连接上限 |

### 3.3 `<AutomaticShutdown>` 子组

| XML 元素 | 类型 | 默认 | 含义 | Web UI 控件 |
|---|---|---|---|---|
| `AutomaticShutdown/Enabled` | bool | `false` | 周期自动关服开关 | 开关 |
| `AutomaticShutdown/Interval` | int | `86400` | 间隔秒数（24h） | 数字 |

### 3.4 `<WebPermissions>` 子组

| XML 元素 | 类型 | 默认 | 含义 | Web UI 控件 |
|---|---|---|---|---|
| `WebPermissions/Enabled` | bool | `false` | 远程权限同步开关 | 开关 |
| `WebPermissions/Url` | string | `""` | 同步 URL | 文本 |
| `WebPermissions/Interval` | int | `180` | 同步间隔秒 | 数字 |

### 3.5 `<WebConfigurations>` 子组

| XML 元素 | 类型 | 默认 | 含义 | Web UI 控件 |
|---|---|---|---|---|
| `WebConfigurations/Enabled` | bool | `false` | 远程插件配置同步开关 | 开关 |
| `WebConfigurations/Url` | string | `""` | 同步 URL | 文本 |

> ❌ **删字段**（老 RocketMod <4.x / 教程误传，LDM master 不存在）：`Economy/*` `InstanceGuid` `InstanceName` `Port` `AutomaticallyDownloadPatches` `EnableLogging` `LogLevel` `LogToFile` `LogToConsole`——面板写入这些字段会被 XmlSerializer 静默忽略。

---

## 4. Rocket.Unturned.config.xml — LDM-Unturned 特有配置

**路径**：`Servers/<ServerID>/Rocket/Rocket.Unturned.config.xml`
**格式**：XML（XmlSerializer，C# 类 `UnturnedSettings.cs`）
**生成**：首次启动 U3DS 自动生成（与 Rocket.config.xml 同时）
**真源**：[`Rocket/Rocket.Unturned/Serialisation/UnturnedSettings.cs`](https://github.com/SmartlyDressedGames/Legally-Distinct-Missile)
**版本核对（2026-08-12）**：与游戏 Extras 实际版本零差异（同 §3）
**生效**：改后需重启

> ⚠️ **不暴露字段**：`RocketModObservatory` 子组（`CommunityBans` / `KickLimitedAccounts` / `KickTooYoungAccounts` / `MinimumAge`）属于已废弃功能——仅 `CommunityBans` 字段（`UnturnedSettings.cs:20`）带 `[Obsolete("Observatory is no longer maintained.")]` 注解（`RocketModObservatorySettings` 类本身无标注）。**面板不提供编辑**，避免引导用户配置已废弃功能。

| XML 元素 | 类型 | 默认 | 含义 | SDK 真源 | Web UI 控件 |
|---|---|---|---|---|---|
| `<AutomaticSave>` / `<Enabled>` | bool | `true` | 定时触发 U3DS `/save` 命令 | `UnturnedSettings.cs` | 开关 |
| `<AutomaticSave>` / `<Interval>` | int | `1800` | 间隔秒数（30 分钟） | `UnturnedSettings.cs` | 数字 |
| `<CharacterNameValidation>` | bool | `false` | 启用角色名正则校验 | `UnturnedSettings.cs` | 开关 |
| `<CharacterNameValidationRule>` | string | `"([\x00-\xAA]\|[\w_\ \.\+\-])+"` | 正则模式（防注入） | `UnturnedSettings.cs` | 文本（高级） |
| `<LogSuspiciousPlayerMovement>` | bool | `true` | 记录瞬移速度违规 | `UnturnedSettings.cs` | 开关 |
| `<EnableItemBlacklist>` | bool | `false` | 限制 `/i` 物品（黑名单模式） | `UnturnedSettings.cs` | 开关 |
| `<EnableItemSpawnLimit>` | bool | `false` | 限制单次刷物品数 | `UnturnedSettings.cs` | 开关 |
| `<MaxSpawnAmount>` | int | `10` | 配合上一项的单次刷物品上限 | `UnturnedSettings.cs` | 数字 |
| `<EnableVehicleBlacklist>` | bool | `false` | 限制 `/v` 载具 | `UnturnedSettings.cs` | 开关 |

---

## 5. Permissions.config.xml — LDM 权限组配置

**路径**：`Servers/<ServerID>/Rocket/Permissions.config.xml`
**格式**：XML（XmlSerializer）
**生成**：首次启动 U3DS 自动生成
**真源**：[wasabihosting.com](https://docs.wasabihosting.com/games/unturned/server-configuration) + [restoremonarchy.com](https://restoremonarchy.com/docs/servers/rocket/permissions)
**生效**：改后需 PTY 写 `/p reload` 或重启

### 5.1 顶层字段

| XML 元素 | 类型 | 默认 | 含义 | Web UI 控件 |
|---|---|---|---|---|
| `<DefaultGroup>` | string | `"default"` | 未显式分配玩家的默认组 Id | 下拉（来自 Groups） |

### 5.2 `<Groups>` / `<Group>` 子组

| XML 元素 | 类型 | 默认 | 含义 | Web UI 控件 |
|---|---|---|---|---|
| `<Id>` | string | — | 组唯一 ID（kebab-case 推荐） | 文本（唯一） |
| `<DisplayName>` | string | — | 玩家聊天显示的组名 | 文本 |
| `<Color>` | enum/string | `white` | `black/blue/clear/cyan/gray/green/grey/magenta/red/white/yellow/rocket/#RRGGBB` | 颜色选择器 |
| `<Prefix>` | string | `""` | 聊天前缀文本（建议带尾空格） | 文本 |
| `<Suffix>` | string | `""` | 聊天后缀文本（建议带头空格） | 文本 |
| `<ParentGroup>` | string (Group Id) | — | 父组 Id（继承父组所有权限） | 下拉（来自 Groups） |
| `<Priority>` | int | `100` | **数字越小权限越高**；同优先级位置靠上者胜出 | 数字 |

### 5.3 `<Members>` / `<Member>` 子组

| XML 元素 | 类型 | 含义 | Web UI 控件 |
|---|---|---|---|
| `<Member>` | ulong (SteamID64) | 玩家 17 位 SteamID | SteamID 输入 + 列表 |

### 5.4 `<Permissions>` / `<Permission>` 子组

| XML 元素 | 属性 | 类型 | 含义 | Web UI 控件 |
|---|---|---|---|---|
| `<Permission>` | `Cooldown` (int 秒) | string | 权限字符串（`rocket.kits` / `rocket.tpa` / `rocket.home` / `kit.survival` 等，由各插件定义）；Cooldown 限制命令冷却秒数 | 输入 + 通配支持（`rocket.*`） |

> **通配**：`rocket.*` 通配支持（如 `rocket.kits.*` 匹配 `rocket.kits.vip` 等所有子权限）。
