export interface JwtPayload {
  userId: number;
  username: string;
  role: 'admin';
}

export interface IAuthService {
  login(username: string, password: string): Promise<{ accessToken: string; refreshToken: string }>;
  refresh(refreshToken: string): Promise<{ accessToken: string; refreshToken: string }>;
  logout(refreshJti: string): Promise<void>;
  validateAccessToken(token: string): JwtPayload | null;
  changePassword(userId: number, currentPassword: string, newPassword: string): Promise<void>;
}
