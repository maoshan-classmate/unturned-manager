---
paths:
  - "manager-server/src/modules/**"
---

# Unturned 开服标准作业流程（SOP）

> 每个服务端管理功能都要对到本章里某个样板上，**不能重新发明**。

## 一个 ServerID 的目录布局

```
Servers/
└── <ServerID>/
    ├── Server/
    │   ├── Commands.dat           # 启动参数
    │   ├── Adminlist.dat          # 管理员 SteamID64 名单
    │   ├── Blacklist.dat          # 黑名单
    │   └── Whitelist.dat          # 白名单
    ├── WorkshopDownloadConfig.json  # Mod 订阅清单（★ 在 <ServerID>/ 根，不在 Server/ 子目录——U3-SDK WorkshopDownloadConfig.cs:99）
    ├── Config.txt                 # 游戏玩法/浏览器配置
    ├── Rocket/                    # LDM（官方 Mod 框架）插件配置
    │   ├── Rocket.config.xml
    │   └── Plugins/<Name>/Configuration.xml
    ├── Workshop/                  # SteamCMD 下载的 Workshop 内容（★ 实际加载在 Workshop/Steam/content/，DedicatedUGC.cs:560）
    ├── Bundles/Workshop/          # 手动放的 .unity3d 包
    └── Logs/                      # 面板 tail 的日志目录
```

## 安装 + 启动

### 单服模式

```bash
# SteamCMD 安装（幂等、匿名、AppID 1110390）
steamcmd +login anonymous +force_install_dir /opt/unturned +app_update 1110390 validate +quit

# 运行时前置（Debian/Ubuntu）
sudo apt-get install -y mono-complete lib32gcc-s1

# 首次启动——生成默认配置（Servers/Default/ 目录）
/opt/unturned/ExampleServer.sh

# 编辑配置后再次启动
/opt/unturned/ExampleServer.sh
```

`ExampleServer.sh` 是 U3DS 自带的默认启动脚本（SteamCMD 安装后自动生成），对应 `Servers/Default/` 这个 ServerID。**参考**：GSM3 单服模式也走同一条路径（`.research/GameServerManager` 配套文档）。

### 多实例模式

```bash
# 启动一个命名的服
/opt/unturned/ServerHelper.sh +InternetServer/<ServerID> -ThreadedConsole
```

多个 ServerID 共用同一个 U3DS 安装目录，省 10GB×N 磁盘。

**硬规则**：

- 一个 ServerID 一个进程。多个 ServerID 共用同一个 U3DS 安装目录。
- **不要再用老命令行的 `-port -map -pvp` 参数**——所有可配置项都走 `Commands.dat`。
- Mono **必须装**。
- **SteamCMD 下载到 staging（`Workshop/staging/`）可不停服**；写入 `content/304930/`、`validate`、更新 U3DS 二进制**必须停服**（见下文「Workshop 内容下载」）。

## Commands.dat 样板

> **以下为示例值**——玩家可直接复制作为起步配置。**真实默认值 + SDK 真源（U3-SDK 代码行号）见** `@claudedocs/reference_config_files.md` §1（每个字段有独立「SDK 真源」列）。
>
> 注意：样板的 `MaxPlayers 16` / `Queue_Size 0` / `Perspective Both` 与 SDK 默认值（`Provider.cs:6615` `maxPlayers=8` / `Provider.cs:6616` `queueSize=8` / `Provider.cs:6645` `cameraMode=FIRST`——专用服务器默认视角，非单机 `BOTH`）不同，是常见的社区教程示例值。**面板如不显式配置，行为以 SDK 默认值为准**。

```
Name My Unturned Server
Port 27015
MaxPlayers 16
Map PEI
Mode Normal
Owner 76561198XXXXXXXXX
Perspective Both
Chatrate 0.25
Cycle 3600
Timeout 750
Queue_Size 0
Filter
Whitelisted
Gold
Hide_Admins
Sync
Cheats
GSLT <your_gslt_here>
Log Y Y Y N
Votify N 5 60 15 75 3
```

**解析器契约**：每行 `指令 值`（单独一个词就是开关）；用 `#` 或 `;` 起注释；**必须保留未知键**——面板不能把不认识的指令删了。

### Loadout 样板（开局物品）

> **允许重复行**——每个技能组（ID 0–10 或 255）单独一行；U3DS 同 ID 多行后写覆盖前写（`CommandLoadout.cs:42-49`）。  
> **真源**：`PlayerSkills.cs:43-97`（11 个技能组枚举），`CommandLoadout.cs:13-49`（解析/写入逻辑）。  
> **SDK 默认**：不写 Loadout 行 = `LOADOUT = {}` + `SKILLSETS_SERVER = [[]×11]`（`PlayerInventory.cs:30-32`），玩家开局无任何额外物品。

```
# 警察开局配一把手枪 + 一件防弹衣（itemID 仅为示例，按需替换）
Loadout 2/17/1064
# 农民开局带工具斧 + 种子
Loadout 4/62/1118
# 全部技能组（255）默认带基本医疗包 + 绷带
Loadout 255/1100/1101
```

格式：`Loadout <SkillsetID>/<itemID>/<itemID>/...`

- SkillsetID：`0`=无技能 `1`=消防员 `2`=警察 `3`=军人 `4`=农民 `5`=渔夫 `6`=露营者 `7`=工匠 `8`=厨师 `9`=盗贼 `10`=医生 `255`=默认全部技能组
- ItemID：`0`–`65535` ushort，可在游戏内 `Items.asset` 查到；非法 ItemID 会触发该条 Loadout 命令报错中止（`CommandLoadout.cs:33-39`）；合法 ushort 但指向不存在物品的 ID 命令层不校验

面板编辑器：`claudedocs/reference_config_files.md` §1.7 + Figma ConfigPage Tab「Commands.dat」→「开局物品（Loadout）」区块。

## WorkshopDownloadConfig.json 规则

- 面板**只能写** `File_IDs`，以及用户主动切换的 `Should_Monitor_Updates` 跟计时器字段。其他字段**只读展示**。
- **每次写之前**必须先复制备份：`cp WorkshopDownloadConfig.json WorkshopDownloadConfig.json.bak.<UTC-ISO>`
- 配置文件形状权威在 U3-SDK 的 `WorkshopDownloadConfig.cs`（仅供查阅）。

## Workshop 内容下载（staging，下载可不停服）

> 依据：U3-SDK `WorkshopDownloadConfig.Use_Cached_Downloads`——服务端**只在启动时**加载已安装 Mod（`content/304930/`），运行中不重扫目录；`Should_Monitor_Updates` 官方行为 = 检测到更新 → 广播 → **关服应用**。即：**下载≠生效**，下载可不停服，生效必须重启。

> **AppID 分工**：`app_update` 安装/更新用 `1110390`（服务端工具）；`workshop_download_item`、content 目录、acf 清单、WebAPI 搜索（`QueryFiles` / `GetDetails`）用 `304930`（游戏本体——workshop 内容归属它，1110390 名下无 workshop，误用只能拿到元数据缓存、拿不到内容）。

- **下载新 Mod（不在 File_IDs 或未加载）**：SteamCMD 下载到 **staging 目录**，U3DS **可继续运行**。
  - staging 目录：`Servers/<ID>/Workshop/staging/`（U3DS 只 mount `Workshop/Steam/content/304930/`，**不扫描 staging**）
  - 命令：`steamcmd +force_install_dir <Servers/<ID>/Workshop/staging> +login anonymous +workshop_download_item 304930 <id1> <id2> ... +quit`
  - 进度经 `steamcmd_progress` 事件推送；下载锁与 `activeOperation` 竞态门控合并。
- **应用（生效）必须停服**：把 staging 内容移入 `Workshop/Steam/content/304930/` 并改 `File_IDs` 后，**必须走下方重启流水线**。Unturned 无热重载（U3-SDK Issues #1794）。
- **validate / 更新已启用 Mod / 更新 U3DS 二进制**：**必须停服**（写入运行中服务端直接读取的位置，覆盖已加载文件有风险）。
- staging 下载完成后，其中的 `appworkshop_304930.acf` 可用于「已下载 Mod 清单」核对（参考 `claudedocs/research_dst_mod_reference_2026-08-08.md`）。

### 旧版 `WorkshopDownloadConfig.json` 位置纠正

旧版面板 `WorkshopDownloadConfig.json` 写在 `Server/` 子目录，U3DS 不读——纠正到 ServerID 根（停服后执行）：

```bash
mv Servers/<ID>/Server/WorkshopDownloadConfig.json Servers/<ID>/WorkshopDownloadConfig.json
```

## 重启 / 改 Mod 流水线（唯一模式——没有热重载）

```
【第一步：保存 Mod 列表（仅写 File_IDs）】
用户在 ConfigPage > WorkshopTab 勾选启用 → 点 [保存配置]
  → PUT /api/servers/:id/config/workshop { fileIds: [...] }
  → ConfigService.writeWorkshopFileIds 原子写 WorkshopDownloadConfig.json
  → U3DS 只在启动时读 File_IDs，运行中不重扫——运行时安全，写入零冲突
  → toast.success「Mod 列表已保存，重启服务器后生效」
  → 不触发状态机变化、不动 PTY、不动 staging

【第二步：手动重启生效】
用户在控制台/首页手动点 [重启]（POST /api/servers/:id/{start, restart}）
  → ServerManager.startInternal(serverId)
  ├─ ① state != RUNNING 守卫（RUNNING 直接 return）——保证「移动时 U3DS 已停」
  ├─ ② WorkshopApplyService.applyStaged(serverId)  ← 自动在启动前执行
  │     ├─ 解析 staging/appworkshop_304930.acf
  │     ├─ WorkshopAcfService.addItem（内部自带备份 + 回滚）
  │     ├─ mv staging/content/304930/<id>/ → content/304930/<id>/
  │     ├─ 失败 → 上抛，阻止 spawn（不拿残缺 content 启动）
  │     └─ WS 推 mod_apply_progress { stage: 'ready' | 'failed' }
  ├─ ③ transition(STARTING) + PtyManager.startPty spawn bash + 塞 startCommand
  └─ ④ U3DS 启动，读到 content 新内容 → 新 Mod 生效
```

## 服务端状态机

```
STOPPED → STARTING → RUNNING → STOPPING → STOPPED（循环，4 态）
任何状态 → STOPPED（强制停止，kill -9 兜底）
```

`activeOperation` 字段防止"用户点自动重启同时点手动重启"的竞态。

> 状态机完全由 PTY 进程的 spawn/exit 驱动，无 A2S / RCON / DEGRADED 维度（ADR-0004 §3.3）。

## Steam Workshop Mod 元数据获取

- **主路径（推荐）**：Steam WebAPI `IPublishedFileService/GetDetails/v1`（详情/批量）+ `QueryFiles/v1`（搜索），**需要 WebAPI Key**（用户 Steam 账号免费申请，Settings 配置）。
- **零凭证备选不可用**：`?xml=1` 接口实测返回 HTML 而非 XML（不再可用，证据见 `claudedocs/research_dst_mod_reference_2026-08-08.md` §5.1）。
- **不做**：GameServerUGC 接口（安全成本太高）。

## 实时控制台

- 后端 tail 两路：日志文件 `Servers/<ID>/Logs/*.log` + spawn 子进程 stdout
- 通过 `ws` **双向**：出站 `console_line` 推送输出 + 入站 `terminal_input` 写入 PTY stdin
- 前端命令经 WS `terminal_input` 直达 PTY 终端——owner-trust 模型（登录即可执行任意命令）；危险指令由前端卡片拦截

---

## LDM（Legally-Distinct-Missile）Mod 框架接入

> 完整设计：`docs/architecture/ldm-integration-design.md` + 决策：`docs/adr/0006-ldm-framework-integration.md`
> 真源：[github.com/SmartlyDressedGames/Legally-Distinct-Missile](https://github.com/SmartlyDressedGames/Legally-Distinct-Missile)
> 选型决策：本项目**只采用 LDM**

### 一个 ServerID 的 LDM 目录布局

```
Servers/<ServerID>/
└── Rocket/                          # 首次启动 U3DS 自动生成（不可手写预创建）
    ├── Rocket.config.xml            # LDM 主框架配置（XML / RocketSettings.cs）
    ├── Rocket.Unturned.config.xml   # LDM-Unturned 特有配置（XML / UnturnedSettings.cs）
    ├── Permissions.config.xml       # 权限组配置（XML）
    ├── Logs/                        # LDM 框架日志
    ├── Libraries/                   # 共享依赖 .dll
    └── Plugins/
        ├── <PluginName>.dll         # 插件二进制（玩家从 GitHub Releases 下载）
        └── <PluginName>/            # Linux 大小写敏感！文件夹名必须 .dll 同名
            ├── <PluginName>.configuration.xml   # 插件配置（每插件 schema 不同）
            └── Libraries/                       # 插件私有依赖
```

### 激活步骤（5 步走）

```bash
# ① 装 U3DS（SteamCMD +app_update 1110390 validate）—— 已有「安装 Unturned 服务端」按钮

# ② 激活 LDM 主框架（U3DS 装包自带 Extras/Rocket.Unturned/，cp 复制即可）
cp -r /opt/unturned/Extras/Rocket.Unturned /opt/unturned/Modules/

# ③ 启动一次 U3DS（生成 Servers/<ID>/Rocket/ + 3 个 XML 自动生成）
/opt/unturned/ServerHelper.sh +InternetServer/<ServerID> -ThreadedConsole

# ④ 从 LDM-Community (https://ldm-community.github.io/pluginlist) 下载插件 .dll
#    通过面板「Mod 框架 > 已装插件 > 上传插件」拖拽上传

# ⑤ 编辑配置 → 应用变更 → 面板走 PTY 终端 owner-trust 重启流水线
```

> **激活检测点**（游戏 Extras 实文件核对）：`Modules/Rocket.Unturned/Rocket.Unturned.module` 存在 = LDM 已激活（Unity 模块清单，声明 3 个 Server 程序集 + 版本）。面板可用「该文件存在性 + `/modules` 命令输出」双确认；`.module` 里的 `Version` 即 LDM 主框架版本。

### 关键约束

| 约束                                   | 说明                                                                                                                                                                                                                                        |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Rocket/ 必须首次启动 U3DS 自动生成** | **不可手写预创建**——gameserverkings.com 警告                                                                                                                                                                                                |
| **Linux 大小写敏感**                   | `Plugins/Uconomy/` ≠ `Plugins/uconomy/`；.dll 文件名必须与子目录名严格一致                                                                                                                                                                  |
| **多实例隔离**                         | `Modules/Rocket.Unturned/` 全 U3DS 共享一份；`Servers/<ID>/Rocket/` 每实例独立（真源：`Rocket/Rocket.Core/Environment.cs` `RocketDirectory = "Servers/{0}/Rocket/"` + `U.Instance.InstanceId = Dedicator.serverID = +InternetServer/<ID>`） |
| **LDM 插件不上 Steam Workshop**        | 走 GitHub Releases + LDM-Community；Workshop Asset Type 只有 Map/Item/Vehicle/Skin/Object/Localization/Server Curation 7 类                                                                                                                 |
| **改配置生效 = 重启**                  | LDM 无官方热重载（U3-SDK Issue #1794）；走 ADR-0004 §重启流水线（Save + Shutdown 10 + forceKill + spawn）                                                                                                                                   |
| **不暴露 `/rocket reload`（全局）**    | prohibitions.md 钉死；提示 "Please reload individual plugins instead"                                                                                                                                                         |
| **单插件 reload 不保证成功**           | `/rocket reload <plugin>` 暴露但加警告                                                                                                                                                                                                      |
| **不接管 .dll 编译/分发**              | 二进制风险；编译/分发不是面板职责                                                                                                                                                                                                           |
| **不接管全局 `rocket reload`**         | 钉死                                                                                                                                                                                                                                        |

### LDM 与 Commands.dat / Config.txt 的关系

- **完全正交**——Commands.dat 是 U3DS 自身的（U3-SDK 真源），`Rocket.config.xml` / `Rocket.Unturned.config.xml` / `Permissions.config.xml` 是 LDM 框架
- **端口不冲突**——Commands.dat `Port 27015`（游戏端口），Rocket.config.xml 的 RCON 默认 `27115` Telnet（本项目不用）
- **共享 admin**——U3DS 的 `Owner`（SteamID64，Commands.dat）和 LDM 的 `Permissions.config.xml` 的 `default` 组**不互通**——需分别配置

### LDM 管理命令（PTY 终端 owner-trust 唯一通道）

| 命令                     | 用途                                                        | 面板处理                        |
| ------------------------ | ----------------------------------------------------------- | ------------------------------- |
| `/rocket`（空参）        | 输出版本信息 `Rocket v<版本> for Unturned v<游戏版本>`      | 「关于 LDM」卡片                |
| `/rocket plugins`        | 列出已加载插件（按 Loaded/Unloaded/Failure/Cancelled 分组） | 解析 stdout 展示                |
| `/rocket load <name>`    | 加载已卸载插件（子串匹配 + 大小写不敏感）                   | 前端按钮 + 调 PTY               |
| `/rocket unload <name>`  | 卸载指定插件                                                | 前端按钮 + 调 PTY               |
| `/rocket reload <name>`  | 重新加载指定插件（不保证成功）                              | 前端按钮 + 调 PTY（加警告）     |
| `/rocket reload`（全局） | 重载所有插件                                                | ❌ 不暴露（Issue #1794 + 钉死） |
| `/modules`               | U3DS 原生命令，验证 Rocket.Unturned 是否加载                | 「LDM 状态」卡片                |
| `/p reload`              | 重新加载 `Permissions.config.xml`                           | 前端按钮 + 调 PTY               |

### 配置文件原子写 + 备份策略

```typescript
// 写入前必走流程（复用 ConfigService.atomicWrite）
const file = `Servers/${serverId}/Rocket/${name}`;
await fs.copy(file, `${file}.bak.${new Date().toISOString()}`); // 备份
await atomicWrite(file, newContent); // 原子写
```

适用范围：`Rocket.config.xml` / `Rocket.Unturned.config.xml` / `Permissions.config.xml` / 所有 `<Plugin>.configuration.xml`。
