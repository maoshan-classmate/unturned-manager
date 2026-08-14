# Session Checkpoint 2026-08-13 — 当前实例脱离 URL（sc:design + 8 批实施）

用户拍板「侧栏所有菜单都要展示」+「实例标识不该拼在 URL 上」→ 完成一次跨前后端的大改造，5 个 commit 落地（34e7098 / fbed139 / 31d288a / 8b9469e / 43d20e0）。

## 架构决策（brainstorm 拍板）

实例标识从 URL 路径参数（`/:serverId/xxx`）迁到客户端共享层：

- **`CurrentServerProvider`**（`manager-web/src/contexts/CurrentServerContext.tsx`）：承载 `currentServerId`，localStorage 键 `unturned-manager.currentServerId` 持久化，跨标签 `storage` 事件同步，隐私模式降级到内存态。沿用 AuthContext 的 null-guard 模式。
- **`useRequireServer`**（`manager-web/src/hooks/useRequireServer.ts`）：实例类页面统一守卫，四态 `loading / empty / missing / ready`；钩子只读，跳转 + toast 由消费方 useEffect 执行。
- **路由表纯路径**：`/console` `/mods` `/config/commands` `/ldm` `/files` `/server-setup` `/settings`；旧 `/:serverId/*` 兼容重定向保留。
- **侧栏**：八个标签永远渲染永远可点；实例类四菜单未选实例时右侧「去新建」引导按钮；右上角 ServerSelector 升级为真下拉选择器（含实例列表 + 新建入口 + 状态点）。
- **文件菜单面板级**：`GET /api/files?path=` 浏览 installDir 根（新增 `FilesService.listPanelDirectory` + `createPanelFilesRouter`，契约加 `PanelDirectoryResult`）；动态面包屑可回退更上级；写操作（新建/上传/删除/重命名/读）依赖选中实例，未选时按钮禁用 + title 提示。
- **ServerSetup 页**：实例库链接从 `<a href=/{id}/server-setup>` 改 `<button onClick=setCurrentServerId>`；创建实例后自动选中新实例；删除当前实例后选下一个，无剩余则 `clear()` + 回首页。

## 关键教训

1. **ModsPage 不该整页守卫**：浏览 Steam 创意工坊是全局操作（不需要 serverId），只有下载需要。初版用 `useRequireServer` 整页守卫会破坏「模组菜单总能用」——已修正为浏览照常、仅下载无实例时 toast 提示。
2. **e2e 适配**：`selectActiveInstance` helper 登录后写 localStorage 再整页 goto（让 Provider 重新 mount 读到）；实例库 hover 目标从 `a[href=...]` 改 `.group` div（因为链接改成了按钮）。
3. **删除后无剩余实例必须 clear()**：否则 localStorage 残留失效实例 → 页面变 missing 态。

## 验证

前端 90 passed（新增共享层 11 + 守卫 7 + 选择器 8）、后端 272 passed + 1 skip（新增面板级浏览 4）、双端 typecheck 零错误。e2e 未实跑（需浏览器），留待真机。
