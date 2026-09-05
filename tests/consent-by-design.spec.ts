import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { testIds } from '../src/components/testIds';
import {
  type StubIntent,
  PLUGIN_ID,
  asEnvelope,
  isStableEnvelope,
  resourcePath,
  stubIntents,
} from './byDesignHelpers';

/**
 * Consent by design — no execute/operate surface from this plugin; remediate is
 * analysis-only; the on-page notice discloses what an Ask actually POSTs.
 *
 * The disclosure case asserts the notice against the stub's recorded request
 * bodies (GET /intents), so the copy cannot drift away from the egress it
 * describes. The "Send Grafana evidence" off variant is covered in jsdom rather
 * than here — see the note above the "the notice matches what is POSTed"
 * describe on why this file stays read-only on plugin settings.
 *
 * Deferred (see issue #44):
 * - ask log file-write behaviour has no HTTP-readable surface in this harness;
 *   the config-UI half of "opt-in, off by default" (P4/C1) is pinned in
 *   tests/privacy-by-design.spec.ts, the backend half by Go unit tests.
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

  test('no execute/operate resource route exists on the real HTTP path (S12, consent overlap C5)', async ({
    request,
  }) => {
    for (const tool of ['execute', 'operate']) {
      // pkg/plugin/resources.go registers only /health, /test-connection, /query
      // and /remediate on its mux; an unmapped path 404s before any tool handler
      // runs. This is the network half of "no execute control" — the UI-only
      // assertion above cannot show that the route plainly does not exist.
      const resp = await request.post(`/api/plugins/${PLUGIN_ID}/resources/${tool}`, {
        data: { issue: 'consent check' },
      });
      expect(resp.status(), `POST /${tool} must not be a registered resource route`).toBe(404);
    }
  });
});

test.describe('Consent by design — Show context reveals full History on screen (C2)', () => {
  test.use({ storageState: adminState });

  /**
   * The disclosure notice above (and README "Data egress") promises "Full
   * History stays in this browser." This is the on-screen half of C2: Show
   * context is on by default (jsonData.showContext unset in
   * provisioning/plugins/apps.yaml) and no e2e spec in this fullyParallel suite
   * writes plugin settings at all — see the note above the last describe — so a
   * fresh Ask must render the History panel holding the
   * verbatim question, not the ≤240-char, possibly-ellipsised condensed Prior:
   * text that the wire actually carries (pinned separately as P7 in
   * tests/privacy-by-design.spec.ts).
   */
  test('History panel shows the full verbatim question after an Ask', async ({ gotoPage, page }) => {
    await gotoPage('/');

    const marker = `historypanel-${Date.now().toString(36)}`;
    const longQuestion =
      `status of pod checkout-${marker} in namespace prod and please walk through every ` +
      'plausible root cause before this gets escalated to the on-call team tonight';
    // Longer than formatPriorPair's own 90-char per-turn question budget, so the
    // wire's Prior: line (checked elsewhere) would have to truncate it even when
    // the on-screen History panel below must not.
    expect(longQuestion.length).toBeGreaterThan(90);

    await page.getByTestId(testIds.dotai.intent).fill(longQuestion);
    await page.getByTestId(testIds.dotai.submit).click();
    await expect(page.getByTestId(testIds.dotai.response)).toBeVisible({ timeout: 20_000 });

    const history = page.getByTestId(testIds.dotai.history);
    await expect(history).toBeVisible();
    await expect(history).toContainText(longQuestion);
  });
});

/**
 * The notice at `testIds.dotai.consent` is the operator's only egress notice in the
 * product — README and prds/ are not shipped to the browser. The case below reads the
 * rendered notice, then compares it with what the stub actually received.
 *
 * Deliberately read-only on plugin settings. An earlier revision flipped
 * `jsonData.sendGrafanaEvidence` here to cover the evidence-off notice too, but plugin
 * settings are org-wide: under `playwright.config.ts` `fullyParallel: true` that write
 * raced `reliability-by-design.spec.ts`, whose R5 asserts the "<Kind> datasource missing"
 * notes that exist only while evidence is on. It is the same hazard
 * `provisioning/plugins/apps.yaml` already documents for `apiUrl` / `apiKey`. The
 * evidence-off half of the disclosure is asserted in jsdom instead, where the toggle is
 * a prop — `DotAIPage.test.tsx` "evidence off: the notice still discloses Prior, and
 * Prior is still POSTed" checks both the copy and that Prior still reaches the body.
 */
test.describe('Consent by design — the notice matches what is POSTed', () => {
  test.use({ storageState: adminState });

  const token = (label: string) => `consentprobe-${label}-${Math.random().toString(36).slice(2, 8)}`;

  /**
   * Ask twice so the second POST is the one that can carry Prior. The intent box
   * emptying is the completion signal — the page clears it on success, which also
   * re-disables the submit button, so `toBeEnabled` never resolves after a successful
   * Ask. The response check that follows is a post-condition, not a wait: the previous
   * Ask's response is still mounted on the second pass.
   */
  async function askTwice(page: Page, first: string, second: string): Promise<void> {
    for (const text of [first, second]) {
      await page.getByTestId(testIds.dotai.intent).fill(text);
      await page.getByTestId(testIds.dotai.submit).click();
      await expect(page.getByTestId(testIds.dotai.intent)).toHaveValue('', { timeout: 20_000 });
      await expect(page.getByTestId(testIds.dotai.response)).toBeVisible();
    }
  }

  function followUp(intents: StubIntent[], marker: string): StubIntent {
    const match = intents.filter((entry) => entry.text.includes(marker));
    expect(
      match.length,
      `no recorded intent carried ${marker}; recorded ${intents.length} intents`
    ).toBeGreaterThan(0);
    return match[match.length - 1];
  }

  test('evidence on: the notice names the blocks the follow-up Ask actually sends', async ({
    gotoPage,
    page,
  }) => {
    // No settings write: apps.yaml provisions no sendGrafanaEvidence, and both
    // AppConfig.tsx (`!== false`) and DotAIPage.tsx (prop default) read undefined as
    // on, so the provisioned default is already the state this case needs.
    await gotoPage('/');

    const notice = page.getByTestId(testIds.dotai.consent);
    await expect(notice).toBeVisible();
    await expect(notice).toContainText('Grafana datasource facts read at that moment');
    await expect(notice).toContainText('condensed Prior block of up to 240 characters');
    await expect(notice).toContainText('Full History stays in this browser');

    const first = token('on-first');
    await askTwice(page, `status of pod ${first} in namespace prod`, 'why is it restarting in namespace prod?');

    const intents = await stubIntents();
    // The follow-up POST is the one whose Prior block quotes the first question.
    const packed = followUp(intents, first);
    expect(packed.text, packed.text).toContain('Prior:');
    expect(packed.len).toBeLessThanOrEqual(1000);
    // The notice claims a datasource read happens; the packed body must show one.
    expect(packed.text, packed.text).toContain('Current:');
    // …and History itself is never a block on the wire.
    expect(packed.text).not.toMatch(/^History:/m);
  });
});
