# Unturned 服务端配置文件完整参数参考

> 面向 Web UI 管理面板的可视化配置编辑器设计。  
> 每个字段标注：类型、默认值、取值范围、Web UI 控件建议。

---

## 1. Commands.dat — 服务器启动/运行时指令

**路径**：`Servers/<ServerID>/Server/Commands.dat`  
**格式**：每行一条指令，空格分隔参数  
**加载**：服务器启动时读取，部分指令运行时也可通过控制台/RCON 执行

### 1.1 服务器身份与连接

| 指令 | 参数 | 类型 | 默认值 | 范围 | 分类 | Web UI 控件 |
|---|---|---|---|---|---|---|
| `Name` | `<Text>` | string | `Unturned` | 5–50 字符 | any | 文本输入框 (maxlength=50) |
| `Password` | `<Text>` | string | 无（开放） | 任意文本 | config | 密码输入框 (SHA-1 哈希存储) |
| `Port` | `<Number>` | int | `27015` | 1024–65535 | config | 数字输入 + 提示"占用 2 个连续端口" |
| `Bind` | `<IP>` | string | `0.0.0.0` | 有效 IP | config | 文本输入 (IP 格式校验) |
| `MaxPlayers` | `<Number>` | int | `8` | 1–200 | any | 数字滑块 |
| `Queue_Size` | `<Number>` | int | `0` | 0–64 | any | 数字滑块 |
| `GSLT` | `<LoginToken>` | string | 无 | — | config | 密码输入框 + 链接到 steamcommunity.com/dev/managegameservers |
| `Perspective` | `First\|Third\|Both\|Vehicle` | enum | `Both` | — | config | 下拉选择 |

### 1.2 地图与游戏模式

| 指令 | 参数 | 类型 | 默认值 | 范围 | 分类 | Web UI 控件 |
|---|---|---|---|---|---|---|
| `Map` | `<Level>` | string | `PEI` | 已安装地图 | config | 下拉选择（从 Maps/ 目录扫描） |
| `Mode` | `Easy\|Normal\|Hard` | enum | `Normal` | — | config | 下拉选择 |
| `GameMode` | `<ClassName>` | string | 无 | 已安装 GameMode | config | 下拉选择 |
| `PvE` | 无参数 | flag | 关闭 | — | config | 开关 (PvP / PvE) |
| `Cheats` | 无参数 | flag | 关闭 | — | config | 开关 |

### 1.3 管理权限

| 指令 | 参数 | 类型 | 默认值 | 范围 | 分类 | Web UI 控件 |
|---|---|---|---|---|---|---|
| `Owner` | `<SteamID>` | SteamID64 | 无 | 单个 17 位 ID | config | 文本输入 (SteamID64 格式校验) |

### 1.4 安全与过滤

| 指令 | 参数 | 类型 | 默认值 | 范围 | 分类 | Web UI 控件 |
|---|---|---|---|---|---|---|
| `Gold` | 无参数 | flag | 关闭 | — | config | 开关 |
| `Whitelisted` | 无参数 | flag | 关闭 | — | config | 开关 |
| `Filter` | 无参数 | flag | 关闭 | — | config | 开关 |
| `Hide_Admins` | 无参数 | flag | 关闭 | — | config | 开关 |
| `Sync` | 无参数 | flag | 关闭 | — | config | 开关 |

### 1.5 RCON（原生 SDG RCON — 协议未公开，但 Commands.dat 支持配置）

| 指令 | 参数 | 类型 | 默认值 | 范围 | 分类 | Web UI 控件 |
|---|---|---|---|---|---|---|
| `RCON Enabled` | `true\|false` | bool | 未确认 | — | config | 开关 |
| `RCON Port` | `<Number>` | int | 同游戏端口 | 1024–65535 | config | 数字输入 |
| `RCON Password` | `<String>` | string | 无 | 任意文本 | config | 密码输入框 |

> **注意**：这三个指令的存在来自 Zonely 托管面板文档，SDG 官方文档未公开确认。如果 Web 面板通过 OpenMod/RocketMod RCON 通信，则不需要配置原生 RCON。建议在 UI 上标注"实验性 / 与 OpenMod RCON 二选一"。

### 1.6 游戏参数

| 指令 | 参数 | 类型 | 默认值 | 范围 | 分类 | Web UI 控件 |
|---|---|---|---|---|---|---|
| `Timeout` | `<Number>` | int (ms) | `750` | 50–10000 | any | 数字滑块 |
| `Chatrate` | `<Number>` | float (秒) | `0.25` | 0–60 | any | 数字输入 |
| `Cycle` | `<Number>` | int (秒) | `3600` | >0 | any | 数字输入（含 "现实时间对照" 提示） |
| `Loadout` | `<SkillsetID>/<ItemID>...` | list | 无 | SkillsetID 255=全部 | any | 多条目编辑器 |

### 1.7 日志

| 指令 | 参数 | 类型 | 默认值 | 分类 | Web UI 控件 |
|---|---|---|---|---|---|
| `Log` | `Chat Y/N, Join/Leave Y/N, Death Y/N, Anticheat Y/N` | 4×bool | `N/N/N/N` | any | 四个独立开关 |

### 1.8 投票

| 指令 | 参数 | 类型 | 默认值 | 分类 | Web UI 控件 |
|---|---|---|---|---|---|
| `Votify` | `Allow Y/N, PassCooldown, FailCooldown, Duration, Percentage, Players` | mixed | 禁用 | any | 结构化表单 |

---

## 2. Config.txt — 高级游戏设置

**路径**：`Servers/<ServerID>/Config.txt`  
**格式**：`Key Value`（空格分隔），`>` 开头为注释行  
**版本**：≥3.25.8.0（2025-09），替代旧 Config.json  
**特性**：
- 空值 = 使用默认值
- 使用 `-LogGameplayConfig` 启动可打印所有覆盖值
- `-NoLevelConfigOverrides` 禁止关卡覆盖
- `-GameplayConfigFile="xxx.txt"` 指定自定义配置文件

### 2.1 Browser 段（服务器列表展示）

| 字段 | 类型 | 默认值 | 说明 | Web UI 控件 |
|---|---|---|---|---|
| `Login_Token` | string | 空 | GSLT，在 steamcommunity.com/dev/managegameservers 用 AppID 304930 创建 | 密码输入框 + 外部链接 |
| `Desc_Full` | string | 空 | 服务器详情页的完整描述（支持多行） | 多行文本编辑器 |
| `Desc_Server_List` | string | 空 | 服务器列表中的简短描述 | 文本输入框 |
| `Icon` | string (URL) | 空 | 服务器图标 URL | 文本输入 + 预览 |
| `Thumbnail` | string (URL) | 空 | 缩略图 URL | 文本输入 + 预览 |
| `Links` | list of URLs | 空 | 额外链接列表 | URL 列表编辑器 |

### 2.2 Server 段（服务器行为）

| 字段 | 类型 | 默认值 | 范围 | 说明 | Web UI 控件 |
|---|---|---|---|---|---|
| `VAC_Secure` | bool | — | — | Valve Anti-Cheat 开关 | 开关 |
| `BattlEye_Secure` | bool | true（默认开启） | — | BattlEye 反作弊 | 开关 |
| `Max_Ping_Ms` | int | 750 | — | 最大允许 ping 值 | 数字滑块 |
| `Timeout_Queue_Seconds` | int | — | — | 超时排队秒数 | 数字输入 |
| `Enable_Scheduled_Shutdown` | bool | false | — | 启用调度关机 | 开关 |
| `Scheduled_Shutdown_Time_UTC` | string (HH:mm) | — | — | 调度关机时间 (UTC) | 时间选择器 |
| `Scheduled_Shutdown_Warnings` | list of int | — | — | 关机前警告时机（秒） | 数字列表编辑器 |
| `Enable_Update_Shutdown` | bool | — | — | 游戏版本更新时自动关机 | 开关 |
| `Update_Shutdown_Warnings` | list of int | — | — | 更新关机警告时机 | 数字列表编辑器 |
| `Max_Unresponsive_Time_Seconds` | int | — | — | 无响应超时秒数 | 数字输入 |
| `Max_Packets_Per_Second` | float | — | — | 每秒最大数据包 | 数字输入 |
| `Fake_Lag_Seconds` | float | — | — | 模拟延迟补偿（秒） | 数字输入 |

### 2.3 Items 段（物品系统）

| 字段 | 类型 | 说明 | Web UI 控件 |
|---|---|---|---|
| `Spawn_Chance` | float | 物品整体生成概率倍率 | 数字滑块 (0–2.0) |
| `Despawn_Dropped_Time` | float | 丢弃物品消失时间（秒） | 数字输入 |
| `Despawn_Natural_Time` | float | 自然刷新物品消失时间 | 数字输入 |
| `Respawn_Time` | float | 物品重生时间 | 数字输入 |
| `Quality_Full_Chance` | float | 满耐久物品概率 | 滑块 (0–1) |
| `Has_Durability` | bool | 物品是否有耐久度 | 开关 |

> 注：Config.txt 中 Items/Vehicles/Zombies/Animals/Players/Barricades/Structures/Objects/Events/Gameplay 段的具体字段名会随 Unturned 版本变化。SDG 官方文档未逐字段枚举——因为该文件**启动时自动生成带注释的模板**。  
> **Web 面板策略**：首次加载时解析 Config.txt 的所有 `Key Value` 行（跳过 `>` 注释），动态生成表单。对于注释中的说明文字，提取展示为字段 tooltip。

### 2.4 Gameplay 开关

| 字段 | 说明 |
|---|---|
| `Allow_Shoulder_Camera` | 允许肩后视角 |
| `Allow_Freeform_Buildables` | 允许自由放置建筑物 |
| `Can_Suicide` | 允许自杀 |
| `Enable_Player_Damage` | 启用玩家伤害 |
| `Enable_Crowd_Scale` | 启用群体缩放 |
| `Show_Weapon_Safety_Lock` | 显示武器安全锁 |
| `Allow_Static_NPC_Respawn` | 允许静态 NPC 重生 |
| `Allow_Rocket` | 允许火箭发射器 |
| `Can_Start_Quests_Nearby` | 允许在附近开始任务 |
| `Enable_Admin_Bypass_Build_Restrictions` | 管理员绕过建筑限制 |

> 以上字段来自多项社区文档交叉验证，每个字段的具体默认值取决于难度（Easy/Normal/Hard）。  
> **实现建议**：Config.txt 不适合穷举所有字段写死到前端——应做 **Key-Value 通用解析器** + 对已知重要字段提供专用 UI 控件（开关/滑块），对未知字段回退到纯文本输入。

---

## 3. WorkshopDownloadConfig.json — Mod 订阅

**路径**：`Servers/<ServerID>/Server/WorkshopDownloadConfig.json`  
**来源**：U3-SDK `WorkshopDownloadConfig.cs`（权威，`ServerSavedata` 根 = `Servers/<ServerID>/Server/`）

| 字段 | 类型 | 默认值 | 说明 | Web UI 控件 |
|---|---|---|---|---|
| `File_IDs` | `ulong[]` | `[]` | Steam Workshop 文件 ID 列表 | 标签编辑器 + Steam WebAPI 搜索联动 |
| `Ignore_Children_File_IDs` | `ulong[]` | `[]` | 排除指定 Mod 的子依赖 | 标签编辑器 |
| `Query_Cache_Max_Age_Seconds` | `uint` | `600` | Workshop 查询缓存有效期（0=禁用） | 数字输入 |
| `Max_Query_Retries` | `uint` | `2` | 查询失败最大重试次数 | 数字输入 |
| `Use_Cached_Downloads` | `bool` | `true` | 是否加载已缓存下载 | 开关 |
| `Should_Monitor_Updates` | `bool` | `true` | 运行时监控 Workshop 更新 | 开关 ⭐ 关键 |
| `Shutdown_Update_Detected_Timer` | `int` | `600` | 检测到更新后的关机倒计时（秒） | 数字输入 (建议 60–3600) |
| `Shutdown_Update_Detected_Message` | `string` | `"Workshop file update detected, shutdown in: {0}"` | 关机广播模板，`{0}`=剩余秒数 | 文本输入 |
| `Shutdown_Kick_Message` | `string` | `"Shutdown for Workshop file update."` | 被踢出时的提示消息 | 文本输入 |

---

## 4. RocketMod 插件配置

### 4.1 Rocket.config.xml（框架级配置）

**路径**：`Servers/<ServerID>/Rocket/Rocket.config.xml`

```xml
<RCON Enabled="true" Port="27117" Password="YourSecurePassword"
      EnableMaxGlobalConnections="true" MaxGlobalConnections="10"
      EnableMaxLocalConnections="true" MaxLocalConnections="3" />
```

| 字段 | 类型 | 说明 | Web UI 控件 |
|---|---|---|---|
| `Enabled` | bool | 启用 RocketMod RCON (Telnet) | 开关 |
| `Port` | int | RCON 端口（默认游戏端口+2） | 数字输入 |
| `Password` | string | RCON 登录密码 | 密码输入框 |
| `EnableMaxGlobalConnections` | bool | 限制全局连接数 | 开关 |
| `MaxGlobalConnections` | int | 全局最大连接数 | 数字输入 |
| `EnableMaxLocalConnections` | bool | 限制本地连接数 | 开关 |
| `MaxLocalConnections` | int | 本地最大连接数 | 数字输入 |

### 4.2 单个 RocketMod 插件配置

**路径**：`Servers/<ServerID>/Rocket/Plugins/<PluginName>/Configuration.xml`（部分新插件支持 .json）

**格式**：XML（RocketMod 经典）/ JSON（RocketModFix 新增）  
**生成**：插件首次加载时自动生成默认配置文件  
**热重载**：`/rocket reload <PluginName>` — 但**强烈不推荐**，官方 Issue 确认会破坏大多数插件。变更配置应重启服务器。

**Web 面板策略**：
- 扫描 `Rocket/Plugins/` 下每个子目录
- 找到 `Configuration.xml`（或 `.json`）并解析
- **XML** → 用 `fast-xml-parser`（Node.js）转 JSON → 动态表单
- **JSON** → 直接渲染表单
- 保存时写回原文件格式
- 在变更后提示用户"需要重启服务器使配置生效"

---

## 5. OpenMod 插件配置

### 5.1 openmod.yaml（框架级配置）

**路径**：`Servers/<ServerID>/OpenMod/openmod.yaml`

```yaml
rcon:
  bind: 0.0.0.0
  enabled: true
  port: 25545
```

| 字段 | 类型 | 说明 | Web UI 控件 |
|---|---|---|---|
| `rcon.enabled` | bool | 启用 OpenMod RCON (Valve Source RCON) | 开关 |
| `rcon.bind` | string | 绑定地址 | 文本输入 (IP) |
| `rcon.port` | int | RCON 端口 | 数字输入 |

> OpenMod RCON 密码在用户层面管理（`ID:PASSWORD` 格式），不在 openmod.yaml 全局配置中。

### 5.2 单个 OpenMod 插件配置

**路径**：`openmod/plugins/<PluginId>/config.yaml`  
**格式**：标准 YAML  
**热重载**：`openmod reload <PluginId>` — **官方支持**，前提是插件代码不缓存配置值

**Web 面板策略**：
- 扫描 `openmod/plugins/` 下每个子目录
- 解析每个 `config.yaml` → `js-yaml`（Node.js）
- 读取同目录 `openmod.yaml` 获取插件元数据（id, name, version, author）
- 动态生成嵌套表单（支持 YAML 的层级结构）
- 保存时用 `js-yaml` dump 写回
- OpenMod 支持热 reload → 保存后可尝试执行 `openmod reload <PluginId>`（通过 RCON）

---

## 6. Adminlist / Blacklist / Whitelist 文件

| 文件 | 路径 | 格式 | 用途 |
|---|---|---|---|
| `Adminlist.dat` | `Servers/<ID>/Server/` | 每行一个 SteamID64 | 管理员白名单 |
| `Blacklist.dat` | `Servers/<ID>/Server/` | 每行一个 SteamID64 | 黑名单（永久禁止进入） |
| `Whitelist.dat` | `Servers/<ID>/Server/` | 每行一个 SteamID64 | 白名单（仅允许列表内玩家，需 `Whitelisted` 开启） |

**Web UI**：每条 SteamID 一行文本，支持批量粘贴 + Steam 社区 URL 解析（从 `https://steamcommunity.com/profiles/7656119...` 提取 SteamID64）。

---

## 7. 配置文件优先级关系（面板必知）

```
Servers/<ServerID>/            (服务器实例根目录)
    ├── Server/                (ServerSavedata 根目录)
    │   ├── Commands.dat (启动参数/模式/权限)
    │   └── WorkshopDownloadConfig.json (Mod 订阅)
    ├── Config.txt (游戏玩法/浏览器/反作弊 — ServerID 根，非 Server/)
    ├── Rocket/Plugins/<Name>/Configuration.xml (每插件配置)
    └── openmod/plugins/<Id>/config.yaml (每插件配置)
```

- `Commands.dat` 中的 `Mode` 决定加载 `Config_<Mode>Difficulty.txt`
- Workshop Mod 加载先于插件加载
- Config.txt 中 `-NoLevelConfigOverrides` 可阻止地图覆盖你的配置

---

*文档版本：2026-08-03。Config.txt 字段随版本变化，建议以实际生成文件为准。*
