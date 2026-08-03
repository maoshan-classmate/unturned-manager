# 子 Agent #2 产物：Unturned RCON 协议（原始交付）

> 来源：deep-research agent 完成于 2026-08-03

## 核心发现：RCON 不是一层，是四层

| 层 | 来源 | 协议 | 配置位置 | 端口 |
|---|---|---|---|---|
| Native SDG RCON | 官方 | ICommandInputOutput (未公开) | Commands.dat | 同游戏端口 (27015) |
| RocketMod/LDM RCON | 社区 | Telnet (明文行) | Rocket.config.xml | 游戏端口+2 |
| OpenMod RCON | 社区 | Valve Source RCON (TCP 二进制 LE) | openmod.yaml | 可配置 (~25545) |
| BattlEye RCON | BattlEye | 自定义 UDP + CRC32 | BEServer.cfg | 游戏端口+3 |

**Web 面板建议：优先 OpenMod Valve Source RCON + RconSharp NuGet；RocketMod Telnet 做 fallback。**

---

## 1. Native SDG RCON

Commands.dat 配置：
```
RCON Enabled true
RCON Port 27015
RCON Password YOUR_PASSWORD
```

- ICommandInputOutput C# 接口 + Dedicator.commandWindow.setIOHandler()
- -NoDefaultConsole 启动参数
- 2018 年 Devlog #012 描述了一个 JSON HTTP API (`/rcon/teleport?key=...`) 和多密钥权限——但这是 Unturned II 的设计，不确定是否回溯到 3.x
- **协议细节未公开**，需要反编译 Assembly-CSharp.dll
- 置信度：中

## 2. RocketMod/LDM RCON (Telnet)

```xml
<RCON Enabled="true" Port="27117" Password="YourSecurePassword" />
```

- TCP Telnet，明文行协议
- 连接后发 `login <password>`
- 命令纯文本，无前缀 (`say Hello`, `kick SteamID`)
- 端口 = 游戏端口 + 2
- RocketMod 2019 年停更，SDG fork 为 LDM (Legally Distinct Missile) 继续维护
- 置信度：高

## 3. OpenMod RCON (Valve Source RCON) ⭐推荐

```yaml
rcon:
  bind: 0.0.0.0
  enabled: true
  port: 25545
```

密码格式：`ID:PASSWORD`（如 `ServerOwner:Jingle`）

**Valve Source RCON 协议** (TCP LE 二进制)：

| 字段 | 类型 | 大小 |
|---|---|---|
| Size | int32 LE | 4 |
| ID | int32 LE | 4 |
| Type | int32 LE | 4 |
| Body | null-terminated ASCII | 变长 |
| Empty String | null byte | 1 |

Type：3=SERVERDATA_AUTH, 2=SERVERDATA_AUTH_RESPONSE/SERVERDATA_EXECCOMMAND, 0=SERVERDATA_RESPONSE_VALUE

**RconSharp 用法 (.NET 8 兼容)：**
```csharp
var client = RconClient.Create("127.0.0.1", 27117);
await client.ConnectAsync();
bool ok = await client.AuthenticateAsync("password");
string result = await client.ExecuteCommandAsync("players");
```

置信度：高。

## 4. BattlEye RCON

UDP 协议，7 字节头 (`B` `E` + CRC32 + 0xFF)，仅反作弊管理。不适用于通用服务器管理。置信度：高。

## 5. 完整命令列表（~60+ 条）

来源：unturned.wiki.gg/wiki/Console_commands

| 类别 | 命令示例 |
|---|---|
| 玩家管理 | Admin, Unadmin, Kick, Ban(时长/原因), Unban, Slay, Spy |
| 世界控制 | Time, Day, Night, Weather, Cycle, Airdrop, Save, Map |
| 物品/载具 | Give(物品ID/数量), Vehicle(载具ID), Loadout |
| 传送 | Teleport(目标玩家/location/wp/bed) |
| 聊天 | Say(文本/R/G/B), Welcome |
| 信息 | Players, Admins, Bans, Permits, Help, Debug, Modules |
| 配置 | Name, Password, Port, MaxPlayers, Mode, PvE, Cheats, GSLT, Bind, Gold, Whitelisted |
| 作弊 (需 Cheats 开启) | Give, Teleport, Vehicle, Animal, Experience, Flag, Kill, Quest, Reputation, UnlockNpcAchievement |
| 生命周期 | Shutdown(延迟/原因), Reload(GUID/目录), ResetConfig |

命令语法：控制台/RCON 无前缀空格分隔；游戏内聊天用 `/` 或 `@` 前缀，`/` 分隔参数。

## 6. 权限系统

| 层级 | 设置方式 | 范围 |
|---|---|---|
| Owner | Commands.dat `Owner <SteamID64>` | 全部命令 |
| Admin | Adminlist.dat 或 /admin 命令 | 除 Owner-only 外的命令 |
| Default | 所有人 | 无管理命令 |

SteamID64 格式：17 位 `7656119...`。Cheats 类命令需要 Commands.dat 中 `Cheats` 开启。

## 7. 配置文件速查

| 文件 | 路径 | 用途 |
|---|---|---|
| Commands.dat | Servers/{Name}/Server/ | 启动参数、Owner、Map、Port、原生RCON |
| Config.txt | Servers/{Name}/ | 高级设置 (≥3.25.8.0，替代 Config.json) |
| Rocket.config.xml | Servers/{Name}/Rocket/ | RocketMod 设置含 RCON |
| openmod.yaml | Servers/{Name}/OpenMod/ | OpenMod 设置含 RCON |
| BEServer.cfg | BattlEye/Config/ | BattlEye RCON |
| WorkshopDownloadConfig.json | Servers/{Name}/ | Workshop Mod |

## 8. 开源客户端参考

| 库 | NuGet | 协议 | 状态 |
|---|---|---|---|
| RconSharp | RconSharp | Valve Source RCON | MIT, netstandard 2.1 |
| CoreRCON | CoreRCON | Valve Source RCON | Archived |
| mcrcon | CLI (C) | Valve Source RCON | 事实标准 CLI |
| rcon-cli | Go | Valve Source RCON | CLI + Docker |

Unturned 专属：unturned2-panel (Node.js, 早期)、Tebex Unturned Plugin (RocketMod RCON)、OpenMod (.NET 插件框架)、Rocket.Unturned (NuGet)。

## 9. 协议选型建议

| 标准 | RocketMod Telnet | OpenMod Valve RCON |
|---|---|---|
| 复杂度 | 简单 (纯文本) | 中等 (二进制) |
| 库支持 | 不需要 (裸 TCP) | RconSharp, CoreRCON, mcrcon |
| 多密钥权限 | 否 | 是 (ID:Password) |
| .NET 8 兼容 | 原生 TCP | RconSharp 完美 |

**建议：主力 OpenMod Valve RCON + RconSharp；RocketMod Telnet 做 fallback。**

## 10. 待确认

1. 原生 SDG RCON 线协议——需反编译 Assembly-CSharp.dll
2. Devlog #012 的 JSON HTTP API 是否存在于 U3DS
3. RconBindAddress 是否存在于 Commands.dat（Zonely 文档未提）
4. Config.txt (≥3.25.8.0) 是否有 RCON 段
5. 原生 RCON 的速率限制行为
6. Unturned II vs 3.x 的 RCON 功能差异

## 来源 (16条)

| # | URL | 标题 | 可信度 |
|---|---|---|---|
| 1 | docs.smartlydressedgames.com/en/stable/servers/command-io.html | Command IO | 高 |
| 2 | docs.smartlydressedgames.com/en/stable/servers/server-hosting.html | Server Hosting | 高 |
| 3 | blog.smartlydressedgames.com/posts/2018-07-01-unturned-ii-devlog-012/ | Devlog #012 | 中 |
| 4 | unturned.wiki.gg/wiki/Console_commands | Console Commands | 高 |
| 5 | developer.valvesoftware.com/wiki/Source_RCON_Protocol | Source RCON Protocol | 高 |
| 6 | battleye.com/downloads/BERConProtocol.txt | BattlEye RCON Protocol v2 | 高 |
| 7 | github.com/stefanodriussi/rconsharp | RconSharp | 高 |
| 8 | github.com/ScottKaye/CoreRCON | CoreRCON | 中 |
| 9-16 | 多家托管商 (HostHavoc, Zonely, Streamline, Wasabi, XGamingServer 等) | 中-高 |
