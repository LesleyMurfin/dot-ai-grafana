import { setTimeout as sleep } from 'node:timers/promises';
import { STUB_BASE_URL, stubHealth } from '../byDesignHelpers';

/**
 * Playwright globalSetup: prove the dot-ai stub upstream is alive before any
 * spec runs. Without this, a dead or unpublished stub surfaces as plugin-shaped
 * failures (502 envelopes, missing `stub-*-ok` summaries) that read like a
 * regression in the plugin itself.
 */
export default async function stubPreflight(): Promise<void> {
  const deadline = Date.now() + 30_000;
  let lastError = '';

  while (Date.now() < deadline) {
    try {
      const health = await stubHealth();
      process.stdout.write(`dot-ai stub reachable at ${STUB_BASE_URL} (hits=${JSON.stringify(health.hits)})\n`);
      return;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      await sleep(1000);
    }
  }

  throw new Error(
    [
      `dot-ai stub upstream (docker-compose service \`dot-ai-stub\`) is NOT reachable at ${STUB_BASE_URL}/healthz — aborting e2e.`,
      `Last error: ${lastError}`,
      'This is a harness failure, not a plugin failure: start it with `npm run server`',
      '(container port 8080 is published on host 18080), or set DOT_AI_STUB_URL',
      'if you published a different host port.',
    ].join('\n')
  );
}
