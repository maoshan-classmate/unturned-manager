# Session Checkpoint 2026-08-10 — ADR-0004 §4 Phase 3 完成

## 交付物

ADR-0004 §4 Phase 3（前端 xterm.js 终端 + WS terminal_input 双向链路）完成并提交 `dbcdd6f`（功能实现: Phase3 xterm终端+WS terminal_input双向链路，12 文件 +627/-216）。

## 双向链路架构

- **下行**：xterm.js onData 原始字节 → WS `terminal_input`（`{type,serverId,data}`）→ gateway → `ptyManager.write(serverId, data)`。owner-trust 模型（ADR-0004 §3.4）——verifyClient 已校验 JWT，不做命令解析/危险指令门控，前端 ConfirmDialog 拦截。
- **上行**：PTY stdout → ServerManager `pipePtyOutput` 订阅 `ptyManager.onData` → `console_line` 广播 → 前端 `Terminal.writeln`（增量写入，source==='input' 跳过防重复）。
- `shared/contracts/ws.ts` 新增 `ClientWsMessage` 联合类型（subscribe | terminal_input）。
- `PtyManager.write` 幂等语义（进程不存在 → warn + return）支撑 gateway 契约（isRunning=false 时写被丢弃）。

## 前端组件

`manager-web/src/components/console/Terminal.tsx`：xterm.js wrapper——增量写入（writtenRef）、clearLines 长度骤减先 clear 重置游标、FitAddon + ResizeObserver fit、theme 对齐全局色值（背景 #0F172A / 前景 #94A3B8 / 强调 #22C55E）、`data-testid="terminal-container"`、dispose 清理完整。ConsolePage 用 `<Terminal>` 替换 `<pre>`，保留结构化 RCON 通道 + ConfirmDialog。

## 验证证据

- 后端单测 165/165（含新增 gateway.test.ts 4 个——真实 ws 端到端，`vi.resetModules()` + 动态 import 解决 wsBroadcaster 模块级单例污染；缺 serverId / 缺 ptyManager / 未知类型三分支全测）
- 前端单测 29/29、前端 e2e 10/10、后端 e2e 26/26
- typecheck 前后端 0 错误，prettier 干净
- 依赖：`@xterm/xterm ^6.0.0` + `@xterm/addon-fit ^0.11.0`（生产依赖）

## 遗留

`claudedocs/reference_pty_terminal.md` 活参考文档待 Phase 1-4 全部完成后补（ADR-0004 §8）。
