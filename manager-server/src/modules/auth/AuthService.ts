import Database from 'better-sqlite3';
import * as argon2 from 'argon2';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import type { IAuthService, JwtPayload } from '@unturned-manager/shared';
import { config } from '../../config.js';
import { logger } from '../../utils/logger.js';

export class AuthService implements IAuthService {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  async login(username: string, password: string): Promise<{ accessToken: string; refreshToken: string }> {
    const user = this.db.prepare('SELECT id, username, password_hash FROM users WHERE username = ?').get(username) as
      | { id: number; username: string; password_hash: string }
      | undefined;

    if (!user) {
      throw new AuthError('invalid_credentials', '用户名或密码错误');
    }

    const valid = await argon2.verify(user.password_hash, password);
    if (!valid) {
      throw new AuthError('invalid_credentials', '用户名或密码错误');
    }

    return this.issueTokens(user.id, user.username);
  }

  async refresh(refreshToken: string): Promise<{ accessToken: string; refreshToken: string }> {
    let payload: JwtPayload & { jti: string };
    try {
      payload = jwt.verify(refreshToken, config.jwtSecret) as JwtPayload & { jti: string };
    } catch {
      throw new AuthError('invalid_token', 'Refresh token 无效或已过期');
    }

    // 检查是否已被撤销
    const revoked = this.db.prepare('SELECT revoked_at FROM refresh_tokens WHERE jti = ?').get(payload.jti) as
      | { revoked_at: string | null }
      | undefined;

    if (!revoked || revoked.revoked_at !== null) {
      throw new AuthError('invalid_token', 'Refresh token 已被撤销');
    }

    // 撤销旧 refresh token，签发新的（rotation）
    this.db.prepare('UPDATE refresh_tokens SET revoked_at = datetime(\'now\') WHERE jti = ?').run(payload.jti);

    return this.issueTokens(payload.userId, payload.username);
  }

  async logout(refreshJti: string): Promise<void> {
    this.db.prepare('UPDATE refresh_tokens SET revoked_at = datetime(\'now\') WHERE jti = ?').run(refreshJti);
  }

  validateAccessToken(token: string): JwtPayload | null {
    try {
      return jwt.verify(token, config.jwtSecret) as JwtPayload;
    } catch {
      return null;
    }
  }

  private issueTokens(userId: number, username: string): { accessToken: string; refreshToken: string } {
    const jti = crypto.randomUUID();

    const accessToken = jwt.sign(
      { userId, username, role: 'admin' as const },
      config.jwtSecret,
      { expiresIn: '15m', subject: String(userId) }
    );

    const refreshToken = jwt.sign(
      { userId, username, role: 'admin' as const },
      config.jwtSecret,
      { expiresIn: '7d', subject: String(userId), jwtid: jti }
    );

    // 持久化 refresh token
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    this.db.prepare('INSERT INTO refresh_tokens (jti, user_id, expires_at) VALUES (?, ?, ?)').run(jti, userId, expiresAt);

    logger.info({ userId, username }, 'User logged in');
    return { accessToken, refreshToken };
  }
}

export class AuthError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 401) {
    super(message);
    this.code = code;
    this.status = status;
    this.name = 'AuthError';
  }
}
