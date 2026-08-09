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
   * - 之前：`<installDir>` 存于 `servers.install_dir` 列，按 serverId 查 DB
   * - 现在：单一全局值，多 ServerID 共装决策（CLAUDE.md §2）
   */
  installDir: process.env.INSTALL_DIR || '/opt/unturned',
  nodeEnv: process.env.NODE_ENV || 'development',
};
