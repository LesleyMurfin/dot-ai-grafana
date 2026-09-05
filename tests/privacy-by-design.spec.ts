import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from './fixtures';
import { testIds } from '../src/components/testIds';
import { MAX_PRIOR_CHARS } from '../src/utils/progressiveContext';
import {
  PLUGIN_ID,
  PROVISIONED_API_KEY,
  UPSTREAM_INTERNAL_FIELD,
  UPSTREAM_SECRET_MARKER,
  asEnvelope,
  bodyContainsForbidden,
  isStableEnvelope,
  resourcePath,
  stubIntents,
} from './byDesignHelpers';

/**
 * Privacy by design — bearer never leaves secure storage; resource responses stay
 * on the stable envelope; bundle does not embed the provisioned token; config UI
 * never renders the secret into the DOM; Debug Log defaults off on screen; the
 * condensed Prior block stays within MAX_PRIOR_CHARS (#44 P1–P4, P7).
 *
 * Deferred (see issue #44):
 * - ask log file-write behaviour (whether a line actually lands at
 *   /var/lib/grafana/dotai-ask.log) has no HTTP-readable surface in this harness —
 *   pinned by Go unit tests instead (TestAskLogDisabledByDefault, TestAskLogFile).
 * - ask log login/role fields and email absence (unit-only, TestAskLogUserAttribution)
 */

const adminState = 'playwright/.auth/admin.json';

function collectFiles(root: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    return out;
  }
  for (const name of entries) {
    const full = join(root, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      collectFiles(full, out);
    } else if (st.isFile() && st.size < 5_000_000) {
      out.push(full);
    }
  }
  return out;
}

test.describe('Privacy by design — bearer token isolation', () => {
  test.use({ storageState: adminState });

  test('plugin settings response does not include the provisioned apiKey', async ({ request }) => {
    const resp = await request.get(`/api/plugins/${PLUGIN_ID}/settings`);
    const text = await resp.text();
    expect(resp.ok(), text).toBeTruthy();

    const forbidden = bodyContainsForbidden(text, PROVISIONED_API_KEY, 'Bearer ');
    expect(forbidden, text).toEqual([]);

    // secureJsonFields may flag apiKey as set, but the value must not appear.
    expect(text).not.toContain(PROVISIONED_API_KEY);
  });

  test('tool resource responses never echo the bearer token', async ({ request }) => {
    const resp = await request.post(resourcePath('query'), {
      data: { intent: 'privacy check' },
    });
    const text = await resp.text();
    const json = JSON.parse(text);

    expect(isStableEnvelope(json)).toBeTruthy();
    const forbidden = bodyContainsForbidden(
      text,
      PROVISIONED_API_KEY,
      'Bearer ',
      UPSTREAM_SECRET_MARKER,
      UPSTREAM_INTERNAL_FIELD
    );
    expect(forbidden, text).toEqual([]);
    expect(asEnvelope(json).ok).toBe(true);
  });

  test('built frontend bundle does not embed the provisioned apiKey', async () => {
    // CI builds into dist/ before e2e; local runs may use the same tree.
    const roots = ['dist', `dist/${PLUGIN_ID}`];
    const files: string[] = [];
    for (const root of roots) {
      collectFiles(root, files);
    }

    // If dist is missing (dev without build), skip rather than false-green.
    test.skip(files.length === 0, 'dist/ not present — bundle scan requires a frontend build');

    const hits: string[] = [];
    for (const file of files) {
      if (!/\.(js|css|html|map|json)$/i.test(file)) {
        continue;
      }
      let content: string;
      try {
        content = readFileSync(file, 'utf8');
      } catch {
        continue;
      }
      if (content.includes(PROVISIONED_API_KEY)) {
        hits.push(file);
      }
    }
    expect(hits, `apiKey leaked into bundle files: ${hits.join(', ')}`).toEqual([]);
  });

  test('config page never renders the provisioned apiKey into the DOM (P2)', async ({ appConfigPage, page }) => {
    void appConfigPage;
    const apiKeyField = page.getByTestId(testIds.appConfig.apiKey);
    await expect(apiKeyField).toBeVisible();

    // AppConfig never populates state.apiKey from secureJsonFields (only the
    // isConfigured flag), so the decrypted secret cannot reach the rendered page —
    // scan the whole DOM, not just the SecretInput, to catch any other leak.
    const html = await page.content();
    expect(html).not.toContain(PROVISIONED_API_KEY);
  });
});

test.describe('Privacy by design — Debug Log defaults off on screen (P4, consent overlap C1)', () => {
  test.use({ storageState: adminState });

  /**
   * jsonData.debugLog is unset in provisioning/plugins/apps.yaml and no other
   * e2e spec in this suite toggles the Debug Log switch (only
   * src/components/AppConfig/AppConfig.test.tsx flips it, under jsdom, not here),
   * so a fresh config load must show it off — the config-UI half of "opt-in,
   * off by default" (#44 P4/C1). The backend file-write half (no line appended
   * to /var/lib/grafana/dotai-ask.log while debugLog is false) has no
   * HTTP-readable surface in this harness and stays with Go unit coverage
   * (TestAskLogDisabledByDefault).
   */
  test('Debug Log switch is off on a fresh config load', async ({ appConfigPage, page }) => {
    void appConfigPage;
    const toggle = page.getByTestId(testIds.appConfig.debugLog);
    await expect(toggle).toBeVisible();
    await expect(toggle).not.toBeChecked();
  });
});

test.describe('Privacy by design — Prior stays within MAX_PRIOR_CHARS (P7)', () => {
  test.use({ storageState: adminState });

  /**
   * The 1000-char overall intent budget is already pinned in
   * tests/consent-by-design.spec.ts ("the notice matches what is POSTed"); this
   * pins the independent, tighter bound on the condensed Prior: block itself
   * (condensePriorTurns / MAX_PRIOR_CHARS = 240 — README "Data egress" table).
   * The first question is long enough that an uncapped You+Answer pairing would
   * clear 240 by a wide margin, so a capped, ellipsised Prior: block here proves
   * live truncation rather than a coincidentally short input.
   */
  test('a long first turn still yields a Prior: block no longer than MAX_PRIOR_CHARS on the follow-up', async ({
    gotoPage,
    page,
  }) => {
    await gotoPage('/');

    const marker = `priorbound-${Date.now().toString(36)}`;
    const longQuestion =
      `status of pod checkout-789 in namespace prod ${marker} — it keeps restarting every few ` +
      'minutes and the last three restarts all happened right after a deploy rollout, so I want ' +
      'to understand whether this is a resource limit problem, a liveness probe misconfiguration, ' +
      'or an image pull issue before anyone gets paged about it tonight';
    expect(longQuestion.length).toBeGreaterThan(MAX_PRIOR_CHARS);

    for (const text of [longQuestion, 'why is it restarting?']) {
      await page.getByTestId(testIds.dotai.intent).fill(text);
      await page.getByTestId(testIds.dotai.submit).click();
      await expect(page.getByTestId(testIds.dotai.response)).toBeVisible({ timeout: 20_000 });
      await expect(page.getByTestId(testIds.dotai.intent)).toHaveValue('', { timeout: 20_000 });
    }

    const intents = await stubIntents();
    const followUps = intents.filter((entry) => entry.text.includes('why is it restarting?'));
    expect(followUps.length, `no recorded follow-up intent; recorded ${intents.length} intents`).toBeGreaterThan(0);
    const packed = followUps[followUps.length - 1];

    const match = /\n\nPrior:\n([\s\S]*?)\n\n(?:Map:|Question:|Issue:)/.exec(packed.text);
    expect(match, `no Prior: section found in packed text: ${packed.text}`).not.toBeNull();
    const priorBlock = match![1];

    expect(priorBlock.length, priorBlock).toBeLessThanOrEqual(MAX_PRIOR_CHARS);
    // Truncated, not merely short: the full question never survives verbatim, and
    // oneLine's ellipsis marks where it was cut.
    expect(priorBlock).not.toContain(longQuestion);
    expect(priorBlock).toContain('…');
  });
});

test.describe('Privacy by design — envelope only', () => {
  test.use({ storageState: adminState });

  test('successful query response is only the stable envelope keys', async ({ request }) => {
    const resp = await request.post(resourcePath('query'), {
      data: { intent: 'envelope shape' },
    });
    const json = JSON.parse(await resp.text()) as Record<string, unknown>;
    expect(isStableEnvelope(json)).toBeTruthy();

    const keys = Object.keys(json).sort();
    // Allow only the documented contract keys.
    for (const k of keys) {
      expect(['ok', 'status', 'summary', 'error']).toContain(k);
    }
  });
});
