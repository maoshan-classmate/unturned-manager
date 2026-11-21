import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import axios from "axios";
import {
  refreshAccessToken,
  ensureAccessToken,
  getTokenJti,
  setAccessToken,
} from "./client.js";

/** 构造一个带 jti 的假 JWT（payload 部分用 base64url） */
function makeToken(jti: string): string {
  const payload = Buffer.from(
    JSON.stringify({ jti, exp: Math.floor(Date.now() / 1000) + 3600 }),
  ).toString("base64url");
  return `header.${payload}.signature`;
}

describe("刷新令牌单飞", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    setAccessToken(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("并发调用只发一个刷新请求，且都拿到同一个新令牌", async () => {
    localStorage.setItem("refreshToken", makeToken("old-jti"));
    const newAccess = makeToken("new-access");
    const newRefresh = makeToken("new-jti");

    let resolveRequest!: (value: unknown) => void;
    const postSpy = vi.spyOn(axios, "post").mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRequest = resolve;
        }),
    );

    const first = refreshAccessToken();
    const second = refreshAccessToken();
    const third = ensureAccessToken(); // 内存无 token → 也走刷新

    expect(postSpy).toHaveBeenCalledTimes(1);

    resolveRequest({
      data: { data: { accessToken: newAccess, refreshToken: newRefresh } },
    });

    const [a, b, c] = await Promise.all([first, second, third]);
    expect(a).toBe(newAccess);
    expect(b).toBe(newAccess);
    expect(c).toBe(newAccess);
    expect(localStorage.getItem("refreshToken")).toBe(newRefresh);
  });

  it("刷新失败时清理本地凭据，返回 null", async () => {
    localStorage.setItem("refreshToken", makeToken("old-jti"));
    vi.spyOn(axios, "post").mockRejectedValue(new Error("401"));

    const result = await refreshAccessToken();

    expect(result).toBeNull();
    expect(localStorage.getItem("refreshToken")).toBeNull();
  });

  it("没有本地刷新令牌时直接返回 null，不发请求", async () => {
    const postSpy = vi.spyOn(axios, "post");
    const result = await refreshAccessToken();
    expect(result).toBeNull();
    expect(postSpy).not.toHaveBeenCalled();
  });

  it("单飞结束后再次刷新会重新发请求（不永久缓存）", async () => {
    localStorage.setItem("refreshToken", makeToken("old-jti"));
    const postSpy = vi.spyOn(axios, "post").mockResolvedValue({
      data: {
        data: {
          accessToken: makeToken("a1"),
          refreshToken: makeToken("r1"),
        },
      },
    });

    await refreshAccessToken();
    await refreshAccessToken();

    expect(postSpy).toHaveBeenCalledTimes(2);
  });
});

describe("读取令牌标识", () => {
  it("能从 JWT 里解析出 jti", () => {
    expect(getTokenJti(makeToken("abc-123"))).toBe("abc-123");
  });

  it("无效令牌返回 null", () => {
    expect(getTokenJti("not-a-jwt")).toBeNull();
  });
});
