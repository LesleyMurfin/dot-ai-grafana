import {
  appendHistory,
  buildRequestText,
  extractResourceHints,
  MAX_CURRENT_CHARS,
  MAX_HISTORY_TURNS,
  mergeMap,
  rewriteCurrent,
  stablePreamble,
} from './progressiveContext';

describe('progressiveContext', () => {
  test('stable preamble distinguishes query vs remediate analysis-only', () => {
    expect(stablePreamble('query')).toMatch(/Query/i);
    expect(stablePreamble('query')).toMatch(/no mutations/i);
    expect(stablePreamble('remediate')).toMatch(/Remediate/i);
    expect(stablePreamble('remediate')).toMatch(/Analysis only/i);
    expect(stablePreamble('remediate')).toMatch(/do not apply/i);
  });

  test('buildRequestText sends Stable+Current+Map+box and omits History', () => {
    const text = buildRequestText({
      tool: 'query',
      current: 'pod/checkout-api is CrashLooping',
      map: 'pod/checkout-api, ns/prod',
      box: 'why is it restarting?',
    });

    expect(text).toContain(stablePreamble('query'));
    expect(text).toContain('Current:');
    expect(text).toContain('pod/checkout-api is CrashLooping');
    expect(text).toContain('Map:');
    expect(text).toContain('pod/checkout-api, ns/prod');
    expect(text).toContain('Question:');
    expect(text).toContain('why is it restarting?');
    // History must never appear in the packed POST body text
    expect(text).not.toMatch(/\bHistory\b/i);
    expect(text).not.toMatch(/\bYou:/);
    expect(text).not.toMatch(/\bAnswer:/);
  });

  test('buildRequestText first turn is Stable + Question only', () => {
    const text = buildRequestText({
      tool: 'query',
      current: '',
      map: '',
      box: '  show failing pods  ',
    });
    expect(text).toBe(`${stablePreamble('query')}\n\nQuestion:\nshow failing pods`);
  });

  test('buildRequestText remediate uses Issue label', () => {
    const text = buildRequestText({
      tool: 'remediate',
      current: 'ns/prod checkout failing',
      map: 'ns/prod',
      box: 'analyze crash',
    });
    expect(text).toContain(stablePreamble('remediate'));
    expect(text).toContain('Issue:');
    expect(text).toContain('analyze crash');
    expect(text).not.toMatch(/\bHistory\b/i);
  });

  test('rewriteCurrent replaces with capped block including resources and next', () => {
    const current = rewriteCurrent(
      '',
      'show pod checkout-api in production namespace',
      'pod checkout-api is CrashLooping in namespace production. Restart count 12.'
    );
    expect(current).toMatch(/Asked:/);
    expect(current).toMatch(/What's true now:/);
    expect(current).toMatch(/Next:/);
    expect(current.length).toBeLessThanOrEqual(MAX_CURRENT_CHARS);
  });

  test('appendHistory caps display turns at MAX_HISTORY_TURNS', () => {
    let history = appendHistory([], 'q1', 'a1');
    history = appendHistory(history, 'q2', 'a2');
    history = appendHistory(history, 'q3', 'a3');
    // 3 pairs = 6 turns → sliced to last 5
    expect(history).toHaveLength(MAX_HISTORY_TURNS);
    expect(history[0].role).toBe('answer'); // oldest you dropped
    expect(history[history.length - 1]).toEqual({ role: 'answer', text: 'a3' });
  });

  test('mergeMap keeps short names only', () => {
    const map = mergeMap('', 'pod foo-bar in prod namespace is down', 'namespace: kube-system');
    expect(map.length).toBeLessThanOrEqual(400);
    expect(map.length).toBeGreaterThan(0);
  });

  test('extractResourceHints ignores filler words around "in"', () => {
    const hints = extractResourceHints('All 14 namespaces are in Active status');
    expect(hints).not.toContain('are@Active');
    expect(hints).not.toMatch(/\bare@/);
  });

  test('extractResourceHints still keeps real "name in namespace" pairs', () => {
    const hints = extractResourceHints('checkout-api in production is degraded');
    expect(hints).toContain('checkout-api@production');
  });
});
