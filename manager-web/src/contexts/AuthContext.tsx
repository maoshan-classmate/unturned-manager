import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import { apiClient, setAccessToken } from '../api/client.js';

interface AuthState {
  isAuthenticated: boolean;
  username: string | null;
}

interface AuthContextValue extends AuthState {
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    isAuthenticated: !!localStorage.getItem('refreshToken'),
    username: null,
  });

  const login = useCallback(async (username: string, password: string) => {
    const { data } = await apiClient.post('/auth/login', { username, password });
    setAccessToken(data.data.accessToken);
    localStorage.setItem('refreshToken', data.data.refreshToken);
    setState({ isAuthenticated: true, username });
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
    setState({ isAuthenticated: false, username: null });
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
