import { defineConfig, devices } from '@playwright/test';
import { resolve } from 'node:path';

process.env.PLAYWRIGHT_BROWSERS_PATH ??= resolve('.tools/playwright');

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  timeout: 30000,
  expect: { timeout: 10000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:3001',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium' } },
  ],
  webServer: {
    command: `"${process.execPath}" apps/api/dist/index.js`,
    url: 'http://127.0.0.1:3001/api/config',
    reuseExistingServer: false,
    timeout: 30000,
    env: {
      AGREE_FIRST_DATABASE_PATH: resolve(`work/e2e-${process.pid}.sqlite`),
      PAYPAL_CLIENT_ID: '',
      PAYPAL_CLIENT_SECRET: '',
      PAYPAL_MERCHANT_ID: '',
      AGREE_FIRST_AI_MODE: 'examples',
      PORT: '3001',
    },
  },
});

