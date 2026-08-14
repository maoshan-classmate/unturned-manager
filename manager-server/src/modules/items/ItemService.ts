import type Database from "better-sqlite3";
import type {
  IItemService,
  ItemRecord,
} from "@unturned-manager/shared";
import { AppError } from "../../utils/AppError.js";
import { BUILTIN_ITEMS } from "./itemSeed.js";

// ─── 常量 ────────────────────────────────────────────────

/**
 * SQLite 唯一约束冲突判定（better-sqlite3 抛 SqliteError，code 形如
 * 'SQLITE_CONSTRAINT_UNIQUE'）——create/update 撞 ID 时映射为 409。
 */
function isUniqueConstraintError(err: unknown): boolean {
  return (
    err instanceof Error &&
    "code" in err &&
    typeof (err as { code?: unknown }).code === "string" &&
    (err as { code: string }).code.startsWith("SQLITE_CONSTRAINT")
  );
}

// ─── 实现 ────────────────────────────────────────────────

/**
 * 物品清单服务——全局物品 ID → 名称映射（开局物品选择器 + 名称反查共用）。
 *
 * 设计决策：
 * - 同步 better-sqlite3，路由直接返回，不引 async 样板。
 * - 内置种子只读是**服务端硬规则**（D11）——create/update/delete 对 builtin 行一律
 *   403，API 层绕过也会被拦，不是前端禁用就够。
 *
 * 设计来源：docs/architecture/loadout-item-editor-design.md §4.4。
 */
export class ItemService implements IItemService {
  constructor(private db: Database.Database) {}

  listItems(): ItemRecord[] {
    const rows = this.db
      .prepare("SELECT id, name, label, source FROM item_list ORDER BY id")
      .all() as ItemRecord[];
    return rows.map((r) => ({ ...r, label: r.label ?? null }));
  }

  createItem(input: { id: number; name: string; label?: string | null }): ItemRecord {
    try {
      this.db
        .prepare(
          "INSERT INTO item_list (id, name, label, source) VALUES (?, ?, ?, 'custom')",
        )
        .run(input.id, input.name, input.label?.trim() ? input.label : null);
    } catch (err) {
      if (isUniqueConstraintError(err)) {
        throw new AppError("item-id-exists", "该物品 ID 已存在", 409);
      }
      throw err;
    }
    return { id: input.id, name: input.name, source: "custom" };
  }

  updateItem(
    id: number,
    input: { id?: number; name?: string; label?: string | null },
  ): ItemRecord {
    const existing = this.getById(id);
    if (!existing) {
      throw new AppError("item-not-found", "物品不存在", 404);
    }
    if (existing.source === "builtin") {
      throw new AppError(
        "builtin-item-readonly",
        "内置物品不可修改，只能管理自定义物品",
        403,
      );
    }

    const newId = input.id ?? id;
    const newName = input.name ?? existing.name;
    // label 显式传才更新（undefined = 不改；null = 清空回落 name）
    const newLabel =
      input.label !== undefined
        ? input.label?.trim()
          ? input.label
          : null
        : (existing.label ?? null);

    // 改 ID 时校验新 ID 未被占用（updateItem 允许改 ID——D11 自定义全可编辑）
    if (newId !== id) {
      const collision = this.getById(newId);
      if (collision) {
        throw new AppError("item-id-exists", "该物品 ID 已存在", 409);
      }
    }

    this.db
      .prepare(
        "UPDATE item_list SET id = ?, name = ?, label = ?, updated_at = datetime('now') WHERE id = ?",
      )
      .run(newId, newName, newLabel, id);

    return { id: newId, name: newName, label: newLabel, source: existing.source };
  }

  deleteItem(id: number): void {
    const existing = this.getById(id);
    if (!existing) {
      throw new AppError("item-not-found", "物品不存在", 404);
    }
    if (existing.source === "builtin") {
      throw new AppError(
        "builtin-item-readonly",
        "内置物品不可修改，只能管理自定义物品",
        403,
      );
    }
    this.db.prepare("DELETE FROM item_list WHERE id = ?").run(id);
  }

  seedBuiltinItems(): void {
    // 幂等插入缺失行 + 对已存在内置行同步 name/label（INSERT OR IGNORE 不更新已存在行——
    // 若服务器在加 label 前灌过种子，必须在此重刷，否则内置 label 永远是 NULL）
    const insert = this.db.prepare(
      "INSERT OR IGNORE INTO item_list (id, name, label, source) VALUES (?, ?, ?, 'builtin')",
    );
    const sync = this.db.prepare(
      "UPDATE item_list SET name = ?, label = ? WHERE id = ? AND source = 'builtin'",
    );
    this.db.transaction(() => {
      for (const item of BUILTIN_ITEMS) {
        insert.run(item.id, item.name, item.label ?? null);
        sync.run(item.name, item.label ?? null, item.id);
      }
    })();
  }

  /** 按 ID 查单条——内部复用 */
  private getById(id: number): ItemRecord | null {
    const row = this.db
      .prepare("SELECT id, name, label, source FROM item_list WHERE id = ?")
      .get(id) as ItemRecord | undefined;
    return row ?? null;
  }
}
