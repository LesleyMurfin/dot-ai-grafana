import { test, expect } from './fixtures';
import { testIds } from '../src/components/testIds';
import { resourcePath } from './byDesignHelpers';

const adminState = 'playwright/.auth/admin.json';

/**
 * The /d/<uid> dashboard drilldown link (src/utils/grafanaExplore.ts
 * buildDrilldownLinks) is built from dashboardUidsFromAlertFrames, which in
 * turn depends on real Alertmanager evidence loading at all — see the module
 * header of src/utils/grafanaStack.ts. provisioning/alerting/e2e-evidence.yaml's
 * always-firing alert carries a dashboardUID annotation pointing at a real,
 * provisioned dashboard, so this link is reachable end to end, not just
 * rendered.
 */
test.describe('Alertmanager-derived dashboard drilldown link is reachable end to end', () => {
  test.use({ storageState: adminState });

  test('firing alert with a dashboardUID renders a working /d/<uid> link', async ({ gotoPage, page, context }) => {
    await gotoPage('/');

    const intent = page.getByTestId(testIds.dotai.intent);
    await intent.fill('what alerts are firing right now?');

    const submit = page.getByTestId(testIds.dotai.submit);
    await expect(submit).toBeEnabled();

    const queryRequest = page.waitForRequest(
      (req) => req.url().includes(resourcePath('query')) && req.method() === 'POST'
    );
    await submit.click();
    const req = await queryRequest;
    const body = JSON.parse(req.postData() || '{}') as { intent?: string };
    expect(body.intent).toContain('Dashboards (from firing alerts):\n/d/e2etestdash1');

    const drilldown = page.getByTestId(testIds.dotai.drilldown);
    const link = drilldown.getByRole('link', { name: /Dashboard e2etestdash1/ });
    await expect(link).toBeVisible();
    const href = await link.getAttribute('href');
    expect(href).toBe('/d/e2etestdash1');

    // Reachable end to end: the href resolves to a real, provisioned dashboard.
    const dashboardPage = await context.newPage();
    const resp = await dashboardPage.goto(new URL(href!, page.url()).toString());
    expect(resp?.status()).toBe(200);
    await expect(dashboardPage.getByText('E2E Evidence Dashboard')).toBeVisible();
    await dashboardPage.close();
  });
});
