# 控制台「首条生效后续失效 + 屏幕填满不显示」双根因修复(2026-08-17)

## 输出端根因(commit 4271d39)

xterm 被切碎的 ANSI 转义序列卡死状态机。旧链路 PtyManager.onData 按 \r?\n 切行后逐条 term.writeln,当 PTY 输出包含跨 chunk 的不完整 ESC 序列(进度条 \r 覆盖、状态行 \x1b[?...m 半截),xterm 等待补全后续写入全卡住——不是命令没执行,是响应不显示。

修复:PtyManager 加双通道——onChunk(raw) 保留原始字节流 50ms 累积整体 emit,前端 console_output 事件直写 term.write,由 xterm ANSI 状态机自处理跨 chunk 序列;onData(line) 保留给 waitForMarker/save 成功匹配/U3DS_READY_PATTERNS。前端 useConsole 从 lines 数组改成 sinks 回调(onChunk/onLine/onClear)直接写 xterm,Terminal 组件暴露 xterm 实例 + convertEol:true。

## 输入端根因(commit df7b6b4)

3 处 silent fail:① PtyManager.write 进程不存在/底层抛错只 log 吞掉;② gateway terminal_input fire-and-forget 不回 ack;③ WebSocket 底层连接已重置但 readyState 仍 OPEN,send 静默丢消息。

修复(照搬 MCSManager general_command.ts 失败即通知 + useTerminal.ts socket.connected 检查):
- PtyManager.write 改抛 AppError(人话:"控制台未在运行,请先启动服务器"/"命令未送达,请稍后重试")
- gateway terminal_input try/catch 失败时推 console_output 错误行
- useConsole sendCommand 前检查 connected,断开直接拒绝 + 写错误提示
- 前后端心跳对齐:前端 PING_INTERVAL 25s→10s,后端 HEARTBEAT 30s→10s

## 验证

双端 typecheck 0 错;后端 ptyManager+serverManager 86/86;前端 162/162。e2e 未跑(vitest exclude 夹具环境问题,惯例)。实机验证留 Sprint 5。

## 关键文件

- manager-server/src/modules/process/PtyManager.ts:270 — write 抛 AppError + onChunk/flushChunkBuffer
- manager-server/src/ws/gateway.ts:180 — terminal_input 失败推错误
- manager-web/src/hooks/useConsole.ts:93 — sendCommand connected 检查 + sinks 回调
- manager-web/src/contexts/WebSocketContext.tsx:104 — PING_INTERVAL 10s

相关:[[session-checkpoint-2026-08-17-control-three-bugs]]
