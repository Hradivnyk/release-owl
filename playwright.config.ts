import { defineConfig, devices } from '@playwright/test';

const port = process.env.PORT ?? '3000';
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${port}`;

const skipWebServer = process.env.PLAYWRIGHT_SKIP_WEBSERVER === '1';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : [['html', { open: 'never' }], ['list']],
  use: {
    baseURL,
    trace: 'on-first-retry',
  },
  projects: [
    // UI tests: all routes are mocked via page.route() — safe to run in parallel.
    {
      name: 'ui',
      testMatch: /(?<!\.e2e)\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
    // Full-stack E2E tests: hit the real DB, must run serially to avoid
    // shared-data conflicts (duplicate email/repo across concurrent workers).
    {
      name: 'e2e',
      testMatch: /\.e2e\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
      fullyParallel: false,
      workers: 1,
    },
  ],
  ...(skipWebServer
    ? {}
    : {
        webServer: {
          command: 'npm run dev',
          url: baseURL,
          reuseExistingServer: !process.env.CI,
          timeout: 120_000,
        },
      }),
});
