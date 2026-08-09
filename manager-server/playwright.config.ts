import { defineConfig } from '@playwright/test';
import path from 'path';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 15_000,
  retries: 0,
  use: {
    baseURL: 'http://localhost:3099',
    extraHTTPHeaders: { 'Content-Type': 'application/json' },
  },
  webServer: {
    command: 'npx tsx tests/e2e/test-server.ts',
    port: 3099,
    timeout: 10_000,
    reuseExistingServer: false,
    env: {
      JWT_SECRET: 'test-jwt-secret-do-not-use-in-prod-min-32-chars',
      ENCRYPTION_KEY: 'dGVzdC1lbmNyeXB0aW9uLWtleS0zMi1ieXRlcy1sb25n',
      // ADR-0003 B2：createServer 以目录为真源（mkDir + 写 Commands.dat）——
      // e2e 不走 vitest setup，必须显式把 INSTALL_DIR 指向本项目 .test-install（生产仍默认 /opt/unturned）
      INSTALL_DIR: path.resolve(import.meta.dirname, '.test-install'),
      LOG_LEVEL: 'error',
      NODE_ENV: 'test',
    },
  },
});
