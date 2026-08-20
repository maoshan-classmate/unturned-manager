import { describe, expect, it } from "vitest";
import { getItemIconUrl } from "../../lib/itemIcon.js";

describe("getItemIconUrl", () => {
  it("合法 ushort 返回 /items/<id>.png", () => {
    expect(getItemIconUrl(0)).toBe("/items/0.png");
    expect(getItemIconUrl(1100)).toBe("/items/1100.png");
    expect(getItemIconUrl(65535)).toBe("/items/65535.png");
  });

  it("null/undefined 返回 null", () => {
    expect(getItemIconUrl(null)).toBeNull();
    expect(getItemIconUrl(undefined)).toBeNull();
  });

  it("越界 ID 返回 null", () => {
    expect(getItemIconUrl(-1)).toBeNull();
    expect(getItemIconUrl(65536)).toBeNull();
    expect(getItemIconUrl(99999)).toBeNull();
  });

  it("非有限数返回 null", () => {
    expect(getItemIconUrl(Number.NaN)).toBeNull();
    expect(getItemIconUrl(Number.POSITIVE_INFINITY)).toBeNull();
    expect(getItemIconUrl(Number.NEGATIVE_INFINITY)).toBeNull();
  });
});