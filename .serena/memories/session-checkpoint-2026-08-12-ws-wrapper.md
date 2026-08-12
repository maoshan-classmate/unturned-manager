# Session Checkpoint 2026-08-12 WS 包装层实现

2026-08-12 完成 `docs/architecture/ws-wrapper-design.md` 阶段 1-4 全部实施。

## 服务端 ACK 协议

- `shared/contracts/ws.ts` 新增 `ClientWsRequestMessage`（`terminal_close` / `save` / `shutdown`，均带 `requestId`）
- `shared/contracts/broadcast.ts` 新增 `ack` 事件类型 + `WsRequestHandler` / `WsRequestResult`
- `gateway.ts`：请求处理器注册表 `registerRequestHandler(type, handler)` + 路由 + `sendAck`；业务异常兜底 `internal_error` ack，不抛回 ws 层
- `composition-root.ts` 注册三个处理器：
  - `terminal_close` → `ptyManager.kill`（SIGTERM → 5s → SIGKILL）
  - `save` → 写 `Save\r` + `waitForMarker(/world saved/i, 30s)`，超时转 `save_timeout`
  - `shutdown` → 先 `Save` 再 `Shutdown <delay> "<reason>"` + `waitExit`；delaySeconds 钳制 0-600，reason 剥引号换行

## PtyManager 扩展

- 新增 `waitForMarker`：命中 resolve / 进程先退 reject pty-exited / 超时 reject pty-marker-timeout（504），settle 后自动退订
- `onData` / `onExit` 改为返回退订函数（向后兼容，既有调用不受影响）

## 前端事件总线

- `WebSocketContext` 重写为单连接订阅总线：`subscribe(type, handler) => unsubscribe` + `send`（fire-and-forget）+ `request`（UUID requestId / 默认 30s 超时 / 断线 reject 全部在飞请求）；保留旧 `connected` API
- 3 处独立 WS 连接合并为 1：`useConsole` / `useSteamCmdProgress` 删独立建连改订阅；`useServer` 按类型订阅
- `ConsolePage`：存档/关服升级为 ACK 按钮 + ConfirmDialog，新增「关闭控制台」核选项按钮；`runAck` 统一 toast 反馈（业务错误/超时/断线）

## 验证

- 后端 typecheck 零错误 + 单测 213/213（含 6 个 gateway ACK + 6 个 waitForMarker 新用例）
- 前端 typecheck 零错误 + 单测 42/42（含 9 个 WebSocketContext 新用例）
- e2e 9/9（含 WS 连接回归 + ACK 按钮渲染用例）
- 依赖真 U3DS 的关服 ACK e2e、重连恢复订阅 e2e 留 Sprint 5 真机验证

## 实施偏差（设计文档 §10.1）

- `terminal_close` 用 `kill` 而非设计稿的 `close`（PtyManager 无 close 方法）
- `shutdown` 先 `Save` 再 `Shutdown`，对齐 SOP 重启流水线与 REST stop 同序
- 处理器注册放 `composition-root.ts` 而非 gateway 内（网关保持协议层职责）
- `architecture-spec.md` §3.4 / §4.3 已同步更新

## 文档归档收尾（commit 998427c）

- `claudedocs/research_ws_socketio_decision_2026-08-12.md` 按规范归档至 `claudedocs/archive/`（git 识别 100% rename）——它命名是 research 类型但状态已「✅ 已决策」且结论已吸收进 ws-wrapper-design.md，符合「调研结论已吸收 → 归档」触发条件
- `ws-wrapper-design.md` 中 4 处 `claudedocs/` 根引用同步改为 `claudedocs/archive/`，doc-outdated-guard 二次验证无死引用
