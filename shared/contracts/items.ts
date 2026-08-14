/**
 * 物品清单契约——全局物品 ID → 名称映射（开局物品选择器 + 名称反查共用）。
 * 设计来源：docs/architecture/loadout-item-editor-design.md §4。
 */

/** 物品来源：内置种子（只读）| 用户自定义（可 CRUD） */
export type ItemSource = "builtin" | "custom";

/** 物品清单记录 */
export interface ItemRecord {
  /** 物品 ID（0–65535，全局唯一） */
  id: number;
  /** 源名（内置=wiki 英文名；自定义=用户输入） */
  name: string;
  /** 中文显示名（仅前端 UI 显示，不参与 Commands.dat 序列化）；空 → 回落 name */
  label?: string | null;
  /** 来源——驱动只读规则 */
  source: ItemSource;
}

/** 物品清单服务——同步 better-sqlite3 CRUD。 */
export interface IItemService {
  /**
   * 全量物品清单（按 ID 升序）——客户端搜索用，量级几百条，无需分页。
   * @returns 全部物品记录（内置 + 自定义）
   */
  listItems(): ItemRecord[];

  /**
   * 新增自定义物品。
   * @param input - { id: 物品 ID, name: 名称, label?: 中文显示名 }
   * @returns 新建记录（source='custom'）
   * @throws AppError('item-id-exists', 409) ID 已存在
   */
  createItem(input: { id: number; name: string; label?: string | null }): ItemRecord;

  /**
   * 修改自定义物品（ID / 名称 / 中文显示名，至少一项）。内置物品只读——禁止修改。
   * @param id - 目标物品 ID
   * @param input - 可改字段：id（新 ID）/ name / label
   * @returns 更新后的记录
   * @throws AppError('item-not-found', 404) 物品不存在
   * @throws AppError('builtin-item-readonly', 403) 内置物品只读
   * @throws AppError('item-id-exists', 409) 新 ID 已被占用
   */
  updateItem(
    id: number,
    input: { id?: number; name?: string; label?: string | null },
  ): ItemRecord;

  /**
   * 删除自定义物品。内置物品只读——禁止删除。
   * @param id - 目标物品 ID
   * @throws AppError('item-not-found', 404) 物品不存在
   * @throws AppError('builtin-item-readonly', 403) 内置物品只读
   */
  deleteItem(id: number): void;

  /**
   * 播种内置种子（INSERT OR IGNORE，幂等可自愈）——composition-root 启动调用一次。
   * 内置只读 → 用户删不掉 → 无需「重新导入」按钮。
   */
  seedBuiltinItems(): void;
}
