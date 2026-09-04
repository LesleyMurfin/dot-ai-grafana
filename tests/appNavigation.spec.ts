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

  // B2a end-to-end: with "Send Grafana evidence" off the plugin never reads a datasource, so a
  // show-me navigation Ask has nothing to point at. It must say so — not report success with an
  // empty Current and Map links that were never built.
  test('Send Grafana evidence off: a show-me Ask reports failure, not an empty success', async ({ gotoPage, page }) => {
    const settingsUrl = `/api/plugins/${pluginId}/settings`;
    const before = await page.request.get(settingsUrl);
    if (before.status() === 403) {
      test.skip(true, 'settings API forbidden — not admin in this fixture');
      return;
    }
    expect(before.ok()).toBeTruthy();
    const meta = await before.json();
    const jsonData = (meta.jsonData ?? {}) as Record<string, unknown>;
    const envelope = { enabled: meta.enabled !== false, pinned: Boolean(meta.pinned) };

    // Any dot-ai POST here would mean the engine was consulted for a navigation-only Ask.
    let toolCalls = 0;
    await page.route(toolResourceUrl('query'), async (route) => {
      toolCalls += 1;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, status: 200, summary: 'e2e-mock: must not be reached', error: '' }),
      });
    });

    await page.request.post(settingsUrl, {
      data: { ...envelope, jsonData: { ...jsonData, sendGrafanaEvidence: false } },
    });

    try {
      await gotoPage('/');
      // Toggle took effect: the evidence-consent banner is gone.
      await expect(page.getByTestId(testIds.dotai.container)).toBeVisible();
      await expect(page.getByTestId(testIds.dotai.consent)).toHaveCount(0);

      const intent = page.getByTestId(testIds.dotai.intent);
      const submit = page.getByTestId(testIds.dotai.submit);
      await intent.fill('show me the logs');
      await expect(submit).toBeEnabled();
      await submit.click();

      const error = page.getByTestId(testIds.dotai.error);
      await expect(error).toBeVisible({ timeout: 10_000 });
      await expect(error).toContainText(/Send Grafana evidence/i);

      // No success surface: no answer, no Map links, no Current.
      await expect(page.getByTestId(testIds.dotai.response)).toHaveCount(0);
      await expect(page.getByTestId(testIds.dotai.drilldown)).toHaveCount(0);
      await expect(page.getByTestId(testIds.dotai.current)).toHaveCount(0);
      expect(toolCalls).toBe(0);
    } finally {
      // Restore the operator's setting for every other spec in the run.
      await page.request.post(settingsUrl, { data: { ...envelope, jsonData } });
    }
  });
});
