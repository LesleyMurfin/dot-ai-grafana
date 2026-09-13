import { test, expect } from './fixtures';
import { testIds } from '../src/components/testIds';
import {
  asEnvelope,
  isStableEnvelope,
  resourcePath,
} from './byDesignHelpers';

/**
 * Consent by design — no execute/operate surface from this plugin; remediate is
 * analysis-only; UI discloses that fact.
 *
 * Deferred (see issue #44):
 * - debugLog opt-in default-off (main always writes ask log; gate branch adds the flag)
 * - Show-context row matching POSTed progressive context (needs #14/#43 UI)
 */

const adminState = 'playwright/.auth/admin.json';

test.describe('Consent by design — no execute/operate surface', () => {
  test.use({ storageState: adminState });

  test('tools page has no Execute or Operate control', async ({ gotoPage, page }) => {
    await gotoPage('/');
    await expect(page.getByTestId(testIds.dotai.container)).toBeVisible();

    await expect(page.getByRole('button', { name: /execute/i })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /operate/i })).toHaveCount(0);
    await expect(page.getByRole('link', { name: /execute/i })).toHaveCount(0);

    // Submit is Ask (query) — never Execute.
    const submit = page.getByTestId(testIds.dotai.submit);
    await expect(submit).toBeVisible();
    await expect(submit).toHaveText(/Ask/i);
  });

  test('Remediate option is labelled analysis-only and shows disclosure', async ({
    gotoPage,
    page,
    selectors,
  }) => {
    const appPage = await gotoPage('/');

    await page.getByTestId(testIds.dotai.tool).click();
    const optionSelector = selectors.components.Select.option;
    const remediateOpt = appPage.getByGrafanaSelector(optionSelector).filter({ hasText: /Remediate/ });
    await expect(remediateOpt).toBeVisible();
    await expect(remediateOpt).toContainText(/analysis/i);
    await remediateOpt.click();

    // Option description and Alert body both match; assert via first match in app root.
    const root = page.getByTestId(testIds.dotai.container);
    await expect(root.getByText(/never executes changes/i).first()).toBeVisible();
    await expect(root.getByText(/Headlamp/i).first()).toBeVisible();

    const submit = page.getByTestId(testIds.dotai.submit);
    await expect(submit).toHaveText(/Analyze/i);
  });

  test('POST remediate with execute flags still returns analysis-only envelope', async ({ request }) => {
    const resp = await request.post(resourcePath('remediate'), {
      data: {
        issue: 'consent check',
        execute: true,
        apply: true,
      },
    });
    const text = await resp.text();
    const json = JSON.parse(text);
    expect(isStableEnvelope(json)).toBeTruthy();
    expect(resp.status(), text).toBe(200);
    const env = asEnvelope(json);
    expect(env.ok).toBe(true);
    expect(String(env.summary || '')).not.toMatch(/STUB_SAW_EXECUTE/i);
  });
});
