/**
 * configTxtAdapter 单测（BUG-2 闭环 owner 网，2026-08-13）。
 *
 * 颗粒度最小：只测 helper 4 个函数的纯逻辑，不引入 React/jsdom。
 * 边界覆盖：
 *   - section 不存在 / entries 不存在 / value=null / key 不存在 / 空串归一
 *   - bool 字段未勾选 = value="false"（保留已知键）
 *   - 全 false → 4 个 section 全 entries 全 known
 *   - 全填值 → entries 值正确回填
 */
import { describe, it, expect } from "vitest";
import type { ConfigSection } from "@unturned-manager/shared";
import {
  readStringEntry,
  readBoolEntry,
  boolEntry,
  stringEntry,
  buildTxtSections,
  EMPTY_TXT_FIELDS,
  type ConfigTxtFields,
} from "./configTxtAdapter.js";

// ─── readStringEntry ─────────────────────────────────────

describe("readStringEntry — section → string UI 字段", () => {
  it("section = undefined → 返回 ''", () => {
    expect(readStringEntry(undefined, "Login_Token")).toBe("");
  });

  it("entries 中找不到 key → 返回 ''", () => {
    const section: ConfigSection = {
      name: "浏览器",
      entries: [{ key: "Other", value: "x", comment: null, known: true }],
    };
    expect(readStringEntry(section, "Login_Token")).toBe("");
  });

  it("value 非 null → 返回原字符串", () => {
    const section: ConfigSection = {
      name: "浏览器",
      entries: [
        { key: "Login_Token", value: "abc123", comment: null, known: true },
      ],
    };
    expect(readStringEntry(section, "Login_Token")).toBe("abc123");
  });

  it("value = null → 返回 ''（未设置视作空）", () => {
    const section: ConfigSection = {
      name: "浏览器",
      entries: [
        { key: "Login_Token", value: null, comment: null, known: true },
      ],
    };
    expect(readStringEntry(section, "Login_Token")).toBe("");
  });
});

// ─── readBoolEntry ───────────────────────────────────────

describe("readBoolEntry — section → bool UI 字段", () => {
  it("section = undefined → 返回 false", () => {
    expect(readBoolEntry(undefined, "VAC反作弊")).toBe(false);
  });

  it("entries 中找不到 key → 返回 false", () => {
    const section: ConfigSection = {
      name: "服务器",
      entries: [{ key: "Other", value: null, comment: null, known: true }],
    };
    expect(readBoolEntry(section, "VAC反作弊")).toBe(false);
  });

  it("value = null + type=bool → 返回 true（裸 key 行 = 开关启用）", () => {
    const section: ConfigSection = {
      name: "服务器",
      entries: [
        { key: "VAC反作弊", value: null, comment: null, known: true, type: "bool" },
      ],
    };
    expect(readBoolEntry(section, "VAC反作弊")).toBe(true);
  });

  it("value = 'true' → 返回 true（显式 true 字符串）", () => {
    const section: ConfigSection = {
      name: "服务器",
      entries: [
        { key: "VAC反作弊", value: "true", comment: null, known: true, type: "bool" },
      ],
    };
    expect(readBoolEntry(section, "VAC反作弊")).toBe(true);
  });

  it("value = 'false' → 返回 false（显式 false 字符串——保留已知键场景）", () => {
    const section: ConfigSection = {
      name: "服务器",
      entries: [
        { key: "VAC反作弊", value: "false", comment: null, known: true, type: "bool" },
      ],
    };
    expect(readBoolEntry(section, "VAC反作弊")).toBe(false);
  });
});

// ─── boolEntry / stringEntry ────────────────────────────

describe("boolEntry — 已知键保留语义", () => {
  it("enabled=true → value=null + type=bool（裸 key 行 = 开关）", () => {
    expect(boolEntry("VAC反作弊", true)).toEqual({
      key: "VAC反作弊",
      value: null,
      comment: null,
      known: true,
      type: "bool",
    });
  });

  it("enabled=false → value='false' + type=bool（保留已知键，显式 false）", () => {
    expect(boolEntry("VAC反作弊", false)).toEqual({
      key: "VAC反作弊",
      value: "false",
      comment: null,
      known: true,
      type: "bool",
    });
  });
});

describe("stringEntry — 空串归一", () => {
  it("非空串 → value=原值 + type=string", () => {
    expect(stringEntry("Login_Token", "abc")).toEqual({
      key: "Login_Token",
      value: "abc",
      comment: null,
      known: true,
      type: "string",
    });
  });

  it("空串 → value=null（后端 serialize 不带等号，避免空 key= 行污染文件）", () => {
    expect(stringEntry("Login_Token", "")).toEqual({
      key: "Login_Token",
      value: null,
      comment: null,
      known: true,
      type: "string",
    });
  });
});

// ─── buildTxtSections ───────────────────────────────────

describe("buildTxtSections — UI 字段 → schema", () => {
  it("EMPTY_TXT_FIELDS → 4 个 section 全 entries + 全 known + 18 字段", () => {
    const sections = buildTxtSections(EMPTY_TXT_FIELDS);
    expect(sections).toHaveLength(4);
    expect(sections.map((s) => s.name)).toEqual([
      "浏览器",
      "服务器",
      "物品",
      "玩法开关",
    ]);
    const allEntries = sections.flatMap((s) => s.entries);
    // 5 + 5 + 4 + 4 = 18 entries
    expect(allEntries).toHaveLength(5 + 5 + 4 + 4);
    expect(allEntries.every((e) => e.known === true)).toBe(true);
    expect(allEntries.every((e) => e.comment === null)).toBe(true);
  });

  it("EMPTY_TXT_FIELDS → 所有 bool 字段 enabled=false 走 value='false' 保留", () => {
    const sections = buildTxtSections(EMPTY_TXT_FIELDS);
    const bools = sections.flatMap((s) =>
      s.entries.filter((e) => e.type === "bool"),
    );
    expect(bools.length).toBeGreaterThan(0);
    expect(bools.every((e) => e.value === "false")).toBe(true);
  });

  it("全填值 → entries 正确回填（string 直传 / bool=true value=null）", () => {
    const filled: ConfigTxtFields = {
      ...EMPTY_TXT_FIELDS,
      Login_Token: "tok-123",
      完整描述: "全服描述",
      最大Ping: "500",
      生成倍率: "2",
      掉落消失: "30",
      重生时间: "60",
      VAC反作弊: true,
      BattlEye: true,
      定时关机: true,
      物品耐久: true,
      肩后视角: true,
      自由建造: true,
      玩家伤害: true,
      允许自杀: true,
      更新自动关机: false,
    };
    const sections = buildTxtSections(filled);
    const get = (name: string, key: string) =>
      sections.find((s) => s.name === name)?.entries.find((e) => e.key === key);

    // string 字段：直传
    expect(get("浏览器", "Login_Token")?.value).toBe("tok-123");
    expect(get("浏览器", "完整描述")?.value).toBe("全服描述");
    expect(get("服务器", "最大Ping(ms)")?.value).toBe("500");
    expect(get("物品", "生成倍率")?.value).toBe("2");

    // bool 字段：enabled=true → value=null
    expect(get("服务器", "VAC反作弊")?.value).toBeNull();
    expect(get("服务器", "BattlEye")?.value).toBeNull();
    expect(get("服务器", "定时关机")?.value).toBeNull();
    expect(get("物品", "物品耐久")?.value).toBeNull();
    expect(get("玩法开关", "肩后视角")?.value).toBeNull();

    // bool 字段：enabled=false → value="false"（保留）
    expect(get("服务器", "更新自动关机")?.value).toBe("false");
  });

  it("空串 string 字段 → value=null（不被存为空 key= 行）", () => {
    const filled: ConfigTxtFields = {
      ...EMPTY_TXT_FIELDS,
      Login_Token: "",
    };
    const sections = buildTxtSections(filled);
    const entry = sections
      .find((s) => s.name === "浏览器")
      ?.entries.find((e) => e.key === "Login_Token");
    expect(entry?.value).toBeNull();
  });
});