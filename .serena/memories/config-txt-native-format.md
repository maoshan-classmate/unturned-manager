# Config.txt 原生格式 + 字段定义表机制

## 格式（U3-SDK 原生 DAT）
- `Section { }` 大括号块 + `Key Value` 空格分隔 + `//` 注释（`// >` 为 U3DS 自动生成）+ `Version 1` 头
- 真源：`.research/U3-SDK/Assets/Runtime/UnturnedDat/DatTokenizer.cs` + `DatParser.cs`
- 裸 key（无 value）= 使用该字段官方默认值（`DatValueEx.cs:158`），不是强制 true
- 旧 `[Browser]` + `=` 格式 U3DS 读不懂 → 启动重建默认（已修复）

## 字段定义表（前端）
- `manager-web/src/pages/txtFieldDefs.ts`：`TXT_FIELD_DEFS` 196 字段（托管 18 + 未托管 178），`(section,key)` 复合唯一，含 key/label/type(bool|number|string)/range/def/min/max/section
- `manager-web/src/pages/perModeDefaults.ts`：`PER_MODE_DEFAULTS` 36 个 per-mode 字段 `{easy,normal,hard}` 默认值（bool 存布尔、数值存字符串）
- 前端托管 + 未托管字段统一从定义表查 label/type 渲染：bool 用 ConfigToggle、数值用 ConfigField 输入并 clamp min/max、placeholder 显示默认值（per-mode 按当前难度）
- 零字符串解析——per-mode 默认直接查表

## 保存策略
- `mergeTxtSections(rawSections, fields)`（configTxtAdapter.ts）：18 托管字段合并进完整 sections，保留未托管/注释/rawBlocks，避免数据丢失

## 参考
- `claudedocs/reference_config_files.md` §2.1-2.14：全部 196 字段权威表（含中文 label/允许值/默认值）
- `docs/architecture/config-txt-native-format.md`：格式设计文档