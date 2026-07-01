// playwright.config.js — LoadBoot authenticated security matrix.
// Discovers the persona and POD browser specs under tests/security. Uses the pre-installed Chromium.
// Authenticated specs skip cleanly unless PERSONAS_READY=1 and storage states exist, so this config is
// safe to run as part of local release gates (it will report expected skips, not failures).

const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests/security',
  testMatch: ['**/*.spec.js'],
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [
    ['list'],
    ['json', { outputFile: 'evidence/gate/persona-playwright-results.json' }],
    ['html', { outputFolder: 'evidence/gate/playwright-report', open: 'never' }],
  ],
  use: {
    baseURL: process.env.BASE_URL || '',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    // The environment ships Chromium at a fixed path; do not download.
    launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
  },
  projects: [
    { name: 'security', use: {} },
  ],
});
