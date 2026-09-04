import type { PluginOptions, User } from '@grafana/plugin-e2e';
import { defineConfig, devices } from '@playwright/test';
import { dirname } from 'node:path';

const pluginE2eAuth = `${dirname(require.resolve('@grafana/plugin-e2e'))}/auth`;

/**
 * Read environment variables from file.
 * https://github.com/motdotla/dotenv
 */
// require('dotenv').config();

const viewerUser: User = {
  user: 'viewer',
  password: 'viewer-password',
  role: 'Viewer',
};

const editorUser: User = {
  user: 'editor',
  password: 'editor-password',
  role: 'Editor',
};

/**
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig<PluginOptions>({
  testDir: './tests',
  /* Fail fast with a clear message when the dot-ai stub upstream is not up. */
  globalSetup: './tests/harness/stubPreflight.ts',
  /* Run tests in files in parallel */
  fullyParallel: true,
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,
  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  reporter: 'html',
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    /* Base URL to use in actions like `await page.goto('/')`. */
    baseURL: process.env.GRAFANA_URL || 'http://localhost:3000',

    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: 'on-first-retry',
  },

  /* Configure projects for major browsers */
  projects: [
    // 1a. Login to Grafana and store the cookie on disk for use in other tests.
    {
      name: 'auth',
      testDir: pluginE2eAuth,
      testMatch: [/.*\.js/],
    },
    // 1b. Provision + login Viewer → playwright/.auth/viewer.json
    {
      name: 'auth-viewer',
      testDir: pluginE2eAuth,
      testMatch: [/.*\.js/],
      use: { user: viewerUser },
    },
    // 1c. Provision + login Editor → playwright/.auth/editor.json
    {
      name: 'auth-editor',
      testDir: pluginE2eAuth,
      testMatch: [/.*\.js/],
      use: { user: editorUser },
    },
    // 2. Run tests in Google Chrome. Every test will start authenticated as admin user;
    //    by-design describes that need another role override storageState themselves.
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        storageState: 'playwright/.auth/admin.json',
      },
      dependencies: ['auth', 'auth-viewer', 'auth-editor'],
    },
  ],
});
