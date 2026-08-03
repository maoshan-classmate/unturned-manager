# U3-SDK 实地认知笔记（2026-08-03）

> 本笔记仅做"读"的动作：不去编辑 U3-SDK，也不把 U3-SDK 文件夹的内容加进项目。  
> 用途：建立对官方仓库边界的清晰认识，避免后续把"客户端 Unity 工程"误当作"服务端 .NET 仓库"来研究 RCON / Workshop / Config。

## 仓库性质

`U3-SDK` 来自 `smartlydressedgames/u3-sdk` 的 GitHub 项目，对应一份 **Unity 客户端源码工程**：构建目标平台是 `Unturned` 客户端（Steam AppID `304930`，见 `U3-SDK/steam_appid.txt`），启动场景是 `Assets/GameStartup.unity`。  
Unity 版本：`2022.3.62f3`。

它 **不等于** Unturned 专用服务器源码。Unturned 专用服务器的二进制随游戏主分发（Linux 下载入口即 Steam 的 appid `1110390`，仍在调研中二次验证），自 3.26 起服务端已转向 .NET 8（脱离 Mono / Rocket 4 时代）。

## 哪些能力在 U3-SDK 里可以直接借鉴

下面这些都是客户端视角代码，但是能在 Web 面板的"协议层 / 配置层"问题里给我们提示。

### 1. Workshop 下载配置：`WorkshopDownloadConfig.cs`

- 文件路径：`Assets/Runtime/Assembly-CSharp/Unturned/Provider/WorkshopDownloadConfig.cs`（159 行）
- 关键字段：
  - `List<ulong> File_IDs`：要下载的 Workshop file ID（优先级最高）
  - `List<ulong> Ignore_Children_File_IDs`：作者把依赖当广告时，用来屏蔽子依赖
  - `uint Query_Cache_Max_Age_Seconds`（默认 600）
  - `uint Max_Query_Retries`（默认 2）
  - `bool Use_Cached_Downloads`（默认 true）
  - `bool Should_Monitor_Updates`（默认 true）—— 检测到更新会触发倒计时关服
  - `Shutdown_Update_Detected_Timer`（默认 600 秒）
  - `Shutdown_Update_Detected_Message` / `Shutdown_Kick_Message`
- 持久化：
  - 主文件：`/WorkshopDownloadConfig.json`（存在 Data 根目录，SerDe 走 `ServerSavedata.serializeJSON`）
  - 兼容旧格式：`/WorkshopDownloadIDs.json`（仅一个 file id 数组）

> **Web 面板产物 1**：面板写 mod 列表 → 调后端 API → 把修改反映到 `WorkshopDownloadConfig.json`（其实是 ID 数组 + 选项），下次 Serverded start 时自动生效；如果改了 `Should_Monitor_Updates` 这种运行期开关，需要 `shutdown` 通知玩家再热起。

### 2. 本地启用：`LocalWorkshopSettings.cs`

- 58 行；提供 `ILocalWorkshopSettings`，默认实现是 `LocalWorkshopSettingsImplementation`
- 提供 `getEnabled(fileId)` / `setEnabled(fileId, enabled)`，用 `ConvenientSavedata` 落到本地 key `Enabled_Workshop_Item_{fileId}`
- 关键认知：**"已下载"不等于"已启用"**，服务器端有"按 file id 启用 / 禁用"的能力
- **Web 面板产物 2**：可视化的"Mod 总览表"需要区分 `installed`（命中 Servers/<id>/Workshop/Content/）vs `enabled`（`LocalWorkshopSettings` 中的位）

### 3. 服务端连接参数：`ServerConnectParameters.cs`

- 字段：address / queryPort / connectionPort / steamId / password
- 重要提示：Steam 引入 Fake IP 后 connectionPort 和 queryPort 实际相同；面板做"端口暴露" 时要按"query port" 理解

### 4. Workshop 工具：`WorkshopUtils.cs` 与 `SteamworksWorkshopService.cs`

- `WorkshopUtils`：客户端/服务端安全调用 wrapper，根据 `Dedicator.IsDedicatedServer` 选择 `SteamGameServerUGC.*` 或 `SteamUGC.*`
- 拉取元数据：key/value tag、`m_bBanned`、cached query
- 这解释了为什么面板在做"Mod 信息预览"时如果想零网络跳，可以借助 `Steam GameServerUGC` API（前提是面板和 server 共享 token），否则只能走 Steam Web API

## 与本次任务直接相关的"边界提示"

1. **找不到 RCON 的实现代码**：U3-SDK 整个仓库 grep `rcon` 没有命中（仅 `editorconfig` 与 `Glazier` 等无关项）。说明 RCON 服务器端是私有二进制提供的，**Web 面板必须用网络协议交互**，不会得到 .NET 源码可抄。
2. **看不到 server.json 解析**：服务端在私有的 `Server.dll / Unturned-Server.runtimeconfig.json` 内。我们只能从官方 Wiki / 第三方 RconClient 学习字段定义。
3. **WorkshopDownloadConfig 是权威字段来源**：即便面板存的不是同一份文本，UI 上的 mod 表字段也得照搬它（File_IDs、Ignore_Children、cache max age、shutdown timer…）。

## 不必做的事

- 不必尝试编译 U3-SDK（其依赖 Unity 客户端二进制，建出来不是 server）  
- 不必读 Provider/UI/Sleek 这些 IMGUI / UIToolkit 代码（与服务端面板无关）  
- 不必读 Asset Bundle、Curve、Shader、NPC 等域（与服务端运维无关）
