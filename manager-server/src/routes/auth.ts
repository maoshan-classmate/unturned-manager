import { Router } from 'express';
import { z } from 'zod';
import type { IAuthService } from '@unturned-manager/shared';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { authenticateToken } from '../middleware/auth.js';

const LoginSchema = z.object({
  username: z.string().min(1, '用户名不能为空'),
  password: z.string().min(1, '密码不能为空'),
});

const RefreshSchema = z.object({
  refreshToken: z.string().min(1, 'refreshToken 不能为空'),
});

const LogoutSchema = z.object({
  refreshJti: z.string().optional(),
});

const ChangePasswordSchema = z.object({
  current: z.string().min(1, '当前密码不能为空'),
  newPass: z.string().min(8, '新密码至少 8 位'),
  confirm: z.string().min(1, '确认密码不能为空'),
}).refine((d) => d.newPass === d.confirm, {
  message: '两次输入的新密码不一致',
  path: ['confirm'],
});

export function createAuthRouter(authService: IAuthService): Router {
  const router = Router();

  router.post(
    '/login',
    validate(LoginSchema),
    asyncHandler(async (req, res) => {
      const { username, password } = req.body as { username: string; password: string };
      const tokens = await authService.login(username, password);
      res.json({ data: tokens });
    }),
  );

  router.post(
    '/refresh',
    validate(RefreshSchema),
    asyncHandler(async (req, res) => {
      const { refreshToken } = req.body as { refreshToken: string };
      const tokens = await authService.refresh(refreshToken);
      res.json({ data: tokens });
    }),
  );

  router.post(
    '/logout',
    validate(LogoutSchema),
    asyncHandler(async (req, res) => {
      const { refreshJti } = req.body as { refreshJti?: string };
      if (refreshJti) {
        await authService.logout(refreshJti);
      }
      res.json({ data: { message: '已注销' } });
    }),
  );

  // 修改密码（SettingsPage Card 1 使用）
  // Phase 0 先在 AuthService 上做扩展
  router.post(
    '/change-password',
    authenticateToken,
    validate(ChangePasswordSchema),
    asyncHandler(async (req, res) => {
      const user = (req as unknown as { user?: { userId: number } }).user;
      if (!user) {
        res.status(401).json({ error: { code: 'unauthorized', message: '未认证' } });
        return;
      }
      const body = req.body as { current: string; newPass: string };
      await authService.changePassword(user.userId, body.current, body.newPass);
      res.json({ data: { message: '密码已更新' } });
    }),
  );

  return router;
}
