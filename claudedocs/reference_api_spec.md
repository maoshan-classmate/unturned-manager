# API 契约规格 · 后端端点 ↔ 前端页面功能映射

> **文档类型**：活参考文档（reference）
> **状态**：基于 2026-08-08 源码审计，非记忆推断
> **审计方法**：读前端全部 `apiClient.*` 调用点 + 后端全部路由文件逐一对照
> **配套**：后端补全路线见本文件 §7；失效 SOP 见 `research_verification_tracker.md`

---

## 1. 前端页面清单（10 个）

| 页面 | 文件 | 核心功能 | 消费的 API 域 |
|---|---|---|---|
| Login | `pages/LoginPage.tsx` | 登录表单 | auth |
| Dashboard | `pages/DashboardPage.tsx` | StatCard×4 + 启停重启 | servers + WS state_change |
| Console | `pages/ConsolePage.tsx` | 实时控制台 | servers/execute + WS console_line |
| Mods | `pages/ModsPage.tsx` | Mod 卡片 + 添加 + 应用变更 | config/workshop + workshop/mods |
| Players | `pages/PlayersPage.tsx` | 玩家表格 + 踢/封 | **rcon/execute（断裂，见 §5）** |
| Config | `pages/ConfigPage.tsx` | Commands/Txt/Workshop 三 Tab 编辑器 | config/* |
| Files | `pages/FilesPage.tsx` | 文件浏览/上传/新建/删除/重命名 | servers/:id (files 域) |
| ServerSetup | `pages/ServerSetupPage.tsx` | 实例管理 + SteamCMD 状态/更新 | servers + steamcmd |
| Settings | `pages/SettingsPage.tsx` | 5 张卡片（账户/安全/网页/日志/默认值） | 目前**无真实 API 调用** |
| Permissions | `pages/`（路由重定向到 Files） | 占位 | — |

---

## 2. API 端点总表

> 图例：✅ 可用 · ⚠️ 有缺陷 · ❌ 断裂/未实现 · 🆕 缺失（需新增）

### 2.1 认证 `/api/auth`

| 方法 | 路径 | 后端 handler | Zod | 前端消费点 | 状态 |
|---|---|---|---|---|---|
| POST | `/login` | `AuthService.login` | 无 | `AuthContext` login 按钮 | ✅ |
| POST | `/refresh` | `AuthService.refresh` | 无 | `client.ts` 401 拦截 + `AuthContext` session 恢复 | ✅ |
| POST | `/logout` | `AuthService.logout` | 无 | `AuthContext` 退出按钮 | ✅ |

### 2.2 服务器 `/api/servers`

| 方法 | 路径 | 后端 handler | Zod | 前端消费点 | 状态 |
|---|---|---|---|---|---|
| GET | `/` | `ServerManager.listServers` | — | `useServer` 挂载拉一次 + 手动 refresh（已去轮询，状态实时待 WS 推送） | ✅ |
| POST | `/` | `ServerManager.createServer` | ❌ 无 | **前端当前不调用**——创建/删除改为纯本地 UI 效果（`useServer.addServer`/`removeServer`），待后端实现目录扫描/创建/删除后接通 | ⚠️ 脏数据直入库 |
| PATCH | `/:id` | `ServerManager.configureServer` | ❌ 无 | **前端无调用点** | ⚠️ 僵尸端点 |
| POST | `/:id/start` | `ServerManager.start` | — | `useServerActions.start`（Dashboard/ServerSetup） | ⚠️ A2S bug 必失败 |
| POST | `/:id/stop` | `ServerManager.stop` | — | `useServerActions.stop` | ⚠️ RCON 不可达时无 SIGTERM |
| POST | `/:id/restart` | `ServerManager.restart` | — | `useServerActions.restart` | ✅ 逻辑完整 |
| POST | `/:id/execute` | `rcon.ts` RCON 执行 | ❌ 手写内联 | `useConsole.sendCommand` | ✅ 路径匹配 |

### 2.3 Mod `/api/servers`

| 方法 | 路径 | 后端 handler | Zod | 前端消费点 | 状态 |
|---|---|---|---|---|---|
| POST | `/:id/mods/apply` | `ServerManager.applyModChanges` | ❌ 仅 Array.isArray | `ConfigPage`「应用变更」（:182） | ✅ apply 流水线已接线（Sprint 2） |

### 2.4 配置文件 `/api/servers`

| 方法 | 路径 | 后端 handler | Zod | 前端消费点 | 状态 |
|---|---|---|---|---|---|
| GET | `/:id/config/commands` | `ConfigService.readCommandsDat` | — | `ConfigPage` Commands Tab | ⚠️ Map 序列化→`{}`，前端读空 |
| PUT | `/:id/config/commands` | `ConfigService.writeCommandsDat` | ❌ 未消费 | `ConfigPage` 保存 Commands | ❌ 前端传对象→后端 `for...of` 抛错→500 |
| GET | `/:id/config/txt` | `ConfigService.readConfigTxt` | — | `ConfigPage` Txt Tab | ❌ 后端数组 vs 前端 map，永远默认值 |
| PUT | `/:id/config/txt` | `ConfigService.writeConfigTxt` | ❌ 未消费 | `ConfigPage` 保存 Txt | ❌ 契约不一致 |
| GET | `/:id/config/workshop` | `ConfigService.readWorkshopConfig` | — | `ModsPage`/`ConfigPage` Workshop | ✅ |
| PUT | `/:id/config/workshop` | `ConfigService.writeWorkshopFileIds` | ✅ `WriteWorkshopFileIdsSchema` | `ModsPage` 应用/`ConfigPage` 保存 | ⚠️ schema 写了但路由未消费 |

### 2.5 文件 `/api/servers`（files 域）

| 方法 | 路径 | 后端 handler | Zod | 前端消费点 | 状态 |
|---|---|---|---|---|---|
| GET | `/:id` | `FilesService.listDirectory` | ❌ query 未校验 | `FilesPage` 文件列表 | ✅ |
| GET | `/:id/content` | `FilesService.readFile` | ❌ | `FilesPage` 读文件（alert 前 2000 字） | ✅ 文本可用 |
| POST | `/:id/upload` | `FilesService.writeFile` | ❌ | `FilesPage` 上传 | ⚠️ TextEncoder 破坏二进制 |
| POST | `/:id/mkdir` | `FilesService.createDirectory` | ❌ | `FilesPage` 新建文件夹 | ✅ |
| DELETE | `/:id` | `FilesService.deleteEntry` | ❌ | `FilesPage` 右键删除 | ✅ |
| PUT | `/:id/rename` | `FilesService.renameEntry` | ❌ | `FilesPage` 右键重命名 | ✅ |

### 2.6 RCON 独立端点

| 方法 | 路径 | 后端 handler | 前端消费点 | 状态 |
|---|---|---|---|---|
| POST | `/:id/rcon/execute` | — | `PlayersPage`（Players 命令 + Kick/Ban） | ❌ **后端无此路由 → 404** |

### 2.7 Workshop `/api/workshop`

| 方法 | 路径 | 后端 handler | Zod | 前端消费点 | 状态 |
|---|---|---|---|---|---|
| GET | `/mods/:fileId` | `WorkshopMetadataService.getModDetails` | — | `ModsPage` 添加 Mod 拉元数据 | ✅ C6 已修复（IPublishedFileService/GetDetails，需 WebAPI Key） |

### 2.8 SteamCMD `/api/steamcmd`

| 方法 | 路径 | 后端 handler | Zod | 前端消费点 | 状态 |
|---|---|---|---|---|---|
| GET | `/status` | `SteamCmdManager.getStatus` | — | `ServerSetupPage` SteamCMD 状态 | ⚠️ 本地路径检查，Linux 路径下恒 false |
| POST | `/update` | `SteamCmdManager.updateU3DS` | ❌ 仅 typeof | `ServerSetupPage`「更新 U3DS」 | ❌ 不 spawn 但返回 202（撒谎） |

### 2.9 LDM Mod 框架 Phase 1（2026-08-13 落地）

| 方法 | 路径 | 现状 | 说明 |
|---|---|---|---|
| GET | `/api/servers/:id/ldm/installed` | ✅ Phase 1 | 列已装插件（LDM 激活检测 + 插件目录扫描 + PE 元数据） |
| POST | `/api/servers/:id/ldm/load-plugin` | ✅ Phase 1 | PTY 写 `/rocket load <name>`，10s 超时 |
| POST | `/api/servers/:id/ldm/unload-plugin` | ✅ Phase 1 | PTY 写 `/rocket unload <name>`，10s 超时 |
| GET | `/api/ldm/community-plugins` | ✅ Phase 1 | LDM-Community 列表 + GitHub 元数据补全，5min 缓存 |
| POST | `/api/ldm/community-plugins/test-pat` | ✅ Phase 1 | 测试 GitHub PAT（X-Github-Pat header 传入） |

**真实数据形态**：`InstalledPlugin` 6 字段（name/version/sizeBytes/hasConfig/modifiedAtIso/runtimeStatus）；runtimeStatus 5 值（loaded/unloaded/failure/cancelled/unknown）；`CommunityPlugin` 7 字段（slug/name/author/description/repoUrl/latestVersion/updatedAtIso）。

**前端入口**：左侧导航「Mod 框架」→ `/<serverId>/ldm`（LdmPage.tsx）。PAT 走 localStorage 兜底，不进后端。

### 2.10 WebSocket `/ws`

| 事件 | 消费方 | 现状 |
|---|---|---|
| `state_change` | Dashboard StatCard | ✅ 后端已发，但前端订阅空收不到 |
| `console_line` | ConsolePage `useConsole` | ✅ 后端 LogStreamer 有，但 startStreaming 未接线 + 订阅空 |
| `rcon_status` / `player_join` / `player_leave` / `mod_apply_progress` / `steamcmd_progress` / `file_changed` | — | 契约已定义，后端未广播 |

---

## 3. 前端页面 → 功能 → API 映射（反查表）

| 页面 | 功能按钮/交互 | 调用端点 | 当前是否可用 |
|---|---|---|---|
| **Login** | 登录提交 | `POST /auth/login` | ✅ |
| **Dashboard** | 启动 / 停止 / 重启 | `POST /servers/:id/{start,stop,restart}` | ⚠️ start 因 A2S bug 必失败 |
| **Dashboard** | 状态轮询 | `GET /servers` + WS `state_change` | ⚠️ 轮询可用，WS 收不到 |
| **Console** | 发送命令 | `POST /servers/:id/execute` | ✅（依赖 RCON 凭证链，重启即丢） |
| **Console** | 实时输出 | WS `console_line` | ❌ 订阅空 + LogStreamer 未启动 |
| **Mods** | 添加 Mod | `GET /workshop/mods/:fileId` | ❌ 恒 404（Steam HTML） |
| **Mods** | 应用变更 | `PUT /servers/:id/config/workshop` | ⚠️ 只写文件，**不触发重启流水线** |
| **Mods** | 应用变更后重启 | `POST /servers/:id/apply` | ❌ 前端根本没调 |
| **Players** | 玩家列表 | `POST /servers/:id/rcon/execute` | ❌ 404（路由名不符） |
| **Players** | 踢 / 封禁 | 同上 | ❌ 404 |
| **Config·Commands** | 读取 | `GET /servers/:id/config/commands` | ⚠️ 读到 `{}` |
| **Config·Commands** | 保存 | `PUT /servers/:id/config/commands` | ❌ 500 |
| **Config·Txt** | 读取 | `GET /servers/:id/config/txt` | ❌ 永远默认值 |
| **Config·Txt** | 保存 | `PUT /servers/:id/config/txt` | ❌ 契约不匹配 |
| **Config·Workshop** | 读取 / 保存 | `GET/PUT /servers/:id/config/workshop` | ✅ |
| **Files** | 列表 / 读 / 上传 / 新建 / 删除 / 重命名 | `GET /:id` `GET /:id/content` `POST /:id/upload` `POST /:id/mkdir` `DELETE /:id` `PUT /:id/rename` | ⚠️ 上传二进制破坏，其余可用 |
| **ServerSetup** | 创建实例 | `POST /servers` | ⚠️ 无校验；**前端当前纯本地效果，不调用** |
| **ServerSetup** | SteamCMD 状态 | `GET /steamcmd/status` | ⚠️ |
| **ServerSetup** | 更新 U3DS | `POST /steamcmd/update` | ❌ 假成功 |
| **Settings** | 5 张卡片 | — | ⚠️ 无后端支撑，纯静态 |

---

## 4. WS 事件契约（后端已定义，前端待接通）

前端必须在 WS 连接建立后发送订阅消息（当前未实现）：

```json
{ "type": "subscribe", "serverIds": ["MyServer"] }
```

后端 `gateway.ts` 当前 `register()` 零调用点 + 无 `message` 处理器 → 订阅集合永远为空。修复方案：`ws.on('message')` 解析该消息并调 `register`。

**安全缺陷**：前端 `WebSocketContext.tsx:28` 与 `useConsole.ts:42` 用 **refreshToken** 作 WS token；后端 `gateway.ts:25` 用 `validateAccessToken` 校验。同 secret 恰好放行，但长效 token 进 URL 属泄露风险——改为 accessToken。

---

## 5. 已证实的契约断裂清单（前端 ↔ 后端）

| # | 断裂 | 证据 | 后果 | 修复方向 |
|---|---|---|---|---|
| C1 | PlayersPage 调 `/servers/:id/rcon/execute`，后端只挂 `/execute` | `rcon.ts:89`(`/execute`) + `:94`(`/rcon/execute` 别名) | ~~玩家页 404~~ ✅ 已修复 | Phase 0 已补别名 |
| C2 | Config.txt 契约：后端 `sections: ConfigSection[]`（数组），前端当 map（`sections['浏览器']`）用 | `ConfigPage.tsx:106` vs `domain.ts:21-36` | 前端永远读默认值 | 统一为 map：`Record<sectionName, Record<key, value>>` 或前端改数组遍历 |
| C3 | Commands.dat 写：前端传普通对象，后端 `serializeCommandsDat` 对 `record.known` 做 `for...of` | `ConfigPage.tsx:141` vs `ConfigService.ts:198` | 保存必 500 | `domain.ts` 改 `Record<string,string>` |
| C4 | Commands.dat 读：后端返回 Map → `JSON.stringify` 成 `{}` | `routes/config.ts:12` vs `ConfigPage.tsx:93-96` | 前端读空 | 同 C3，路由层 `Object.fromEntries` |
| C5 | 前端"应用变更"从不调 `POST /:id/apply` | `ModsPage.tsx:96` | apply 流水线永不触发 | ModsPage 改调 `POST /servers/:id/apply`，进度走 WS |
| C6 | Steam `?xml=1` 返回 HTML 非 XML | 实测 3 个 Mod ID 全部 HTML | `GET /workshop/mods/:fileId` 恒 404 | ✅ 已落地：IPublishedFileService/GetDetails + QueryFiles（需 WebAPI Key） |
| C7 | 上传二进制经 `TextEncoder` 破坏 | `FilesPage.tsx:186`(base64) → `files.ts:44` | `.unity3d` 无法上传 | `createUploadStream` 分块 + Buffer |
| C8 | WS 无订阅协议 | `gateway.ts:40,60` + 前端从不发消息 | 实时功能全哑 | 补 subscribe 协议 + 前端发消息 |

---

## 6. 后端补全路线（Phase 0–4，见会话设计）

| Phase | 目标 | 关键项 |
|---|---|---|
| 0 | 主干修复（可运行门禁） | A2S API 修正、Commands.dat 契约、WS 订阅 + LogStreamer 接线、AppError/asyncHandler/Zod 落地 |
| 1 | RCON 凭证闭环 | CryptoBox AES-GCM、迁移 003、createServer/load 解密注册 |
| 2 | Mod apply 流水线 | ModChangeApplier、mod_apply_* 事件、routes/mods.ts Zod |
| 3 | SteamCMD + Workshop 重调研 | updateU3DS 真 spawn、Steam XML 失效→新 SOP |
| 4 | 测试与部署基线 | vitest 配置、录制回放、docker-compose.yml + Dockerfile |

**新增端点**（前端已在用/将用，后端缺失）：
- `GET /api/servers/:id/players` — PlayersPage 玩家列表（替代 RCON 文本 hack）✅ 已实现（`routes/players.ts:57`，`PlayersPage.tsx:46` 调用）
- `GET /api/servers/:id/download?path=` — Files 二进制下载
- `GET /api/audit-logs` — Settings 系统日志 ✅ 已实现（`index.ts:104` 挂载）
- `GET/PUT /api/servers/:id/config/openmod/:pluginId`、`/rocket/:pluginName`、`/lists/:type` — Sprint 4

---

## 7. 验收清单（每端点的 DoD）

- [ ] `tsc --noEmit` 通过（**不再作为可运行证据**，需冒烟测试）
- [ ] Zod schema 消费：每个 POST/PUT/PATCH 挂 `validate()`
- [ ] 冒烟：后端 + 假 U3DS + 假 A2S，跑通 `start → console_line → stop`
- [ ] 前端每个按钮/表格有对应端点的契约测试（supertest）
- [ ] 参考文档同步：本文档 + `reference_config_files.md` + `reference_console_commands.md`
- [ ] RCON 用录制回放测试，不连真服

---

*最近修订：2026-08-08 · 依据源码审计建立 · 维护：每改一个路由或页面调用点必须同步本文档*
