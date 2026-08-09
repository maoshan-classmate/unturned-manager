## 会话要点：ServerSetup 前端创建/删除纯本地效果 + useServer 去轮询

### 前端创建/删除改纯本地（不动后端）
- 创建：`CreateServerDialog` 提交后构造 `ServerInfo` 经 `onCreated` 回传 → `useServer.addServer` 本地列表加一条 + toast「已创建」；**不调 POST /servers、不写 DB**
- 删除：`ServerSetupPage.handleDelete` 经 `removeServer` 本地移除 + toast「已删除」+ 删除当前实例自动跳转下一实例；**不调 DELETE /servers/:id、不写 DB**
- 后端实现「目录扫描 + 创建/删除 Servers/<id> 目录」后，把 `addServer`/`removeServer` 换成真实接口（代码留注释标记接缝）

### useServer 去轮询
- 原 5s 轮询 `GET /servers` 已移除 → 改为挂载时拉一次 + 手动 `refresh`
- 理由：本地增删不该被轮询的后端真相覆盖；状态(state)实时变化将来走 WebSocket 推送（后端 `ServerManager.onStateChange`），不走轮询

### 架构认知：实例来源应为文件系统扫描
- 项目 SOP 钉死：**ServerID = `Servers/` 下的子目录**（`unturned-sop.md` 目录布局）
- 当前后端 `ServerManager.listServers` 从 **SQLite `servers` 表**读实例（`SELECT ... FROM servers`），无 readdir 扫描——与 SOP 矛盾，属半成品，待重构为扫描 `Servers/` 目录
- 后端 `createServer` 只写 DB + 内存 Map，不建 `Servers/<id>/` 目录 → 新建实例无法真正启动

### 其他变更
- toast 位置：`components/ui/sonner.tsx` `bottom-right` → `top-center`
- 测试残留清理：`e2e-create` 已从 SQLite 删除（DB 剩 MyServer / admin / admin123 三个真实实例）
- typecheck 0 error；浏览器实测：新建后 7s 不消失、删除后 7s 不复活
