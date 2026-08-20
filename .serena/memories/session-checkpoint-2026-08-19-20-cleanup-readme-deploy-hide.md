---
name: session-checkpoint-2026-08-19-20-cleanup-readme-deploy-hide
description: 2026-08-19/20 注释清理完成 + README 四轮校对 + 部署文件精简 + UI 隐藏 + 控制台重设
metadata:
  type: project
---

2026-08-19/20 大跨度会话总结。

## 一、注释清理三轮（agent 全跑过 + 人工补刀）

`87671e0` (16 文件 +66/-85) → `1178eda` (53 文件 +293/-366) → `ae449f2` (23 文件 +125/-157)。三轮共改 92 文件，全仓扫描 GSM/GSM3/GameServerManager/DST/MCSManager/mod.go/1:1/抄 GSM/对齐 GSM/照搬 MCSManager **零命中**。可发布 GitHub。

**关键教训**：hook `code-comment-history-detect.sh` 扫描 Edit/Write 的 `new_string` 注释行，命中 30+ 关键词即 deny。阻塞词表：`★/之前/不再/曾经/曾/2026/以前/ADR-/PR-/决策/落地/拍板/旧版/老版/设计/设计见/Phase/现在改为/后续改为/之前是/之前实现/已就绪/GSM/DST/修复了/替代/TOCTOU/S2 修复/P1-P4/BUG-N/v2.x/DSG/mod.go/1:1/同款/抄/对齐/上次/反转/T1-T7/MCSManager`。

**保留型冲突处理**：任务规则「保留 ADR」与 hook「拒绝 ADR-」冲突——策略是**纯 ADR 设计行不动；编辑含 ADR 的行时把 ADR- 从替换文本里去掉**。

**agent 协作经验**：agent 完成大块清理后**人工复查半成品**——曾出现删一半留一半（孤立 "GSM3 "、"（DST mod.go:72-75 ）"空括号、缩进错乱、空 JSDoc 行）。提交前 grep 复核 + 人工逐文件修残留。

## 二、README 四轮校对

`ff40ea1` 第一版 161 行 → `1cfc75e` 改页面名 → `45338c7` 事实校对 → `b05739b` Linux 唯一支持警告（简化后只剩 `> ⚠️ 本项目目前只支持 Linux。`）。

**重要教训**：UI 文档必须 grep 实际代码确认，不能脑补。Sidebar.tsx L22-30 是真实菜单名（仪表盘/控制台/配置/模组/Mod 框架/文件/服务器设置/系统设置）——README 不能写 "Server Setup / Dashboard / Console / Mods / Config"。配置页 Tab 名在 ConfigPage.tsx L668-670：基本设置/高级设置/Mod 列表。

**事实校对维度**：按钮名（U3dsCard.tsx:285「安装 Unturned 服务端」）、控制台命令（ConsolePage.tsx:32-40 共 7 个）、端口语义（SDK 默认 27015→查询=Port+1）、staging 路径（`Servers/<id>/Workshop/staging/`）、SQLite 范围（startCommand 存 SQLite，删了要逐个重设）。

## 三、部署文件精简

`42e7ba7` Dockerfile + docker-compose.yml 净减 80 行。`b6c18bc` docker-entrypoint.sh 净减 9 行。`16b27e8` .env.example 删除 RCON 残留（RCON 通道已删）。全仓库其他 .sh / .example / .json / .toml / .cfg / .dockerignore / Dockerfile / Makefile（无）已扫描零残留。

**保留的合规注释**：hook `comment-history-detect.sh:84/98` 的「修复了之前的 bug」是**检测示例**（删了 hook 自相矛盾）；`comment-history-keywords.json` 的「★」「GSM」是**关键词表**（hook 工具本身）；hook `small-feature-detect.sh:4` 接口格式说明。

## 四、UI 隐藏（未完成功能）

`161c69c` 侧栏隐藏「Mod 框架」「文件」菜单——这两页未开发完。恢复方法：去掉 NAV_ITEMS 数组里两行行首 `// `。

`d1f78da` ScheduledTasksCard 隐藏「添加任务」按钮——计划任务功能未完成。恢复方法：去掉 JSX 注释符 `/* */`。

## 五、控制台重设

`7990037` + `d965625` + `c7cada2` + `ff4e8d7`：

**输入框重设**（暗色嵌入）：
- wrapper 高度固定 40px
- 背景 `#1E293B`（与卡片统一）
- 边框 `#334059` → focus `#22C55E`
- 发送按钮 `absolute right-2 top-1/2 -translate-y-1/2` 绝对定位（不撑高）
- input `paddingRight: input.trim() ? 56 : 0` 给按钮预留位置

**预设命令全部走二次确认弹框**（`d965625`）：
- 重命名 `DangerCommandDialog`（实际是预设命令确认弹窗）+ 加 `dangerous` + `needsParam` 双 prop
- `showConfirm` 状态升级为 `{ command, dangerous, needsParam } | null`
- 7 个预设命令：Say（needsParam）/ Kick（dangerous + needsParam）/ Players / Night / Airdrop / Help / Day
- 手敲危险关键字（shutdown/ban/slay/resetconfig/unadmin/unban/cheats）走 `dangerous=true, needsParam=true`
- 弹框按 dangerous 分样式：红标题 vs 绿标题、危险警告 vs 普通消息
- 确认后直接 `handleSend(finalCommand)` 发送，不回填输入框

## 当前 git 状态

```
ff4e8d7 修复: 控制台输入框背景色统一为 #1E293B——与其他卡片背景一致
c7cada2 修复: 控制台输入框高度固定——发送按钮改为绝对定位，输入内容不撑高容器
d965625 功能重构: 预设命令全部走二次确认弹框——危险+普通命令区分样式，参数命令显示输入框
7990037 功能重构: 控制台输入框重设样式——暗色嵌入 + 发送按钮内嵌 + 危险指令带参数二次确认
d1f78da 修复: 计划任务卡片隐藏「添加任务」按钮——功能未完成
161c69c 修复: 侧栏临时隐藏 Mod 框架与文件菜单——这两页未完成
```

工作区干净。`MMDB_PATH .env / .env.example / docker-compose.yml / Dockerfile / docker-entrypoint.sh / README.md` 全部已 commit。

## 未完成（下次可继续）

- **侧栏隐藏项恢复**：Mod 框架、文件两个菜单的完整开发（用户未规划何时做）
- **计划任务「添加任务」功能**：scheduled-tasks 后端 + 前端编辑对话框
- **其他文档**：changelog、贡献指南等（README 暂用，未来扩展）
- **prettier 警告**：Dockerfile / 部分 manager-web 文件有格式问题（代码行 964/980 等，与本次注释清理无关，未处理）

## 关键代码位置（下次快速定位）

- `manager-web/src/components/layout/Sidebar.tsx:22-30` — 真实菜单名数组
- `manager-web/src/pages/ConfigPage.tsx:668-670` — 配置页 Tab 名
- `manager-web/src/components/server-setup/U3dsCard.tsx:285` — 真实按钮文字
- `manager-web/src/pages/ConsolePage.tsx:32-40` — 7 个预设命令（含 needsParam）
- `manager-web/src/pages/ConsolePage.tsx:510+` — DangerCommandDialog 实现
- `manager-web/src/components/server-setup/ScheduledTasksCard.tsx:97-100` — 「添加任务」注释位置
- `manager-web/src/components/server-setup/CreateServerDialog.tsx:54` — ownerSteamId 默认值
- `manager-server/src/modules/server/startScript.ts:5/18` — U3DS Linux-only 真源
- `shared/schemas/server.schema.ts:15-16` — Port 范围 + SteamID64 regex
- `manager-server/src/modules/server/ServerManager.ts:40` — CRASH_RESTART_DELAY 5s
- `manager-server/src/modules/steamcmd/SteamCmdManager.ts:106-107` — staging 路径真源