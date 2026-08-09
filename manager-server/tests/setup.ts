import path from 'node:path';

// 给 logger/config 的 requireEnv 提供兜底测试 secret
process.env.JWT_SECRET ||= 'test-jwt-secret-do-not-use-in-prod-min-32-chars';
process.env.ENCRYPTION_KEY ||= 'dGVzdC1lbmNyeXB0aW9uLWtleS0zMi1ieXRlcy1sb25n';
process.env.LOG_LEVEL ||= 'error';
process.env.NODE_ENV ||= 'test';
// ADR-0003 / T2：服务端安装根目录。测试环境强制指向本项目路径下的临时目录，
// 不回落到 Linux 默认 /opt/unturned，也不散到 OS 全局 tmpdir——
// 保证服务读的 config.installDir 与测试 fixture 写入的路径天然对齐（真源唯一）。
process.env.INSTALL_DIR = path.join(process.cwd(), '.test-install');
