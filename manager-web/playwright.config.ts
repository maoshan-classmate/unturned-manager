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
      reuseExistingServer: true,
      timeout: 15_000,
    },
    {
      command: 'npx vite --port 5173',
      port: 5173,
      reuseExistingServer: true,
      timeout: 15_000,
    },
  ],
});
