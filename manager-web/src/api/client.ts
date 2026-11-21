import axios from "axios";

export const apiClient = axios.create({
  baseURL: "/api",
  // 长任务（启动/install/update）后端要 30s+，10s 太短会提前掐断。
  timeout: 60000,
  headers: { "Content-Type": "application/json" },
});

let accessToken: string | null = null;

/**
 * 在飞的刷新请求——同一时刻所有调用方共用同一个 Promise。
 *
 * 背景：刷新令牌每次使用后会轮换（旧的立即撤销）。页面加载时「会话恢复」和
 * 「WebSocket 建连」会同时发起刷新，若各发一次请求，后到的那次必然拿到
 * 「已被撤销」而失败，并把刚存好的新令牌清掉——表现为每次刷新页面都要重新登录。
 * 单飞机制保证同一时刻只发一个刷新请求，其余调用方等待同一个结果。
 */
let refreshInFlight: Promise<string | null> | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function getAccessToken(): string | null {
  return accessToken;
}

/**
 * 用刷新令牌换取新的访问令牌——单飞（同一时刻只发一个请求）。
 *
 * 会话恢复、接口 401 重试、WebSocket 建连/重连都走这里，避免并发刷新
 * 互相撤销对方刚换发的新令牌。成功后新访问令牌写入内存、新刷新令牌写回本地存储。
 *
 * @returns 新的访问令牌；本地无刷新令牌或刷新失败返回 null（并清理本地凭据）
 */
export function refreshAccessToken(): Promise<string | null> {
  if (refreshInFlight) return refreshInFlight;

  const refreshToken = localStorage.getItem("refreshToken");
  if (!refreshToken) return Promise.resolve(null);

  refreshInFlight = (async () => {
    try {
      // 用裸 axios——不能走 apiClient，否则 401 会再次触发本拦截器形成递归
      const { data } = await axios.post("/api/auth/refresh", { refreshToken });
      setAccessToken(data.data.accessToken);
      localStorage.setItem("refreshToken", data.data.refreshToken);
      return data.data.accessToken as string;
    } catch {
      setAccessToken(null);
      localStorage.removeItem("refreshToken");
      return null;
    } finally {
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
}

/**
 * 从 JWT 里读取唯一标识（jti）——服务端按它撤销刷新令牌。
 * 解码失败返回 null，由调用方决定兜底方式。
 *
 * @param token - JWT 字符串
 * @returns jti 字符串；无法解析返回 null
 */
export function getTokenJti(token: string): string | null {
  try {
    const part = token.split(".")[1];
    if (!part) return null;
    const base64 = part.replace(/-/g, "+").replace(/_/g, "/");
    const payload = JSON.parse(atob(base64));
    return typeof payload.jti === "string" ? payload.jti : null;
  } catch {
    return null;
  }
}

/**
 * 判断 JWT accessToken 是否已过期（解码 payload 的 exp，不引第三方依赖）。
 * 解码失败或没有 exp 一律视为过期——触发刷新，避免用过期 token 建 WS 被拒。
 *
 * @param token - accessToken（JWT）
 * @returns true = 已过期 / 不可用
 *
 * @example
 * ```ts
 * if (isAccessTokenExpired(token)) { /* 需要 refresh *\/ }
 * ```
 */
export function isAccessTokenExpired(token: string): boolean {
  try {
    const part = token.split(".")[1];
    if (!part) return true;
    // JWT payload 是 base64url → base64 解码
    const base64 = part.replace(/-/g, "+").replace(/_/g, "/");
    const payload = JSON.parse(atob(base64));
    return typeof payload.exp !== "number" || payload.exp * 1000 <= Date.now();
  } catch {
    return true; // 解码失败视为不可用，走刷新
  }
}

/**
 * 读取 JWT accessToken 的 exp 字段（秒）——主动 refresh 调度用。
 * 解码失败返回 null，由调用方决定降级策略（立即 refresh / 等下次 401）。
 *
 * @param token - accessToken（JWT）
 * @returns exp 时间戳（毫秒）；解码失败返回 null
 */
export function getAccessTokenExpMs(token: string): number | null {
  try {
    const part = token.split(".")[1];
    if (!part) return null;
    const base64 = part.replace(/-/g, "+").replace(/_/g, "/");
    const payload = JSON.parse(atob(base64));
    return typeof payload.exp === "number" ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

/**
 * 确保拿到一个可用的 accessToken——内存里没有 **或已过期** 都主动用 refreshToken 刷新一次。
 * 过期即刷新，保证 WS 重连永远用有效 token。
 *
 * 复用 401 拦截器里的 refresh 逻辑,避免在 WS / HTTP 两处重复实现。
 *
 * @returns accessToken 字符串;refresh 失败返回 null
 *
 * @example
 * ```ts
 * const token = await ensureAccessToken();
 * if (!token) return; // 跳到登录页
 * const ws = new WebSocket(`/ws?token=${token}`);
 * ```
 */
export async function ensureAccessToken(): Promise<string | null> {
  if (accessToken && !isAccessTokenExpired(accessToken)) return accessToken;
  // 与会话恢复、401 重试共用单飞刷新——避免并发刷新互相撤销
  return refreshAccessToken();
}

// 请求拦截器：注入 JWT
apiClient.interceptors.request.use((config) => {
  if (accessToken) {
    config.headers.Authorization = `Bearer ${accessToken}`;
  }
  // 界面语言透传给后端（用于 Steam WebAPI QueryFiles/GetDetails 的 `language` 参数；默认 zh）。
  config.headers['X-I18n-Lang'] = 'zh';
  return config;
});

// 响应拦截器：401 自动刷新
apiClient.interceptors.response.use(
  (res) => res,
  async (error) => {
    if (error.response?.status === 401 && accessToken) {
      // 与会话恢复、WebSocket 建连共用单飞刷新——避免并发刷新互相撤销
      const token = await refreshAccessToken();
      if (!token) {
        window.location.href = "/login";
        return Promise.reject(error);
      }

      // 重试原请求（error.config 是原始配置，必须用新令牌覆盖 Authorization）
      error.config.headers.Authorization = `Bearer ${token}`;
      return axios(error.config);
    }
    return Promise.reject(error);
  },
);
