# LDM Mod 框架接入设计规格

> **状态**：v0.1 设计稿 · **日期**：2026-08-12
> **承接**：CLAUDE.md §1（钉死 LDM）+ ADR-0003 B2 目录扫描真源 + ADR-0004 PTY 终端 owner-trust
> **驱动源**：用户 2026-08-12 诉求「LDM Mod 框架暂未实现，需要接入」
> **关系**：`mod-management-design.md` v2.5（Steam Workshop 资源包）— 本文档**平行但独立**，不修改资源包链路
> **核心参考**：LDM 仓库 https://github.com/SmartlyDressedGames/Legally-Distinct-Missile

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
| `/rocket` | 别名 `/rocket plugins` —— 列出已加载插件（按 Loaded/Unloaded/Failure/Cancelled 分组） | — | 解析 stdout 展示 | ✅ 可用 |
| `/rocket plugins` | 按状态分组列出所有插件 | `rocket.plugins` | 同上 | ✅ 可用 |
| `/rocket info` | 显示 LDM 版本信息 | `rocket.info` | 前端「关于 LDM」弹窗 | ✅ 可用 |
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
| **插件清单展示** | ✅ 做 | `readdir Servers/<ID>/Rocket/Plugins/` → `[{name, version, hasConfig, enabled, loaded}]` |
| **插件启用/禁用** | ✅ 做 | 通过 LDM 框架：`/rocket load <name>` 或 `/rocket unload <name>` 经 PTY 终端；或改 Rocket.config.xml + 重启 |
| **插件配置编辑**（Configuration.xml） | ✅ 做 | 各插件字段由插件 schema 决定；面板做**通用 Monaco XML 编辑器**（不做字段 schema 自动发现——schema 演进跟插件版本走，维护成本高） |
| **Rocket.config.xml 结构化编辑** | ✅ 做 | 字段表已确认（16 字段），逐字段控件 |
| **Permissions.config.xml 树形编辑** | ✅ 做 | Groups / Members / Permissions / Color / ParentGroup / Priority 全字段结构化 |
| **LDM 插件来源浏览** | ⚠️ 外链 + 列表展示 | **外链到 [LDM-Community 插件列表](https://ldm-community.github.io/pluginlist)**（不上 Steam Workshop）；面板本地缓存 LDM-Community 公开插件列表供浏览 |
| **改 LDM 配置生效方式** | ✅ PTY 终端 owner-trust 重启流水线 | `Say "保存 LDM 变更"` + `Save` + `Shutdown 10 "LDM 变更重启"` → spawn 新进程；**不调 `/rocket reload` 全局**（Issue #1794 + prohibitions 钉死） |
| **日志观察 LDM 启动加载/错误** | ✅ 复用现有 PTY 控制台 | U3DS stdout 已含 `[LDM] Loaded plugin X.Y.Z` / `[LDM] Plugin X error: ...`；前端 xterm.js 已实时渲染 |
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
├── LdmApplyService.ts            # PTY 终端 owner-trust 重启流水线（复用 ServerManager.applyChangesCore）
├── LdmPluginSourceService.ts     # 拉取 LDM-Community 公开插件列表（本地缓存，供前端展示/外链）
├── LdmPluginCommandsService.ts   # PTY 写 /rocket load/unload/reload + 解析 stdout 插件状态
├── RocketConfigXmlParser.ts      # 自写 XML 解析（保留注释/属性顺序/嵌套，与 VdfParser 同思路）
└── (各模块 .test.ts)
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

/** 已装插件描述 */
export interface InstalledPlugin {
  name: string;                  // 插件目录名 = 插件标识
  version: string | null;        // 从 .dll 元数据读（System.Reflection 或 mono）
  hasConfig: boolean;            // Configuration.xml 是否存在
  enabled: boolean;              // 运行时加载状态（RUNNING 时解析 /rocket plugins stdout；STOPPED 时未知，UI 提示「实例未运行」）
                                  // 启停走 PTY 命令 /rocket load/unload，Rocket.config.xml 无 PluginMapping 节点
  configPath: string;            // 绝对路径，方便 UI 跳转
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
- `listInstalledPlugins`：`fs.readdir` + `fs.stat` 拿 .dll 时间戳 + `mono`/`Process` 调 .NET 程序集读版本号。
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

### 5.4 ~~`LdmWorkshopService`~~ **已删除**——LDM 插件不上 Steam Workshop

**调研结论（关键）**：LDM 插件走 **GitHub Releases + LDM-Community 列表**分发，**不上 Steam Workshop**（[Steam Workshop 主站](https://steamcommunity.com/app/304930/workshop/) Asset Type 清单里没有 Plugin 类）。前端 `ModsPage` 现有的 Workshop 浏览与 LDM 插件无关。

**修改原设计**：
- ❌ 删除 `?ldm=true` 端点
- ❌ 删除 `LdmWorkshopService`
- ✅ 新增 `LdmPluginSourceService`：定期拉取 [LDM-Community 插件列表](https://ldm-community.github.io/pluginlist) 公开数据（JSON API），面板本地缓存；前端展示 + 外链到 GitHub Releases 下载页
- ✅ 插件下载与上传：用户从 GitHub 下载 .dll 后，通过 **Files API** 拖拽上传到 `Rocket/Plugins/<Name>.dll`

### 5.5 与 `applyModChanges` 的对接

**改 LDM 配置生效 = 走 `ServerManager.applyModChanges` 同款 9 步流水线**（已存在）。但 LDM 不改 WorkshopDownloadConfig.json 的 File_IDs——File_IDs 只记录 Steam Workshop 资源包（AppID 304930）；LDM 插件**不上 Workshop**（走 GitHub Releases + 面板上传），配置项全在 `Rocket/` 目录，**与 File_IDs 完全无关**。

新增轻量级流水线（不改 Mod 列表时也用得上）：

```typescript
/**
 * 应用 LDM 配置变更——复用 PTY 终端 owner-trust 重启链路。
 * 与 applyModChanges 的区别：不写 WorkshopDownloadConfig.json（File_IDs 与 LDM 无关）。
 */
async applyLdmChanges(serverId: ServerId, changedPlugins: string[]): Promise<void> {
  // ① activeOperation 校验（防竞态）
  // ② PTY 写 Say 公告
  // ③ PTY 写 Save
  // ④ PTY 写 Shutdown 10
  // ⑤ waitExit bash（30s 超时 forceKill）
  // ⑥ spawn 新 bash + 1s 塞 startCommand
  // ⑦ WS 广播 ldm_apply_progress { stage }
}
```

**决策**：是否抽出独立 `LdmApplyService`？
- **抽**：语义清晰，与 `WorkshopApplyService` 对称
- **不抽**：直接复用 `ServerManager.applyModChanges`，传 `modIds=[]`（File_IDs 不变），单独加一个 `ldmChanged: string[]` 参数

**推荐**：抽出 `LdmApplyService`（继承 80% `applyModChanges` 逻辑；公共部分提到 `ServerManager.applyChangesCore(serverId, { type: 'mod_apply' | 'ldm_apply', payload })`）。

> ⚠️ 此处抽象触发条件**恰好达到**（≥2 个模块：WorkshopApplyService + LdmApplyService 都跑同一套 PTY 重启流水线）—— **遵循 `backend-development.md` 模块抽象规范**「重复的数据库操作 ≥3 模块共用→新建共享模块」（差 1，先抽 base method 备好第三处）。

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
| 11 | WS | `ldm_apply_progress` | 重启进度事件 | — | 见 §6.4 | — |

### 6.2 Zod Schema（`shared/schemas/ldm.schema.ts`）

```typescript
import { z } from 'zod';

/** 已装插件描述 */
export const InstalledPluginSchema = z.object({
  name: z.string().min(1),
  version: z.string().nullable(),
  hasConfig: z.boolean(),
  enabled: z.boolean(),
  configPath: z.string(),
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
前端 toast「BetterEconomy 已加载」

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
- [ ] U3DS 启动后 stdout 命中 `Loaded plugin X.Y.Z` 在控制台可见
- [ ] 改配置 → 重启 → 新插件生效（PTY 终端 owner-trust 链路）
- [ ] 单实例改 LDM 不影响其他实例
- [ ] 没引入 `any`
- [ ] `.research/U3-SDK` 未动
- [ ] `unturned-sop.md` / `prohibitions.md` / `reference_ui_terms.md` / `reference_config_files.md §3` 同步更新
- [ ] §12 调研回填已完成（8 项，含子任务补充 #1b/#7，2026-08-12）；唯一遗留项 5（.dll 版本号读取方式）在 Phase B 实施时定

---

## 11. 实施阶段（按生产质量全量交付）

### Phase A：基础设施（共享类型）

| # | 任务 | 产出 |
|---|---|---|
| A1 | `shared/types/domain.ts` 加 `RocketConfig` / `RocketUnturnedConfig` / `PermissionsConfig` / `InstalledPlugin` / `LdmState` / `CommunityPlugin` 类型 | 6 类型 + JSDoc |
| A2 | `shared/schemas/ldm.schema.ts` | 9 个 Zod schema（§6.2） |
| A3 | `shared/contracts/ldm.ts` | 5 个接口（Discovery / ConfigWriter / Apply / PluginSource / PluginCommands） |
| A4 | `RocketConfigXmlParser.ts` 自写（保留注释/属性顺序/CDATA） | 解析/序列化 + 8 单测 |

### Phase B：核心模块

| # | 任务 | 产出 |
|---|---|---|
| B1 | `LdmDiscoveryService.ts` | 4 方法 + 单测（含 LDM 未装场景） |
| B2 | `LdmConfigWriter.ts` | 4 方法 + 单测（含写失败回滚） |
| B3 | `LdmApplyService.ts` | 走 ServerManager PTY 重启 + 抽 `applyChangesCore` 共用方法 |
| B4 | `LdmPluginCommandsService.ts` | PTY 写 /rocket load/unload/reload + 解析 stdout 插件状态 + 单测 |
| B5 | `LdmPluginSourceService.ts` | 拉取 LDM-Community 列表 + 本地缓存 + 单测 |

### Phase C：API 层

| # | 任务 | 产出 |
|---|---|---|
| C1 | `routes/ldm.ts` 新建 | 9 个 REST 端点（§6.1 #1–9）+ Zod 校验 + AppError |
| C2 | `composition-root.ts` 注入 5 新模块 | DI 容器 |
| C3 | WS 事件 `ldm_apply_progress` 注册 | IBroadcaster 联合类型 |

### Phase D：前端基础设施

| # | 任务 | 产出 |
|---|---|---|
| D1 | `<LdmPage>` 新建（4 Tab） | 路由 + 页面骨架 |
| D2 | `useLdmState(serverId)` hook | TanStack Query 包装 |
| D3 | `lib/utils.ts` 加 `formatPluginVersion` 等小工具 | 2 工具 |

### Phase E：前端 UI

| # | 任务 | 产出 |
|---|---|---|
| E1 | `LdmPage/InstalledTab.tsx` | 列表 + 加载/卸载按钮（/rocket 命令，不停服）+ 运行状态 |
| E2 | `LdmPage/FrameworkConfigTab.tsx` | 双卡片（Rocket.config.xml + Rocket.Unturned.config.xml）字段编辑器 + XML 高级视图 |
| E3 | `LdmPage/PermissionsTab.tsx` | Permissions.config.xml 树形编辑器 |
| E4 | `LdmPage/PluginConfigDialog.tsx` | 通用 XML 编辑器（`<插件名>.configuration.xml` 原文） |
| E5 | `LdmPage/PluginSourceTab.tsx` | LDM-Community 列表 + 外链 GitHub Releases + .dll 上传 |

### Phase F：联调与验证

| # | 任务 |
|---|---|
| F1 | typecheck 零错误（前后端 + shared） |
| F2 | 单测全绿（≥ 80% 行覆盖；RocketConfigXmlParser ≥ 8 用例） |
| F3 | E2E：加载插件（不停服）→ 改配置 → 应用 → 实例重启 → 列表刷新（mock Rocket/ 目录） |
| F4 | 文档更新：`unturned-sop.md` 加 LDM 章节；`reference_config_files.md §3` 加 Rocket.config.xml；`reference_ui_terms.md` 加「LDM → Mod 框架」对照 |
| F5 | 提交：3 个提交（Phase A-C 后端 / D-E 前端 / F 验证+文档） |

---

## 12. 调研回填记录（已完成）

**2026-08-12 调研 agent（deep-research + 子任务）已完成回填**——本节由「待回填」改为「回填记录」。

| # | 项 | 结论 | 真源 |
|---|---|---|---|
| 1 | Rocket.config.xml 完整字段表 | §2.4（16 字段：LanguageCode / MaxFrames / RCON 7 子字段 / AutomaticShutdown / WebPermissions / WebConfigurations）；**删** Economy/Instance/Logging 系列（老 RocketMod 残留） | LDM 仓 `Rocket.Core/Serialization/RocketSettings.cs` |
| 1b | Rocket.Unturned.config.xml | **子任务新发现独立文件**——§2.4b（AutomaticSave / CharacterNameValidation / LogSuspiciousPlayerMovement / Item/Vehicle Blacklist 9 字段） | `Rocket.Unturned/Serialisation/UnturnedSettings.cs` |
| 2 | LDM 控制台命令 | §2.7（13 命令：`/rocket` `/rocket plugins` `/rocket info` `/rocket load/unload/reload` `/modules` `/p reload` 等）；全局 `/rocket reload` 已禁用 | `Rocket.Unturned/Commands/CommandRocket.cs` + U3-SDK Issue #1794 |
| 3 | LDM Steam Workshop | **不上**——Workshop Asset Type 无 Plugin 类；走 GitHub Releases + LDM-Community | [Steam Workshop](https://steamcommunity.com/app/304930/workshop/) 实测 |
| 4 | Configuration.xml schema | **无统一标准**——面板做通用 Monaco XML 编辑器（不解析字段） | `Rocket.Core/Environment.cs` `PluginConfigurationFileTemplate = "{0}.configuration.xml"` |
| 5 | .dll 版本号读取方式 | **未定**——Phase B 实施时定（mono 调 / 读 AssemblyInfo）；`ModuleConfig.cs:65` 有 `Version` 字段可参考 | U3-SDK `Framework/Modules/ModuleConfig.cs` |
| 6 | LDM 启动日志格式 | U3DS stdout 含 `[LDM] Loaded plugin X.Y.Z`；前端 xterm.js 已实时渲染，**无需特殊解析**（ConsolePage 已接） | LDM 仓 `Module.cs:249` |
| 7 | 多实例隔离 | §8——`Environment.cs` 源码铁证：`RocketDirectory = "Servers/{0}/Rocket/"` + `U.Instance.InstanceId` | `Rocket.Core/Environment.cs` |

**遗留（不阻塞评审，阻塞实施 PR 的一部分）**：
- 项 5 `.dll` 版本号读取方式——Phase B 定，先读 U3-SDK `ModuleConfig.cs:65` `Version` 字段方案

---

*版本：v0.1 设计稿 · 2026-08-12*