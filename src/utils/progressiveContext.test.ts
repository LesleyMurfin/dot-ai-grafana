import {
  appendHistory,
  buildRequestText,
  extractResourceHints,
  MAX_CURRENT_CHARS,
  MAX_HISTORY_TURNS,
  MAX_INTENT_CHARS,
  mergeMap,
  rewriteCurrent,
  stablePreamble,
} from './progressiveContext';

describe('progressiveContext', () => {
  test('packed intent contract is 1000 chars', () => {
    expect(MAX_INTENT_CHARS).toBe(1000);
    expect(MAX_CURRENT_CHARS).toBe(700);
  });

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

  test('buildRequestText packs huge Current to ≤ MAX_INTENT_CHARS', () => {
    const lokiLines = Array.from({ length: 80 }, (_, i) => `error-line-${i} ${'x'.repeat(40)}`).join('\n');
    const current = [
      'Loki last 15m (pod/checkout-api ns/prod):',
      lokiLines,
      '',
      'Prometheus last 15m:',
      'pod/checkout-api ns/prod restarts=12',
      '',
      'Tempo last 15m:',
      Array.from({ length: 20 }, (_, i) => `trace ${'a'.repeat(32)}${i}`).join('\n'),
      '',
      'Alertmanager:',
      'KubePodCrashLooping firing',
    ].join('\n');
    const map =
      'Loki Loki, Prometheus Prometheus, Tempo Tempo, Alertmanager Alertmanager, pod/checkout-api, ns/prod';

    expect(current.length).toBeGreaterThan(MAX_INTENT_CHARS);

    const text = buildRequestText({
      tool: 'query',
      current,
      map,
      box: 'why is checkout-api crashing?',
    });

    expect(text.length).toBeLessThanOrEqual(MAX_INTENT_CHARS);
    expect(text).toContain('Question:');
    expect(text).toContain('why is checkout-api crashing?');
    // Map dropped first when over budget
    expect(text).not.toContain('\nMap:\n');
  });

  test('buildRequestText drops Tempo before trimming below budget', () => {
    const lokiBody = Array.from({ length: 12 }, (_, i) => `log-${i}-${'y'.repeat(30)}`).join('\n');
    const tempoBody = Array.from({ length: 30 }, (_, i) => `trace-${i}-${'z'.repeat(40)}`).join('\n');
    const current = [
      'Loki last 15m:',
      lokiBody,
      '',
      'Prometheus last 15m:',
      'restarts=1',
      '',
      'Tempo last 15m:',
      tempoBody,
      '',
      'Alertmanager:',
      'no alerts',
    ].join('\n');
    const map = 'x'.repeat(200);

    const text = buildRequestText({
      tool: 'query',
      current,
      map,
      box: 'status?',
    });

    expect(text.length).toBeLessThanOrEqual(MAX_INTENT_CHARS);
    expect(text).not.toMatch(/Tempo last 15m/i);
    expect(text).toContain('Loki last 15m');
    expect(text).toContain('Prometheus last 15m');
  });

  test('buildRequestText trims Loki lines after Map and Tempo are dropped', () => {
    const lokiBody = Array.from({ length: 40 }, (_, i) => `error-line-${i} ${'w'.repeat(80)}`).join('\n');
    const current = [
      'Loki last 15m:',
      lokiBody,
      '',
      'Prometheus last 15m:',
      'restarts=3',
      '',
      'Tempo last 15m:',
      Array.from({ length: 10 }, (_, i) => `trace-${i}-${'z'.repeat(40)}`).join('\n'),
      '',
      'Alertmanager:',
      'firing',
    ].join('\n');

    const text = buildRequestText({
      tool: 'query',
      current,
      map: 'm'.repeat(400),
      box: 'why are pods crashing?',
    });

    expect(text.length).toBeLessThanOrEqual(MAX_INTENT_CHARS);
    expect(text).not.toContain('\nMap:\n');
    expect(text).not.toMatch(/Tempo last 15m/i);
    expect(text).toContain('Loki last 15m');
    expect(text).toContain('Question:');
    expect(text).toContain('why are pods crashing?');
  });

  test('MAX_CURRENT_CHARS cannot overflow packed intent alone', () => {
    const hugeAnswer = 'fact '.repeat(500);
    const current = rewriteCurrent('', 'q', hugeAnswer);
    expect(current.length).toBeLessThanOrEqual(MAX_CURRENT_CHARS);
    const packed = buildRequestText({
      tool: 'query',
      current,
      map: 'm'.repeat(MAX_CURRENT_CHARS),
      box: 'follow up on the crash',
    });
    expect(packed.length).toBeLessThanOrEqual(MAX_INTENT_CHARS);
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
