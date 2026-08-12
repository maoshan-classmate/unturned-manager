# LDM Mod 框架接入设计规格

> **状态**：v0.1 设计稿 · **日期**：2026-08-12
> **承接**：CLAUDE.md §1（钉死 LDM）+ ADR-0003 B2 目录扫描真源 + ADR-0004 PTY 终端 owner-trust
> **驱动源**：用户 2026-08-12 诉求「LDM Mod 框架暂未实现，需要接入」
> **关系**：`mod-management-design.md` v2.5（Steam Workshop 资源包）— 本文档**平行但独立**，不修改资源包链路
> **核心参考**：LDM 仓库 https://github.com/SmartlyDressedGames/Legally-Distinct-Missile + 本地只读源码 `.research/Legally-Distinct-Missile`（master `c5f8062`，2025-10-23）
> **源码版本核对（2026-08-12）**：本地 master 源码与游戏自带 `Extras/Rocket.Unturned/`（`Rocket.API/Core.dll=4.9.3.16` + `Rocket.Unturned.dll=4.9.3.18`）的 schema 字段 + `/rocket` 命令行为**零差异**（git diff v4.9.3.15/18 vs master 验证）——本设计文档所有真源引用对实际运行版本成立

---

## 0. 一句话结论

**面板为 LDM 提供「配置 + 启停 + 插件来源」三种能力，不接管插件安装/编译/热重载**。LDM 主框架激活 = 用户复制 U3DS 装包自带的 `Extras/Rocket.Unturned/` 到 `Modules/`（一次性，引导式）；插件 .dll 由用户从 GitHub Releases 下载后经面板上传到 `Servers/<ID>/Rocket/Plugins/<Name>/`（**不上 Steam Workshop**）；面板**只读不写** .dll，**写** Rocket.config.xml / Rocket.Unturned.config.xml / Permissions.config.xml 与各 Configuration.xml，插件启停走 PTY 终端 `/rocket load/unload`（可不停服），改配置生效走 PTY 重启流水线。

---

## 1. 背景与现状

### 1.1 已实现的 Mod 维度

| 维度 | 状态 | 真源文件 | 模块 |
|---|---|---|---|
| **Steam Workshop 资源包**（unity3d 数据包：地图/武器/皮肤/UI） | ✅ 已实现 | `WorkshopDownloadConfig.json` + `appworkshop_304930.acf` + `Workshop/steamapps/workshop/content/304930/<id>/` | `WorkshopMetadataService` / `WorkshopAcfService` / `WorkshopApplyService` / `WorkshopDeleteService` |
| **LDM 插件框架**（代码级 .dll 插件：经济系统/权限/反作弊/地图机制） | ❌ **未实现** | `Servers/<ID>/Rocket/Rocket.config.xml` + `Servers/<ID>/Rocket/Plugins/<Name>.dll` + `Servers/<ID>/Rocket/Plugins/<Name>/<Name>.configuration.xml` | 无（commit c5f2ac8 删了 OpenMod/RocketMod 残留） |

**用户拍板**（2026-08-12 Serena 记忆 `session-checkpoint-2026-08-12-ldm-framework.md`）：
- Mod 框架定死 **LDM**（Unturned 官方维护分叉）
- 删 OpenMod / RocketMod 配置读写（commit `c5f2ac8`）
- 文档层收敛（commit `68730b9`）
- **代码层接入本身未做** —— 本文档承接

### 1.2 已沉淀的边界（钉死，不用重新决策）

| 边界 | 出处 |
|---|---|
| **唯一命令通道 = PTY 终端 owner-trust**（JWT 有效即视为 owner 写任意命令） | ADR-0004 Phase 6 |
| **状态机 = 4 态 STOPPED/STARTING/RUNNING/STOPPING** | ADR-0004 §3.3 |
| **重启流水线 = Save + Shutdown 10 + forceKill** | `unturned-sop.md` §重启 |
| **Mod 变更应用 = `applyModChanges` 已有 9 步流水线** | `ServerManager.ts:714-854` |
| **配置原子写 = `ConfigService.atomicWrite`（temp + rename + 备份）** | `ConfigService.ts:60` |
| **路径解析 = `resolveInstallDir` + `resolveServerPath`** | `pathResolver.ts` |
| **禁止自动跑 `rocket reload`**（LDM 无官方热重载支持） | `prohibitions.md` 钉死 |
| **不自动装 SteamCMD/U3DS/LDM**（引导式） | `decision-no-auto-install-steamcmd-u3ds.md` |

---

## 2. LDM 是什么（接入前先搞清楚对象）

### 2.1 选型对比（用户已拍板，本节只做事实归档）

| 框架 | 维护方 | 状态 | 本项目 |
|---|---|---|---|
| **LDM（Legally-Distinct-Missile）** | Smartly Dressed Games 官方 | 当前活跃 | ✅ **唯一采用** |
| ~~OpenMod~~ | 社区 | 2023 起停滞 | ❌ 已删（commit c5f2ac8） |
| ~~RocketMod~~ | 社区 | 2019-12 停维 | ❌ 已删（commit c5f2ac8） |

**LDM 来源**：`https://github.com/SmartlyDressedGames/Legally-Distinct-Missile`（SDG 官方维护）
**部署形态**：
- **LDM 主框架** = U3DS 安装包内 `Extras/Rocket.Unturned/` 已自带（无需额外下载）；用户首次装 U3DS 后 `cp -r /opt/unturned/Extras/Rocket.Unturned /opt/unturned/Modules/` 即激活
- **LDM 插件 .dll** = 走 **GitHub Releases + LDM-Community 列表**分发，**不上 Steam Workshop**（Workshop Asset Type 不含 Plugin 类）
- 面板提供 Web 上传 .dll 通道 + 外链到 LDM-Community 插件市场

### 2.2 LDM 配置文件目录布局（用户已拍板的 ServerID 内布局）

```bash
# U3DS 安装目录 = /opt/unturned（Linux）
/opt/unturned/
├── Extras/
│   └── Rocket.Unturned/          # LDM 主框架副本（U3DS 装包自带，复制源）
├── Modules/
│   └── Rocket.Unturned/          # ★ LDM 激活位置（cp -r Extras/Rocket.Unturned Modules/）
│       ├── Rocket.API.dll
│       ├── Rocket.Core.dll
│       └── Rocket.Unturned.dll
└── Servers/
    └── <ServerID>/               # ★ 首次启动 U3DS 后自动生成（含 Rocket/）
        ├── Server/
        │   ├── Commands.dat
        │   └── WorkshopDownloadConfig.json
        ├── Rocket/               # ★ LDM 配置（首次启动 U3DS 自动生成；不可手写预创建）
        │   ├── Rocket.config.xml          # ★ 框架主配置（首次启动自动生成）
        │   ├── Permissions.config.xml     # ★ 权限组配置（首次启动自动生成）
        │   ├── Logs/                       # LDM 框架日志
        │   ├── Libraries/                  # 共享依赖 .dll
        │   └── Plugins/                    # ★ 插件目录
        │       ├── Uconomy.dll
        │       ├── Uconomy/                # Linux 大小写敏感！文件夹名必须 .dll 同名
        │       │   └── Uconomy.configuration.xml
        │       └── ...其他插件
        ├── Workshop/
        └── Logs/
```

**关键警告**：
> "The first boot creates `U3DS/Servers/MyServer/`, and Rocket creates its `Rocket/` folder inside it. **Do not pre-create those by hand. Let the first run generate them, then edit.**"  
> —— [gameserverkings.com](https://www.gameserverkings.com/knowledge-base/unturned/how-to-install-rocketmod-plugins-for-unturned)

> **Linux 大小写敏感**：`Plugins/Uconomy/` ≠ `Plugins/uconomy/`——配置子目录名必须与 .dll 文件名（去 .dll 后缀）大小写严格一致（框架按插件名建配置目录；Windows 容错、Linux 严格，大小写不一致会建出重复目录）。.dll 本体在 `Plugins/` 根目录。

**多实例隔离**：
- `Modules/Rocket.Unturned/` **全 U3DS 安装一份**（共享、单进程）
- `Servers/<ServerID>/Rocket/` **每实例独立**（配置/插件/权限全隔离）

### 2.3 LDM 配置文件清单与面板写权限

| 文件 | 用途 | 格式 | 面板写权限 | 字段真源 |
|---|---|---|---|---|
| `Modules/Rocket.Unturned/*.dll` | LDM 主框架二进制 | .NET DLL | ❌ 不写 | U3DS 安装包自带 |
| `Servers/<ID>/Rocket/Rocket.config.xml` | 框架主配置（16 字段） | XML | ✅ 结构化写 | [wasabihosting.com](https://docs.wasabihosting.com/games/unturned/server-configuration) + LDM 仓 |
| `Servers/<ID>/Rocket/Permissions.config.xml` | 权限组配置（Groups / Permissions / Members） | XML | ✅ 结构化写 | [wasabihosting](https://docs.wasabihosting.com/games/unturned/server-configuration) + [restoremonarchy.com](https://restoremonarchy.com/docs/servers/rocket/permissions) |
| `Servers/<ID>/Rocket/Logs/` | LDM 框架日志 | 文本 | ❌ 不写（pino tail） | — |
| `Servers/<ID>/Rocket/Libraries/` | 共享依赖 .dll | .NET DLL | ⚠️ 文件级上传（Files API） | — |
| `Servers/<ID>/Rocket/Plugins/<Name>.dll` | 插件二进制 | .NET DLL | ⚠️ Web 上传 + 大小写校验 | GitHub Releases / LDM-Community |
| `Servers/<ID>/Rocket/Plugins/<Name>/<Name>.configuration.xml` | 插件私有配置 | XML（**每插件 schema 不同**） | ✅ 通用 XML 编辑器 | 插件开发者文档 |
| `Servers/<ID>/Rocket/Plugins/<Name>/Libraries/*.dll` | 插件私有依赖 | .NET DLL | ⚠️ 文件级上传 | — |

---

## 2.4 Rocket.config.xml 字段表（已填 + 子任务修订）

> **真源**：LDM 仓源码 `Rocket/Rocket.Core/Serialization/RocketSettings.cs` + `Rocket/Rocket.Core/RemoteConsole.cs` + 子任务验证。
> **C# 类名 ≠ XML 根元素**：类名 `RocketSettings`，XML 根元素 `<RocketConfiguration>`（XmlSerializer 默认行为）。
> **修订**：删 Economy 系列（老 RocketMod <4.x 残留，LDM master 不存在）+ 删 InstanceGuid/InstanceName/Port/AutoDownload/EnableLogging/LogLevel/LogToFile/LogToConsole（教程误传）；加 LanguageCode / MaxFrames / Web 系列 / RCON 子字段。

| XML 元素 | .NET 类型 | 默认 | 含义 | UI 控件 |
|---|---|---|---|---|
| `LanguageCode` | string | `"en"` | 翻译文件代码（`Rocket.{code}.translation.xml`） | 下拉（en/zh-CN/...） |
| `MaxFrames` | int | `60` | 帧预算（部分 Rocket API 用） | 数字 |
| `<RCON>` | group | — | Telnet RCON 配置（**本项目不用——ADR-0004 Phase 6 已删**，UI 标「实验性 / 保持未配置」） | 不暴露 |
| `RCON/Enabled` | bool | `false` | 开关 Telnet RCON | （隐藏） |
| `RCON/Port` | ushort | `27115` | TCP 端口 | （隐藏） |
| `RCON/Password` | string | `"changeme"` | **明文**（子任务实锤），必须改 | （隐藏） |
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

> ⚠️ Rocket.config.xml 写入 RCON 节点时必须**警告**——子任务真源显示默认密码是明文 `"changeme"`。本项目 UI 完全隐藏 RCON 字段，**禁止**让用户触碰。

---

## 2.4b Rocket.Unturned.config.xml 字段表（子任务发现，之前漏掉）

> **路径**：`Servers/<ServerID>/Rocket/Rocket.Unturned.config.xml`
> **真源**：LDM 仓 `Rocket/Rocket.Unturned/Serialisation/UnturnedSettings.cs`（**子任务实锤**）。
> **何时生成**：首次启动 U3DS（与 Rocket.config.xml 同时）。

| XML 元素 | 类型 | 默认 | 含义 | UI 控件 |
|---|---|---|---|---|
| `<AutomaticSave>` / `<Enabled>` | bool | `true` | 定时触发 U3DS `/save` 命令 | 开关 |
| `<AutomaticSave>` / `<Interval>` | int | `1800` | 间隔秒数（30 分钟） | 数字 |
| `<CharacterNameValidation>` | bool | `false` | 启用角色名正则校验 | 开关 |
| `<CharacterNameValidationRule>` | string | `"([\x00-\xAA]\|[\w_\ \.\+\-])+"` | 正则模式（防注入） | 文本（高级） |
| `<LogSuspiciousPlayerMovement>` | bool | `true` | 记录瞬移速度违规 | 开关 |
| `<EnableItemBlacklist>` | bool | `false` | 限制 `/i` 物品（黑名单模式） | 开关 |
| `<EnableItemSpawnLimit>` | bool | `false` | 限制单次刷物品数 | 开关 |
| `<MaxSpawnAmount>` | int | `10` | 配合上一项的单次刷物品上限 | 数字 |
| `<EnableVehicleBlacklist>` | bool | `false` | 限制 `/v` 载具 | 开关 |

**面板处理**：与 Rocket.config.xml 并列，**同款结构化编辑器**（9 字段，单卡片）。

---

## 2.5 Permissions.config.xml Schema（已填）

> **真源**：[wasabihosting.com](https://docs.wasabihosting.com/games/unturned/server-configuration) + [restoremonarchy.com](https://restoremonarchy.com/docs/servers/rocket/permissions)

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

**UI 设计**：树形 Groups 编辑器 + 成员 SteamID64 列表 + 颜色选择器（Color 枚举 + hex）。

**生效**：改后需 PTY 终端输入 `/p reload` 或重启服务才生效。

---

## 2.6 LDM 插件 Configuration.xml Schema（不统一）

**关键事实**：每个 LDM 插件的 `.configuration.xml` **schema 由插件开发者自定义**——LDM 只提供 `IRocketConfiguration` 接口 + `XmlSerializer` 序列化基类。

**示例**（Uconomy / Kits 等插件常见样式）：

```xml
<?xml version="1.0" encoding="utf-8"?>
<KitsConfiguration xmlns:xsd="..." xmlns:xsi="...">
  <Kits>
    <Kit>
      <Name>default</Name>
      <Items>
        <ushort>363</ushort>   <!-- item ID -->
        <ushort>17</ushort>
      </Items>
      <Cooldown>300</Cooldown>
    </Kit>
  </Kits>
</KitsConfiguration>
```

**面板决策**：**通用 Monaco XML 编辑器**（原文编辑 + 实时校验 + 不解析字段）—— 不为每个插件做专用表单（维护成本无限）。

---

## 2.7 LDM 管理命令表

> **真源**：[CommandRocket.cs](https://github.com/SmartlyDressedGames/Legally-Distinct-Missile/blob/master/Rocket.Unturned/Commands/CommandRocket.cs) + [Apex Hosting](https://apexminecrafthosting.com/guides/unturned/unturned-rocketmod-commands) + [Wasabi Hosting](https://docs.wasabihosting.com/games/unturned/admin-commands)
> **生效方式**：经 PTY 终端 owner-trust 写入（ADR-0004 Phase 6 删 RCON 后唯一通道）；危险指令由前端 `ConfirmDialog` 拦截。

| 命令 | 用途 | 权限 | 面板处理 | 状态 |
|---|---|---|---|---|
| `/rocket`（空参） | **输出版本信息** `Rocket v<版本> for Unturned v<游戏版本>`（**不是** plugins 别名） | `rocket.info` | 前端「关于 LDM」弹窗 | ✅ 可用 |
| `/rocket plugins` | 按状态分组列出所有插件（Loaded/Unloaded/Failure/Cancelled 4 行） | `rocket.plugins` | 解析 stdout 展示 | ✅ 可用 |
| `/rocket load <plugin>` | 加载已卸载插件（**子串匹配 + 大小写不敏感**：`pl.Name.ToLower().Contains(command[1].ToLower())`） | `rocket.loadplugin` | 前端按钮 + 调 PTY | ✅ 可用 |
| `/rocket unload <plugin>` | 卸载指定插件 | `rocket.unloadplugin` | 前端按钮 + 调 PTY | ✅ 可用 |
| `/rocket reload <plugin>` | 重新加载指定插件 | `rocket.reloadplugin` | 前端按钮 + 调 PTY（**不保证成功**） | ⚠️ 不承诺 |
| `/rocket reload`（全局） | 重载所有插件 | `rocket.reload` | **禁用**（U3-SDK Issue #1794；LDM 官方已删；prohibitions.md 钉死；LDM 提示 "**Please reload individual plugins instead**"） | ❌ 不暴露 |
| `/modules` | U3DS 原生命令，确认 `Rocket.Unturned` 模块是否加载 | — | 前端「LDM 状态」卡片显示 | ✅ 可用 |
| `/p` | 查看自己/他人权限组 | — | 前端展示 | ✅ 可用 |
| `/p reload` | 重新加载 `Permissions.config.xml` | — | 前端按钮 + 调 PTY | ✅ 可用 |
| `/p add <player> <group>` | 玩家加入组 | — | 推荐编辑 Permissions.config.xml 代替 | ✅ 推荐 |
| `/p remove <player> <group>` | 玩家退出组 | — | 推荐编辑 Permissions.config.xml 代替 | ✅ 推荐 |

**热重载决策（钉死）**：
- ❌ **不暴露 `/rocket reload`（全局）**——LDM 官方已删（Issue #1794）；prohibitions.md 已钉死
- ⚠️ `/rocket reload <plugin>` **不承诺可用**——社区已知会破坏许多插件状态；面板暴露但加警告
- ✅ 改配置生效 → 走 ADR-0004 §重启流水线（Save + Shutdown 10 + forceKill + spawn）
- ✅ 加载/卸载单插件 `/rocket load/unload` → **可不停服**（LDM 支持运行时热挂载，但推荐重启以避免状态不一致）

---

## 3. 接入范围（用户拍板边界）

### 3.1 面板管什么

| 能力 | 是否面板做 | 说明 |
|---|---|---|
| **LDM 主框架安装（首次激活）** | ⚠️ **面板可引导 + 不自动跑 cp** | 显示 5 步 SOP：① U3DS 装包自带 Extras/Rocket.Unturned/ ② `cp -r /opt/unturned/Extras/Rocket.Unturned /opt/unturned/Modules/` ③ 首次启动 U3DS 自动生成 `Servers/<ID>/Rocket/` ④ 编辑配置 ⑤ 重启生效；遵循 `decision-no-auto-install-steamcmd-u3ds.md` 决策 |
| **LDM 主框架更新** | ❌ 不做 | U3DS 装包跟随更新；面板只读不写 |
| **插件 .dll 安装** | ⚠️ **Web 上传 .dll**（Files API） | 走 [LDM-Community 插件列表](https://ldm-community.github.io/pluginlist) 外链 + GitHub Releases 下载 → 拖拽上传；不上 Steam Workshop |
| **插件 .dll 升级/删除** | ⚠️ Files API（替换/删除） | 同上 |
| **插件清单展示** | ✅ 做 | `readdir Servers/<ID>/Rocket/Plugins/` → `[{name, version, sizeBytes, hasConfig, modifiedAtIso, runtimeStatus}]` |
| **插件启用/禁用** | ✅ 做 | 通过 LDM 框架：`/rocket load <name>` 或 `/rocket unload <name>` 经 PTY 终端；或改 Rocket.config.xml + 重启 |
| **插件配置编辑**（Configuration.xml） | ✅ 做 | 各插件字段由插件 schema 决定；面板做**通用 Monaco XML 编辑器**（不做字段 schema 自动发现——schema 演进跟插件版本走，维护成本高） |
| **Rocket.config.xml 结构化编辑** | ✅ 做 | 字段表已确认（16 字段），逐字段控件 |
| **Permissions.config.xml 树形编辑** | ✅ 做 | Groups / Members / Permissions / Color / ParentGroup / Priority 全字段结构化 |
| **LDM 插件来源浏览** | ⚠️ 外链 + 列表展示 | **外链到 [LDM-Community 插件列表](https://ldm-community.github.io/pluginlist)**（不上 Steam Workshop）；面板本地缓存 LDM-Community 公开插件列表供浏览。<br>**双源融合**（2026-08-12 用户拍板）：LDM-Community 上游**无公开 JSON API**（静态 HTML 主页），**Phase 1 走 HTML 解析 + GitHub API 批量补充**——HTML 解析拿 `slug` / `name` / `author` / `description` / `repoUrl`；GitHub API 拿 `tag_name`（`latestVersion`）+ `pushed_at`（`updatedAtIso`）。**GitHub PAT 配置位置在 LdmPage「插件来源」Tab 顶部**（不是 SettingsPage）。详细规格见 `claudedocs/workflow_sprint5_ldm_phase1.md` §5 + 调研报告 `claudedocs/research_ldm_community_source_2026-08-12.md` |
| **改 LDM 配置生效方式** | ✅ PTY 终端 owner-trust 重启流水线 | `Say "保存 LDM 变更"` + `Save` + `Shutdown 10 "LDM 变更重启"` → spawn 新进程；**不调 `/rocket reload` 全局**（Issue #1794 + prohibitions 钉死） |
| **日志观察 LDM 启动加载/错误** | ✅ 复用现有 PTY 控制台 | 真源锚点（2026-08-12 源码核对）：模块启动 banner = `CommandWindow.Log("Rocket Unturned v... for Unturned v...")`（`U.cs:151`）；插件加载失败日志 = `RocketPlugin.cs:132` `Logger.LogError("Failed to load X, unloading now...")`（主要路径）+ `U.cs:200` `Logger.LogException(ex, "Failed to load plugin X.")`（次要路径）；**插件加载成功无 stdout 行**——不存在 `[LDM] Loaded plugin X.Y.Z`（该字符串无源码）。前端 xterm.js 实时渲染 |
| **`/rocket` 命令输出解析**（插件状态列表） | ✅ 做 | 解析 `Loaded` / `Unloaded` / `Failure` / `Cancelled` 4 状态 |
| **Linux 大小写校验**（上传 .dll） | ✅ 做 | Web 上传时校验 .dll 文件名合法 + 提示配置目录名大小写（.dll 在 `Plugins/` 根目录；配置目录 `Plugins/<Name>/` 由框架首次加载自动创建，目录名须与 .dll 同名） |

### 3.2 面板不做什么

- 不编译/分发 LDM 插件
- 不做插件商店（仅外链到 LDM-Community）
- 不做插件兼容性矩阵（哪个插件能跑哪个 U3DS 版本）
- 不做全局 `/rocket reload`（钉死）
- 不做自动故障诊断（哪个插件导致崩溃）—— 只展示 stdout 日志
- 不自动装 LDM 主框架（引导式）

---

## 4. 接入 SOP（用户/管理员在 UI 之外的首次操作）

> **面板**不引导这些步骤（决策：不让面板变成开服百科）；但**文档**必须记录清楚。
> 用户首次启用 LDM 的 5 步：

```bash
# ① 装 U3DS（已有「安装 Unturned 服务端」按钮）
steamcmd +login anonymous +force_install_dir /opt/unturned +app_update 1110390 validate +quit

# ② 激活 LDM 主框架（U3DS 装包自带 Extras/Rocket.Unturned/，cp 复制即可）
cp -r /opt/unturned/Extras/Rocket.Unturned /opt/unturned/Modules/

# ③ 启动一次 U3DS（生成 Servers/<ID>/ + Rocket/ 骨架；Rocket.config.xml/Permissions.config.xml 自动生成）
#    重要：Rocket/ 必须由首次启动自动生成，不可手写预创建
/opt/unturned/ServerHelper.sh +InternetServer/<ServerID> -ThreadedConsole

# ④ 从 LDM-Community 插件列表 (https://ldm-community.github.io/pluginlist) 下载插件 .dll
#    或从 GitHub Releases 商业插件（Tebex 等）下载
#    通过面板的「Mod 框架 > 已装插件 > 上传插件」拖拽上传到 Rocket/Plugins/<Name>.dll

# ⑤ 编辑 Rocket.config.xml / Permissions.config.xml / 各 <Plugin>.configuration.xml
#    通过面板的「Mod 框架 > 框架配置」/「权限组」/「插件配置」结构化编辑器
#    完成后点「应用变更」→ 面板走 PTY 终端 owner-trust 重启流水线
```

**面板引导文案**（首次进「Mod 框架」页、`Rocket/` 目录不存在时）：

> 「未检测到 Mod 框架。  
> LDM 主框架随 U3DS 装包自带（路径：`Extras/Rocket.Unturned/`）。  
> 激活步骤：  
> 1. 复制 `cp -r /opt/unturned/Extras/Rocket.Unturned /opt/unturned/Modules/`  
> 2. 重启实例（首次启动 U3DS 会自动生成 Rocket/ 配置目录）  
> 3. 返回本页面继续管理插件  
>  
> 详细文档：[LDM 官方安装指南](https://docs.smartlydressedgames.com/en/latest/servers/rocket.html)」

---

## 5. 后端模块设计

### 5.1 模块树（与现有模块并行，不混 workshop/ 命名空间）

```
manager-server/src/modules/ldm/
├── LdmDiscoveryService.ts        # 读 Rocket.config.xml + Rocket.Unturned.config.xml + Permissions.config.xml + Plugins/ 目录
├── LdmConfigWriter.ts            # 写上述 3 个 XML + 各 Configuration.xml（原子写 + 备份 + 回滚）
├── LdmApplyService.ts            # 薄业务层，调 ServerManager.applyChangesCore（§5.6 抽出的核心流水线）
├── LdmPluginSourceService.ts     # 拉取 LDM-Community 公开插件列表（本地缓存，供前端展示/外链）
├── LdmPluginCommandsService.ts   # PTY 写 /rocket load/unload/reload + 解析 stdout 插件状态
├── LdmAssemblyVersionReader.ts   # PE 元数据解析读 .dll 版本号（§5.5 准确方案，零依赖）
├── RocketConfigXmlParser.ts      # 自写 XML 解析（保留注释/属性顺序/嵌套，与 VdfParser 同思路）
└── (各模块 .test.ts)

manager-server/src/modules/server/ServerManager.ts
└── applyChangesCore(serverId, opts)   # §5.6 抽出的 9 步流水线本体（mod_apply / ldm_apply 共用）
```

### 5.2 `LdmDiscoveryService`（读取类）

**职责**：列已装插件 + 读 Rocket.config.xml + Rocket.Unturned.config.xml + Permissions.config.xml + 读各配置原文。

```typescript
/**
 * LDM 插件发现服务——读盘真源。
 * 真源路径：<installDir>/Servers/<id>/Rocket/Rocket.config.xml
 *         + <installDir>/Servers/<id>/Rocket/Plugins/<name>.dll（存在性）
 *         + <installDir>/Servers/<id>/Rocket/Plugins/<name>/<name>.configuration.xml
 */
export interface ILdmDiscoveryService {
  /** 读 Rocket.config.xml 全文，返回结构化对象（Rocket/ 未生成时返回 null） */
  readRocketConfig(serverId: ServerId): Promise<RocketConfig | null>;
  /** 读 Rocket.Unturned.config.xml 全文（UnturnedSettings.cs，9 字段） */
  readRocketUnturnedConfig(serverId: ServerId): Promise<RocketUnturnedConfig | null>;
  /** 读 Permissions.config.xml 全文（Groups/Members/Permissions 树形） */
  readPermissionsConfig(serverId: ServerId): Promise<PermissionsConfig | null>;
  /** 读单个插件的 `<插件名>.configuration.xml`（XML 字符串原样返回——插件 schema 不一致，不强解） */
  readPluginConfig(serverId: ServerId, pluginName: string): Promise<string>;
  /** 列已装插件（Plugins/ 下的 .dll 存在性 + 配置存在性） */
  listInstalledPlugins(serverId: ServerId): Promise<InstalledPlugin[]>;
  /** 读所有插件的配置原文（批量给前端编辑器用） */
  readAllPluginConfigs(serverId: ServerId): Promise<Map<string, string>>;
}

/** 已装插件描述（Phase 1 字段集；configPath 为 Phase 2 新增——见 workflow §9 路线图） */
export interface InstalledPlugin {
  name: string;                  // 插件目录名 = 插件标识
  version: string | null;        // 从 .dll 元数据读（自写 PE 流式解析）
  sizeBytes: number;             // .dll 文件大小（列表展示用）
  hasConfig: boolean;            // Configuration.xml 是否存在
  modifiedAtIso: string;         // .dll 最后修改时间（排序/更新检测用）
  runtimeStatus: 'loaded' | 'unloaded' | 'failure' | 'cancelled' | 'unknown';  // 运行时加载状态
                                  // Phase 1 填充：列表加载时（实例 RUNNING）由 Discovery 注入的「运行时状态读取器」
                                  //   同步解析 /rocket plugins stdout（D1）；非 RUNNING 或解析失败 = 'unknown'
                                  // 启停走 PTY 命令 /rocket load/unload，Rocket.config.xml 无 PluginMapping 节点
}

/** Rocket.config.xml 结构化对象（真源：RocketSettings.cs，字段已回填） */
export interface RocketConfig {
  raw: string;                   // 原文（保留注释顺序，给「高级」视图用）
  fields: {
    /** 翻译文件代码（Rocket.{code}.translation.xml），默认 "en" */
    languageCode: string;
    /** 帧预算（部分 Rocket API 用），默认 60 */
    maxFrames: number;
    /** 周期自动关服（AutomaticShutdown/Enabled + Interval） */
    automaticShutdown: { enabled: boolean; interval: number };
    /** 远程权限同步（WebPermissions/Enabled + Url + Interval） */
    webPermissions: { enabled: boolean; url: string; interval: number };
    /** 远程插件配置同步（WebConfigurations/Enabled + Url） */
    webConfigurations: { enabled: boolean; url: string };
    /** RCON 子组——本项目不暴露（ADR-0004 Phase 6 已删），UI 隐藏 */
    rcon: { enabled: boolean; port: number; password: string } | null;
  };
}
```

**实现要点**：
- `readRocketConfig`：自写 `RocketConfigXmlParser`（与现有 `VdfParser` 同思路，保留注释/属性顺序/嵌套深度）。
- `listInstalledPlugins`：`fs.readdir` + `fs.stat` 拿 .dll 时间戳 + **`LdmAssemblyVersionReader` 解析 PE 元数据**读版本号（见 §5.5 准确方案）。
- **错误处理**：Rocket/ 目录不存在 → 返回 `{ plugins: [], rocketConfig: null }`，UI 友好提示「未检测到 Mod 框架。请复制 U3DS 装包自带的 Extras 到 Modules 目录并重启实例」。
- **错误处理**：Rocket/ 目录不存在 → 返回 `{ plugins: [], rocketConfig: null }`，UI 友好提示「未检测到 Mod 框架。请复制 U3DS 装包自带的 Extras 到 Modules 目录并重启实例」。

### 5.3 `LdmConfigWriter`（写类）

**职责**：原子写 Rocket.config.xml + Rocket.Unturned.config.xml + Permissions.config.xml + 各插件 `<插件名>.configuration.xml`。**不写 .dll**。

```typescript
/**
 * LDM 配置写入服务——仅写 XML，不写 .dll。
 * 写前必须 U3DS STOPPED（覆盖正在读的文件 = 崩溃）。路由层校验 ServerManager.activeOperation。
 */
export interface ILdmConfigWriter {
  /**
   * 写 Rocket.config.xml（框架级配置：语言/帧预算/自动关服/远程同步）。
   * 插件启停不走此文件——走 PTY 命令 /rocket load/unload（LDM 无 PluginMapping 节点）。
   * 原子写：先备份 Rocket.config.xml.bak.<UTC-ISO> → 写 tmp → rename。
   * 失败抛 AppError('ldm-config-write-failed', status=500)。
   */
  writeRocketConfig(serverId: ServerId, config: RocketConfig): Promise<void>;

  /** 写 Rocket.Unturned.config.xml（UnturnedSettings.cs，9 字段） */
  writeRocketUnturnedConfig(serverId: ServerId, config: RocketUnturnedConfig): Promise<void>;

  /** 写 Permissions.config.xml（Groups/Members/Permissions 树形） */
  writePermissionsConfig(serverId: ServerId, config: PermissionsConfig): Promise<void>;

  /**
   * 写单个插件的 `<插件名>.configuration.xml`（原文写入，不解析）。
   * 不校验字段——插件 schema 由插件开发者决定，面板不强解。
   */
  writePluginConfig(serverId: ServerId, pluginName: string, xmlContent: string): Promise<void>;

  /** 备份 Rocket.config.xml → 返回备份路径 */
  backupRocketConfig(serverId: ServerId): Promise<string>;

  /** 从备份回滚（写失败时调） */
  rollbackRocketConfig(serverId: ServerId, backupPath: string): Promise<void>;
}
```

**写路径**：
1. 备份原文件 → `<file>.bak.<UTC-ISO>`
2. 写 tmp → `<file>.tmp`
3. `fs.rename` → 原子替换
4. 失败 → 读备份回滚 → 抛 AppError

**复用现有 `ConfigService.atomicWrite`**（已实现 temp + rename + 备份，line 60）。

### 5.4 LdmAssemblyVersionReader（.dll 版本号读取 — 完整规格）

> 本节为 reader 完整规格（接口 / 实现要点 / 失败语义 / 集成点 / 单测）；选型拍板结论见 §5.5。

**底层逻辑**：.NET 程序集的 `AssemblyVersion` 不是 PE 头字段，而是 .NET 元数据流 `#~` 里的 `AssemblyVersionAttribute` 字符串属性。Mono CLI 调用方式（spawn `mono --assembly`）虽准，但开发期本机无 mono 拖慢 CI；PE 元数据流纯 Node 解析，部署零依赖。

**模块结构**（严格对齐 `backend-development.md` 三层规范）：

```
manager-server/src/modules/ldm/
└── LdmAssemblyVersionReader.ts    # 单文件模块（纯函数，零状态，零依赖注入）
shared/
├── contracts/ldm.ts               # + ILdmAssemblyVersionReader 接口
└── schemas/ldm.schema.ts          # 不变（version 字段已存在）
```

**接口**（`shared/contracts/ldm.ts`）：

```typescript
/**
 * 从 LDM 插件 .dll 读 AssemblyVersion 属性。
 * 纯函数，零状态，零外部副作用——可并发调用（多个插件同时读版本号）。
 * 失败一律返回 null，绝不抛异常——版本号只是展示字段，不影响插件启用/卸载/配置。
 */
export interface ILdmAssemblyVersionReader {
  /** 读 .dll 的 AssemblyVersion（格式 "major.minor.patch.build"，如 "3.2.1.0"）；解析失败返回 null，永不抛错 */
  readVersion(dllPath: string): Promise<string | null>;
}
```

**实现要点**（`LdmAssemblyVersionReader.ts`）：

```typescript
/** 自写 PE 流式解析（拍板：pe-library 已 archived 否决）——方案细节与单测见 workflow_sprint5_ldm_phase1.md §3 */
export class LdmAssemblyVersionReader implements ILdmAssemblyVersionReader {
  /**
   * 读 .dll 的 AssemblyVersion。
   * 步骤（ECMA-335 Partition II §22 真源）：
   *  ① 读 PE 头（DOS→PE signature→Optional Header）→ data directory[14] 拿 CLI Header RVA
   *  ② CLI Header → Metadata root（头 4 字节 'BSJB' 签名校验）
   *  ③ 元数据根 → #~ 流 → CustomAttribute 表 + #Strings heap
   *  ④ 扫 TypeRef/TypeDef 找 "System.Reflection.AssemblyVersionAttribute" → 读 FixedArg 返回 "major.minor.patch.build"
   *
   * @param dllPath - .dll 绝对路径
   * @returns 版本字符串（如 "3.2.1.0"）；解析失败/非 .NET/无 AssemblyVersion 属性 → null（永不抛）
   */
  async readVersion(dllPath: string): Promise<string | null> {
    try {
      // ~20 行流式解析（仅扫 PE 头 + CLI 头 + 关键 metadata stream，限制 4KB 扫描窗口）
      // 单文件 ≤ 5ms，不整读文件进内存
    } catch {
      return null;  // 绝不抛——版本号只是展示
    }
  }
}
```

**失败语义**（写进 JSDoc）：
- 文件不存在 → null
- 非 PE 文件 → null
- PE 但非 .NET（无 CLI Header） → null
- .NET 但无 AssemblyVersionAttribute → null（用 AssemblyFileVersionAttribute 兜底）
- 元数据损坏 → null + pino warn（不阻塞列表渲染）

**集成点**（`LdmDiscoveryService.listInstalledPlugins`）：

```typescript
async listInstalledPlugins(serverId: ServerId): Promise<InstalledPlugin[]> {
  const pluginsDir = path.join(resolveServerPath(serverId), 'Rocket', 'Plugins');
  const dlls = await fs.readdir(pluginsDir).catch(() => []);
  return await Promise.all(
    dlls
      .filter((f) => f.endsWith('.dll'))
      .map(async (f) => {
        const full = path.join(pluginsDir, f);
        const stat = await fs.stat(full);
        const name = f.replace(/\.dll$/, '');
        return {
          name,
          version: await this.versionReader.readVersion(full),  // 流式解析（单文件 ≤ 5ms）
          sizeBytes: stat.size,
          hasConfig: await this.hasPluginConfig(pluginsDir, name),
          modifiedAtIso: stat.mtime.toISOString(),
          runtimeStatus: await this.runtimeStatusReader.read(serverId, name),  // 经构造注入的「运行时状态读取器」（D1：RUNNING 时同步调一次 /rocket plugins 解析；非 RUNNING → 'unknown'）
          // configPath 为 Phase 2 新增（workflow §9）——Phase 1 前端不跳转配置目录
        };
      }),
  );
}
```

**单测**（≥ 8 用例，对应 backend-development.md 强制 ≥80% 行覆盖）：
1. 真 .NET .dll → 返回 "3.2.1.0"
2. 无 AssemblyVersionAttribute → 返回 null
3. PE 但非 .NET（无 CLI Header）→ 返回 null
4. 文件不存在 → 返回 null（不抛）
5. 文件损坏（PE 头合法但 metadata 截断）→ 返回 null（不抛）
6. 并发 10 个 .dll → 全部正确
7. 文件 0 字节 → 返回 null
8. 100MB 假 .dll → 返回 null（不 OOM）

**为什么不用 mono CLI**：
- 本机开发无 mono → 拖慢开发体验
- Linux 部署虽强制装 mono，但 `mono --assembly` 输出解析脆（不同 mono 版本格式略异）
- 自写流式解析零依赖（仅 Node 内置 `fs` + `Buffer`），CI 无需额外镜像

**依赖**（`manager-server/package.json`）：无新增——自写解析仅用 Node 内置 `fs` + `Buffer`

### 5.5 `LdmAssemblyVersionReader`（.dll 版本号读取 — A1 准确方案）

> **拍板**：**自写 PE 元数据流式解析**（零依赖，仅 Node 内置 `fs` + `Buffer`），**不走 mono CLI、不用 `pe-library`**（pe-library 已 archived）。方案细节与单测见 `claudedocs/workflow_sprint5_ldm_phase1.md` §3。

**调研结论（关键）**：LDM 插件走 **GitHub Releases + LDM-Community 列表**分发，**不上 Steam Workshop**（[Steam Workshop 主站](https://steamcommunity.com/app/304930/workshop/) Asset Type 清单里没有 Plugin 类）。前端 `ModsPage` 现有的 Workshop 浏览与 LDM 插件无关。

**修改原设计**：
- ❌ 删除 `?ldm=true` 端点
- ❌ 删除 `LdmWorkshopService`
- ✅ 新增 `LdmPluginSourceService`：定期拉取 [LDM-Community 插件列表](https://ldm-community.github.io/pluginlist) 公开数据（JSON API），面板本地缓存；前端展示 + 外链到 GitHub Releases 下载页
- ✅ 插件下载与上传：用户从 GitHub 下载 .dll 后，通过 **Files API** 拖拽上传到 `Rocket/Plugins/<Name>.dll`

### 5.6 与 `applyModChanges` 的对接（A2 拍板：抽 `LdmApplyService`）

> **拍板**：抽出独立 `LdmApplyService`，公共流水线提到 `ServerManager.applyChangesCore`。
> **模块意识**：严格对齐 `backend-development.md` 三层结构（contracts 接口 → class 实现 → 路由工厂注入），预留第三应用方抽象入口。

**底层逻辑**：当前 `ServerManager.applyModChanges` 是 145 行的 9 步流水线，**与 LDM 应用 80% 相同**（PTY Say + Save + Shutdown + waitExit + spawn + 广播）。按 backend-development.md「重复的数据库操作 ≥3 模块共用→新建共享模块」——现在是 2 个，**预防性抽 base method + 薄业务模块**，比等到 3 个再重构便宜。

**模块结构**：

```
manager-server/src/modules/ldm/
└── LdmApplyService.ts            # 薄业务层（activeOperation 类型 + WS 事件名 + 业务 hook）

manager-server/src/modules/server/ServerManager.ts
└── applyChangesCore(serverId, opts) → 重构抽出（9 步流水线本体）

shared/
└── contracts/ldm.ts               # + ILdmApplyService
```

**接口**（`shared/contracts/ldm.ts`）：

```typescript
/**
 * 应用 LDM 配置变更——PTY 终端 owner-trust 重启流水线。
 * 不写 WorkshopDownloadConfig.json（File_IDs 只含 Workshop 资源包，与 LDM 无关）。
 */
export interface ILdmApplyService {
  /**
   * @param serverId - 实例标识
   * @param changedPlugins - 变更的插件名列表（仅供日志与 UI 提示，重启本体由 applyChangesCore 完成）
   * @throws AppError('operation-conflict') 当已有 activeOperation
   * @throws AppError('server-not-running') 当实例未运行
   */
  applyChanges(serverId: ServerId, changedPlugins: string[]): Promise<void>;
}
```

**实现要点**（`LdmApplyService.ts`）：

```typescript
/**
 * LDM 配置变更应用服务——薄业务层。
 *
 * 关键设计决策（A2 拍板）：
 * - 抽出独立模块而非在 ServerManager 加 ldmApply 分支，遵循 backend-development.md
 *   「重复的数据库操作 ≥3 模块共用→新建共享模块」原则（现在是 2 个：mod_apply + ldm_apply；
 *   将来加 modpack_apply 时零成本接入）
 * - 流水线本体（Say + Save + Shutdown + waitExit + spawn + broadcast）抽到
 *   ServerManager.applyChangesCore，本模块仅负责 activeOperation 类型 / WS 事件类型 / 业务 hook
 * - 三个应用方（mod / ldm / 未来 modpack）共享同一个 activeOperation 互斥区，由 opts.kind 区分
 */
export class LdmApplyService implements ILdmApplyService {
  constructor(
    private readonly serverManager: IServerManager,
    private readonly broadcaster: IBroadcaster,
  ) {}

  async applyChanges(serverId: ServerId, changedPlugins: string[]): Promise<void> {
    await this.serverManager.applyChangesCore(serverId, {
      kind: 'ldm_apply',
      eventType: 'ldm_apply_progress',
      activeOpType: 'ldm_apply',
      preShutdownHook: async () => {
        // LDM 应用前无额外操作（配置已写入完成才调 apply，hook 仅做日志）
        logger.info({ serverId, changedPlugins }, 'LDM 变更应用开始');
      },
      postReadyHook: async () => {
        logger.info({ serverId, changedPlugins }, 'LDM 变更应用完成');
      },
    });
  }
}
```

**`ServerManager.applyChangesCore` 重构契约**（抽出后的签名）：

```typescript
/**
 * 应用变更核心流水线——mod_apply / ldm_apply / 未来 modpack_apply 共用。
 * 不在路由层直接调——必须经 Service 层包装。
 *
 * @param opts.kind - 'mod_apply' | 'ldm_apply' | 'modpack_apply'（预留第三处）
 * @param opts.eventType - WS 广播事件名（mod_apply_progress / ldm_apply_progress / modpack_apply_progress）
 * @param opts.activeOpType - activeOperation.type（防竞态互斥）
 * @param opts.preShutdownHook - 关服前回调（业务层日志/校验）
 * @param opts.postReadyHook - 启动就绪后回调（业务层后处理）
 */
async applyChangesCore(
  serverId: ServerId,
  opts: ApplyChangesOptions,
): Promise<void> { /* 145 行流水线本体 */ }
```

**事件类型扩展**（`shared/types/events.ts`）：

```typescript
/** 现状：只有 mod_apply_progress；A2 抽完后扩展为联合类型 */
export type ApplyProgressEvent =
  | { type: 'mod_apply_progress'; serverId: string; stage: ModApplyStage; ... }
  | { type: 'ldm_apply_progress'; serverId: string; stage: LdmApplyStage; ... };
```

**重构影响**：
- `ServerManager.applyModChanges` → 改为薄壳（20 行）调 `applyChangesCore` + `kind: 'mod_apply'`
- `WorkshopApplyService` 内的任何调用方同步改
- 兼容性：API 端点 8 `/api/servers/:id/ldm/apply` 不变（路由层只调 `ILdmApplyService.applyChanges`）

**单测**（≥ 4 用例）：
1. `applyChanges` 正常路径 → activeOperation='ldm_apply' → 流水线跑完 → 释放
2. 已有 activeOperation → 抛 `operation-conflict`
3. 实例非 RUNNING → 抛 `server-not-running`
4. `preShutdownHook` 抛错 → 流水线仍走 finally 清理 activeOperation

**完成定义**：
- [ ] `applyChangesCore` 从 `applyModChanges` 抽出，原方法变薄壳
- [ ] `LdmApplyService` 实现 + 单测
- [ ] WS 事件类型扩展为联合
- [ ] `composition-root.ts` 注入 `LdmApplyService`

---

## 6. API 契约

### 6.1 端点清单（挂在 `/api/servers/:id/ldm` 下，独立于 `/api/mods`）

| # | 方法 | 路径 | 用途 | 入参 | 响应 | 备注 |
|---|---|---|---|---|---|---|
| 1 | GET | `/api/servers/:id/ldm/installed` | 已装插件列表 + Rocket.config.xml + Permissions.config.xml | — | `LdmStateSchema` | 真源扫描 |
| 2 | GET | `/api/servers/:id/ldm/plugins/:name/config` | 读单个 Configuration.xml 原文 | path: name | `PluginConfigSchema`（原文 + metadata） | XML 原文 |
| 3 | PUT | `/api/servers/:id/ldm/plugins/:name/config` | 写 Configuration.xml（原文） | `PluginConfigWriteSchema` | `OperationResponseSchema` | 必须 STOPPED |
| 4 | PUT | `/api/servers/:id/ldm/rocket-config` | 写 Rocket.config.xml（结构化字段） | `RocketConfigWriteSchema` | `OperationResponseSchema` | 必须 STOPPED |
| 5 | PUT | `/api/servers/:id/ldm/permissions-config` | 写 Permissions.config.xml（结构化字段） | `PermissionsConfigWriteSchema` | `OperationResponseSchema` | 必须 STOPPED |
| 6 | POST | `/api/servers/:id/ldm/load-plugin` | 加载插件（PTY 写 `/rocket load <name>`） | `LoadPluginSchema` | `OperationResponseSchema` | **不停服**（LDM 支持运行时 load） |
| 7 | POST | `/api/servers/:id/ldm/unload-plugin` | 卸载插件（PTY 写 `/rocket unload <name>`） | `UnloadPluginSchema` | `OperationResponseSchema` | **不停服** |
| 8 | POST | `/api/servers/:id/ldm/apply` | 应用配置变更（重启流水线） | `LdmApplyRequestSchema`（{changedPlugins: string[]}） | `OperationResponseSchema` | 走 PTY 重启 |
| 9 | GET | `/api/ldm/community-plugins` | LDM-Community 公开插件列表（缓存） | — | `CommunityPluginListSchema` | 复用 LdmPluginSourceService |
| 10 | POST | `/api/servers/:id/files` | 插件 .dll 上传（Files API 复用） | multipart | `FileUploadResponseSchema` | **复用** FilesService；Linux 大小写校验 |
| 11 | POST | `/api/ldm/community-plugins/test-pat` | PAT 测连通性 | `X-GitHub-PAT` 请求头 | `OperationResponseSchema` | Phase 1 |
| 12 | GET | `/api/servers/:id/ldm/status` | 统一状态（LDM 主框架装没装 / Rocket/ 存在 / 插件总数） | — | `LdmStatusSchema` | Phase 3 |
| 13 | GET | `/api/ldm/community-plugins/:slug` | 插件详情（GitHub Releases 外链 + 最近版本） | path: slug | `CommunityPluginDetailSchema` | Phase 3 |
| 14 | POST | `/api/servers/:id/ldm/reload-plugin` | 单插件 reload（二次确认） | `ReloadPluginSchema` | `OperationResponseSchema` | Phase 4 |
| 15 | GET | `/api/servers/:id/ldm/plugins/search` | 按 .dll 名 / 版本筛选 | query: q | `InstalledPlugin[]` | Phase 4 |
| 16 | WS | `ldm_apply_progress` | 重启进度事件 | — | 见 §6.4 | — |

### 6.2 Zod Schema（`shared/schemas/ldm.schema.ts`）

```typescript
import { z } from 'zod';

/** 已装插件描述 */
export const InstalledPluginSchema = z.object({
  name: z.string().min(1),
  version: z.string().nullable(),
  sizeBytes: z.number().int().nonnegative(),
  hasConfig: z.boolean(),
  modifiedAtIso: z.string().datetime(),
  runtimeStatus: z.enum(['loaded', 'unloaded', 'failure', 'cancelled', 'unknown']),
});

/** Rocket.config.xml 结构化（真源 RocketSettings.cs，字段已回填） */
export const RocketConfigSchema = z.object({
  raw: z.string().describe('原文（高级视图用）'),
  fields: z.object({
    languageCode: z.string().default('en').describe('翻译文件代码（Rocket.{code}.translation.xml）'),
    maxFrames: z.number().int().default(60).describe('帧预算'),
    automaticShutdown: z.object({
      enabled: z.boolean().default(false),
      interval: z.number().int().default(86400).describe('间隔秒数（24h）'),
    }),
    webPermissions: z.object({
      enabled: z.boolean().default(false),
      url: z.string().default(''),
      interval: z.number().int().default(180),
    }),
    webConfigurations: z.object({
      enabled: z.boolean().default(false),
      url: z.string().default(''),
    }),
    rcon: z
      .object({
        enabled: z.boolean().default(false),
        port: z.number().int().default(27115),
        password: z.string().default('changeme').describe('明文密码——UI 不暴露'),
      })
      .nullable()
      .default(null)
      .describe('RCON 子组——本项目不暴露（ADR-0004 Phase 6 已删）'),
  }),
});

/** Rocket.Unturned.config.xml 结构化（真源 UnturnedSettings.cs，9 字段） */
export const RocketUnturnedConfigSchema = z.object({
  raw: z.string().describe('原文（高级视图用）'),
  fields: z.object({
    automaticSave: z.object({
      enabled: z.boolean().default(true),
      interval: z.number().int().default(1800).describe('间隔秒数（30 分钟）'),
    }),
    characterNameValidation: z.boolean().default(false),
    characterNameValidationRule: z.string().default(''),
    logSuspiciousPlayerMovement: z.boolean().default(true),
    enableItemBlacklist: z.boolean().default(false),
    enableItemSpawnLimit: z.boolean().default(false),
    maxSpawnAmount: z.number().int().default(10),
    enableVehicleBlacklist: z.boolean().default(false),
  }),
});

/** Permissions.config.xml 结构化（Groups/Members/Permissions 树形） */
export const PermissionsConfigSchema = z.object({
  raw: z.string().describe('原文（高级视图用）'),
  fields: z.object({
    defaultGroup: z.string().default('default'),
    groups: z.array(
      z.object({
        id: z.string(),
        displayName: z.string(),
        color: z.string(),
        parentGroup: z.string().nullable(),
        priority: z.number().int(),
        prefix: z.string().nullable(),
        suffix: z.string().nullable(),
        members: z.array(z.string()),
        permissions: z.array(z.string()),
      }),
    ),
  }),
});

/** 整个 LDM 状态（一次 GET 拿全）*/
export const LdmStateSchema = z.object({
  rocketInstalled: z.boolean().describe('Rocket/ 目录是否存在 = LDM 主框架是否生效'),
  rocketConfig: RocketConfigSchema.nullable(),
  rocketUnturnedConfig: RocketUnturnedConfigSchema.nullable(),
  permissionsConfig: PermissionsConfigSchema.nullable(),
  plugins: z.array(InstalledPluginSchema),
});

/** 单个插件配置（原文 + 元数据） */
export const PluginConfigSchema = z.object({
  name: z.string(),
  xmlContent: z.string().describe('Configuration.xml 原文'),
  lastModified: z.string().datetime(),
});

/** 写插件配置 */
export const PluginConfigWriteSchema = z.object({
  xmlContent: z.string().min(1).max(64 * 1024),  // 64KB 上限防御
});

/** 写 Rocket.config.xml */
export const RocketConfigWriteSchema = z.object({
  fields: RocketConfigSchema.shape.fields,
});

/** 加载插件（PTY 写 /rocket load <name>，不停服） */
export const LoadPluginSchema = z.object({ name: z.string().min(1) });

/** 卸载插件（PTY 写 /rocket unload <name>，不停服） */
export const UnloadPluginSchema = z.object({ name: z.string().min(1) });

/** 应用 LDM 变更 */
export const LdmApplyRequestSchema = z.object({
  changedPlugins: z.array(z.string()).default([]),
});

/** 操作响应（异步任务） */
export const OperationResponseSchema = z.object({
  operationId: z.string(),
  status: z.enum(['queued', 'running', 'completed', 'failed']),
});

/** WS 事件 */
export const LdmApplyProgressEventSchema = z.object({
  type: z.literal('ldm_apply_progress'),
  serverId: z.string(),
  stage: z.enum(['broadcasting', 'saving', 'shutting_down', 'moving', 'starting', 'ready', 'failed']),
  remainingSeconds: z.number().int().optional(),
  pluginName: z.string().optional(),
  message: z.string().optional(),
});
```

### 6.3 契约（`shared/contracts/ldm.ts`）

```typescript
import type { ServerId } from '../types/branded.js';
import type {
  LdmState, RocketConfig, RocketUnturnedConfig, PermissionsConfig, InstalledPlugin,
} from '../types/domain.js';

export interface ILdmDiscoveryService {
  readRocketConfig(serverId: ServerId): Promise<RocketConfig | null>;
  readRocketUnturnedConfig(serverId: ServerId): Promise<RocketUnturnedConfig | null>;
  readPermissionsConfig(serverId: ServerId): Promise<PermissionsConfig | null>;
  readPluginConfig(serverId: ServerId, pluginName: string): Promise<string>;
  listInstalledPlugins(serverId: ServerId): Promise<InstalledPlugin[]>;
  readState(serverId: ServerId): Promise<LdmState>;
}

export interface ILdmConfigWriter {
  writeRocketConfig(serverId: ServerId, config: RocketConfig): Promise<void>;
  writeRocketUnturnedConfig(serverId: ServerId, config: RocketUnturnedConfig): Promise<void>;
  writePermissionsConfig(serverId: ServerId, config: PermissionsConfig): Promise<void>;
  writePluginConfig(serverId: ServerId, pluginName: string, xml: string): Promise<void>;
  backupRocketConfig(serverId: ServerId): Promise<string>;
  rollbackRocketConfig(serverId: ServerId, backupPath: string): Promise<void>;
}

export interface ILdmApplyService {
  /**
   * 应用 LDM 配置变更——PTY 终端 owner-trust 重启流水线。
   * 不写 WorkshopDownloadConfig.json（File_IDs 只含 Workshop 资源包，与 LDM 无关）。
   */
  applyChanges(serverId: ServerId, changedPlugins: string[]): Promise<void>;
}
```

### 6.4 错误处理

| 错误 | code | status | 触发 | UI 提示（中文） |
|---|---|---|---|---|
| LDM 主框架未装 | `ldm-not-installed` | 404 | `Rocket/` 目录不存在 | 「未检测到 Mod 框架。请复制 U3DS 装包自带的 Extras 到 Modules 目录并重启实例（见「关于 LDM」指引）」 |
| 插件不存在 | `ldm-plugin-not-found` | 404 | `Plugins/<Name>/` 不存在 | 「插件 {{name}} 不存在。请从 GitHub Releases 下载 .dll 并上传到插件目录」 |
| U3DS 未停止时写配置 | `server-not-stopped` | 409 | activeOperation ≠ none 或 state ≠ STOPPED | 「配置写入要求实例已停止（当前：{{state}}）。请先停止实例」 |
| 配置文件损坏 | `ldm-config-corrupted` | 500 | XML 解析失败 | 「配置文件损坏，已自动回滚到上次正确状态」 |
| 写失败 | `ldm-config-write-failed` | 500 | atomic write 失败 | 「配置文件写入失败：{{reason}}」 |
| PTY 关闭超时 | `server-shutdown-timeout` | 504 | waitExit 30s 超时 | 「实例关闭超时，已强制停止」 |

---

## 7. 前端 UI 草案

### 7.1 新页面：`<LdmPage>`（顶层路由 `/ldm`）

**Tab 布局**（与 `ConfigPage` 同款 4 Tab）：

```
LdmPage
├── Tab "已装插件"   ← 插件列表 + 加载/卸载按钮（走 /rocket 命令）+ 配置按钮
├── Tab "框架配置"   ← Rocket.config.xml + Rocket.Unturned.config.xml 双卡片（结构化）
├── Tab "权限组"     ← Permissions.config.xml 树形编辑器
└── Tab "插件来源"   ← LDM-Community 列表 + 外链 GitHub Releases + .dll 上传
```

**侧栏导航**：在现有侧栏加「Mod 框架」入口（与「模组管理」并列）。
- 命名：**「Mod 框架」**（依据 `claudedocs/reference_ui_terms.md` 风格；LDM 是品牌名，**不要** 在用户可见文案出现）

### 7.2 已装插件 Tab

```
┌─────────────────────────────────────────────────────────┐
│ Mod 框架 > 已装插件                                       │
├─────────────────────────────────────────────────────────┤
│ [搜索] [状态筛选▼]              [全部刷新] [应用变更]      │
├─────────────────────────────────────────────────────────┤
│ ┌─────────────────────────────────────────────────┐    │
│ │ EssentialsX                       ✓ 已加载        │    │
│ │ 版本 3.2.1     配置文件存在                       │    │
│ │ [卸载] [编辑配置] [查看日志]                      │    │
│ └─────────────────────────────────────────────────┘    │
│ ┌─────────────────────────────────────────────────┐    │
│ │ BetterEconomy                     ○ 未加载        │    │
│ │ 版本 1.0.5     配置文件存在                       │    │
│ │ [加载] [编辑配置] [查看日志]                      │    │
│ └─────────────────────────────────────────────────┘    │
│ ...                                                     │
├─────────────────────────────────────────────────────────┤
│ 共 5 个插件 · 4 已加载 · 1 未加载                         │
└─────────────────────────────────────────────────────────┘
```

**加载/卸载语义**：
- 加载/卸载 = PTY 写 `/rocket load/unload <name>`，**不停服**（LDM 支持运行时启停）
- `已加载` 状态 = RUNNING 时解析 `/rocket plugins` stdout；U3DS 停止时按钮禁用 + 提示「实例未运行」
- 改插件配置 / 框架配置 → 才触发重启流水线（见 7.6 场景 B）

**复用组件**：
- `SearchInput`（已有）
- `DataTable`（已有，3 列：名称+版本+操作）
- `ConfirmDialog`（加载/卸载轻量确认——不停服，不重启）
- `sonner` toast（操作反馈）

### 7.3 框架配置 Tab

**双卡片**（对齐 Rocket/ 目录下两个独立文件）：
- **Mod 框架配置卡**（Rocket.config.xml）：语言 / 帧预算 / 自动关服 / 远程同步（RCON 子组**隐藏**——默认密码 `"changeme"` 明文，ADR-0004 Phase 6 已删 RCON 通道）
- **未转变者服务端配置卡**（Rocket.Unturned.config.xml）：自动存档 / 角色名校验 / 可疑日志 / 物品与载具黑名单（9 字段）

**高级视图切换**：右上角小图标，点击切到「XML 原文」模式（给高级用户手动改）。

### 7.4 权限组 Tab（Permissions.config.xml）

树形编辑器：权限组（Groups）→ 成员（Members）→ 权限（Permissions）+ 颜色 / 父组 / 优先级 / 前后缀 / 冷却。直接映射 XML 结构，保存走结构化写接口（`PUT /ldm/permissions-config`）。

### 7.5 插件来源 Tab（替换旧「工作坊 Tab」——LDM 不上 Workshop）

**不复用 `ModsPage`**（Workshop 搜索只含资源包，Asset Type 无 Plugin 类）：
- 展示 [LDM-Community 插件列表](https://ldm-community.github.io/pluginlist)（`GET /api/ldm/community-plugins`，本地缓存）
- 每行外链「前往 GitHub Releases 下载」→ 用户下载 .dll
- 拖拽上传 .dll 到 `Rocket/Plugins/<Name>.dll`（Files API 复用；配置目录 `Plugins/<Name>/` 由框架首次加载自动创建，目录名须与 .dll 同名）

**架构决策**（2026-08-12 用户拍板）：
- **Tab 顶部固定 GitHub PAT 配置卡**——用于「提升 GitHub API 限流（60/h → 5000/h）」。PAT 只服务 LDM 社区插件列表，不属于「系统级设置」，**不放在 SettingsPage**（避免污染 Steam WebAPI Key 域）
- **后端透传**：PAT 由前端 localStorage 持有 + 每次请求通过请求头 `X-GitHub-PAT` 透传，**后端不持久化**——用户改 PAT 立即生效，无需重启面板
- **双源融合**：列表展示走 HTML 解析 + GitHub API 批量（25 仓库 × 2 端点 = 50 调用/全量，5min 进程内缓存复用，匿名 60/h 限流恰好够 1 次全量刷新；配 PAT 后 5000/h 零压力）
- 详细规格（控件 / 字段 / 错误码 / 单测用例）见 `claudedocs/workflow_sprint5_ldm_phase1.md` §7.8

### 7.6 操作流（端到端）

```
场景 A：加载插件（不停服）
──────────────────────────────────
[已装插件 Tab] 找到 BetterEconomy → 点 [加载]
  ↓
[ConfirmDialog] 轻量确认「加载插件 BetterEconomy？」（不需要重启）
  ↓
[确认] → POST /api/servers/:id/ldm/load-plugin {name: "BetterEconomy"}
  ↓
LdmPluginCommandsService 经 PTY 写 /rocket load BetterEconomy
  ↓
解析 stdout → WS 推插件状态 → 列表刷新
  ↓
前端 toast「已触发加载」（成功=命令已接受，非加载最终成功——CommandRocket.cs:114-115 先 Say 后执行）

场景 B：改插件配置（需重启生效）
──────────────────────────────────
[已装插件 Tab] 点 [编辑配置] → 通用 XML 编辑器改 Configuration.xml → 保存
  ↓
POST /api/servers/:id/ldm/plugins/:name/config（路由层校验 state=STOPPED）
  ↓
提示「配置已保存，重启后生效」→ 用户点 [应用变更] → POST /ldm/apply
  ↓
PTY 写 Say + Save + Shutdown 10 + spawn 新 bash（applyChangesCore 流水线）
  ↓
WS 推 ldm_apply_progress {stage: 'broadcasting' → ... → 'ready'}
  ↓
前端 toast「变更已应用」 + 列表自动刷新
```

---

## 8. 多实例隔离

> **源码铁证**：LDM 仓 `Rocket/Rocket.Core/Environment.cs`——
> ```csharp
> RocketDirectory = String.Format("Servers/{0}/Rocket/", U.Instance.InstanceId);
> if (!Directory.Exists(RocketDirectory)) Directory.CreateDirectory(RocketDirectory);
> Directory.SetCurrentDirectory(RocketDirectory);
> ```
> `U.Instance.InstanceId` = `Dedicator.serverID` = 启动参数 `+InternetServer/<ServerID>`。

| 维度 | 隔离机制 |
|---|---|
| **每个实例独立 Rocket/** | `Servers/<ServerID>/Rocket/`（Environment.cs 源码级隔离） |
| **Modules/Rocket.Unturned/ 共享一份** | 全 U3DS 安装目录一份（LDM 主框架单进程加载） |
| **每个实例独立 WorkshopDownloadConfig.json** | 已有 B2 目录扫描真源 |
| **每个实例独立 Rocket.config.xml / Permissions.config.xml / Plugins/** | 都在 `Servers/<ID>/Rocket/` 下，路径天然隔离 |
| **启动时 `Directory.SetCurrentDirectory(RocketDirectory)`** | LDM 内部 cwd 随 ServerID 切换，插件路径解析自动隔离 |

---

## 9. 数据库迁移

**无新增表**——所有 LDM 状态从磁盘读（`Rocket.config.xml` + `Plugins/` 目录 + 各 `Configuration.xml`）。真源唯一 = 文件系统。

---

## 10. 验证门槛（PR 5 件套）

按 `.claude/rules/development.md`：

| 门槛 | 通过标准 |
|---|---|
| **类型检查** | `tsc --noEmit` 零错误 |
| **代码风格** | ESLint 零警告 |
| **单测** | 改到的文件行覆盖率 ≥ 80%；`RocketConfigXmlParser` ≥ 8 个用例（嵌套/属性/注释/CDATA/转义/空文件/大文件/字段顺序） |
| **E2E** | Playwright：装 LDM（mock `Rocket/` 目录）→ 加载插件（不停服）→ 改配置 → 应用 → 实例重启 → 列表刷新 |
| **接口契约** | ajv 加在所有 API 边界（§6.1 的 9 个 ldm REST 端点 + 复用 files 上传） |

**完成定义**：
- [ ] U3DS 启动后 stdout 可见 `Rocket Unturned v... for Unturned v...` banner（`U.cs:151`）——插件加载成功无独立 stdout 行，加载失败可见 `Failed to load plugin X.`（`U.cs:200`）
- [ ] 改配置 → 重启 → 新插件生效（PTY 终端 owner-trust 链路）
- [ ] 单实例改 LDM 不影响其他实例
- [ ] 没引入 `any`
- [ ] `.research/U3-SDK` 未动
- [ ] `unturned-sop.md` / `prohibitions.md` / `reference_ui_terms.md` / `reference_config_files.md §3` 同步更新
- [ ] §11「LDM 框架全功能盘点」(35 项) + §12「多期接入规划」（4 期切片）已与 ADR-0006 §7 + `reference_config_files.md §3-5` 同步

---

## 11. LDM 框架全功能盘点

> **盘点对象**：LDM 框架本身的全部可观测能力 + 周边生态，按面板可接入 / 不可接入 / 不该接入三档分类。
> 这是后续多期接入规划的「总目录」——每期从这张表里挑能力，§12 给出切分理由与依赖关系。

### 11.1 框架能力总表

| 维度 | 子能力 | 真源 | 面板可接入 | 接入难点 / 拒绝理由 |
|---|---|---|---|---|
| **A. 配置层** | | | | |
| A1 | `Rocket.config.xml` 结构化读写（16 字段） | LDM `Rocket.Core/Serialization/RocketSettings.cs` | ✅ | XML 解析自写（保留注释/属性顺序/CDATA） |
| A2 | `Rocket.Unturned.config.xml` 结构化读写（9 字段） | LDM `Rocket.Unturned/Serialisation/UnturnedSettings.cs` | ✅ | 同上，独立文件但同 schema 风格 |
| A3 | `Permissions.config.xml` 树形读写（Groups / Members / Permissions / Color / ParentGroup / Priority / Prefix / Suffix / Cooldown） | wasabihosting + LDM `Permissions.config.xml` 模板 | ✅ | 嵌套结构 + 通配符权限（`rocket.*`、`*`）；写入前必须备份 |
| A4 | 各插件 `<Plugin>.configuration.xml` 通用 XML 编辑器 | LDM `Rocket.Core/Environment.cs` `PluginConfigurationFileTemplate` | ✅ | **不强解 schema**——每插件自定义，面板只做 Monaco XML 原文编辑器 |
| **B. 插件生命周期** | | | | |
| B1 | `Plugins/<Name>.dll` 文件级上传 / 替换 / 删除 | Files API（已存在） | ✅ | Linux 大小写校验——`.dll` 名必须与 `<Name>/` 子目录同名 |
| B2 | `Libraries/` 共享依赖 .dll 上传 | Files API（已存在） | ✅ | 同上 |
| B3 | 插件 `load` / `unload`（**可不停服**） | PTY `/rocket load <name>` / `/rocket unload <name>` | ✅ | stdout 解析为状态反馈；子串匹配 + 大小写不敏感 |
| B4 | 插件 `reload`（单插件，不保证成功） | PTY `/rocket reload <name>` | ⚠️ 暴露 + 加警告 | 社区已知会破坏插件状态；前端必须弹二次确认 |
| B5 | 全局 `rocket reload` | PTY `/rocket reload` | ❌ | U3-SDK Issue #1794 + LDM 官方已删 + prohibitions 钉死 |
| **C. 权限系统** | | | | |
| C1 | 权限组增删改（`default` / `vip` / `admin` 等） | `Permissions.config.xml` | ✅ | 同 A3 |
| C2 | 组成员管理（SteamID64 → 组） | `Permissions.config.xml` `<Member>` | ✅ | 同 A3 |
| C3 | 通配符权限（`rocket.*`、`*`） | LDM `Rocket.Core/Permissions/PermissionSet.cs` | ✅ | 面板只展示不展开匹配计算 |
| C4 | 权限 Cooldown（按 Permission 元素 `Cooldown="<minutes>"`） | LDM `Permission` 元素属性 | ✅ | 写入字段表新增 Cooldown；UI 数字控件 |
| **D. 控制台命令（PTY 唯一通道）** | | | | |
| D1 | `/rocket plugins` 列出已加载插件 | LDM `Rocket.Unturned/Commands/CommandRocket.cs` | ✅ | 解析 stdout（Loaded/Unloaded/Failure/Cancelled 分组） |
| D2 | LDM 版本信息（**空参 `/rocket`**，非 `/rocket info`——后者不存在） | 同上 | ✅ | 前端「关于 LDM」卡片 |
| D3 | `/modules` 验证 Rocket.Unturned 模块加载状态 | U3DS 原生命令 | ✅ | 「LDM 状态」卡片 |
| D4 | `/p reload` 重载 `Permissions.config.xml` | LDM 命令 | ✅ | 不需重启服务端 |
| D5 | 其余 U3DS 原生命令（`Save` / `Shutdown` / `Say` 等） | U3DS `Provider.cs` | ✅ 复用 | 已被 ADR-0004 Phase 3 终端 owner-trust 模型覆盖 |
| **E. 多实例隔离** | | | | |
| E1 | `Servers/<ID>/Rocket/` 每实例独立 | LDM `Rocket.Core/Environment.cs` `RocketDirectory = "Servers/{0}/Rocket/"` | ✅ | 通过 `pathResolver` 已支持；UI 按实例聚合 |
| E2 | `Modules/Rocket.Unturned/` 全 U3DS 共享 | LDM 仓加载逻辑 | ❌（面板层不做） | 这是 U3DS 安装期的操作，属「不自动装」决策 |
| **F. 信息查询 / 运行时状态** | | | | |
| F1 | 插件运行时加载状态（已加载 / 已卸载 / 失败 / 取消） | `/rocket plugins` stdout | ✅ | 解析后挂在「已装插件」卡片 |
| F2 | 插件 .dll 版本号 | 自写 PE 流式解析 + `AssemblyVersionAttribute` | ✅ | ECMA-335 Partition II §22 真源；零依赖 |
| F3 | LDM 主框架版本（空参 `/rocket`） | stdout 解析 | ✅ | **与 D2 同一能力，归 Phase 2**（Phase 1 前端 2 Tab 无落位）；「关于 LDM」卡片显示 |
| F4 | 各插件兼容 U3DS 版本信息 | 插件仓库 README / GitHub Releases | ⚠️ 只展示不验证 | 不接管兼容性矩阵（每 LDM × 每插件 × 每 U3DS = O(n³)，维护成本无限） |
| **G. 插件来源 / 生态** | | | | |
| G1 | LDM-Community 公开插件列表 | https://ldm-community.github.io/pluginlist | ✅ | 进程内缓存 5min（与 mod 浏览同模式） |
| G2 | 外链到 GitHub Releases 下载页 | 列表项点击外链 | ✅ | 浏览器新标签打开，**面板不下载 .dll**（二进制风险） |
| G3 | Web 上传 .dll | Files API（已存在） | ✅ | 见 B1 |
| G4 | Steam Workshop 插件分发 | Steam Workshop | ❌ | Workshop Asset Type 不含 Plugin 类，实测 0 结果 |
| G5 | 自动从 GitHub Releases 同步 .dll | GitHub API | ❌ | 二进制风险 + 编译/分发不是面板职责 |
| **H. 日志 / 调试** | | | | |
| H1 | `Servers/<ID>/Rocket/Logs/` 框架日志 | pino tail | ✅ | 复用现有 PTY 控制台（xterm.js 已实时渲染） |
| H2 | 加载失败插件 stderr | stdout 实时输出 | ✅ | 同上，xterm.js 不需特殊解析 |
| H3 | 自动故障诊断（哪个插件导致崩溃） | — | ❌ | 定位归 owner，面板只展示 |
| **I. 主框架安装 / 升级** | | | | |
| I1 | 主框架安装（`cp -r Extras/Rocket.Unturned Modules/`） | U3DS 安装包自带 | ⚠️ 引导式（5 步 SOP） | 决策：`decision-no-auto-install-steamcmd-u3ds.md`——不自动装 |
| I2 | 主框架升级（U3DS 版本升级时同步 Modules/） | 同上 | ⚠️ 引导提示 | 不接管 |
| **J. 高级能力（不做）** | | | | |
| J1 | 插件商店 / 商业化 / Tebex 集成 | Tebex | ❌ | 钉死不接商业化；超出面板职责 |
| J2 | 兼容性矩阵（每 LDM × 每插件 × 每 U3DS） | — | ❌ | 维护成本无限 |
| J3 | 插件签名 / 哈希校验 | — | ❌ | 二进制风险；用户自己 GitHub 验源 |
| J4 | 插件隔离沙箱 | — | ❌ | LDM 架构层不支持，Mono 进程同地址空间 |
| J5 | `rocket reload` 全局重载 | PTY 命令 | ❌ | Issue #1794 + 钉死 |
| J6 | `cvar reload` 重载所有 cvar | U3DS 原生命令 | ❌ | 无官方热重载（钉死） |
| J7 | OpenMod 兼容层 | OpenMod | ❌ | OpenMod 2023 起停滞，已删（commit c5f2ac8） |
| J8 | RocketMod 兼容层 | RocketMod | ❌ | RocketMod 2019-12 停维，已删（commit c5f2ac8） |

### 11.2 可接入能力合计

- ✅ **必须做**：A1–A4 / B1–B3 / C1–C4 / D1–D5 / E1 / F1–F3 / G1–G3 / H1–H2 / I1 = **19 项**
- ⚠️ **加警告暴露**：B4 / I2 / F4 = **3 项**
- ❌ **明确不做**：B5 / E2 / G4 / G5 / H3 / J1–J8 = **13 项**

> 19 + 3 + 13 = **35 个盘点项**——其中 19 项是「必须做」，3 项是「暴露 + 警告」，13 项是「拒绝」（含拒绝理由）。

### 11.3 与现有架构的边界对齐

| 能力簇 | 接入方式 | 复用现有模块 |
|---|---|---|
| 配置层 A1–A4 | 结构化 XML 解析 + 原子写 | `ConfigService.atomicWrite`（已存在） |
| 插件生命周期 B1–B4 | Files API + PTY 终端 | `Files API`（已存在）+ ADR-0004 Phase 3 终端 |
| 权限系统 C1–C4 | XML 树形编辑 | 同 A3 |
| 控制台命令 D1–D5 | PTY stdout 解析 | ADR-0004 Phase 3 终端（已存在） |
| 多实例隔离 E1 | `pathResolver.resolveServerPath` | 已存在 |
| 信息查询 F1–F4 | PTY + PE 元数据 | 新增 `LdmAssemblyVersionReader`（自写流式解析，零依赖） |
| 插件来源 G1–G3 | 缓存列表 + Files API | 同 mod 浏览 5min 缓存模式 |
| 日志 H1–H2 | PTY 控制台复用 | ConsolePage（已存在） |

**与 `mod-management-design.md` v2.5 的边界**：
- 资源包（Workshop unity3d）走 SteamCMD + 应用时走 `WorkshopApplyService` → `ServerManager.applyModChanges`
- LDM 插件（.dll）走 Files API + 应用时走 `LdmApplyService` → `ServerManager.applyChangesCore`
- **两者共用** `ServerManager.applyChangesCore`（§5.6 抽出）——这是 backend-development.md「重复 ≥3 模块共用→新建共享」原则的预留位（当前 2 个共用方：mod_apply + ldm_apply；未来 modpack_apply 为第三处）

---

## 12. 多期接入规划

> **规划原则**：每期交付一个**生产可用**的能力切片，前端 / 后端 / shared / 文档齐备，不留「半成品」跨期。
> **升期触发**：本期能力全部落地 + 单测/E2E 全绿 + 至少一次实机验证，再启动下一期。
> **依赖关系**：后一期必须等前一期落地（避免重构回滚）。同期内任务可并行。

### 12.1 总体切片

| 期 | 主题 | 能力切片 | 端点 | 前端组件 | 后端模块 | 工作量 |
|---|---|---|---|---|---|---|
| **Phase 1 — MVP** | 看得到 + 启停得了 | F1 / F2 + B1 / B3 + **G1 双源融合** + D1 | 4 端点 + 1 PAT-test | `LdmPage` **2 Tab**（已装插件 / 插件来源，Tab 2 顶部固定 GitHub PAT 卡） | `LdmDiscoveryService` / `LdmPluginCommandsService` / `LdmAssemblyVersionReader` / `LdmPluginSourceService` | 10–12 人天 |
| **Phase 2 — 完整配置** | 改得了配置 | A1 / A2 / A3 / A4 / C1–C4 + B2 / D2 / D3 / D4 / H1 | +6 端点（=10） | 4 Tab 齐 | + `LdmConfigWriter` / `RocketConfigXmlParser` / `LdmApplyService` / `applyChangesCore` 抽出 | +12–15 人天 |
| **Phase 3 — 生态接入** | 找得到 + 下载方便 | G2 / G3 + 高级 UX（I1 引导 SOP 卡片 / F4 兼容信息展示） | +2 端点（=12） | 引导卡片 + 详情链接 | 无新模块（仅前端+已有模块拼接） | +5–7 人天 |
| **Phase 4 — 高级能力** | 已知边界的能力 | B4 单插件 reload + 插件搜索/筛选 | +2 端点（=14） | 二次确认弹窗 + 筛选 chip | `LdmPluginCommandsService` 增 reload 方法 | +3–5 人天 |
| **合计** | — | 19 + 3 项能力 | **14 端点 + WS 1** | 1 页面 4 Tab | 6 服务模块 + 1 工具模块 | **30–39 人天** |

### 12.2 Phase 1 — MVP（10–12 人天）

**目标**：用户能看到已装插件、加载/卸载插件（不停服）、查 .dll 版本、看社区插件列表——**配置可改可不改**。

| 维度 | 内容 |
|---|---|
| **能力** | F1（运行时状态）+ F2（.dll 版本）+ B1（.dll 上传/删除）+ B3（load/unload）+ **G1 走 HTML 解析 + GitHub API 双源融合**（用户拍板 2026-08-12；PAT 放 LdmPage Tab 顶部）+ D1（`/rocket plugins` 解析） |
| **端点** | `GET /api/servers/:id/ldm/installed`<br>`POST /api/servers/:id/ldm/load-plugin`<br>`POST /api/servers/:id/ldm/unload-plugin`<br>`GET /api/ldm/community-plugins`（**双源融合**响应）<br>`POST /api/ldm/community-plugins/test-pat`（PAT 测连通性） |
| **前端** | `<LdmPage>` 2 Tab：①「已装插件」②「插件来源」**顶部固定 GitHub PAT 配置卡**（PAT 输入 + 测试按钮 + 限流状态显示）。架构层决策：PAT 不进 SettingsPage。 |
| **后端模块** | `LdmDiscoveryService`（只读 `Plugins/` 目录） / `LdmPluginCommandsService`（PTY `load/unload` + stdout 解析） / `LdmAssemblyVersionReader`（PE 元数据流式解析，零依赖） / `LdmPluginSourceService`（HTML 解析 + GitHub API 批量补充 + 5min 进程内缓存） |
| **不做** | 配置 XML 编辑（A1–A4 全部留给 Phase 2） / 重启流水线（Phase 2 才需要） / 引导 SOP（Phase 3） |
| **验证门槛** | typecheck 0；单测 ≥ 80%（`LdmAssemblyVersionReader` ≥ 8 用例 / `LdmPluginSourceService` ≥ 13 用例含双源融合 + 限流处理 / `LdmPluginCommandsService` ≥ 8 用例 / `LdmDiscoveryService` ≥ 7 用例 = 36 用例）；E2E「上传 .dll → 列表出现 → load → 状态徽章变更 → unload → 状态徽章变更」+ E2E「配 PAT → 拉双源列表 → 限流显示 5000/h」 |
| **详细规格** | `claudedocs/workflow_sprint5_ldm_phase1.md`（单期实施契约层）<br>调研证据：`claudedocs/research_ldm_community_source_2026-08-12.md` |

### 12.3 Phase 2 — 完整配置（+12–15 人天）

**目标**：用户能结构化编辑 Rocket.config.xml / Rocket.Unturned.config.xml / Permissions.config.xml + 通用 XML 编辑器写插件配置 + 改完走 PTY 终端 owner-trust 重启流水线——**配置即生效**。

| 维度 | 内容 |
|---|---|
| **能力** | A1（A1）/ A2（A2）/ A3（A3）/ A4（plugin config 通用 XML）/ C1–C4（A3 扩展）+ B2（`Libraries/` 上传）+ D2（空参 `/rocket` 版本信息）+ D3（`/modules`）+ D4（`/p reload`）+ H1（`Rocket/Logs/` tail） |
| **端点** | + 6 端点 = **10 端点**：<br>`GET /api/servers/:id/ldm/plugins/:name/config`<br>`PUT /api/servers/:id/ldm/plugins/:name/config`<br>`PUT /api/servers/:id/ldm/rocket-config`<br>`PUT /api/servers/:id/ldm/permissions-config`<br>`POST /api/servers/:id/ldm/apply`<br>`WS ldm_apply_progress` |
| **前端** | `<LdmPage>` 4 Tab 齐：<br>① 已装插件（继承 Phase 1）<br>② 框架配置（顶部「关于 LDM」卡 = 空参 `/rocket` 版本信息 D2 +「LDM 状态」卡 = `/modules` D3；下方双卡片 Rocket.config.xml + Rocket.Unturned.config.xml 结构化字段编辑器 + XML 高级视图切换）<br>③ 权限组（Permissions.config.xml 树形编辑器：Groups / Members / Permissions / Color / ParentGroup / Priority / Prefix / Suffix / Cooldown）<br>④ 插件配置（每个插件 → Monaco XML 编辑器对话框） |
| **后端模块** | + `LdmConfigWriter`（3 XML 原子写 + 备份 + 回滚） / `RocketConfigXmlParser`（自写保留注释/属性顺序/CDATA） / `LdmApplyService`（薄业务层）+ **`ServerManager.applyChangesCore` 抽出**（与 `applyModChanges` 共用，预留 modpack_apply 第三处）<br>`LdmPluginCommandsService` 增 `readLdmVersion(serverId)`（D2：空参 `/rocket` stdout 解析版本行 `Rocket v<版本> for Unturned v<游戏版本>`）+ `readModulesState(serverId)`（D3：`/modules` 输出） |
| **依赖** | 必须 Phase 1 完成（`LdmDiscoveryService` 提供 `readState` 给 ConfigWriter 复用） |
| **不做** | 通用 Monaco XML 编辑器（强解 schema）/ 重启流水线外的其他生效路径 |
| **验证门槛** | typecheck 0；`RocketConfigXmlParser` 单测 ≥ 8 用例（注释保留 / 属性顺序 / CDATA / 嵌套 / 未知键保留）；`applyChangesCore` 单测 ≥ 4（mod_apply / ldm_apply 两条路径 + 重入保护）；`readLdmVersion` 单测 ≥ 2（版本行解析 + 非 RUNNING 报错）；E2E「改 Rocket.config.xml → 应用 → 实例 STOPPED→STARTING→RUNNING → 配置落盘 + stdout 含新配置生效信号」+ E2E「框架配置 Tab 顶部显示 LDM 版本（D2）+ 模块加载状态（D3）」 |

### 12.4 Phase 3 — 生态接入（+5–7 人天）

**目标**：用户能找到插件、了解它、下载它、上传它——**激活 LDM 主框架 + 全流程闭环**。

| 维度 | 内容 |
|---|---|
| **能力** | G2（外链 GitHub Releases）+ G3（详情页跳转）+ I1（5 步 SOP 引导卡片）+ F4（兼容信息只展示） |
| **端点** | + 2 端点 = **12 端点**：<br>`GET /api/servers/:id/ldm/status`（统一状态：LDM 主框架是否装 / Rocket/ 目录是否存在 / 插件总数）<br>`GET /api/ldm/community-plugins/:slug`（详情页：GitHub Releases 外链 + 最近版本） |
| **前端** | `<LdmPage>` 加「引导 SOP」卡片（5 步 + 复制按钮：cp -r ...）+ 「插件来源 Tab」增强（详情抽屉 + 版本时间线 + README 截断预览）+ 顶部「LDM 状态」卡片（显示 Rocket.Unturned 是否加载 + 插件总数 + 是否有更新） |
| **后端模块** | 无新模块——纯前端 + 复用 `LdmDiscoveryService` 增 1 方法 `getLdmStatus(serverId)` |
| **依赖** | 必须 Phase 2 完成（状态卡片依赖 Discovery 完整数据） |
| **不做** | 自动下载 .dll / Tebex 集成 / 兼容性矩阵自动校验 |
| **验证门槛** | typecheck 0；E2E「未装 LDM → 显示引导卡片 → 复制命令 → 模拟 cp → 状态变绿 → 列表出现空 Plugins/」；E2E「社区列表点击 → 外链跳转 GitHub Releases」 |

### 12.5 Phase 4 — 高级能力（+3–5 人天）

**目标**：暴露已知边界的实验性能力 + 高级 UX——**LDM 框架边界**。

| 维度 | 内容 |
|---|---|
| **能力** | B4 单插件 reload（加警告）+ 插件搜索/筛选（按 .dll 名 / 版本 / 状态） |
| **端点** | + 2 端点 = **14 端点**：<br>`POST /api/servers/:id/ldm/reload-plugin`（单插件 reload，弹二次确认）<br>`GET /api/servers/:id/ldm/plugins/search?q=`（按 .dll 名 / 版本前缀筛选） |
| **前端** | 「已装插件 Tab」加 reload 按钮（弹 ConfirmDialog 警告「可能破坏插件状态」）+ 顶部 SearchInput + 状态 chip 筛选（全部 / 已加载 / 已卸载 / 加载失败） |
| **后端模块** | `LdmPluginCommandsService` 增 `reloadPlugin(serverId, name)`（PTY `/rocket reload <name>` + 解析 reload 结果） + `LdmDiscoveryService` 增 `searchPlugins(serverId, query)` |
| **依赖** | 必须 Phase 2 完成（reload 走 stdout 解析，需要 Phase 2 的 `LdmPluginCommandsService` 已稳定） |
| **不做** | 全局 `rocket reload`（J5 钉死）/ `cvar reload`（J6 钉死）/ 插件沙箱（J4 LDM 不支持） |
| **验证门槛** | typecheck 0；E2E「reload 成功 → 插件状态变 Loaded + 版本号不变」+ E2E「reload 失败 → 弹错误提示 + 状态显示 Failure」 |

### 12.6 不进任何期的能力（拒绝清单）

> 这些是 §11.1 的 J1–J8 / B5 / G4–G5——任何期都不接。拒绝理由固化在 `prohibitions.md` 或 ADR-0006。

| 能力 | 拒绝理由 | 文档锚点 |
|---|---|---|
| 全局 `rocket reload` | U3-SDK Issue #1794 + LDM 官方已删 | `prohibitions.md` |
| `cvar reload` 全局 | 无官方热重载 | `prohibitions.md` |
| OpenMod / RocketMod 兼容 | 已停维 | commit `c5f2ac8` |
| Tebex 集成 / 商业化 | 钉死不接商业化 | `decision-no-auto-install-steamcmd-u3ds.md` |
| Steam Workshop 插件分发 | Workshop Asset Type 不含 Plugin | `unturned-sop.md` §LDM |
| 自动下载 .dll / GitHub 同步 | 二进制风险 | ADR-0006 §3.1 |
| 兼容性矩阵自动校验 | O(n³) 维护成本 | ADR-0006 §3.1 |
| 插件签名 / 沙箱 | LDM 架构层不支持 | ADR-0006 §4 |

### 12.7 升期门控

每期交付后必须通过才能开下一期：

| 门控 | 检查项 | 工具 |
|---|---|---|
| **类型检查** | `tsc --noEmit` 前后端 + shared | `pnpm run typecheck` |
| **单测覆盖率** | 改到的文件行覆盖 ≥ 80%；`LdmAssemblyVersionReader` ≥ 8 用例；`RocketConfigXmlParser` ≥ 8 用例；`applyChangesCore` ≥ 4 用例 | `pnpm run test:cov` |
| **E2E** | 本期主流程至少 1 用例跑通（playwright） | `pnpm run test:e2e` |
| **实机验证** | 本期能力在 Linux 真机 U3DS 跑通 | `decision-no-auto-install-steamcmd-u3ds.md` 留待 Sprint 5 |
| **接口契约** | ajv 加在所有新增 API 边界 | `pnpm run test:contract` |
| **文档同步** | `unturned-sop.md` / `reference_config_files.md` / `reference_ui_terms.md` / `architecture-spec.md` §3 §5 已更新 | `doc-outdated-guard` agent |
| **提交规范** | commit message 走 `<操作名>: <≤30 中文字符>`；本期所有提交独立可回滚 | git log 检查 |

### 12.8 与 Sprint 节奏的对齐

| 期 | 工作量 | 推荐 Sprint 节奏 | 前置依赖 |
|---|---|---|---|
| Phase 1 MVP | 10–12 人天 | 1 个 Sprint（与 Sprint 4 并行？） | 无 |
| Phase 2 完整配置 | +12–15 人天 | 1–2 个 Sprint | Phase 1 完成 + 实机验证 |
| Phase 3 生态接入 | +5–7 人天 | 0.5–1 个 Sprint | Phase 2 完成 |
| Phase 4 高级能力 | +3–5 人天 | 0.5 个 Sprint | Phase 3 完成 |

**总工期估算**：30–39 人天 ≈ **3 个 Sprint**（每个 Sprint 按 10 人天计）。Phase 2 是最大的一块（`applyChangesCore` 重构 + 三个 XML 解析 + 树形编辑器 + 重启流水线），建议拆为 Phase 2a（XML 解析 + 配置读写）与 Phase 2b（重启流水线 + UI）。

---

*版本：v0.1 设计稿 · 2026-08-12*