/**
 * 轻量 HTTP GET 客户端（undici fetch 封装）。
 *
 * index.ts 启动时已全局剥离 HTTP_PROXY / HTTPS_PROXY 并配置 undici Agent
 * （connectTimeout/headersTimeout/bodyTimeout 30s）——这里只负责：
 *   - 注入默认 Accept 头 + 调用方自定义头（GitHub API 要求 Accept + User-Agent）
 *   - AbortSignal.timeout 超时兜底（fetch 抛 TimeoutError，调用方 catch 降级）
 *   - 响应转成 { ok, status, headers(小写 key), body } 形态——调用方能读
 *     `x-ratelimit-remaining` 这类响应头做限流判断
 *
 * 只在 body 是 JSON 时成功解析；非 JSON（HTML / 空）返回 body=null。
 * 网络失败 / 超时向上抛 Error——由调用方决定降级还是抛 AppError。
 */

/** 统一 HTTP 响应形态——headers 全部小写 key（读 x-ratelimit-* 方便） */
export interface HttpClientResponse<T = unknown> {
  ok: boolean;
  status: number;
  headers: Record<string, string>;
  body: T;
}

/** httpClient.get 选项 */
export interface HttpClientOptions {
  headers?: Record<string, string>;
  timeoutMs?: number;
}

/** 默认超时（15s——GitHub API 冷启动实测 < 1s，留 15x 余量） */
const DEFAULT_TIMEOUT_MS = 15_000;

export const httpClient = {
  /**
   * GET 请求。
   *
   * @param url - 完整 URL
   * @param options - headers（合并到默认 Accept）+ timeoutMs
   * @returns 响应 { ok, status, headers, body }
   * @throws 网络失败 / 超时时抛 Error（不包装成 AppError——由业务层决定错误码）
   *
   * @example
   * ```ts
   * const res = await httpClient.get('https://api.github.com/rate_limit', {
   *   headers: { Authorization: `Bearer ${pat}` },
   *   timeoutMs: 5_000,
   * });
   * if (res.status === 403 && res.headers['x-ratelimit-remaining'] === '0') { /* 限流 *\/ }
   * ```
   */
  async get<T = unknown>(
    url: string,
    options: HttpClientOptions = {},
  ): Promise<HttpClientResponse<T>> {
    const { headers = {}, timeoutMs = DEFAULT_TIMEOUT_MS } = options;
    const res = await fetch(url, {
      headers: { Accept: "application/json", ...headers },
      signal: AbortSignal.timeout(timeoutMs),
    });

    // Headers → 小写 key Record（GitHub 限流头 x-ratelimit-* 读取用）
    const headerMap: Record<string, string> = {};
    res.headers.forEach((value, key) => {
      headerMap[key.toLowerCase()] = value;
    });

    let body: T = null as T;
    try {
      body = (await res.json()) as T;
    } catch {
      body = null as T; // 非 JSON（HTML / 空响应）——调用方按 status 处理
    }
    return { ok: res.ok, status: res.status, headers: headerMap, body };
  },
};
