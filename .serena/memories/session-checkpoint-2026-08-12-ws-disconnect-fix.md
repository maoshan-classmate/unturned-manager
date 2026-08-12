# Session Checkpoint 2026-08-12 WS 频繁断连修复

## 问题

用户报告控制台页面无输出、敲命令无响应、WS 频繁断连重连循环。日志显示 `[vite] ws proxy error: ECONNRESET`。

## 根因（三层叠加）

1. **Vite dev server WS proxy ECONNRESET**（主因）：`manager-web/vite.config.ts` 的 `/ws` proxy 缺 `rewriteWsOrigin` + `reconnectOnError` + `timeout` 配置，浏览器↔Vite↔后端的 WS upgrade 在握手/数据转发时偶发 ECONNRESET → 浏览器 onclose → 前端指数退避重连 → 频繁断
2. **accessToken 15min 过期 + 被动 refresh**：原 `ensureAccessToken` 只在 WS 重连时调，串行 refresh 让重连慢 + 偶尔失败
3. **应用层缺 ping/pong**：浏览器只被动回 ws 协议层 pong，不发应用层心跳；反向代理（nginx 60s idle / caddy 5min）可能误判空闲切断

订阅语义 (`serverIds: []`) 不是问题——gateway 过滤块 `subs.serverIds.size > 0` 为 false 时跳过过滤，事件照常发出。

## 修复（S1/S5/S2/S4 四件套）

| # | 文件 | 改动 |
|---|---|---|
| **S1** | `manager-web/vite.config.ts` | `/ws` proxy 加 `rewriteWsOrigin: false` + `reconnectOnError: () => true` + `timeout: 0` |
| **S5** | `manager-web/src/api/client.ts` | 新增 `getAccessTokenExpMs(token)` helper（JWT exp 解码） |
| **S5** | `manager-web/src/contexts/WebSocketContext.tsx` | 加 `scheduleRefresh` ref —— 过期前 3min 调度 `ensureAccessToken`，refresh 完递归排下一次；最小间隔 30s 防 drift |
| **S2** | `manager-server/src/ws/gateway.ts` | `msg.type === "ping"` handler：直接 `ws.send({type:"pong"})` 立即回，不进 broadcast/request handler |
| **S2** | `manager-web/src/contexts/WebSocketContext.tsx` | 加 `pingTimer` ref——`ws.onopen` 后启动 25s 间隔 setInterval 发 `{type:"ping"}`；`onclose`/`cleanup` 清掉 |
| **S4** | `manager-web/src/pages/ConsolePage.tsx` | 从 `useServer()` 取 `currentServer.state`，STOPPED 时标题区加红色提示「当前服务器未运行」 |

## 验证

- 前端 typecheck 0 错误
- 后端 typecheck 0 错误
- 前端单测 42/42（含 9 个 WebSocketContext 新加 mock `getAccessToken`/`getAccessTokenExpMs` 后全绿）
- 后端单测 213/213
- 真机验证留 Sprint 5（重启 Vite + DevTools WS 标签看 ECONNRESET 消失 + 每 25s 见 ping/pong + 12min 见自动 refresh）

## 调试教训（避免再走弯路）

- 听到「WS 断连」**先看 vite proxy 日志**——dev 模式下 ECONNRESET 八成是 vite 代理层，不是后端
- 看到「订阅过滤」先**完整审计 if 块逻辑**——空 Set 走 `size > 0` 为 false 会**跳过**过滤（不是过滤掉事件）
- 「token 过期」要分清**主动 refresh** vs **被动 refresh**——业界标准是主动 setTimeout 调度到「过期前 3min」
