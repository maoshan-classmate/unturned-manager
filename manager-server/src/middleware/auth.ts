import type { Request, Response, NextFunction } from 'express';
import type { AuthService } from '../modules/auth/AuthService.js';

let authService: AuthService | null = null;

export function setAuthService(service: AuthService): void {
  authService = service;
}

export function authenticateToken(req: Request, res: Response, next: NextFunction): void {
  if (!authService) {
    res.status(500).json({ error: { code: 'server_error', message: 'Auth service not initialized' } });
    return;
  }

  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    res.status(401).json({ error: { code: 'unauthorized', message: '未提供认证令牌' } });
    return;
  }

  const payload = authService.validateAccessToken(token);
  if (!payload) {
    res.status(401).json({ error: { code: 'token_expired', message: '令牌已过期或无效' } });
    return;
  }

  (req as AuthenticatedRequest).user = payload;
  next();
}

export interface AuthenticatedRequest extends Request {
  user: { userId: number; username: string; role: 'admin' };
}
