import type { PlaywrightTestConfig } from '@playwright/test';

const PORT = process.env.SMOKE_PORT ? Number(process.env.SMOKE_PORT) : 9011;
const HOST = process.env.SMOKE_HOST || '127.0.0.1';

const config: PlaywrightTestConfig = {
  testDir: './tests',
  testIgnore: ['**/unit/**'],
  testMatch: ['**/*.spec.{js,ts}'],
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  use: {
    baseURL: `http://${HOST}:${PORT}/`,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  webServer: {
    command: `npx http-server . -p ${PORT} -c-1`,
    url: `http://${HOST}:${PORT}/`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
  reporter: [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],
};

export default config;

