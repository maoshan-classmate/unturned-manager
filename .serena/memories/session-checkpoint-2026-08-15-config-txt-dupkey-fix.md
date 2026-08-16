# Config.txt 重复 key 覆盖 + 小数输入 + 默认值显示（2026-08-15）

## Bug 1：配置启动后变默认（根因 = 重复 key 覆盖）
U3DS 每次启动写回 Config.txt 时生成「基础裸 key + override 带值」双份结构（如 Zombies 段 `Spawn_Chance` 与 `Spawn_Chance 0` 并存）。
U3-SDK 解析用 DatParser.cs:145 `underlyingDictionary[key] = value`（Dictionary indexer）——重复 key 时**最后一条生效**。
面板此前保留双份 entries、保存只更新第一条 → 用户值写进第一份，U3DS 读最后一份旧值 → 启动后配置「变默认」。
修复：ConfigService.parseConfigTxt 合并重复 key（同 key 保留最后一条，与 DatParser 语义对齐）；前端 mergeTxtSections 更新所有同 key entry。

## Bug 2：细节调整不能输入小数
clampNumber 对输入中间态 "0." 做 Number() 归一 → 返回 "0" 吃掉小数点 → 继续输入 5 得 "05"→5→clamp 到 1 → 0-1 区间只能输 0 或 1。
修复：clampNumber 未越界时保留原始输入字符串，仅越界时截断。

## 默认值显示（用户拍板：界面显示默认值，保存留空）
新增 commentDefaultToPreview：解析 U3DS 自动注释 `// > Default: 604800` / `// > Easy: 0.35  Normal: 0.35  Hard: 0.15`，按当前难度显示「默认 X」。
裸 key = 用官方默认是 U3DS 官方机制（Provider.cs:2423-2439 官方注释：Settings without a value use the default for the mode）。

## 验证
commit 95279bc（5 文件：ConfigService.ts / configTxtAdapter.ts / ConfigPage.tsx + 2 测试）。
后端 ConfigService 16/16、前端 configTxtAdapter 22/22、双端全量 349+162 通过（3 失败 = steamCmdManager mock 串台历史 backlog，与本次无关）。
e2e 路由可达 + Loadout 编辑器通过（.test-install 缺 ApiServer 实例已补建）。

## 实机注意
实机双份 Config.txt 需在面板重新保存一次收敛为单份。