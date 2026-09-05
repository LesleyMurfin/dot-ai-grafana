import { test, expect } from './fixtures';
import { testIds } from '../src/components/testIds';
import { resourcePath } from './byDesignHelpers';

const adminState = 'playwright/.auth/admin.json';

/**
 * Alertmanager evidence must load from a real Grafana instance, not a mocked
 * ds.query(). Grafana's built-in `alertmanager`-type datasource's query() is a
 * stub that always resolves `{ data: [] }` and never issues a request (see the
 * module header of src/utils/grafanaStack.ts) — the fix reads Grafana's own
 * unified-alerting HTTP API instead. provisioning/alerting/e2e-evidence.yaml
 * provisions an always-firing Grafana-managed alert so this has real evidence
 * to assert on without any live cluster or external Alertmanager.
 */
test.describe('Alertmanager evidence loads from a real Grafana instance', () => {
  test.use({ storageState: adminState });

  test('firing alert reaches the packed Current sent to dot-ai', async ({ gotoPage, page }) => {
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

    // The provisioned rule's real title/summary — proves the evidence is the
    // actual alert, not a placeholder note.
    expect(body.intent).toContain('Alertmanager:\nE2E Always Firing: Always firing E2E test alert');
    expect(body.intent).not.toMatch(/Alertmanager:\nno alerts/);
    // Dashboard/folder discovery never goes through the deprecated Search API —
    // Alertmanager evidence itself legitimately calls unified-alerting HTTP.
    expect(body.intent).not.toMatch(/api\/search/);
  });
});
