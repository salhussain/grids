import { defineConfig } from '@playwright/test';

// Runs against the local stack: docker compose (incl. --profile auth), API on :4000,
// console on :5173. Bundled Chromium is unsupported on macOS 13, so macOS uses Chrome.
export default defineConfig({
  testDir: './tests',
  timeout: 90_000,
  fullyParallel: false,
  reporter: [['list']],
  use: {
    baseURL: process.env.CONSOLE_URL ?? 'http://localhost:5173',
    channel: process.platform === 'darwin' ? 'chrome' : undefined,
    headless: true,
    viewport: { width: 1360, height: 860 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  outputDir: './test-results',
});
