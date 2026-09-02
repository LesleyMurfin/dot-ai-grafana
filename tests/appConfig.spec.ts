import { test, expect } from './fixtures';
import { testIds } from '../src/components/testIds';

/** Live / cluster MCP endpoints must never be overwritten by the placeholder host. */
function looksLikeLiveMcpUrl(value: string): boolean {
  const v = value.trim().toLowerCase();
  if (!v) {
    return false;
  }
  return (
    v.includes('dot-ai') ||
    v.includes('10.43.') ||
    v.includes('.svc') ||
    v.includes('cluster.local') ||
    v.includes('svc.cluster')
  );
}

test.describe('dot-ai app configuration', () => {
  test('Test connection is visible; does not clobber a live MCP URL', async ({ appConfigPage, page }) => {
    // Fixture already navigates to the plugin config page.
    void appConfigPage;

    const testButton = page.getByTestId(testIds.appConfig.testConnection);
    await expect(testButton).toBeVisible();
    await expect(page.getByRole('button', { name: /Test connection/i })).toBeVisible();

    // Reset only appears when a secret is already configured (SecretInput isConfigured).
    const resetButton = page.getByRole('button', { name: /reset/i });
    if (await resetButton.isVisible().catch(() => false)) {
      // Optional control present on live installs — assert visibility only; do not force-clear token.
      await expect(resetButton).toBeVisible();
    }

    const urlInput = page.getByTestId(testIds.appConfig.apiUrl);
    await expect(urlInput).toBeVisible();

    const currentUrl = (await urlInput.inputValue()).trim();

    // NEVER save www.my-awsome-grafana-app.com (or any other fake host) over a working apiUrl.
    if (looksLikeLiveMcpUrl(currentUrl)) {
      await expect(urlInput).toHaveValue(currentUrl);
      // Save stays available when a stored token is configured; do not mutate URL or click Save.
      const saveButton = page.getByTestId(testIds.appConfig.submit);
      await expect(saveButton).toBeVisible();
      // Test connection should be enabled when URL + stored token are present.
      await expect(testButton).toBeEnabled();
      return;
    }

    // Empty / non-cluster local only: fill disposable values and save (no live URL to protect).
    const tokenInput = page.getByTestId(testIds.appConfig.apiKey);
    if (await resetButton.isVisible().catch(() => false)) {
      await resetButton.click();
    }
    await tokenInput.fill('secret-api-key-e2e');
    await urlInput.clear();
    // Use a clearly local disposable host — never the historical placeholder domain.
    await urlInput.fill('http://127.0.0.1:3456');

    const saveButton = page.getByTestId(testIds.appConfig.submit);
    const saveResponse = appConfigPage.waitForSettingsResponse();
    await saveButton.click();
    await expect(saveResponse).toBeOK();
  });

  test('settings GET does not echo auth token (B2)', async ({ appConfigPage, page }) => {
    // Fixture already navigates with an admin session (plugin-e2e).
    void appConfigPage;

    const settingsRes = await page.request.get('/api/plugins/lesleymurfin-dotai-app/settings');

    // Soft-pass if settings are forbidden and we are not admin in this environment.
    if (settingsRes.status() === 403) {
      test.skip(true, 'settings GET returned 403 — not admin in this fixture; B2 deferred');
      return;
    }

    expect(settingsRes.ok()).toBeTruthy();
    const body = (await settingsRes.json()) as {
      jsonData?: Record<string, unknown>;
      secureJsonData?: Record<string, unknown>;
      secureJsonFields?: Record<string, boolean>;
    };

    // Token must never appear as a plain string on the public settings surface.
    expect(body.secureJsonData?.apiKey).toBeUndefined();
    expect(body.jsonData?.apiKey).toBeUndefined();

    // When a token is configured, Grafana may advertise the field is set — that is OK.
    if (body.secureJsonFields && 'apiKey' in body.secureJsonFields) {
      expect(typeof body.secureJsonFields.apiKey).toBe('boolean');
    }

    // Defense in depth: entire payload must not contain a non-empty apiKey string value.
    const raw = JSON.stringify(body);
    expect(raw).not.toMatch(/"apiKey"\s*:\s*"[^"]+"/);
  });
});
