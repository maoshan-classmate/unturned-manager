# Loadout（开局物品）支持重复 itemID

Loadout 命令（开局物品）允许同一 itemID 重复出现：U3DS `Loadout 0/1/1` 合法，玩家开局获得多个同类物品。

- 前端物品选择弹窗允许重复添加（`LoadoutItemDialog.addTag` 不去重）
- 同一 ID 出现 ≥2 次时合并显示为单个标签 + `×N` 徽章
- 删除按钮移除该 ID 的全部出现（非单个）
- 后端 schema/序列化天然支持重复（`LoadoutEntrySchema.itemIds` 数组）

真源：U3-SDK `CommandLoadout.cs:13-49`（`/` 分隔，重复合法）。
