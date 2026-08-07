import { createContext, useContext, useState, useCallback, useEffect, useRef, type ReactNode } from 'react';
import { apiClient, setAccessToken } from '../api/client.js';

interface AuthState {
  isAuthenticated: boolean;
  username: string | null;
  restoring: boolean;
}

interface AuthContextValue extends AuthState {
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const hasRefreshToken = !!localStorage.getItem('refreshToken');

  const [state, setState] = useState<AuthState>({
    isAuthenticated: hasRefreshToken,
    username: null,
    restoring: hasRefreshToken, // 需要恢复 session
  });

  const refreshingRef = useRef(false);

  // 恢复 session：用 refreshToken 获取新 accessToken
  useEffect(() => {
    const refreshToken = localStorage.getItem('refreshToken');
    if (!refreshToken || refreshingRef.current) return;

    refreshingRef.current = true;

    apiClient.post('/auth/refresh', { refreshToken })
      .then(({ data }) => {
        setAccessToken(data.data.accessToken);
        localStorage.setItem('refreshToken', data.data.refreshToken);
        setState({ isAuthenticated: true, username: null, restoring: false });
      })
      .catch(() => {
        localStorage.removeItem('refreshToken');
        setState({ isAuthenticated: false, username: null, restoring: false });
      });
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const { data } = await apiClient.post('/auth/login', { username, password });
    setAccessToken(data.data.accessToken);
    localStorage.setItem('refreshToken', data.data.refreshToken);
    setState({ isAuthenticated: true, username, restoring: false });
  }, []);

  const logout = useCallback(async () => {
    const refreshToken = localStorage.getItem('refreshToken');
    try {
      await apiClient.post('/auth/logout', { refreshJti: refreshToken });
    } catch {
      // 即使服务端注销失败，也清除本地状态
    }
    setAccessToken(null);
    localStorage.removeItem('refreshToken');
    setState({ isAuthenticated: false, username: null, restoring: false });
  }, []);

  return (
    <AuthContext.Provider value={{ ...state, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
