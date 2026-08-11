docs/architecture/architecture-spec.md 于 2026-08-11 全面重写为 Phase 0-6 落地后的现状规格（commit 79e669a，+531/-931）。

该文档只描述当前架构事实，正文不含历史演进叙事——已淘汰概念（RCON 通道、A2S 通道、DEGRADED 态、/players 路由、PlayersPage）不出现。

当前架构核心事实（写文档/评审时以此为基准）：
- 命令通道：PTY 持久终端 owner-trust 模型——node-pty spawn 永驻 bash，WS `terminal_input` 入站写 stdin、`console_line` 出站推 stdout；危险指令二次确认在前端 ConfirmDialog
- 状态机：4 态 STOPPED→STARTING→RUNNING→STOPPING→STOPPED，由 PTY 进程存活驱动，无中间模糊态；崩溃 5s 硬重启守卫
- 实例真源：目录扫描——`<installDir>/Servers/<ServerID>/Server/Commands.dat` 存在性 = 实例成立；运行时状态在内存
- DB 收敛 3 表：users / refresh_tokens / settings；settings K-V（`steam_webapi_key` AES-256-GCM、`startCommand:<ServerID>` 明文复用 value_enc 列）
- SteamCMD 长任务全 202 异步化：返回 jobId，进度经 WS `steamcmd_progress` 推送
- 启动序列：POST /servers/:id/start 立即 202 返回 `{terminalSessionId, pid}`，1s 后自动写 startCommand

配套变更：.claude/rules/unturned-sop.md 重启/改 Mod 流水线 `Shutdown 30`→`Shutdown 10`（对齐 applyModChanges 代码；手动 stop 路径仍为 `Shutdown 30`），状态机节补全 4 态循环。