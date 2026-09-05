import { test, expect } from './fixtures';
import { testIds } from '../src/components/testIds';
import {
  PLUGIN_ID,
  PROVISIONED_API_KEY,
  UPSTREAM_INTERNAL_FIELD,
  UPSTREAM_SECRET_MARKER,
  asEnvelope,
  bodyContainsForbidden,
  dialProbe,
  isStableEnvelope,
  resourcePath,
  stubHealth,
} from './byDesignHelpers';

/**
 * Reliability by design — stable {ok,status,summary,error} envelope under
 * upstream failure; no panic-shaped HTML; secrets stay out of error text.
 * Phase 3 (issue #44) closes R2's transport-error half and adds R5.
 *
 * Deferred (see issue #44), with citations now that the code exists on this tree:
 * - R1 (nil/unconfigured client, no panic): Go unit tests on `main`
 *   (pkg/plugin/resources_test.go); the plugin is always provisioned in this
 *   harness, so there is no live-e2e path to an unconfigured client.
 * - R3 (3-hop cap): fully unit-tested — src/utils/askOrchestrator.test.ts
 *   asserts `result.hops` never exceeds `MAX_ASK_HOPS` across hop1/hop2/hop3
 *   transitions. Driving a real 3rd hop through this e2e harness would need
 *   live Loki/Prometheus/Alertmanager datasources (`.config/**`, out of scope
 *   for a tests-only PR) to produce genuine hop-triggering answers; the pure
 *   orchestrator logic is exactly what the issue says to prefer unit-testing.
 * - R4 (1000-char intent budget survives the question under a loaded Current):
 *   fully unit-tested — src/utils/progressiveContext.test.ts
 *   ("buildRequestText reserves the question (issue #14)") packs a full
 *   Loki+Prometheus+Tempo+Alertmanager-at-cap Current and asserts the question
 *   text survives verbatim within MAX_INTENT_CHARS. #14 (the product fix this
 *   pins) is already merged into `main` (29efccc, PR #49). Reproducing "loaded
 *   Current" through this e2e harness would need real datasource provisioning
 *   (`.config/**`, out of scope); the pure-function unit coverage is the
 *   harness this issue asks for.
 */

const adminState = 'playwright/.auth/admin.json';

test.describe('Reliability by design — upstream degradation envelope', () => {
  test.use({ storageState: adminState });

  /**
   * Single e2e copy of upstream-5xx → stable envelope; the near-identical case
   * that lived in tests/security-by-design.spec.ts was removed rather than run
   * twice per matrix cell. Unit equivalent (envelope shape, error mapping, no
   * raw upstream body): pkg/plugin/resources_test.go:751
   * (TestProxyTools/upstream_error_envelope). This case adds what the unit test
   * cannot see: the response really traverses Grafana's resource HTTP path.
   */
  test('upstream 5xx degrades to stable envelope (not raw error page)', async ({ request }) => {
    const resp = await request.post(resourcePath('query'), {
      data: { intent: 'TRIGGER_UPSTREAM_5XX reliability' },
    });
    const text = await resp.text();
    const json = JSON.parse(text);

    expect(isStableEnvelope(json)).toBeTruthy();
    expect(resp.status()).toBe(503);
    const env = asEnvelope(json);
    expect(env.ok).toBe(false);
    expect(typeof env.status).toBe('number');
    expect(typeof env.summary).toBe('string');
    expect(typeof env.error).toBe('string');
    expect(env.error || '').not.toEqual('');

    // Not an HTML panic / stack dump.
    expect(text.toLowerCase()).not.toContain('<html');
    expect(text.toLowerCase()).not.toContain('panic');

    const forbidden = bodyContainsForbidden(
      text,
      UPSTREAM_SECRET_MARKER,
      UPSTREAM_INTERNAL_FIELD,
      PROVISIONED_API_KEY,
      'debug_stack'
    );
    expect(forbidden, text).toEqual([]);
  });

  test('upstream 401 is remapped to 502 envelope', async ({ request }) => {
    const resp = await request.post(resourcePath('query'), {
      data: { intent: 'TRIGGER_UPSTREAM_401 reliability' },
    });
    const text = await resp.text();
    const json = JSON.parse(text);

    expect(isStableEnvelope(json)).toBeTruthy();
    expect(resp.status(), text).toBe(502);
    expect(asEnvelope(json).ok).toBe(false);

    const forbidden = bodyContainsForbidden(text, UPSTREAM_SECRET_MARKER, UPSTREAM_INTERNAL_FIELD, PROVISIONED_API_KEY);
    expect(forbidden, text).toEqual([]);
  });

  test('healthy stub returns ok envelope with summary', async ({ request }) => {
    const resp = await request.post(resourcePath('query'), {
      data: { intent: 'reliability happy path' },
    });
    const text = await resp.text();
    const json = JSON.parse(text);

    expect(resp.status(), text).toBe(200);
    expect(isStableEnvelope(json)).toBeTruthy();
    const env = asEnvelope(json);
    expect(env.ok).toBe(true);
    expect(String(env.summary || '')).toContain('stub-query-ok');
  });

  test('remediate empty issue fails closed with envelope (no upstream execute)', async ({ request }) => {
    const resp = await request.post(resourcePath('remediate'), {
      data: { execute: true },
    });
    const text = await resp.text();
    const json = JSON.parse(text);

    expect(isStableEnvelope(json)).toBeTruthy();
    // Allowlist rejects empty issue before dial.
    expect(resp.status(), text).toBe(400);
    expect(asEnvelope(json).ok).toBe(false);
    expect(String(asEnvelope(json).error || '').toLowerCase()).toMatch(/issue/);
  });
});

test.describe('Reliability by design — transport-level upstream failure', () => {
  test.use({ storageState: adminState });

  /**
   * Upstream 5xx/401/403 above (and in tests/security-by-design.spec.ts) prove
   * the *HTTP-error* half of R2: the stub wrote a response, the plugin mapped
   * its status. This closes the other half — a genuine transport failure
   * (connection reset before any response is written) — which must degrade
   * the same way: a stable 502 envelope, no raw dial exception, no secret
   * leakage. The dial probe proves the stub actually accepted and read the
   * request (recorded before the deliberate reset), so this is a
   * response-phase failure, not a request that never dialled.
   */
  test('upstream connection reset (transport error) degrades to stable 502 envelope', async ({ request }) => {
    const probe = dialProbe('r2-transport');
    const resp = await request.post(resourcePath('query'), {
      data: { intent: `TRIGGER_UPSTREAM_TRANSPORT_ERROR reliability ${probe}` },
    });
    const text = await resp.text();
    const json = JSON.parse(text);

    expect(isStableEnvelope(json)).toBeTruthy();
    expect(resp.status(), text).toBe(502);
    const env = asEnvelope(json);
    expect(env.ok).toBe(false);
    expect(typeof env.error).toBe('string');
    expect(env.error || '').not.toEqual('');

    // Not an HTML panic / stack dump — a transport failure must degrade the
    // same way an HTTP-level upstream error does.
    expect(text.toLowerCase()).not.toContain('<html');
    expect(text.toLowerCase()).not.toContain('panic');

    const forbidden = bodyContainsForbidden(text, UPSTREAM_SECRET_MARKER, UPSTREAM_INTERNAL_FIELD, PROVISIONED_API_KEY);
    expect(forbidden, text).toEqual([]);

    // The stub reads (and probe-counts) the body before resetting the
    // connection, so client.Do really dialled and failed transport-side
    // rather than the plugin short-circuiting before ever reaching the wire.
    const health = await stubHealth();
    expect(health.probes[probe], `stub hits=${JSON.stringify(health.hits)}`).toBe(1);
  });
});

test.describe('Reliability by design — degrades without a configured Grafana datasource', () => {
  test.use({ storageState: adminState });

  const queryResourceUrl = new RegExp(`/api/plugins/${PLUGIN_ID}/resources/query`);

  /**
   * This compose harness provisions no Loki/Prometheus/Tempo/Alertmanager
   * datasource at all (see provisioning/ — only provisioning/plugins exists),
   * so every Ask here already exercises src/utils/grafanaStack.ts's
   * queryOne()'s "missing" branch for all four reads. R5 pins that this
   * degrades to a visible, non-fatal Current note — not a page crash and not
   * a silently blocked Ask — and checks it on both surfaces: what the page
   * renders, and the actual POST body Playwright observes leaving the
   * browser (not just the UI's own claim about it). "Misconfigured" (a
   * datasource is provisioned but its query fails) exercises the same
   * queryOne() catch branch; asserting that sub-case would require
   * provisioning a real datasource (`.config/**`), out of scope here.
   */
  test('Ask completes with a non-fatal Current when no Grafana datasource is configured', async ({
    gotoPage,
    page,
  }) => {
    let capturedBody: string | undefined;
    await page.route(queryResourceUrl, async (route) => {
      capturedBody = route.request().postData() ?? undefined;
      await route.continue();
    });

    await gotoPage('/');
    await page.getByTestId(testIds.dotai.intent).fill('status of pod checkout-api in namespace prod');
    await page.getByTestId(testIds.dotai.submit).click();

    const error = page.getByTestId(testIds.dotai.error);
    const response = page.getByTestId(testIds.dotai.response);
    await expect(response.or(error).first()).toBeVisible({ timeout: 20_000 });

    // Missing datasources must not fail the whole Ask.
    await expect(error).toHaveCount(0);
    await expect(response).toBeVisible();
    await expect(response).toContainText('stub-query-ok');

    // Current still renders (showContext defaults true) with the graceful
    // per-datasource notes instead of being blank or throwing.
    const current = page.getByTestId(testIds.dotai.current);
    await expect(current).toBeVisible();
    await expect(current).toContainText(/datasource missing/i);

    // Same notes are what actually left the browser, not just on-screen text.
    expect(capturedBody, 'expected a captured POST body for the query route').toBeTruthy();
    expect(capturedBody).toMatch(/datasource missing/i);
  });
});
