import { defineConfig } from '@playwright/test';

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
      LOG_LEVEL: 'error',
      NODE_ENV: 'test',
    },
  },
});
