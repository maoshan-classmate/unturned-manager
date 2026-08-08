import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/e2e/**'],
    pool: 'forks',
    testTimeout: 10_000,
    hookTimeout: 10_000,
    setupFiles: ['./tests/setup.ts'],
  },
});
