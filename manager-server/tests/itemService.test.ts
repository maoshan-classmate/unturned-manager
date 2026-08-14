import { describe, it, expect, beforeEach, vi } from "vitest";
import Database from "better-sqlite3";
import { ItemService } from "../src/modules/items/ItemService.js";
import { AppError } from "../src/utils/AppError.js";

// 注入假内置种子——真实播种行为（INSERT OR IGNORE 幂等/不覆盖自定义）
vi.mock("../src/modules/items/itemSeed.js", () => ({
  BUILTIN_ITEMS: [
    { id: 100, name: "测试内置A" },
    { id: 101, name: "测试内置B" },
  ],
}));

/** 内存 DB + item_list 表（对齐迁移 006 + 007 的 DDL，含 label 列） */
function createDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE IF NOT EXISTS item_list (
      id         INTEGER PRIMARY KEY,
      name       TEXT NOT NULL,
      label      TEXT,
      source     TEXT NOT NULL DEFAULT 'custom'
                   CHECK (source IN ('builtin','custom')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  return db;
}

describe("ItemService — 物品清单 CRUD", () => {
  let db: Database.Database;
  let service: ItemService;

  beforeEach(() => {
    db = createDb();
    service = new ItemService(db);
  });

  describe("listItems", () => {
    it("空表返回空数组", () => {
      expect(service.listItems()).toEqual([]);
    });

    it("按 ID 升序返回全部", () => {
      service.createItem({ id: 15, name: "军刀" });
      service.createItem({ id: 1, name: "手枪" });
      const rows = service.listItems();
      expect(rows.map((r) => r.id)).toEqual([1, 15]);
      expect(rows[0]).toMatchObject({ id: 1, name: "手枪", source: "custom" });
    });
  });

  describe("createItem", () => {
    it("新增自定义物品", () => {
      const item = service.createItem({ id: 9999, name: "自定义MOD物品" });
      expect(item).toEqual({ id: 9999, name: "自定义MOD物品", source: "custom" });
      expect(service.listItems()).toHaveLength(1);
    });

    it("重复 ID → AppError 409 item-id-exists", () => {
      service.createItem({ id: 1, name: "手枪" });
      try {
        service.createItem({ id: 1, name: "另一个名字" });
        expect.unreachable("应抛 AppError");
      } catch (err) {
        expect(err).toBeInstanceOf(AppError);
        expect((err as AppError).code).toBe("item-id-exists");
        expect((err as AppError).status).toBe(409);
      }
    });
  });

  describe("updateItem", () => {
    it("改名", () => {
      service.createItem({ id: 1, name: "手枪" });
      const updated = service.updateItem(1, { name: "手枪（改）" });
      expect(updated).toMatchObject({ id: 1, name: "手枪（改）", source: "custom" });
    });

    it("改 ID", () => {
      service.createItem({ id: 1, name: "手枪" });
      const updated = service.updateItem(1, { id: 99 });
      expect(updated).toMatchObject({ id: 99, name: "手枪", source: "custom" });
      expect(service.listItems().map((r) => r.id)).toEqual([99]);
    });

    it("改 ID 撞已存在 → AppError 409", () => {
      service.createItem({ id: 1, name: "手枪" });
      service.createItem({ id: 2, name: "军刀" });
      try {
        service.updateItem(1, { id: 2 });
        expect.unreachable("应抛 AppError");
      } catch (err) {
        expect((err as AppError).code).toBe("item-id-exists");
      }
    });

    it("内置物品 → AppError 403 builtin-item-readonly", () => {
      db.prepare(
        "INSERT INTO item_list (id, name, source) VALUES (?, ?, 'builtin')",
      ).run(1, "手枪");
      try {
        service.updateItem(1, { name: "改名" });
        expect.unreachable("应抛 AppError");
      } catch (err) {
        expect((err as AppError).code).toBe("builtin-item-readonly");
        expect((err as AppError).status).toBe(403);
      }
    });

    it("不存在 → AppError 404 item-not-found", () => {
      try {
        service.updateItem(999, { name: "x" });
        expect.unreachable("应抛 AppError");
      } catch (err) {
        expect((err as AppError).code).toBe("item-not-found");
        expect((err as AppError).status).toBe(404);
      }
    });
  });

  describe("deleteItem", () => {
    it("删除自定义物品", () => {
      service.createItem({ id: 1, name: "手枪" });
      service.deleteItem(1);
      expect(service.listItems()).toEqual([]);
    });

    it("内置物品 → AppError 403", () => {
      db.prepare(
        "INSERT INTO item_list (id, name, source) VALUES (?, ?, 'builtin')",
      ).run(1, "手枪");
      try {
        service.deleteItem(1);
        expect.unreachable("应抛 AppError");
      } catch (err) {
        expect((err as AppError).code).toBe("builtin-item-readonly");
      }
    });

    it("不存在 → AppError 404", () => {
      try {
        service.deleteItem(999);
        expect.unreachable("应抛 AppError");
      } catch (err) {
        expect((err as AppError).code).toBe("item-not-found");
      }
    });
  });

  describe("seedBuiltinItems", () => {
    it("播种内置种子（source=builtin），幂等不重复插入", () => {
      service.seedBuiltinItems();
      service.seedBuiltinItems();
      const rows = service.listItems();
      expect(rows).toHaveLength(2);
      expect(rows.map((r) => r.id)).toEqual([100, 101]);
      expect(rows.every((r) => r.source === "builtin")).toBe(true);
    });

    it("不覆盖自定义物品（自定义先占同 ID）", () => {
      service.createItem({ id: 100, name: "自定义占位" });
      service.seedBuiltinItems();
      const row = service.listItems().find((r) => r.id === 100);
      expect(row).toMatchObject({ name: "自定义占位", source: "custom" });
    });
  });
});
