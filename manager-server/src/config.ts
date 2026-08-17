function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

export const config = {
  port: parseInt(process.env.SERVER_PORT || '3001', 10),
  host: process.env.HOST || '0.0.0.0',
  logLevel: process.env.LOG_LEVEL || 'info',
  jwtSecret: requireEnv('JWT_SECRET'),
  encryptionKey: requireEnv('ENCRYPTION_KEY'),
  dbPath: process.env.DB_PATH || './data/unturned-manager.db',
  dataDir: process.env.DATA_DIR || './data',
  corsOrigin: process.env.CORS_ORIGIN || '*',
  /**
   * U3DS 安装根目录（ADR-0003 / T2 全局化）。
   * - 生产（Linux）：默认 `/opt/unturned`
   * - 开发（Windows）：通过 `INSTALL_DIR` 环境变量覆盖
   * - 单一全局值，多 ServerID 共装决策（CLAUDE.md §2）
   */
  installDir: process.env.INSTALL_DIR || '/opt/unturned',
  /**
   * SteamCMD 安装目录（env 显式声明）。
   * 设置后作为唯一路径使用（不静默回落探测，显式声明优先）；未设则回落
   * SteamCmdManager 的 DEFAULT_PATHS 候选探测。Docker 镜像烘焙到 /opt/steamcmd。
   */
  steamCmdDir: process.env.STEAMCMD_DIR,
  nodeEnv: process.env.NODE_ENV || 'development',
};
