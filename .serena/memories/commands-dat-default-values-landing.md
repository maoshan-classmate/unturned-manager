# Commands.dat 默认值实际写入文件

## 设计

`manager-web/src/pages/ConfigPage.tsx` 的 `EMPTY_FIELDS` 把 11 个公共字段填入 SDK 真源默认值：

| 字段 | SDK 默认值 | 来源 |
|---|---|---|
| Name | `Unturned` | `Provider.cs:6617-6621` |
| Port | `27015` | `Provider.cs:6625` |
| MaxPlayers | `8` | `Provider.cs:6615` |
| Map | `PEI` | `Provider.cs:6627` |
| Mode | `Normal` | `Provider.cs:6642` |
| Perspective | `First` | `Provider.cs:6645` |
| Chatrate | `0.25` | `ChatManager.cs:74` |
| Cycle | `3600` | `LightingManager.cs:852/883` |
| Timeout | `750` | `PlayConfigData.cs:404` |
| Queue_Size | `8` | `Provider.cs:6616` |
| Bind | `0` | `Provider.cs:6624` |

**保留空串**（私人字段不应自动落盘）：`Owner` / `GSLT` / `Password`。

## 保存行为

`handleSave` 走「非空即写」原则：`if (val) known.set(key, ...)`——空字符串不写盘（用户主动清空 → 不写行 → U3DS 兜底走 SDK 默认）。

`Log` 和 `Votify` 复合字段硬编码 `known.set(...)` 不受空值过滤。

## 用户清空语义

- 用户**从未动过**字段（值 = `EMPTY_FIELDS` 默认）→ 保存时写盘（UI 与磁盘一致）
- 用户**主动清空**字段（值 = `""`）→ 保存时不写盘（U3DS 走 SDK 默认）
- 用户**改了值**（值 ≠ `""`）→ 保存时写盘

## 验证

- 后端 `tests/configService.test.ts` 15/15 通过（行为不变：`serializeCommandsDat` 把 known 里每个键写成一行）
- 前端 typecheck 0；前端 117/120（3 失败为 LoadoutItemDialog 遗留类型断言，与本次改动无关）

## 真机验证（留用户）

需 U3DS 启动检查 Commands.dat 写入后无 Unknown entry。

## 关联

- `claudedocs/reference_config_files.md` §1.1-1.5 SDK 真源表
- `session-checkpoint-2026-08-12-commands-defaults.md`（Votify/Log 复合字段落地历史）