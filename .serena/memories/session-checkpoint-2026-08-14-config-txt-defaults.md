# Session Checkpoint 2026-08-14 — Config.txt 默认值对齐 SDK（BattlEye 真源调研）

## 用户需求
配置页 Commands.dat 页面没填值时预览官方默认值（很好），但 Config.txt 配置页没有预览值。用户拍板：bool 字段默认态也要对齐 SDK + BattlEye_Secure 默认值必须先解决（外部资源 + unturned-docs 调研）。

## BattlEye_Secure 真源调研（铁证）

- **实机 U3DS Config.txt 注释**：`// > Whether to enable BattlEye Anti-Cheat.` / `// > Default: True` → **BattlEye_Secure 默认 = True**
- `.research/unturned-docs/`（官方文档克隆）：无 BattlEye_Secure 默认值字段说明（文档偏 launch-options/faq）
- **关键真源法**：U3DS 生成的 Config.txt 自带「// > Default: ...」注释，是每个字段官方默认值的最权威来源——server-configuration.rst:10「空值=用默认」+ :70「设置注释带默认值」

## 默认值真源（实机注释 + PlayConfigData.cs）

### 固定
- Server: VAC_Secure=True(402)、BattlEye_Secure=True、Max_Ping_Milliseconds=750(403)、Enable_Scheduled_Shutdown=False、Enable_Update_Shutdown=False
- Items: Despawn_Dropped_Time=600(596)
- Gameplay: Allow_Shoulder_Camera=True(2446)、Can_Suicide=True(2447)、Friendly_Fire=False(2448)、Allow_Freeform_Buildables=True(2457)

### per-mode（ItemsConfigData 构造函数 594-680，依赖 Commands.dat Mode）
- Spawn_Chance: Easy 0.35 / Normal 0.35 / Hard 0.15
- Respawn_Time: Easy 50 / Normal 100 / Hard 150
- Has_Durability: Easy False / Normal True / Hard True

### 无默认（Browser 段 string）
- Login_Token / Desc_Full / Desc_Server_List / Icon / Thumbnail —— SDK 无默认值，placeholder 留空

## 实施（commit 5a7d0d0）

### configTxtAdapter.ts
- `readBoolEntry(section, key, defaultVal=false)` 加第 3 参数——文件缺失时返回 SDK 默认而非恒 false（Config.txt 空值语义 = 用官方默认，server-configuration.rst:10）
- `EMPTY_TXT_FIELDS` bool 填 SDK 默认
- 新增 `TXT_FIELD_DEFAULTS`（固定值映射）+ `getModeDefaults(mode)`（per-mode 映射，未知 mode 按 Normal 兜底）

### ConfigPage.tsx
- fetchConfig 读取时 `readBoolEntry(..., SDK默认)` 显式传默认
- TxtSection 加 `currentMode` prop，string 字段 `getFieldPlaceholder(key, mode)` 动态渲染 placeholder（per-mode 字段随 Mode 切换变化）

### configTxtAdapter.test.ts
- bool 断言更新（SDK 默认 true→value=null / false→value='false'）
- 新增 getModeDefaults 测试（Easy/Normal/Hard/未知兜底）

## 验证
双端 typecheck 零错、前端单测 94/94（新增 getModeDefaults 用例）。

## tip 去行话（commit 737537f）

**用户报**：「当前生效 mode = （未配置）」+ tip 含 `[Items]/[Gameplay]` 段、`PlayConfigData.cs:2856-2873`、`per-mode 字段值` 等行内术语，普通玩家看不懂；且 mode 未配置应显示官方默认模式。

**改**：`formatModeLabel(mode)`——Easy/Normal/Hard → 简单/普通/困难（复用 COMMANDS_DAT_ENUMS.Mode），空/未知 → 「官方默认（普通）」（U3DS 未写 Mode 默认 Normal）。tip 正文改人话：「此页面的物品与玩法设置会应用到当前难度。留空的项目将采用 Unturned 官方默认值。如需切换难度，请到『Commands.dat』标签页修改『难度』并保存。」

`reference_ui_terms.md` 加 2 行对照（Mode→难度、per-mode/[Items][Gameplay]→物品与玩法设置）。doc-outdated-guard 无标记。

**教训**：上轮 5a7d0d0 专注默认值逻辑没检查文案——界面对话「我上一轮带进去的行话」。改默认值类功能后必须按 frontend-development.md §界面文案规范自查 + 术语表同步（强制）。

## 教训
- **BattlEye_Secure 在 SDK 副本里没默认值定义**（ServerConfigData 构造只看 VAC_Secure 等）——但实机 U3DS 生成的 Config.txt 注释有「Default: True」。**实机生成文件注释 = 官方默认值最权威真源**，比 SDK 源码更完整（U3DS 转换时把默认值写进注释）。
- per-mode 字段用 getModeDefaults 动态，不能写死一个值。
- 排坑：多个 Respawn_Time（Vehicles 300 / Animals 180 / Items per-mode）——必须区分 section，Items 段才是 UI 用。

## 关联
- `session-checkpoint-2026-08-14-workshop-console-fix.md`（同日）
- `session-checkpoint-2026-08-14-mod-download-queue-progress.md`（同日）
- `unturned-server-technical-reference.md`（AppID / Config.txt 结构）
- `.research/unturned-docs/servers/server-configuration.rst`（Config.txt 官方文档）