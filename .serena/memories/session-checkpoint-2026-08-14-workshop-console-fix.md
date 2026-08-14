# Session Checkpoint 2026-08-14 — Workshop 路径/类型修复 + 控制台修复

## Workshop 3 BUG 叠加修复（commit e804616，实机 H:\nvme12-13906871929\docker\unturned-manager\opt\unturned）

1. **路径常量去 steamapps/workshop 子层**：U3-SDK `DedicatedUGC.cs:560` 真实路径 `Workshop/Steam/`（无 steamapps/workshop 子层）。`WorkshopAcfService.ts` / `WorkshopApplyService.ts` / `WorkshopDeleteService.ts` 三处 `CONTENT_SUBDIR` / `WORKSHOP_ACF_REL_PATH` 修正；staging 路径保留 steamapps/workshop（SteamCMD 标准结构）。主因：旧实现臆造 `Workshop/Steam/steamapps/workshop/` → main acf 永远 ENOENT → `/mods/downloaded` mainItems=[]。
2. **File_IDs zod schema 类型归一**：U3-SDK `WorkshopDownloadConfig.cs:30` 用 `List<ulong>`，Unity JsonUtility 序列化为 JSON number；面板 acf 解析（VDF Object.entries）永远是 string → `Set.has` strict equality 永远 false → `applied` 恒 false。schema 改 `z.union([z.string(), z.number()]).transform(String)`，`readWorkshopConfig` 走 `WorkshopConfigSchema.parse`，`writeWorkshopFileIds` 写时 `map(String)`。
3. **moveDir mkdir 父目录**：`fs.rename` 在目标父目录不存在时 ENOENT（U3DS 首次启动前 content 父目录不存在）。
4. **serverManager 测试 API 修正**：v2.6 后 `start` 不再走 `startInternal`，测 applyStaged 失败需用 `restart`。

文档对齐 3 处（2ab602d / c935e29）：unturned-sop.md / architecture-spec.md / ldm-integration-design.md / mod-management-design.md / research_dst_mod_reference。doc-outdated-guard 抓出 unturned-sop 旧版升级标题错配 + mod-management-design staging/main 不对称缺注释，均已修。

## 控制台修复（commit 60f125c，根因 U3-SDK 实机日志定位）

1. **sendCommand `\r`→`\n`**：U3-SDK `-ThreadedConsole` 的 `ThreadedConsoleInputOutput.consoleMain` 用 `Console.ReadLine()`，以 LF 为行终止符。bash 中转下早期 ICRNL 把 `\r`→`\n`（日志 16:52:35 Players 曾成功），后续终端模式变化后 `\r` 不触发行结束 → ReadLine 阻塞 → 命令到 U3DS 但不执行 → **游戏内不生效**。GSM3 用 `\r` 能工作是因为直接 spawn 目标进程（`TerminalManager.ts:1126`），无 bash 中转层。
2. **sendTerminalInput 单 `\r`→`\n`**：xterm Enter 发单个 CR，转 LF 保证手动按键也能触发。
3. **LogStreamer 路径错**：U3-SDK `Logs.cs:311` 日志写到 `<installDir>/Logs/Server_<serverId>.log`（全局），旧实现 tail `Servers/<id>/Logs`（不存在）→ 控制台首次进入空白。改 `resolveU3dsLogFile` + 加轮转保护（size<offset 归零）。
4. **Terminal.tsx**：不再跳过 `source==="input"` 行（命令回显可见）；前景色 `#94A3B8`→`#F1F5FB`。

## 实机数据清理

- `TestServer/Server/Commands.dat` 移除 16 行 Config.txt 键（`LogChat true` / `VotifyPassCooldown 5` 等旧版残留，U3DS 当未知键保留），保留 `Log Y Y Y N` / `Votify N/5/60/15/75/3`。备份 `Commands.dat.bak.2026-08-14T012241`。前端已合成单行不复发，Commands.dat 启动时读取，下次重启生效。

## 验证

- 后端 279/280（1 pre-existing skip）、前端 93/93、双端 typecheck 零错
- 真机验证待用户：重启面板 + 重启 U3DS → 控制台回灌日志 + `Day` 生效

## 关联

- `sessions/2026-08-13-5-bug-fix.md`（Bug2/3 Workshop 路径早期修复）
- `session-checkpoint-2026-08-13-config-parity-audit.md`（Bug B-1 Config.txt key）
- `unturned-server-technical-reference.md`（AppID / 命令通道）
