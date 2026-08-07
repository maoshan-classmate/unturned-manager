# Sprint 2 实施会话 (2026-08-07)

## 执行摘要
完成 Sprint 2 Wave 1-3 全部实施：5 个后端模块从 stub 替换为真实实现，2 个前端页面从 Placeholder 改为完整功能页，8 项 GSM3 + CLAUDE.md §4 交叉审计偏差全部修正。

## 新增文件 (13)
- `manager-server/src/modules/filelock/FileLockProvider.ts` — 进程内文件互斥锁
- `manager-server/src/modules/process/ProcessSupervisor.ts` — U3DS 进程 spawn/kill/优雅关停
- `manager-server/src/modules/a2s/A2SClient.ts` — A2S_INFO UDP 查询
- `manager-server/src/modules/rcon/RconManager.ts` — 双协议 RCON (OpenMod→RocketMod 回落)
- `manager-server/src/modules/server/ServerManager.ts` — 五状态机聚合根
- `manager-server/src/db/migrations/002-add-install-dir.sql` — servers 表加 install_dir
- `manager-web/src/pages/DashboardPage.tsx` — StatCard×4 + QuickActions
- `manager-web/src/pages/ConsolePage.tsx` — Toolbar + Output + Input
- `manager-web/src/components/stats/StatCard.tsx` — 统计卡片组件
- `manager-web/src/hooks/useServer.ts` — 服务器列表轮询 + start/stop/restart
- `manager-web/src/hooks/useConsole.ts` — 控制台 WS 接收 + REST 发送
- `claudedocs/sprint2_design_breakdown.md` — Sprint 2 设计拆解
- `claudedocs/workflow_sprint2_core_domain_correction.md` — GSM3 交叉审计修正计划

## 关键决策
- RCON 凭证拆分为 openModCredential + rocketModPassword，避免跨协议冲突
- A2S 超时 30s 严格报错（对齐 CLAUDE.md §4.6）
- restart() 用 stopInternal/startInternal 避免 activeOperation 竞态窗口
- 危险指令门控在 routes/rcon.ts 返回 428 Precondition Required
- ProcessSupervisor.spawn 必须传 cwd 参数，启动命令使用绝对路径
