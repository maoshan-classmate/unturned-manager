# Votify 关闭 = 不写整行

## 设计

`manager-web/src/pages/ConfigPage.tsx` `handleSave` 中 Votify 段：当 `VotifyAllow=false` 时**不写** Votify 行。

## 原因

Votify 是单行 6 字段复合命令（`CommandVotify.cs:18` `Parser.getComponentsFromSerial(_, '/')`）。若关闭投票仍写完整行（`Votify N/5/60/15/75/3`），玩家会困惑「关闭了投票为啥还有 5 个数字配置」。

不写 Votify 行 → U3DS 走 SDK 默认（`ChatManager.cs:76-81`）：`voteAllowed=false` + 5 数字默认（5/60/15/0.75/3）——投票关闭 + 数字无意义，正合语义。

## 启用时

`VotifyAllow=true` → 写完整 6 字段行 `Votify Y/PassCooldown/FailCooldown/Duration/Percentage/Players`。

## 颗粒度边界

仅修 Votify。Log 字段（4 字段复合 `CommandLog.cs:18`）保留「总是写盘」——因为 SDK 默认 Log `Y/Y/Y/N`，UI 上的"关闭记录聊天"等开关必须总是写盘才能覆盖 SDK 默认。

## 关联

- `claudedocs/reference_config_files.md` §1.6 Log / §1.7 Votify
- `commands-dat-default-values-landing`（基本设置默认值落地）