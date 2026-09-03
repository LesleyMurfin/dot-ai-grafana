import type { PluginOptions, User } from '@grafana/plugin-e2e';
import { defineConfig, devices } from '@playwright/test';
import { dirname } from 'node:path';

const pluginE2eAuth = `${dirname(require.resolve('@grafana/plugin-e2e'))}/auth`;

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
 *
 * Auth projects: admin (default plugin-e2e), plus Viewer and Editor so by-design
 * specs can exercise non-admin callers against the real resource HTTP path.
 * Existing chromium specs keep admin storageState unchanged.
 */
export default defineConfig<PluginOptions>({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: 'html',
  use: {
    baseURL: process.env.GRAFANA_URL || 'http://localhost:3000',
    trace: 'on-first-retry',
  },

  projects: [
    // 1a. Default admin login → playwright/.auth/admin.json
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
    // 2. Default suite (existing + by-design). Starts as admin; role describes override storageState.
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
