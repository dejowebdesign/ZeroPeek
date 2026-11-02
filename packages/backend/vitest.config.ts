import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    // The database-backed integration suites share one PostgreSQL and each
    // truncates tables between tests, so files must not run concurrently.
    fileParallelism: false,
  },
});
