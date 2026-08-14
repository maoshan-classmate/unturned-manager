# 调研报告：DST 管理平台 Mod 链路参考 + Unturned 落地映射

> **日期**：2026-08-08
> **调研对象**：`.research/dst-management-platform-api`（Don't Starve Together 管理平台，Go 实现，只读分析）
> **目的**：回答 4 问——DST 平台如何获取 Steam 创意工坊 Mod 信息 / 如何订阅下载 / 如何管理 / 如何配置，并把可借鉴模式映射为适合 Unturned 的能力建议（AppID：服务端 `1110390` / Workshop `304930`）
> **性质**：调研结论 + 落地建议（供人决策），**不含架构决策、不含实现**
> **置信度**：核心机制均读源码实证（高）；涉及 U3DS 实机的点为「待实机验证」

---

## 一、核心结论（TL;DR）

| 能力 | DST 方案 | 对 Unturned 的启示 | 可借鉴度 |
|---|---|---|---|
| **Mod 信息获取** | Steam WebAPI `IPublishedFileService/QueryFiles/v1` + `GetDetails/v1`，**必须带 WebAPI Key** | **直接解决本项目 `?xml=1` 失效问题**——放弃零凭证 XML，迁移到带 Key 的 JSON 接口 | ⭐⭐⭐ |
| **Mod 订阅下载** | SteamCMD `+workshop_download_item 322330 <id>` → 临时区 → 原子复制到游戏目录 → 维护 `appworkshop_*.acf` 清单 | 下载命令换成 AppID **`304930`**（游戏本体，非服务端 `1110390`——2026-08-11 实机教训）；「临时区+原子移动+acf 维护+失败回滚」模式可整体借鉴 | ⭐⭐⭐ |
| **Mod 管理** | 「目录扫描 + acf 解析 + WebAPI 元数据合并」三源合一展示已下载/已启用 | 模式通用，字段与路径按 U3DS 语义替换 | ⭐⭐⭐ |
| **Mod 配置** | 读 mod 自带 `modinfo.lua`（声明 schema）→ 弹窗表单 → 写 `modoverrides.lua` | **Unturned 无此机制**——必须改为「LDM 插件配置」（`Servers/<ID>/Rocket/Plugins/<Name>/<Name>.configuration.xml`，XML），不能照搬弹窗 | ⭐（模式）+⚠️ 差异化 |

**一句话**：DST 平台是把「Steam 官方 WebAPI（元数据）+ SteamCMD（下载）+ acf 清单（状态）+ 游戏配置文件（启用/配置）」串成完整闭环。Unturned 的对应物是 `WorkshopDownloadConfig.json` + `Servers/<ID>/Workshop/` + `appworkshop_304930.acf`，前三条可直接映射，第四条（mod 配置）语义不同需改造。

> **⚠️ 2026-08-11 修正**：原建议「下载命令换成 AppID `1110390`」**已推翻**——实机测试证实
> `1110390`（服务端工具）名下无 workshop，`workshop_download_item`、content 目录、acf 清单必须用
> `304930`（游戏本体）。AppID 全局唯一真源现定义在 `shared/constants.ts`（`STEAM_APP_IDS`）。

---

## 二、DMP 的 Mod 信息获取（证据）

### 2.1 接口常量

`utils/constants.go:37-41`：
```go
SteamApiModSearch = "http://api.steampowered.com/IPublishedFileService/QueryFiles/v1/"
SteamApiModDetail = "http://api.steampowered.com/IPublishedFileService/GetDetails/v1/"
```

- **搜索**：`QueryFiles/v1`（`app/mod/utils.go:88-164`）
  - 参数：`appid=322330`、`requiredtags[0]=server_only_mod`、`requiredtags[1]=all_clients_require_mod`、`match_all_tags=false`、`return_vote_data=true`、`language`、`key`（WebAPI Key）、`page`、`numperpage`、`search_text`
  - 返回：`publishedfiledetails[]`，字段含 `publishedfileid / title / file_size / file_url / preview_url / file_description / tags / vote_data(score,votes_up,votes_down) / time_created / time_updated / subscriptions`
- **详情**：`GetDetails/v1`（`app/mod/utils.go:166-228`）
  - 参数：`publishedfileids[0]=<id>`、`key`、`language`（支持批量 `publishedfileids[i]`）
- **批量补齐已下载列表**：`addDownloadedModInfo()`（`app/mod/utils.go:230-288`）——对本地已下载 mod ID 列表**批量** `publishedfileids[i]` 拉取元数据补全展示

### 2.2 关键点

- **WebAPI Key 是硬依赖**：`utils.GetSteamApiKey()` 从全局设置读取，两个接口都带 `key` 参数，需以最新实证（`?xml=1` 已返回 HTML）为准——见 §5。
- **AppID 用 `322330` 过滤**，且用 `requiredtags` 只搜服务端 mod（`server_only_mod` / `all_clients_require_mod`），避免把客户端 mod 混进来。

---

## 三、DMP 的 Mod 订阅/下载（证据）

`dst/mod.go:71-162` `downloadMod(id, fileURL)`，分两类：

### 3.1 UGC mod（Steam Workshop 下载，主路径）

`generateModDownloadCmd()`（`dst/mod.go:164-166`）：
```bash
steamcmd/steamcmd.sh +force_install_dir <dmp_files>/mods/ugc/<cluster>
  +login anonymous +workshop_download_item 322330 <id> +quit
```

三步流程（`dst/mod.go:87-149`）：
1. **下载到临时区**：`<dmp_files>/mods/ugc/<cluster>/steamapps/workshop/content/322330/<id>`
2. **原子复制到游戏目录**：`removeGameOldMod()` 删旧 + `generateModCopyCmd()` 生成 `cp -r` 复制到每个世界的 `dst/ugc_mods/<cluster>/<world>/content/322330/<id>`
3. **维护 acf 清单**：`processAcf()`（`dst/mod.go:200-260`）解析下载区 `appworkshop_322330.acf`，取该 mod 的 `WorkshopItemsInstalled` 节点，合并进游戏侧 `dst/ugc_mods/.../appworkshop_322330.acf`；**任一步失败 → 恢复旧 acf 回滚**

并发控制：`atomic.AddInt32(&db.ModDownloadExecuting, 1)` + `modAcfMutex`（`dst/mod.go:72-75`）。

### 3.2 非 UGC mod（外部 URL，cdn.steamusercontent.com 的 zip）

`downloadNotUGCMod(fileURL, id)`：下载 zip → 解压到 `dst/mods/workshop-<id>`（本地非 Workshop mod）。`checkNotUgcUrl()`（`app/mod/utils.go:314-329`）校验 URL 是否属于 `cdn.steamusercontent.com` 的 7 段路径。

### 3.3 acf 文件解析器

`utils/acf.go` 是通用 VDF/ACF 解析器（Node 树：`AppWorkshop → WorkshopItemsInstalled → <id> → {size, ...}`）：
- `ListWorkshopItemsInstalled()`（:206）—— 列出全部已下载项
- `GetWorkshopItemsInstalled(id)`（:131）/ `AddWorkshopItemsInstalled(node)`（:151）/ `RemoveWorkshopItemsInstalled(id)`（:185）—— 增删查
- `Format()`（:225）—— 序列化回 acf 文件

---

## 四、DMP 的 Mod 管理与配置（证据）

### 4.1 管理（`dst/mod.go`）

- **已下载列表** `getDownloadedMods()`（:271-320）：
  - 非 UGC：扫 `dst/mods/workshop-*` 目录
  - UGC：解析游戏侧 acf `ListWorkshopItemsInstalled()`
  - 结果与 WebAPI 元数据合并（`addDownloadedModInfo`）展示
- **启用** `modEnable()`（:395）：从 `modinfo.lua` 读配置 schema → 默认值填入 `modoverrides.lua` 的 `workshop-<id>` 节点 → `saveMods()` 写盘
- **禁用** `modDisable()`（:583）：从 `modoverrides.lua` 删 `workshop-<id>` 键
- **删除** `deleteMod()`（:632）：acf 删项 + 删游戏目录内容
- **已启用列表** `getEnabledMods()`（:536）：解析 `modoverrides.lua` 的键前缀 `workshop-`

### 4.2 配置（`dst/mod.go`）

- **声明文件** `modsettings.lua`：`dsModsSetup()`（:20-69）从 DB `ModData`（Lua 表）生成 `ServerModSetup("<workshop-id>")` 行
- **配置 schema 来源** `getModConfigureOptions()`（:322-358）：解析已下载 mod 自带的 **`modinfo.lua`**（`NewModInfoParser`）→ 得到 `[]ConfigurationOption{Name, Default, Description, Options}`
- **当前值来源** `getModConfigureOptionsValues()`（:360-392）：解析 **`modoverrides.lua`** → 该 mod 的当前配置值
- **写配置** `modConfigureOptionsValuesChange()`（:491）：改 `modoverrides.lua` 对应节点 → `saveMods()`
- 前端交互：读 schema 渲染表单（开关/下拉/文本），提交后写回 `modoverrides.lua`

### 4.3 调度（`scheduler/global.go:253-260`）

`ModDownloadClean()`：若当前无下载在跑（`ModDownloadExecuting==0`），定期清空临时下载区 `mods/ugc`——防磁盘堆积。

---

## 五、Unturned 落地映射

### 5.1 先决问题：Steam `?xml=1` 已失效

旧假设「`?xml=1` 零凭证获取元数据」已被否定，`runtime-audit` 实测 3 个 Mod ID 全部返回 **HTML**（46KB 网页，`<title>Steam Community :: Screenshot</title>`），`parseXml` 恒 null → `GET /workshop/mods/:fileId` 恒 404。

**DMP 的做法（带 Key 的 `IPublishedFileService`）是权威替代方案**，且提供搜索（`QueryFiles`）+ 详情（`GetDetails`）+ 批量补齐三个我们需要的接口形态。**建议把 `unturned-sop.md` 的「零凭证 XML」条目作废，迁移到 WebAPI Key 方案**（WebAPI Key 由用户在自己的 Steam 账号 `steamcommunity.com/dev/apikey` 免费申请）。

### 5.2 逐能力映射表

| DMP 能力 | DMP 实现 | Unturned 落地建议 | 借鉴程度 |
|---|---|---|---|
| 元数据搜索 | `QueryFiles/v1` + requiredtags | 替换现有本地 LIKE `searchMods`；Unturned 无官方 mod tag，可先不做 requiredtags 过滤 | ⭐⭐⭐ |
| 元数据详情 | `GetDetails/v1`（批量） | 替换 `getModDetails` 的 XML 解析；补批量端点供已下载列表补全 | ⭐⭐⭐ |
| 下载 | SteamCMD `workshop_download_item 322330` 临时区+复制 | 改 AppID **`304930`**（游戏本体，非服务端 `1110390`——2026-08-11 实机修正），**下载到 staging 不停服；应用（移动进 content + 改 File_IDs）必须重启**（见 §5.3 修正，已落盘 `unturned-sop.md`） | ⭐⭐ |
| 已下载状态 | 目录扫描 + `appworkshop_322330.acf` 解析 | 目录 `Servers/<ID>/Workshop/Steam/content/304930/*` + `Workshop/Steam/appworkshop_304930.acf`；acf 解析器可移植（Node 需 VDF 解析库或自写） | ⭐⭐⭐ |
| 启用/禁用 | `modoverrides.lua` 键增删 | `WorkshopDownloadConfig.json` 的 `File_IDs` 增删（面板只写 `File_IDs`，其余只读，已有 `writeWorkshopFileIds`） | ⭐⭐（机制对应，文件不同） |
| mod 配置 | `modinfo.lua` schema → `modoverrides.lua` | **Unturned 无对应物** → 改为「LDM 插件 Configuration.xml」编辑（ConfigService 原子写支持，LDM 接入后前端补 Mod 框架页） | ⚠️ 差异化 |
| 并发控制 | `atomic` 计数器 + mutex | 复用本项目 `activeOperation` 竞态门控 | ⭐ |
| 临时区清理 | scheduler `ModDownloadClean` | 可选：SteamCMD staging 目录清理任务 | ⭐ |
| WebAPI Key 配置 | 全局设置存 Key | 面板 Settings 加「Steam WebAPI Key」配置项 | ⭐⭐⭐ |

### 5.3 必须变体 / 不能照搬

| DMP 做法 | 为什么不能照搬 | Unturned 应做的 |
|---|---|---|
| **下载不停服**（临时区+移动） | **部分成立（已修正）**。DST 游戏运行时扫 mod 目录 → 下载完移动即热生效；Unturned 无热加载，但下载到 staging 可不停服（U3DS 只 mount `content/304930/`，不扫 staging），**应用（移动进 content + 改 File_IDs）必须重启** | **可借鉴**：SteamCMD 下载到 `Workshop/staging/`（不停服）→ 重启流水线内移动进 `content/304930/` 生效。validate / 更新已加载 mod / 更新二进制仍停服。**已落盘到 `unturned-sop.md` §Workshop 内容下载 + `architecture-spec.md` §1.4** |
| **mod 配置弹窗**（modinfo.lua） | Unturned Workshop mod 无 modinfo.lua / modoverrides.lua 机制 | 不做 mod 配置弹窗；「配置」落在插件层（LDM），或 WorkshopDownloadConfig.json 的只读字段展示 |
| **每世界独立 mod 配置**（ModInOne 分支） | Unturned 是每 ServerID 一份 WorkshopDownloadConfig.json，无「世界」层级 | 保持每 ServerID 一份 |
| **screen 进程管理 / Lua 注入防护** | 技术栈不同 | 保持 ProcessSupervisor spawn `ServerHelper.sh`；配置格式为 JSON/YAML，无 Lua 注入面 |

### 5.4 落地建议清单（供架构决策，非本报告结论）

1. **WorkshopMetadataService 改造**（P1）：`getModDetails` 从 XML 解析改为 `GetDetails/v1`（带 Key）；`searchMods` 从本地 LIKE 改为 `QueryFiles/v1`；新增批量详情端点供已下载列表补全。Key 从 Settings 配置，DB 加密存储（复用 CryptoBox 方案）。
2. **SteamCmdManager 补全**（P1）：`updateU3DS` 外增加 `downloadWorkshopItem(serverId, itemId)`，spawn `steamcmd +workshop_download_item 304930 <id>`，写入前校验 STOPPED，进度走 `steamcmd_progress` 事件。（⚠️ 2026-08-11 修正：必须是 `304930` 游戏本体，非 `1110390` 服务端工具。）
3. **acf 解析器**（P2）：`appworkshop_304930.acf` 用于「已下载 Mod 清单」与「孤儿清理」，弥补目录扫描在 validate 后信息不全的问题。（⚠️ 2026-08-11 修正：`304930`=游戏本体，非 `1110390`。）
4. **Mod 页状态模型**：`已下载 = Workshop/ 目录 ∩ acf`，`已启用 = WorkshopDownloadConfig.json File_IDs`，展示信息 = WebAPI 合并——三源合一，对应 DMP 的 `getDownloadedMods`。
5. **不改动**：`WorkshopDownloadConfig.json` 写权限保持只写 `File_IDs`（SOP 铁律）；mod 配置弹窗不引入。

---

## 六、参考文件索引（证据位置）

| 内容 | 文件 |
|---|---|
| 元数据搜索/详情接口 | `.research/dst-management-platform-api/app/mod/utils.go:88-288` |
| WebAPI 常量 | `.research/dst-management-platform-api/utils/constants.go:37-41` |
| UGC 下载三步（临时区/复制/acf） | `.research/dst-management-platform-api/dst/mod.go:71-260` |
| acf VDF 解析器 | `.research/dst-management-platform-api/utils/acf.go` |
| mod 启用/禁用/删除 | `.research/dst-management-platform-api/dst/mod.go:395-686` |
| mod 配置（modinfo→modoverrides） | `.research/dst-management-platform-api/dst/mod.go:322-534` |
| 临时区清理调度 | `.research/dst-management-platform-api/scheduler/global.go:253-260` |
| 项目架构（Go/Gin/GORM/SQLite） | `.research/dst-management-platform-api/CLAUDE.md` |

---

## 七、待确认项

| # | 事项 | 影响 | 验证方法 |
|---|---|---|---|
| 1 | `appworkshop_304930.acf` 是否由 SteamCMD 下载 Workshop 内容时自动生成、格式是否与 DST 一致 | acf 方案是否成立 | ✅ 已确认：`workshop_download_item 304930 <id>`（非 `1110390`）后自动生成，格式一致 |
| 2 | U3DS 是否消费 `Workshop/Steam/appworkshop_304930.acf`（校验/清理孤儿） | 面板是否需要自己维护 acf | U3-SDK `WorkshopDownloadConfig.cs` 上下文 + 实机观察 |
| 3 | Unturned Workshop mod 是否有统一元数据字段（如 GameMode）供 `requiredtags` 过滤 | 搜索过滤策略 | WebAPI Key 申请后实测 `QueryFiles` 返回 |
| 4 | WebAPI Key 方案在国内网络稳定性 | 是否需降级缓存 | 实机多 Mod 拉取测试 |

---

*本报告为调研产出，仅提供事实与建议；后续架构决策请在 `/sc:design` 完成，实现在 `/sc:implement` 完成。*
