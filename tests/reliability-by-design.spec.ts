import { test, expect } from './fixtures';
import {
  PROVISIONED_API_KEY,
  UPSTREAM_INTERNAL_FIELD,
  UPSTREAM_SECRET_MARKER,
  asEnvelope,
  bodyContainsForbidden,
  isStableEnvelope,
  resourcePath,
} from './byDesignHelpers';

/**
 * Reliability by design — stable {ok,status,summary,error} envelope under
 * upstream failure; no panic-shaped HTML; secrets stay out of error text.
 *
 * Deferred (see issue #44):
 * - nil/unconfigured client via live e2e (plugin is provisioned in this harness;
 *   covered by Go unit tests on main)
 * - 3-hop cap end-to-end (orchestration UI not on this main tree)
 * - 1000-char intent budget under loaded cluster (no MAX_INTENT_CHARS on main e2e path)
 */

const adminState = 'playwright/.auth/admin.json';

test.describe('Reliability by design — upstream degradation envelope', () => {
  test.use({ storageState: adminState });

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
