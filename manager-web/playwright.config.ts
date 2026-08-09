import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  retries: 1,
  use: {
    baseURL: 'http://localhost:5173',
    screenshot: 'only-on-failure',
  },
  webServer: [
    {
      command: 'cd ../manager-server && npm run dev',
      port: 3001,
      reuseExistingServer: false,
      timeout: 15_000,
      env: {
        ADMIN_PASSWORD: '123456',
        JWT_SECRET: 'e2e-jwt-secret-min-32-chars-for-testing',
        ENCRYPTION_KEY: 'dGVzdC1lbmNyeXB0aW9uLWtleS0zMi1ieXRlcy1sb25n',
        DB_PATH: './data/e2e-web.db',
      },
    },
    {
      command: 'npx vite --port 5173',
      port: 5173,
      reuseExistingServer: true,
      timeout: 15_000,
    },
  ],
});
