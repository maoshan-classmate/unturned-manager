---
name: session-checkpoint-2026-08-17-control-three-bugs
description: 控制台三连击修复(换行错乱+命令失效+Commands.dat未知键) 闭环 074201c/9d3d2e4
metadata:
  type: project
---

# 控制台三连击修复闭环（2026-08-17）

用户实机报三个 bug：①控制台输出换行混乱逐行递增缩进 ②只有首条命令生效后续失效 ③Commands.dat 报 `Unknown entry: 'LogChat true'/'VotifyPassCooldown 5'` 等。

## Commit 落档

| Commit | 内容 |
|---|---|
| `074201c` | 修复: 控制台命令终止符与输出换行渲染错乱（PTY 逐行 emit + 全链路 LF 终止符） |
| `9d3d2e4` | 修复: 命令配置日志与投票子字段拆写成未知键（前端跳过子字段 + 后端丢弃 legacy 键） |

## 三个根因

### 1. 换行混乱（输出逐行递增缩进）

**根因**：`PtyManager.flushOutputBuffer` 把 50ms 内累积的行 `buf.join("\n")` 合并成一条推给前端，前端 `term.writeln` 整块时裸 LF 只下移不归列首 → 渐进缩进。

**修复**：`PtyManager.ts` 改为逐行 emit，恢复 `console_line` = 单行的契约。outputBuffers 环形 buffer + 50ms 定时器批量 flush 的反向阻塞防护保留（PTY read 阻塞 → U3DS Console.WriteLine 阻塞 → consoleMain 死锁——MCSManager 范式），与逐行 emit 不互斥。

**测试**：`ptyManager.test.ts` 此前 8 条 onData 切行测试失败（期望「每次一行」——正是本次换行 bug 的契约），加 `flushOutput()` 辅助函数等 50ms 批量 flush 后断言 → 41/41 全绿。

### 2. 控制台只有首条命令生效

**根因**：a874b7c（**今天**提交）把 60f125c 的 `\n` 修复**回退成 `\r`**，理由是「逐字符模式只认回车符」——但完全对不上用户实机「首条生效、后续失效」。60f125c 根因注释正确：U3DS `Console.ReadLine()` 以 LF 为终止符；`\r` 在终端模式改变后 ICRNL 失效、不触发行结束。首条命令走 `startCommand`（`\n`）所以能执行。

**修复**：全链路恢复 `\n`——`useConsole.ts`（sendCommand + 终端按键 `\r→\n` 归一化）、`composition-root.ts`（Save/Shutdown × 2）、`ServerManager.ts`（stopPty × 2）、`LdmPluginCommandsService.ts`（`/rocket` 命令 × 2）。同步更新测试断言 `\r`→`\n`。

### 3. Commands.dat 报 Unknown entry（LogChat/Votify*）

**根因**：08-14 加了合成单行（Log Y/Y/Y/N + Votify Y/5/60/15/75/3），但**通用已知键循环漏了排除子字段**——`LogChat`/`LogJoin`/`LogDeath`/`LogAnticheat`/`VotifyAllow`/`VotifyPassCooldown` 等被当独立键写盘。

**修复**：前端 `ConfigPage` 通用循环跳过 `COMPOSITE_SUBFIELDS`（10 个子键 Set）；后端 `ConfigService.parseCommandsDatContent` 解析时丢弃 `LEGACY_KEYS`（同 10 子键 Set），自动清理已存在脏文件的残留行。已知键循环保留「未知键不丢」契约（仅丢弃**面板拆写遗留**的子键，第三方真未知键仍走 `unknown` 保留）。

## 验证

| 门槛 | 结果 |
|---|---|
| 双端 typecheck | 0 错 |
| 后端单测 | 373 通过 / 3 失败（`steamCmdManager` 已知 mock 串台 backlog）/ 26 skip |
| 前端单测 | 162/162 |
| e2e | 2 失败 = ApiServer 测试夹具缺失（环境），非代码回归；实机留 Sprint 5 |

## 教训

1. **PTY 输出逐行 emit 是硬契约**——任何合并（join/buffer pack）都会破坏 xterm 列对齐。8 条此前挂着的 onData 测试就是契约守护神，加 50ms 等待辅助函数后绿。
2. **`\r` vs `\n` 在 PTY 上没有「安全默认」**——a874b7c 的「逐字符模式只认回车符」是错误假设，回退 `\n` 后立刻复发。真源：U3DS `Console.ReadLine()` 以 LF 为终止符，bash ICRNL 不靠谱。
3. **复合字段保存的两端防御**：前端排除子字段（防写）+ 后端丢弃 legacy 键（防读）——任一端失效另一端兜底，已存在的脏文件下次保存自动清理。
4. **真实 installDir 是 `manager-server/.test-install`**（相对后端 cwd），不是仓库根——本会话误在仓库根建了 `ApiServer` 残留目录已删。

## 关键文件

- `manager-server/src/modules/process/PtyManager.ts:201` — flushOutputBuffer 逐行 emit
- `manager-web/src/hooks/useConsole.ts:112` — sendCommand 终止符
- `manager-web/src/hooks/useConsole.ts:142` — 终端按键 `\r→\n` 归一化
- `manager-web/src/pages/ConfigPage.tsx:439` — COMPOSITE_SUBFIELDS 排除子字段
- `manager-server/src/modules/config/ConfigService.ts:69` — LEGACY_KEYS 丢弃

## 关联 fact

- [[pty-input-line-terminator-lf]]
- [[ptymanmanager-emit-line-by-line]]
- [[commands-dat-composite-subkeys-discard]]