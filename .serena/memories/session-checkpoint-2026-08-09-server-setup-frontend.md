## 会话要点：ServerSetup 创建/删除闭环（纯前端阶段 → 后端目录真源落地）

### 演进过程
- **第一阶段（纯前端本地效果）**：`CreateServerDialog`/`ServerSetupPage` 先做纯本地 UI 闭环（`addServer`/`removeServer` 只改本地列表，不调后端）——用户明确要求「先只做前端，后端后续再实现」
- **第二阶段（后端落地）**：commit `0738065` 接通真实链路——前端 `addServer` 调 `POST /servers`、`removeServer` 调 `DELETE /servers/:id`，成功后 `refresh()` 重拉

### 后端现状（目录真源，ADR-0003 B2）
- `ServerManager.listServers` 启动时 `loadServersFromDisk()` 扫描 `Servers/` 目录（`Commands.dat` 存在性 = 实例成立）→ 内存 Map，**不读 SQLite**
- `createServer` 建 `Servers/<id>/Server/Commands.dat` + RCON 凭证落 settings K-V（AES-GCM）；重复创建 409 `server-exists`；`installDir` 一律取全局，忽略客户端传入值
- `removeServer` 停服（若运行中）→ `fs.rm` 删目录 → 清凭证 → 注销 RCON/A2S
- `DELETE /servers/:id` 挂 `validate(DeleteServerSchema, 'params')`（shared schema 新增 `DeleteServerSchema`）；servers router 在 `index.ts` 先于 files router 挂载，不会被 `DELETE /:id` 抢匹配

### useServer 去轮询（保留）
- 5s 轮询已移除 → 挂载拉一次 + 手动 `refresh`；增删后 `addServer`/`removeServer` 内部 `refresh()`
- 状态(state)实时变化将来走 WebSocket 推送（后端 `ServerManager.onStateChange`），不走轮询

### 验证证据（2026-08-09）
- 全仓 `tsc --noEmit` 三仓零错误
- e2e 新增 T7「创建→删除实例真链路（后端目录真源）」：唯一 ServerID → 侧栏出现 → 删除 → 消失；全量冒烟 **10/10 绿**，`.test-install/Servers/` 无 `e2e-cd-*` 残留（删除环节确凿清目录）

### 其他变更
- toast 位置：`components/ui/sonner.tsx` `bottom-right` → `top-center`
- 创建弹窗新增 OpenMod RCON 凭证字段（ADR-17 双协议分离，`SteamID:密码` 格式）
