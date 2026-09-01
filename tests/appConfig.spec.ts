import { test, expect } from './fixtures';

test('should be possible to save app configuration', async ({ appConfigPage, page }) => {
  const saveButton = page.getByRole('button', { name: /Save API settings/i });
  const testButton = page.getByRole('button', { name: /Test connection/i });

  await expect(testButton).toBeVisible();

  // Reset only appears when a secret is already configured (SecretInput isConfigured).
  const resetButton = page.getByRole('button', { name: /reset/i });
  if (await resetButton.isVisible()) {
    await resetButton.click();
  }

  // enter some valid values (labels: Auth Token / MCP Server URL)
  await page.getByRole('textbox', { name: /Auth Token|API Key/i }).fill('secret-api-key');
  await page.getByRole('textbox', { name: /MCP Server URL|API Url/i }).clear();
  await page.getByRole('textbox', { name: /MCP Server URL|API Url/i }).fill('http://www.my-awsome-grafana-app.com/api');

  // listen for the server response on the saved form
  const saveResponse = appConfigPage.waitForSettingsResponse();

  await saveButton.click();
  await expect(saveResponse).toBeOK();
});
