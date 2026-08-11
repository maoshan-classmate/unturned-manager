ADR-0004 Phase 6 删除远程控制台通道（2026-08-11，提交 76584bc 代码 / 06e22e2 文档 / db724e9 记忆）。

用户拍板方案 C：彻底删除该通道，命令统一走持久终端 owner-trust 模型（登录即可执行任意命令）。

后端删除范围：
- 依赖 `rcon-srcds` 从 `manager-server/package.json` 移除
- 模块 `modules/rcon/RconManager.ts`（394 行）整体删除
- 路由 `routes/rcon.ts` 与 `routes/players.ts` 删除
- 契约 `shared/contracts/rcon.ts` 删除
- `settingsStorage` 中该通道的凭证读写辅助函数删除
- 依赖注入容器与入口不再装配该模块

行为改动：
- `ServerManager` 的停服与改 Mod 流水线改为向终端写入 `Save` / `Shutdown` / `Say`
- 状态机去掉 DEGRADED 一态，改为 4 态，完全由终端进程存活驱动

前端删除范围：
- 玩家管理页面整页删除，侧栏与路由表同步移除
- 创建实例弹窗的凭证输入字段删除（`rconPassword` 与 `openModCredential` 两个字段不再存在）
- 控制台发命令不再往返 REST，改为经 WebSocket 的 `terminal_input` 事件

验证：后端类型检查零错误 + 单测 170 + 端到端 16；前端类型检查零错误 + 单测 29 + 端到端 10。

历史参考保留：`.claude/rules/rcon-protocol.md` 标记退役但未删除，供未来恢复该通道时重建参考。

相关：[[architecture-spec-current-state]]、[[session-checkpoint-2026-08-11-phase7-session-recovery]]
