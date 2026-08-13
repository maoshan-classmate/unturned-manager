/**
 * configTxtAdapter 单测（BUG-2 闭环 owner 网，2026-08-13；Bug B-1 英文 key 同步 2026-08-13）。
 *
 * 颗粒度最小：只测 helper 4 个函数的纯逻辑，不引入 React/jsdom。
 * 边界覆盖：
 *   - section 不存在 / entries 不存在 / value=null / key 不存在 / 空串归一
 *   - bool 字段未勾选 = value="false"（保留已知键）
 *   - 全 false → 4 个 section 全 entries 全 known
 *   - 全填值 → entries 值正确回填
 *
 * Bug B-1：所有 key 改用 SDK 英文（PlayConfigData.cs C# 字段名）——U3DS 反射 FieldInfo.Name 精确匹配。
 * section 名改用 SDK 英文（Browser / Server / Items / Gameplay）。
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
      name: "Browser",
      entries: [{ key: "Other", value: "x", comment: null, known: true }],
    };
    expect(readStringEntry(section, "Login_Token")).toBe("");
  });

  it("value 非 null → 返回原字符串", () => {
    const section: ConfigSection = {
      name: "Browser",
      entries: [
        { key: "Login_Token", value: "abc123", comment: null, known: true },
      ],
    };
    expect(readStringEntry(section, "Login_Token")).toBe("abc123");
  });

  it("value = null → 返回 ''（未设置视作空）", () => {
    const section: ConfigSection = {
      name: "Browser",
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
    expect(readBoolEntry(undefined, "VAC_Secure")).toBe(false);
  });

  it("entries 中找不到 key → 返回 false", () => {
    const section: ConfigSection = {
      name: "Server",
      entries: [{ key: "Other", value: null, comment: null, known: true }],
    };
    expect(readBoolEntry(section, "VAC_Secure")).toBe(false);
  });

  it("value = null + type=bool → 返回 true（裸 key 行 = 开关启用）", () => {
    const section: ConfigSection = {
      name: "Server",
      entries: [
        { key: "VAC_Secure", value: null, comment: null, known: true, type: "bool" },
      ],
    };
    expect(readBoolEntry(section, "VAC_Secure")).toBe(true);
  });

  it("value = 'true' → 返回 true（显式 true 字符串）", () => {
    const section: ConfigSection = {
      name: "Server",
      entries: [
        { key: "VAC_Secure", value: "true", comment: null, known: true, type: "bool" },
      ],
    };
    expect(readBoolEntry(section, "VAC_Secure")).toBe(true);
  });

  it("value = 'false' → 返回 false（显式 false 字符串——保留已知键场景）", () => {
    const section: ConfigSection = {
      name: "Server",
      entries: [
        { key: "VAC_Secure", value: "false", comment: null, known: true, type: "bool" },
      ],
    };
    expect(readBoolEntry(section, "VAC_Secure")).toBe(false);
  });
});

// ─── boolEntry / stringEntry ────────────────────────────

describe("boolEntry — 已知键保留语义", () => {
  it("enabled=true → value=null + type=bool（裸 key 行 = 开关）", () => {
    expect(boolEntry("VAC_Secure", true)).toEqual({
      key: "VAC_Secure",
      value: null,
      comment: null,
      known: true,
      type: "bool",
    });
  });

  it("enabled=false → value='false' + type=bool（保留已知键，显式 false）", () => {
    expect(boolEntry("VAC_Secure", false)).toEqual({
      key: "VAC_Secure",
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
      "Browser",
      "Server",
      "Items",
      "Gameplay",
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
      Desc_Full: "全服描述",
      Max_Ping_Milliseconds: "500",
      Spawn_Chance: "0.35",
      Despawn_Dropped_Time: "600",
      Respawn_Time: "100",
      VAC_Secure: true,
      BattlEye_Secure: true,
      Enable_Scheduled_Shutdown: true,
      Has_Durability: true,
      Allow_Shoulder_Camera: true,
      Allow_Freeform_Buildables: true,
      Friendly_Fire: true,
      Can_Suicide: true,
      Enable_Update_Shutdown: false,
    };
    const sections = buildTxtSections(filled);
    const get = (name: string, key: string) =>
      sections.find((s) => s.name === name)?.entries.find((e) => e.key === key);

    // string 字段：直传
    expect(get("Browser", "Login_Token")?.value).toBe("tok-123");
    expect(get("Browser", "Desc_Full")?.value).toBe("全服描述");
    expect(get("Server", "Max_Ping_Milliseconds")?.value).toBe("500");
    expect(get("Items", "Spawn_Chance")?.value).toBe("0.35");

    // bool 字段：enabled=true → value=null
    expect(get("Server", "VAC_Secure")?.value).toBeNull();
    expect(get("Server", "BattlEye_Secure")?.value).toBeNull();
    expect(get("Server", "Enable_Scheduled_Shutdown")?.value).toBeNull();
    expect(get("Items", "Has_Durability")?.value).toBeNull();
    expect(get("Gameplay", "Allow_Shoulder_Camera")?.value).toBeNull();

    // bool 字段：enabled=false → value="false"（保留）
    expect(get("Server", "Enable_Update_Shutdown")?.value).toBe("false");
  });

  it("空串 string 字段 → value=null（不被存为空 key= 行）", () => {
    const filled: ConfigTxtFields = {
      ...EMPTY_TXT_FIELDS,
      Login_Token: "",
    };
    const sections = buildTxtSections(filled);
    const entry = sections
      .find((s) => s.name === "Browser")
      ?.entries.find((e) => e.key === "Login_Token");
    expect(entry?.value).toBeNull();
  });
});
