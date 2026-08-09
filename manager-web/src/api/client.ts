import axios from 'axios';

export const apiClient = axios.create({
  baseURL: '/api',
  timeout: 10000,
  headers: { 'Content-Type': 'application/json' },
});

let accessToken: string | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function getAccessToken(): string | null {
  return accessToken;
}

/**
 * 确保拿到一个可用的 accessToken——若内存里没有或调用方怀疑已过期,
 * 主动用 refreshToken 刷新一次。失败返回 null,调用方决定是否重建 WS。
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
  if (accessToken) return accessToken;
  const refreshToken = localStorage.getItem('refreshToken');
  if (!refreshToken) return null;
  try {
    const { data } = await axios.post('/api/auth/refresh', { refreshToken });
    setAccessToken(data.data.accessToken);
    localStorage.setItem('refreshToken', data.data.refreshToken);
    return data.data.accessToken;
  } catch {
    setAccessToken(null);
    localStorage.removeItem('refreshToken');
    return null;
  }
}

// 请求拦截器：注入 JWT
apiClient.interceptors.request.use((config) => {
  if (accessToken) {
    config.headers.Authorization = `Bearer ${accessToken}`;
  }
  return config;
});

// 响应拦截器：401 自动刷新
apiClient.interceptors.response.use(
  (res) => res,
  async (error) => {
    if (error.response?.status === 401 && accessToken) {
      try {
        const { data } = await axios.post('/api/auth/refresh', {
          refreshToken: localStorage.getItem('refreshToken'),
        });
        setAccessToken(data.data.accessToken);
        localStorage.setItem('refreshToken', data.data.refreshToken);

        // 重试原请求
        error.config.headers.Authorization = `Bearer ${data.data.accessToken}`;
        return axios(error.config);
      } catch {
        setAccessToken(null);
        localStorage.removeItem('refreshToken');
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  },
);
