import { test, expect } from './fixtures';
import {
  PLUGIN_ID,
  PROVISIONED_API_KEY,
  UPSTREAM_INTERNAL_FIELD,
  UPSTREAM_SECRET_MARKER,
  asEnvelope,
  bodyContainsForbidden,
  isStableEnvelope,
  resourcePath,
} from './byDesignHelpers';

/**
 * Security by design — real HTTP path /api/plugins/<id>/resources/*.
 *
 * On main (no isEditorOrAbove gate) Viewer is EXPECTED to receive 200 from
 * /query and /remediate when the stub upstream is up. That red is the proof
 * the control is absent. With PR #25 applied, the same unedited specs expect 403.
 */

const viewerState = 'playwright/.auth/viewer.json';
const editorState = 'playwright/.auth/editor.json';
const adminState = 'playwright/.auth/admin.json';

test.describe('Security by design — Viewer denied on tool routes', () => {
  test.use({ storageState: viewerState });

  for (const tool of ['query', 'remediate'] as const) {
    test(`Viewer POST /${tool} is refused with HTTP 403 and no upstream body`, async ({ request }) => {
      const body =
        tool === 'query'
          ? { intent: 'list pods in default' }
          : { issue: 'crashloop on checkout', intent: 'crashloop on checkout' };

      const resp = await request.post(resourcePath(tool), { data: body });
      const text = await resp.text();
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        json = text;
      }

      // THE GATE ASSERTION — red on main without PR #25, green with it.
      expect(
        resp.status(),
        `Viewer /${tool} must be HTTP 403 (role gate). body=${text}`
      ).toBe(403);

      const forbidden = bodyContainsForbidden(
        json,
        UPSTREAM_SECRET_MARKER,
        UPSTREAM_INTERNAL_FIELD,
        PROVISIONED_API_KEY,
        'stub-query-ok',
        'stub-remediate-ok'
      );
      expect(forbidden, `upstream/provisioned secrets must not reach Viewer body`).toEqual([]);

      if (typeof json === 'object' && json !== null) {
        expect(isStableEnvelope(json)).toBeTruthy();
        const env = asEnvelope(json);
        expect(env.status).toBe(403);
        expect(env.ok).toBe(false);
      }
    });
  }
});

test.describe('Security by design — unauthenticated caller', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  for (const tool of ['query', 'remediate'] as const) {
    test(`unauthenticated POST /${tool} is not treated as an authorized tool call`, async ({ request }) => {
      const body = tool === 'query' ? { intent: 'whoami' } : { issue: 'whoami' };
      const resp = await request.post(resourcePath(tool), { data: body });
      const text = await resp.text();
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        json = text;
      }

      // Grafana itself should reject anonymous resource calls when anonymous auth is off.
      // Accept 401/403; never 2xx with upstream content.
      expect(
        [401, 403].includes(resp.status()),
        `unauthenticated /${tool} status=${resp.status()} body=${text}`
      ).toBeTruthy();

      const forbidden = bodyContainsForbidden(
        json,
        UPSTREAM_SECRET_MARKER,
        UPSTREAM_INTERNAL_FIELD,
        PROVISIONED_API_KEY,
        'stub-query-ok',
        'stub-remediate-ok'
      );
      expect(forbidden).toEqual([]);
    });
  }
});

test.describe('Security by design — Editor allowed on tool routes', () => {
  test.use({ storageState: editorState });

  for (const tool of ['query', 'remediate'] as const) {
    test(`Editor POST /${tool} is accepted (authorization, not live cluster)`, async ({ request }) => {
      const body =
        tool === 'query'
          ? { intent: 'list nodes' }
          : { issue: 'pod pending', intent: 'pod pending' };

      const resp = await request.post(resourcePath(tool), { data: body });
      const text = await resp.text();
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        json = text;
      }

      expect(
        resp.status(),
        `Editor /${tool} must not be role-denied. body=${text}`
      ).not.toBe(403);
      expect(resp.status(), `Editor /${tool} should reach the tool proxy. body=${text}`).toBe(200);
      expect(isStableEnvelope(json)).toBeTruthy();
      const env = asEnvelope(json);
      expect(env.ok).toBe(true);
      expect(String(env.summary || '')).toContain(`stub-${tool}-ok`);

      const forbidden = bodyContainsForbidden(json, UPSTREAM_SECRET_MARKER, UPSTREAM_INTERNAL_FIELD, PROVISIONED_API_KEY);
      expect(forbidden).toEqual([]);
    });
  }
});

test.describe('Security by design — Admin allowed on tool routes', () => {
  test.use({ storageState: adminState });

  for (const tool of ['query', 'remediate'] as const) {
    test(`Admin POST /${tool} is accepted`, async ({ request }) => {
      const body =
        tool === 'query'
          ? { intent: 'list namespaces' }
          : { issue: 'node not ready', intent: 'node not ready' };

      const resp = await request.post(resourcePath(tool), { data: body });
      const text = await resp.text();
      const json = JSON.parse(text);

      expect(resp.status(), text).toBe(200);
      expect(isStableEnvelope(json)).toBeTruthy();
      expect(asEnvelope(json).ok).toBe(true);

      const forbidden = bodyContainsForbidden(json, UPSTREAM_SECRET_MARKER, UPSTREAM_INTERNAL_FIELD, PROVISIONED_API_KEY);
      expect(forbidden).toEqual([]);
    });
  }
});

test.describe('Security by design — Test-connection Admin gate', () => {
  test('Admin can test-connection against saved settings', async ({ request }) => {
    const resp = await request.post(resourcePath('test-connection'), { data: {} });
    const text = await resp.text();
    // Saved settings probe is allowed; stub version returns connected.
    expect(resp.ok() || resp.status() === 200, text).toBeTruthy();
  });

  test('Viewer cannot probe a draft apiUrl (Admin-only)', async ({ browser }) => {
    const context = await browser.newContext({ storageState: viewerState });
    const resp = await context.request.post(resourcePath('test-connection'), {
      data: { apiUrl: 'http://127.0.0.1:9', apiKey: 'draft-key' },
    });
    const text = await resp.text();
    expect(resp.status(), text).toBe(403);
    expect(text).not.toContain(UPSTREAM_SECRET_MARKER);
    expect(text).not.toContain(PROVISIONED_API_KEY);
    await context.close();
  });

  test('Editor cannot probe a draft apiUrl (Admin-only)', async ({ browser }) => {
    const context = await browser.newContext({ storageState: editorState });
    const resp = await context.request.post(resourcePath('test-connection'), {
      data: { apiUrl: 'http://127.0.0.1:9', apiKey: 'draft-key' },
    });
    const text = await resp.text();
    expect(resp.status(), text).toBe(403);
    await context.close();
  });
});

test.describe('Security by design — upstream errors never dump raw body', () => {
  test.use({ storageState: adminState });

  test('upstream 5xx becomes stable envelope without secret fields', async ({ request }) => {
    const resp = await request.post(resourcePath('query'), {
      data: { intent: 'TRIGGER_UPSTREAM_5XX please' },
    });
    const text = await resp.text();
    const json = JSON.parse(text);

    expect(isStableEnvelope(json)).toBeTruthy();
    expect(resp.status()).toBe(503);
    const env = asEnvelope(json);
    expect(env.ok).toBe(false);

    const forbidden = bodyContainsForbidden(
      json,
      UPSTREAM_SECRET_MARKER,
      UPSTREAM_INTERNAL_FIELD,
      PROVISIONED_API_KEY,
      'debug_stack'
    );
    expect(forbidden, text).toEqual([]);
  });

  test('upstream 403 is remapped to 502 envelope (not session-looking 403)', async ({ request }) => {
    const resp = await request.post(resourcePath('query'), {
      data: { intent: 'TRIGGER_UPSTREAM_403 please' },
    });
    const text = await resp.text();
    const json = JSON.parse(text);

    expect(isStableEnvelope(json)).toBeTruthy();
    // Plugin maps upstream 401/403 → 502 so the browser does not mistake it for Grafana session expiry.
    expect(resp.status(), text).toBe(502);
    const forbidden = bodyContainsForbidden(json, UPSTREAM_SECRET_MARKER, UPSTREAM_INTERNAL_FIELD, PROVISIONED_API_KEY);
    expect(forbidden, text).toEqual([]);
  });
});

test.describe('Security by design — remediate allowlist (no execute)', () => {
  test.use({ storageState: adminState });

  test('execute/apply keys in remediate body never reach upstream as executable fields', async ({ request }) => {
    const resp = await request.post(resourcePath('remediate'), {
      data: {
        issue: 'scale deployment',
        intent: 'scale deployment',
        execute: true,
        apply: true,
        mode: 'auto',
        confirm: 'yes',
      },
    });
    const text = await resp.text();
    const json = JSON.parse(text);

    expect(resp.status(), text).toBe(200);
    expect(isStableEnvelope(json)).toBeTruthy();
    const summary = String(asEnvelope(json).summary || '');
    // Stub would echo STUB_SAW_EXECUTE_KEYS if allowlist leaked.
    expect(summary).not.toContain('STUB_SAW_EXECUTE_KEYS');
    expect(summary).toContain('stub-remediate-ok');
  });
});

// Reference plugin id so a rename fails loudly.
test('plugin id is stable for resource paths', async () => {
  expect(PLUGIN_ID).toBe('devopstoolkit-dotai-app');
});
