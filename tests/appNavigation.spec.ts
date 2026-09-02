import { test, expect } from './fixtures';
import { testIds } from '../src/components/testIds';
import pluginJson from '../src/plugin.json';

const pluginId = pluginJson.id;

/** Backend resource path for query / remediate (plugin resources API). */
function toolResourceUrl(tool: 'query' | 'remediate'): RegExp {
  return new RegExp(`/api/plugins/${pluginId}/resources/${tool}`);
}

async function delay(ms: number): Promise<void> {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  setTimeout(resolve, ms);
  return promise;
}

test.describe('dot-ai app navigation', () => {
  test('should render tools page with submit control', async ({ gotoPage, page }) => {
    await gotoPage('/');
    await expect(page.getByTestId(testIds.dotai.container)).toBeVisible();
    await expect(page.getByTestId(testIds.dotai.intent)).toBeVisible();
    const submit = page.getByTestId(testIds.dotai.submit);
    await expect(submit).toBeVisible();
    // Submit stays disabled until intent is filled — control must exist either way.
    await expect(submit).toBeDisabled();
  });

  test('tools page exposes Query and Remediate options', async ({ gotoPage, page, selectors }) => {
    const appPage = await gotoPage('/');

    const toolSelect = page.getByTestId(testIds.dotai.tool);
    await expect(toolSelect).toBeVisible();
    await toolSelect.click();

    const optionSelector = selectors.components.Select.option;
    const options = appPage.getByGrafanaSelector(optionSelector);
    await expect(options).toHaveText([/Query/, /Remediate/]);
  });

  test('Query submit shows loading then mocked response', async ({ gotoPage, page }) => {
    // Mock plugin backend so submit is not a no-op even without live MCP.
    await page.route(toolResourceUrl('query'), async (route) => {
      // Brief delay so loading testid can appear.
      await delay(150);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          status: 200,
          summary: 'e2e-mock-query: 3 pods running',
          error: '',
        }),
      });
    });

    await gotoPage('/');

    const intent = page.getByTestId(testIds.dotai.intent);
    const submit = page.getByTestId(testIds.dotai.submit);
    await expect(submit).toBeVisible();

    await intent.fill('list pods in default namespace');
    await expect(submit).toBeEnabled();

    const responsePromise = page.waitForResponse(toolResourceUrl('query'));
    await submit.click();

    // After click: loading, error, or response must appear (page is not a no-op).
    const loading = page.getByTestId(testIds.dotai.loading);
    const error = page.getByTestId(testIds.dotai.error);
    const response = page.getByTestId(testIds.dotai.response);

    await expect(loading.or(error).or(response).first()).toBeVisible({ timeout: 10_000 });

    await responsePromise;
    await expect(response).toBeVisible({ timeout: 10_000 });
    await expect(response).toContainText('e2e-mock-query');
    await expect(error).toHaveCount(0);
  });

  test('Remediate submit shows loading then mocked analysis response', async ({ gotoPage, page, selectors }) => {
    await page.route(toolResourceUrl('remediate'), async (route) => {
      await delay(150);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          status: 200,
          summary: 'e2e-mock-remediate: CrashLoop likely image pull failure',
          error: '',
        }),
      });
    });

    const appPage = await gotoPage('/');

    // Select Remediate (analysis only) — no execute UI.
    await page.getByTestId(testIds.dotai.tool).click();
    const optionSelector = selectors.components.Select.option;
    await appPage.getByGrafanaSelector(optionSelector).filter({ hasText: /Remediate/ }).click();

    // Button label switches to Analyze for remediate.
    const submit = page.getByTestId(testIds.dotai.submit);
    await expect(submit).toBeVisible();
    await expect(submit).toHaveText(/Analyze/i);

    const intent = page.getByTestId(testIds.dotai.intent);
    await intent.fill('why is checkout-api CrashLooping in prod?');
    await expect(submit).toBeEnabled();

    const responsePromise = page.waitForResponse(toolResourceUrl('remediate'));
    await submit.click();

    const loading = page.getByTestId(testIds.dotai.loading);
    const error = page.getByTestId(testIds.dotai.error);
    const response = page.getByTestId(testIds.dotai.response);

    await expect(loading.or(error).or(response).first()).toBeVisible({ timeout: 10_000 });

    await responsePromise;
    await expect(response).toBeVisible({ timeout: 10_000 });
    await expect(response).toContainText('e2e-mock-remediate');
    await expect(error).toHaveCount(0);
  });

  test('Query submit surfaces error testid when backend fails', async ({ gotoPage, page }) => {
    await page.route(toolResourceUrl('query'), async (route) => {
      await route.fulfill({
        status: 502,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: false,
          status: 502,
          summary: '',
          error: 'e2e-mock upstream unavailable',
        }),
      });
    });

    await gotoPage('/');

    const intent = page.getByTestId(testIds.dotai.intent);
    const submit = page.getByTestId(testIds.dotai.submit);
    await expect(submit).toBeVisible();

    await intent.fill('show failing deployments');
    await expect(submit).toBeEnabled();
    await submit.click();

    const loading = page.getByTestId(testIds.dotai.loading);
    const error = page.getByTestId(testIds.dotai.error);
    const response = page.getByTestId(testIds.dotai.response);

    await expect(loading.or(error).or(response).first()).toBeVisible({ timeout: 10_000 });
    await expect(error).toBeVisible({ timeout: 10_000 });
  });
});
