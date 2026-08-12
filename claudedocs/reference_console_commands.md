# Unturned 控制台指令完整参考

> 面向 Web UI 面板的"控制台"和"RCON 命令"功能设计。  
> 来源：`unturned.wiki.gg/wiki/Console_commands`（2026-08-03 抓取）  
> 命令不区分大小写；聊天中输入需 `/` 或 `@` 前缀（需管理员权限）；控制台/RCON 中无前缀。

---

## 分类索引

| 分类 | 命令数 |
|---|---|
| 玩家管理 | 10 |
| 世界控制 | 8 |
| 物品/载具 | 4 |
| 传送/移动 | 1 |
| 聊天/消息 | 2 |
| 信息/查询 | 7 |
| 配置 | 17 |
| 作弊（需 Cheats 开启） | 9 |
| 生命周期 | 3 |

---

## 1. 玩家管理（10 条）

### Admin — 添加管理员
```
Admin <SteamID | Player>
```
- **类别**：runtime
- **说明**：将玩家加入管理员列表，赋予聊天命令执行权限
- **RCON 示例**：`Admin 76561198012345678`
- **聊天示例**：`/admin MiaoShan`

### Unadmin — 移除管理员
```
Unadmin <SteamID | Player>
```
- **类别**：runtime
- **RCON 示例**：`Unadmin 76561198012345678`

### Kick — 踢出玩家
```
Kick <SteamID | Player> / <Reason>
```
- **类别**：runtime
- **参数**：Reason 可选，留空 = "unspecified"
- **RCON 示例**：`Kick 76561198012345678 挂机太久`
- **聊天示例**：`/kick MiaoShan/AFK too long`

### Ban — 封禁玩家
```
Ban <SteamID | Player> / <Reason> / <Duration>
```
- **类别**：runtime
- **参数**：Reason 可选（默认 "unspecified"），Duration 可选（默认 31536000 秒 = 365 天）
- **RCON 示例**：`Ban 76561198012345678 Cheating 86400`
- **聊天示例**：`/ban MiaoShan/Griefing/604800`

### Unban — 解除封禁
```
Unban <SteamID>
```
- **类别**：runtime
- **RCON 示例**：`Unban 76561198012345678`

### Slay — 击杀 + 永久封禁
```
Slay <SteamID | Player> / <Reason>
```
- **类别**：runtime
- **说明**：先击杀再永久封禁（365天）。比 Ban 更强力。
- **RCON 示例**：`Slay 76561198012345678 Speedhacking`

### Spy — 请求截图
```
Spy <SteamID | Player>
```
- **类别**：runtime
- **说明**：请求目标玩家的屏幕截图，保存到执行者电脑为 `Spy.jpg`

### Kill — 击杀玩家
```
Kill <SteamID | Player>
```
- **类别**：runtime
- **说明**：在游戏中击杀指定玩家

### Permit — 加入白名单
```
Permit <SteamID> / <Tag>
```
- **类别**：runtime
- **说明**：将玩家加入允许列表。需 `Whitelisted` 开启才生效。

### Unpermit — 移出白名单
```
Unpermit <SteamID>
```
- **类别**：runtime

---

## 2. 世界控制（8 条）

### Time — 设置时间
```
Time <Seconds>
```
- **类别**：runtime
- **说明**：设置昼夜循环中的当前时间（秒）。0=日出，具体值取决于地图。
- **RCON 示例**：`Time 7200`

### Day — 设为白天
```
Day
```
- **类别**：runtime
- **说明**：将时间设置为白天（具体时刻由地图光照 fade 值决定）

### Night — 设为夜晚
```
Night
```
- **类别**：runtime
- **说明**：将时间设置为夜晚

### Cycle — 昼夜循环长度
```
Cycle <Number>
```
- **类别**：any
- **默认**：3600
- **说明**：设置昼夜循环完整周期长度（秒）。3600=1小时现实时间=游戏内一天。

### Weather — 天气控制
```
Weather <None | Disable | Storm | Blizzard | GUID>
```
- **类别**：runtime
- **RCON 示例**：`Weather Storm` / `Weather None`

### Airdrop — 强制空投
```
Airdrop
```
- **类别**：runtime
- **说明**：立即让一架运输机飞过地图执行空投

### Save — 保存世界
```
Save
```
- **类别**：any
- **说明**：强制保存服务器状态到磁盘。**Web 面板应在重启/关机前先执行 Save。**

### Map — 设置地图（仅启动时）
```
Map <Level>
```
- **类别**：config
- **默认**：PEI
- **说明**：设置启动时加载的地图名称。必须在 Commands.dat 中设置，运行时不可切换。

---

## 3. 物品/载具（4 条）

### Give — 给予物品 ⚠️ 需 Cheats
```
Give <SteamID | Player> / <ItemID | ItemName | ItemFilename> / <Amount>
```
- **类别**：runtime cheat
- **默认**：Amount=1, Player=执行者本人
- **RCON 示例**：`Give 76561198012345678 4 5`（给物品ID 4 五个）
- **聊天示例**：`@give MiaoShan/81/1`

### Vehicle — 生成载具 ⚠️ 需 Cheats
```
Vehicle <SteamID | Player> / <VehicleID | VehicleGUID | VehicleName | VehicleFilename>
```
- **类别**：runtime cheat
- **默认**：Player=执行者本人
- **RCON 示例**：`Vehicle 76561198012345678 1`

### Animal — 生成动物 ⚠️ 需 Cheats
```
Animal <SteamID | Player> / <AnimalID>
```
- **类别**：runtime cheat

### Loadout — 出生装备
```
Loadout <SkillsetID> / <ItemID>...
```
- **类别**：any
- **说明**：指定技能组玩家出生时自动获得物品。SkillsetID 255=全部技能组。
- **RCON 示例**：`Loadout 255/81/4`

---

## 4. 传送/移动（1 条）

### Teleport — 传送玩家
```
Teleport <SteamID | Player> / <SteamID | Player | Location>
```
- **类别**：runtime
- **说明**：将第一个玩家传送到第二个目标。目标可以是：玩家名/SteamID、地图位置节点名、`wp`（路径点）、`bed`（床）
- **RCON 示例**：`Teleport 76561198012345678 Seattle`
- **聊天示例**：`/teleport MiaoShan/wp`

---

## 5. 聊天/消息（2 条）

### Say — 全服广播
```
Say <Text> / <R> / <G> / <B>
```
- **类别**：runtime
- **默认**：颜色 0,255,0（绿色）
- **RCON 示例**：`Say 服务器将在10分钟后重启 255 0 0`
- **聊天示例**：`/say 欢迎新玩家`

### Welcome — 欢迎消息
```
Welcome <Text> / <R> / <G> / <B>
```
- **类别**：any
- **说明**：设置玩家连接时显示的欢迎消息

---

## 6. 信息/查询（7 条）

### Players — 在线玩家
```
Players
```
- **类别**：any
- **说明**：列出当前在线玩家到控制台。**RCON 中执行返回纯文本，需解析。**

### Admins — 管理员列表
```
Admins
```
- **类别**：any

### Bans — 封禁列表
```
Bans
```
- **类别**：any

### Permits — 白名单列表
```
Permits
```
- **类别**：any

### Modules — 已加载模块
```
Modules
```
- **类别**：any

### Help — 命令帮助
```
Help <Command>
```
- **类别**：any

### Debug — 服务器状态
```
Debug
```
- **类别**：runtime
- **说明**：输出服务器运行时状态信息到控制台

---

## 7. 配置指令（17 条）

### Name — 服务器名称
```
Name <Text>
```
- **类别**：any | **默认**：Unturned | **范围**：5–50 字符

### Password — 进服密码
```
Password <Text>
```
- **类别**：config | **说明**：只使用 SHA-1 哈希，不要复用其他地方的密码

### Port — 端口
```
Port <Number>
```
- **类别**：config | **默认**：27015 | **说明**：实际占用连续 2 个端口（查询端口=Port+1）

### MaxPlayers — 最大玩家
```
MaxPlayers <Number>
```
- **类别**：any | **默认**：8 | **范围**：1–200

### Mode — 难度
```
Mode <Easy | Normal | Hard>
```
- **类别**：config | **默认**：Normal

### PvE — 禁用 PvP
```
PvE
```
- **类别**：config

### Cheats — 启用作弊
```
Cheats
```
- **类别**：config

### Perspective — 视角限制
```
Perspective <First | Third | Both | Vehicle>
```
- **类别**：config | **默认**：Both

### Owner — 服务器所有者
```
Owner <SteamID>
```
- **类别**：config | **说明**：只能设定一个 Owner

### Bind — 绑定 IP
```
Bind <IP>
```
- **类别**：config | **默认**：0.0.0.0

### GSLT — 游戏服务器登录令牌
```
GSLT <LoginToken>
```
- **类别**：config | **说明**：使 Server Code 在重启间保持稳定

### Gold — 仅限 Gold 会员
```
Gold
```
- **类别**：config

### Whitelisted — 白名单模式
```
Whitelisted
```
- **类别**：config | **说明**：开启后只有 Permit 过的玩家可以加入

### Filter — 名称过滤
```
Filter
```
- **类别**：config | **说明**：过滤非英文/非字母数字的玩家名

### Sync — 跨服存档同步
```
Sync
```
- **类别**：config

### Hide_Admins — 隐藏管理员标签
```
Hide_Admins
```
- **类别**：config

### Timeout — Ping 超时阈值
```
Timeout <Number>
```
- **类别**：any | **默认**：750 | **范围**：50–10000 ms

### Chatrate — 聊天冷却
```
Chatrate <Number>
```
- **类别**：any | **默认**：0.25 | **范围**：0–60 秒

### Queue_Size — 排队上限
```
Queue_Size <Number>
```
- **类别**：any | **默认**：0 | **范围**：0–64

### GameMode — 游戏模式
```
GameMode <ClassName>
```
- **类别**：config

### Log — 日志选项
```
Log <Chat Y/N> / <Join/Leave Y/N> / <Death Y/N> / <Anticheat Y/N>
```
- **类别**：any | **默认**：N/N/N/N

### Votify — 投票配置
```
Votify <Vote Allowed Y/N> / <Pass Cooldown> / <Fail Cooldown> / <Vote Duration> / <Vote Percentage> / <Players>
```
- **类别**：any | **默认**：禁用投票

---

## 8. 作弊指令（9 条，需 Cheats 开启）

| 命令 | 语法 | 说明 |
|---|---|---|
| `Animal` | `Animal <Player>/<AnimalID>` | 生成动物 |
| `Experience` | `Experience <Player>/<Exp>` | 给予经验值 |
| `Flag` | `Flag <Player>/<Flag>/<Value>` | 设置玩家 Flag |
| `Give` | `Give <Player>/<ItemID\|Name>/<Amount>` | 给予物品（默认数量 1） |
| `Quest` | `Quest <Player>/<Quest>` | 给予任务 Flag |
| `Reputation` | `Reputation <Player>/<Rep>` | 给予声望值 |
| `UnlockNpcAchievement` | `UnlockNpcAchievement <Player>/<AchievementID>` | 授予成就 |
| `Vehicle` | `Vehicle <Player>/<VehicleID\|Name>` | 生成载具 |

---

## 9. 生命周期（3 条）

### Shutdown — 关闭服务器
```
Shutdown <Delay> / <Explanation>
```
- **类别**：any
- **说明**：延迟（秒）后保存、断开所有客户端、关闭服务器。无参数=立即关闭无提示。**Web 面板重启前必须先发 `Save` 再发 `Shutdown 10 面板触发重启`。**
- **RCON 示例**：`Shutdown 60 服务器将在1分钟后重启以应用Mod变更`

### Reload — 重载资源
```
Reload <GUID | Directory>
```
- **类别**：runtime
- **RCON 示例**：`Reload 5b8c2d3e4f1a...`

### ResetConfig — 重置配置
```
ResetConfig
```
- **类别**：runtime
- **说明**：将配置文件重置为默认值。**危险操作，使用前应备份。**

### AllowP2PRelay — P2P 中继开关
```
AllowP2PRelay <boolean>
```
- **类别**：runtime | **默认**：1

### EffectUI — UI 特效
```
EffectUI <EffectID> / <Token>...
```
- **类别**：runtime

---

## 10. LDM Mod 框架命令（Phase 1，2026-08-13 落地）

LDM 命令经 PTY 终端 owner-trust 通道写入（ADR-0004 Phase 6 删 RCON 后为唯一命令通道）。命令锚点见 U.cs:93-118 默认翻译。

### `/rocket plugins` — 列出已加载插件

按 Loaded / Unloaded / Failure / Cancelled 4 组展示当前插件运行时状态。面板解析 stdout 后写入 `InstalledPlugin.runtimeStatus`（Phase 1 暂未接，runtimeStatus 全部 = `unknown`）。

### `/rocket load <name>` — 加载已卸载插件

- 锚点：`Loading {name}`（U.cs:93-118 `command_rocket_load_plugin`）
- 失败锚点：`Unable to load plugin` / `Could not find plugin` / `Unknown plugin`
- 面板：POST `/api/servers/:id/ldm/load-plugin` → PTY 写命令 → 10s 内收响应 → outcome=`success`/`failure`
- Linux 大小写敏感：`Plugins/Uconomy.dll` ≠ `Plugins/uconomy.dll`

### `/rocket unload <name>` — 卸载已加载插件

- 锚点：`Unloading {name}`
- 失败锚点：`Unable to unload plugin` / `is not loaded`
- 面板：POST `/api/servers/:id/ldm/unload-plugin`，同 load 协议

### `/rocket reload <name>` — 重新加载指定插件（Phase 4 + 加警告）

官方不保证成功（U3-SDK Issue #1794），仅单插件 reload 支持。

### `/rocket reload`（全局） — **不暴露**

LDM 官方已删；prohibitions.md 钉死。自动化必报 `Please reload individual plugins instead`。

### `/modules` — 验证 LDM 是否加载

U3DS 原生命令，输出 `Rocket.Unturned v<version>` 标识。面板「LDM 状态」卡片使用。

### `/p reload` — 重新加载 `Permissions.config.xml`

frontend 按钮 + PTY owner-trust（不暴露 RCON 通道）。

### Phase 1 鉴权与 race

| 约束 | 实现 |
|---|---|
| **实例必须 RUNNING** | LdmPluginCommandsService 调 ServerManager.getState，非 RUNNING → server-not-running |
| **per-server 互斥锁** | 同 serverId 同时仅一个 load/unload 在跑，Promise 链串行 |
| **10s 超时** | Promise.race(pollForMarker, pty.waitForMarker) |
| **Outcome 语义** | success = LDM 命令已接受（加载成功零日志，需 `/rocket plugins` 复核）；failure = LDM 拒绝 |

---

## 11. Web 面板的 RCON 命令封装

### 11.1 命令分类建议

| 面板功能 | 封装为 | 底层 RCON 命令 |
|---|---|---|
| 查看在线玩家 | 按钮 | `Players`（解析输出） |
| 踢出玩家 | 按钮+原因输入 | `Kick <SteamID> <Reason>` |
| 封禁玩家 | 按钮+原因+时长 | `Ban <SteamID> <Reason> <Duration>` |
| 全服广播 | 输入框+颜色选择器 | `Say <Text> <R> <G> <B>` |
| 设置时间 | 滑块 | `Time <Seconds>` |
| 白天/黑夜 | 开关 | `Day` / `Night` |
| 强制保存 | 按钮 | `Save` |
| 重启前关机 | 按钮（自动：Save→Shutdown延迟） | `Save` + `Shutdown 10 <Reason>` |
| 天气切换 | 下拉 | `Weather <Option>` |
| 给出物品 | 仅 Owner 可见的搜索+玩家选择 | `Give <Player> <ItemID> <Amount>` |
| 传送到玩家 | 搜索+目标选择 | `Teleport <Player> <Target>` |
| 给予载具 | 仅 Owner 可见 | `Vehicle <Player> <VehicleID>` |

### 10.2 危险命令标记

以下命令应在面板 UI 上标记为 **☠️ 危险** 并要求二次确认：
- `Shutdown` — 会关停服务器
- `Ban` — 365 天默认时长
- `Slay` — 击杀+永久封禁
- `ResetConfig` — 重置所有配置
- `Unadmin` — 移除管理员
- `Unban` — 解除封禁
- `Cheats` — 开启后所有作弊命令可用

### 10.3 Owner-Only 命令

以下命令仅 Owner 可执行（Admin 不行）：
- `Owner` — 已在 Commands.dat 中设定，RCON 中通常不暴露
- `Cheats` — 开启/关闭作弊模式
- `Shutdown`（部分配置下）

---

## 12. RCON 响应解析参考（已退役——ADR-0004 Phase 6，2026-08-11）

> ⛔ **本章节仅作历史参考**。RCON 通道已整体删除（`rcon-srcds` 依赖、`RconManager` 模块、`/rcon` `/players` 路由、`PlayersPage` 全部移除）。命令统一走 **PTY 持久终端 owner-trust 模型**（LDM 命令入站 `terminal_input` 写 PTY，§10）。当前开发不要引用其中的 RCON 响应格式。

### Players 命令输出格式
```
Player Name (SteamID) | Character Name | Ping | Time Online
```

### Bans 命令输出格式
```
SteamID | Reason | Duration | Banned By | Time Remaining
```

> **注意**：Unturned 控制台输出格式没有官方文档保证稳定性。面板应做 **尽力解析** + fallback 到"显示原始输出"。

---

*来源：unturned.wiki.gg/wiki/Console_commands（CC BY-NC-SA）。文档版本 2026-08-03。*
