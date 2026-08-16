---
name: session-checkpoint-2026-08-16-config-txt-format-fix
description: Config.txt 保存后变默认真正根因=写盘格式 Section 同行 + 区块外覆盖值丢失；commit 46c6410
metadata:
  type: project
---

# Config.txt 保存后变默认——真正根因（commit 46c6410）

用户反复反馈"高级设置编辑 Config.txt 保存后启动变默认"，多轮未解。U3-SDK 源码核对 + 实机文件复现后定位两个叠加根因：

1. **写盘格式错**：`serializeConfigTxt` 输出区块头 `Server {`（左花括号同行）。U3-SDK DatTokenizer 把 `{` 当字段值（key 后读非空白做 value），区块不打开 → 区块内字段全部掉 root 层 → U3DS 按区块名找字段找不到 → 全部用 SDK 默认。启动日志表现：每个区块的 `}` 报一次 `unexpected end of dictionary/object`（13 区块 = 13 次），行号即各区块闭合行。
2. **读取归位丢值**：U3DS 被格式错位搞乱后重写产生"双份"结构（区块内默认裸 key + 区块外 root 层散落覆盖值，如 `Spawn_Chance 0.8`）。`parseConfigTxt` 的 `}` 分支设 `hasCurrent=false`，后续 root 散落字段 push 进 currentSection 却永不落盘 → 覆盖值丢失。

修复（`ConfigService.ts`，2 处）：
- `serializeConfigTxt` 区块头改 `Section` 独立一行 + `{` 另起一行（U3DS DatWriter 原生格式）
- `parseConfigTxt` `}` 分支去掉 `hasCurrent=false`，散落覆盖字段归入刚结束区块由下次 flush 一起 dedup

验证：用含覆盖值双份文件实测，覆盖值全保留 + 重复 key 归零 + 区块头 U3DS 兼容；后端 typecheck 零错；`configService.test.ts` 17/17（新增"区块外散落覆盖字段归位"用例）。

相关：[[config-txt-native-format]]、95279bc 只修了重复 key 去重，未触及写盘格式与归位。
