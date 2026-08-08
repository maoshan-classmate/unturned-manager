import Database from 'better-sqlite3';
import * as argon2 from 'argon2';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import type { IAuthService, JwtPayload } from '@unturned-manager/shared';
import { config } from '../../config.js';
import { logger } from '../../utils/logger.js';
import { AppError } from '../../utils/AppError.js';

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

  /**
   * 修改密码——Argon2id 重新哈希。Phase 0 落地，SettingsPage 改动密码卡调用。
   *
   * @param userId - 当前登录用户 ID
   * @param currentPassword - 当前密码（明文，仅用于校验）
   * @param newPassword - 新密码（明文，将被 Argon2id 哈希后入库）
   * @throws {AuthError} 当前密码错误时 `code='invalid_credentials'`
   */
  async changePassword(userId: number, currentPassword: string, newPassword: string): Promise<void> {
    const user = this.db
      .prepare('SELECT id, password_hash FROM users WHERE id = ?')
      .get(userId) as { id: number; password_hash: string } | undefined;
    if (!user) {
      throw new AuthError('user_not_found', '用户不存在', 404);
    }
    const valid = await argon2.verify(user.password_hash, currentPassword);
    if (!valid) {
      throw new AuthError('invalid_credentials', '当前密码错误', 400);
    }
    const newHash = await argon2.hash(newPassword);
    this.db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(newHash, userId);
    // 修改密码后撤销所有 refresh token（旧设备全需重登）
    this.db.prepare('UPDATE refresh_tokens SET revoked_at = datetime(\'now\') WHERE user_id = ? AND revoked_at IS NULL').run(userId);
    logger.info({ userId }, 'User password changed');
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

/**
 * 认证错误——继承 AppError 以通过 errorHandler 的 instanceof 检查
 */
export class AuthError extends AppError {
  constructor(code: string, message: string, status = 401) {
    super(code, message, status);
    this.name = 'AuthError';
  }
}
