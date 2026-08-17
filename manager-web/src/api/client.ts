import axios from "axios";

export const apiClient = axios.create({
  baseURL: "/api",
  // BUG-3/7 修复（第五版）：U3DS 启动 + PTY 就绪后端要 30s+，老 10s 上限把 HTTP 提前掐断
  // → 前端报 "timeout of 10000ms exceeded"。按路由分组，长任务（启动/install/update）单独拉长。
  timeout: 60000,
  headers: { "Content-Type": "application/json" },
});

let accessToken: string | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function getAccessToken(): string | null {
  return accessToken;
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
 *
 * ★ BUG-FIX（WS 断线重连）：原实现 `if (accessToken) return accessToken` 不检查 15 分钟过期——
 * WS 断线重连时拿过期 token 建连，被 gateway verifyClient 拒绝，退避重连反复失败 → 永久断。
 * 现在过期即刷新，保证 WS 重连永远用有效 token。
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
  const refreshToken = localStorage.getItem("refreshToken");
  if (!refreshToken) return null;
  try {
    const { data } = await axios.post("/api/auth/refresh", { refreshToken });
    setAccessToken(data.data.accessToken);
    localStorage.setItem("refreshToken", data.data.refreshToken);
    return data.data.accessToken;
  } catch {
    setAccessToken(null);
    localStorage.removeItem("refreshToken");
    return null;
  }
}

// 请求拦截器：注入 JWT
apiClient.interceptors.request.use((config) => {
  if (accessToken) {
    config.headers.Authorization = `Bearer ${accessToken}`;
  }
  // 界面语言透传给后端（用于 Steam WebAPI QueryFiles/GetDetails 的 `language` 参数；
  // 默认 zh 与 DST 项目对齐，详见 .research/dst-management-platform-api/app/mod/utils.go:90-96）。
  // 二期做 Settings 语言下拉时改为读用户偏好。
  config.headers['X-I18n-Lang'] = 'zh';
  return config;
});

// 响应拦截器：401 自动刷新
apiClient.interceptors.response.use(
  (res) => res,
  async (error) => {
    if (error.response?.status === 401 && accessToken) {
      try {
        const { data } = await axios.post("/api/auth/refresh", {
          refreshToken: localStorage.getItem("refreshToken"),
        });
        setAccessToken(data.data.accessToken);
        localStorage.setItem("refreshToken", data.data.refreshToken);

        // 重试原请求
        error.config.headers.Authorization = `Bearer ${data.data.accessToken}`;
        return axios(error.config);
      } catch {
        setAccessToken(null);
        localStorage.removeItem("refreshToken");
        window.location.href = "/login";
      }
    }
    return Promise.reject(error);
  },
);
