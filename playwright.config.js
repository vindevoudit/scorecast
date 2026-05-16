// @ts-check
const { defineConfig, devices } = require('@playwright/test');
const { E2E_PORT, BASE_URL, DATABASE_URL } = require('./tests/e2e/fixtures/env');

module.exports = defineConfig({
  testDir: './tests/e2e',
  // Single worker: tests share one Postgres database with mutating state.
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['html', { open: 'never' }], ['github']] : [['list']],
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  globalSetup: require.resolve('./tests/e2e/fixtures/global-setup.js'),
  projects: [
    // Default project: the regression suite. Excludes the mobile screenshot
    // specs under `tests/e2e/screenshots/` so `npm run test:e2e` stays fast.
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      testIgnore: '**/screenshots/**',
    },
    // Mobile screenshot projects — only match `tests/e2e/screenshots/**`.
    // Invoke via `npm run test:screenshots`. Three real device profiles
    // (iPhone SE = small WebKit, iPhone 13 = modern WebKit, Pixel 5 =
    // modern Chromium) so we catch layout bugs on both engines.
    {
      name: 'mobile-iphone-se',
      use: { ...devices['iPhone SE'] },
      testMatch: '**/screenshots/**/*.spec.js',
    },
    {
      name: 'mobile-iphone-13',
      use: { ...devices['iPhone 13'] },
      testMatch: '**/screenshots/**/*.spec.js',
    },
    {
      name: 'mobile-pixel-5',
      use: { ...devices['Pixel 5'] },
      testMatch: '**/screenshots/**/*.spec.js',
    },
  ],
  webServer: {
    // The prod build is what we ship; test it. Re-using existing local server
    // is enabled in non-CI so iterating is fast (`node server.js` already
    // running pointing at scorecast_test will be reused).
    command: 'npm run build && node server.js',
    url: `${BASE_URL}/healthz`,
    timeout: 180_000,
    reuseExistingServer: !process.env.CI,
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      // NODE_ENV=test keeps cookies non-Secure (so http://localhost works)
      // and lets runMigrations() apply pending migrations on boot if any.
      NODE_ENV: 'test',
      PORT: String(E2E_PORT),
      DATABASE_URL,
      JWT_SECRET: 'e2e-only-jwt-secret-not-for-production',
      CORS_ORIGINS: BASE_URL,
      PUBLIC_APP_URL: BASE_URL,
      LOG_LEVEL: 'silent',
      HUSKY: '0',
    },
  },
});
