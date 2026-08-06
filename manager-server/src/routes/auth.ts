import { Router } from 'express';
import type { AuthService } from '../modules/auth/AuthService.js';
import type { IAuthService } from '@unturned-manager/shared';

export function createAuthRouter(authService: IAuthService): Router {
  const router = Router();

  router.post('/login', async (req, res) => {
    try {
      const { username, password } = req.body;
      if (!username || !password) {
        res.status(400).json({ error: { code: 'invalid_request', message: '用户名和密码为必填项' } });
        return;
      }
      const tokens = await authService.login(username, password);
      res.json({ data: tokens });
    } catch (err: unknown) {
      if (err instanceof Error && 'code' in err && 'status' in err) {
        const authErr = err as Error & { code: string; status: number };
        res.status(authErr.status).json({ error: { code: authErr.code, message: authErr.message } });
        return;
      }
      res.status(500).json({ error: { code: 'server_error', message: '登录失败' } });
    }
  });

  router.post('/refresh', async (req, res) => {
    try {
      const { refreshToken } = req.body;
      if (!refreshToken) {
        res.status(400).json({ error: { code: 'invalid_request', message: '缺少 refreshToken' } });
        return;
      }
      const tokens = await authService.refresh(refreshToken);
      res.json({ data: tokens });
    } catch (err: unknown) {
      if (err instanceof Error && 'code' in err && 'status' in err) {
        const authErr = err as Error & { code: string; status: number };
        res.status(authErr.status).json({ error: { code: authErr.code, message: authErr.message } });
        return;
      }
      res.status(500).json({ error: { code: 'server_error', message: 'Token 刷新失败' } });
    }
  });

  router.post('/logout', async (req, res) => {
    try {
      const { refreshJti } = req.body;
      if (refreshJti) {
        await authService.logout(refreshJti);
      }
      res.json({ data: { message: '已注销' } });
    } catch {
      res.status(500).json({ error: { code: 'server_error', message: '注销失败' } });
    }
  });

  return router;
}
