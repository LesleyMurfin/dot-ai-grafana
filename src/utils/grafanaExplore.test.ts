import { config } from '@grafana/runtime';
import {
  DIAGNOSIS_TOKENS,
  buildDrilldownLinks,
  dashboardUrl,
  exploreUrl,
  isShowMeOnly,
} from './grafanaExplore';

jest.mock('@grafana/runtime', () => ({
  config: {
    appSubUrl: '',
    apps: { 'grafana-lokiexplore-app': { id: 'grafana-lokiexplore-app' } },
    bootData: { user: { orgId: 1 } },
  },
}));

describe('isShowMeOnly', () => {
  // One test per PRD #3 matching-contract clause (names fail the clause).

  test('clause: lowercase + strip surrounding .?! — SHOW ME LOGS.', () => {
    expect(isShowMeOnly('SHOW ME LOGS.')).toBe(true);
  });

  test('clause: complete phrase only — show me dashboards', () => {
    expect(isShowMeOnly('show me dashboards')).toBe(true);
  });

  test('clause: complete phrase verbs — open the traces / display the metrics', () => {
    expect(isShowMeOnly('open the traces')).toBe(true);
    expect(isShowMeOnly('display the metrics')).toBe(true);
  });

  test('clause: no for-resource tail — show me the logs for pod api-7f', () => {
    // Contract production has no `for <resource>`; must POST (not 0-hop skip).
    expect(isShowMeOnly('show me the logs for pod api-7f')).toBe(false);
  });

  test('clause: diagnosis wins — show me the logs — why is checkout-api crashing?', () => {
    // Interior em-dash/punctuation must survive; why/crash force POST.
    expect(isShowMeOnly('show me the logs — why is checkout-api crashing?')).toBe(false);
  });

  test('clause: diagnosis token analyze', () => {
    expect(isShowMeOnly('analyze the logs')).toBe(false);
  });

  test('clause: no partial-word hits', () => {
    expect(isShowMeOnly('showcase logs')).toBe(false);
    expect(isShowMeOnly('show me the logging')).toBe(false);
    expect(isShowMeOnly('showmen logs')).toBe(false);
  });

  test('pure navigation phrases still match', () => {
    expect(isShowMeOnly('show me the logs')).toBe(true);
    expect(isShowMeOnly('open traces')).toBe(true);
    expect(isShowMeOnly('display alerts')).toBe(true);
  });

  // Former widened-form cases (`for …`) previously expected true; contract rejects them.
  test('widened for-tail no longer skips (was depending on optional for-clause)', () => {
    expect(isShowMeOnly('show me the alerts for checkout')).toBe(false);
    expect(isShowMeOnly('show me metrics for ns/prod')).toBe(false);
    expect(isShowMeOnly('show logs for pod api')).toBe(false);
    expect(isShowMeOnly('list namespaces')).toBe(false);
  });

  test('diagnosis extras still force POST', () => {
    expect(isShowMeOnly('why are there errors for pod api')).toBe(false);
    expect(isShowMeOnly('how do we improve alerts')).toBe(false);
    expect(isShowMeOnly('show failing pods')).toBe(false);
    expect(
      isShowMeOnly('show me the logs for the top issue we need to address in our environment')
    ).toBe(false);
  });

  // The blocklist is unreachable under today's fully-anchored production (no
  // accepted phrase contains a diagnosis token), so these cases pass on the
  // production alone and cannot pin the blocklist directly. What they *can*
  // pin is the stemming, by testing the predicate the blocklist applies: each
  // inflection below must be recognised as a diagnosis token so the block
  // still works when a later slice widens the production.
  describe('diagnosis blocklist stemming (defence for a widened production)', () => {
    const inflections = [
      'error',
      'errors',
      'crash',
      'crashing',
      'crashed',
      'crashloopbackoff',
      'fail',
      'failing',
      'failed',
      'failure',
      'analyze',
      'analyse',
      'analysis',
      'analyzing',
    ];

    test.each(inflections)('%s is a diagnosis token', (token) => {
      // Assert the real exported blocklist — not a copy of it — so a regression
      // in the source regex fails here instead of passing against a duplicate.
      expect(DIAGNOSIS_TOKENS.test(token)).toBe(true);
      // And end-to-end: never a 0-hop skip.
      expect(isShowMeOnly(`show me the logs ${token}`)).toBe(false);
    });

    test('the blocklist is genuinely unreachable under the current production', () => {
      // Pins the review's finding: every phrase the production accepts is free
      // of diagnosis tokens, so the block cannot change a result today. If a
      // later slice widens the production, this test is expected to fail —
      // that is the signal the blocklist has become load-bearing.
      const accepted: string[] = [];
      for (const verb of ['show me', 'open', 'display']) {
        for (const article of ['', ' the']) {
          for (const noun of ['logs', 'alerts', 'traces', 'metrics', 'dashboards']) {
            accepted.push(`${verb}${article} ${noun}`);
          }
        }
      }
      expect(accepted).toHaveLength(30);
      for (const phrase of accepted) {
        expect(isShowMeOnly(phrase)).toBe(true);
        expect(DIAGNOSIS_TOKENS.test(phrase)).toBe(false);
      }
    });
  });

  test('clause: collapse internal whitespace — "show  me   the  logs"', () => {
    expect(isShowMeOnly('show  me   the  logs')).toBe(true);
    expect(isShowMeOnly('  open\tthe   traces  ')).toBe(true);
    expect(isShowMeOnly('display\nthe\nmetrics')).toBe(true);
  });

  test('clause: strip surrounding ? and ! — "show me the logs?" / "open alerts!"', () => {
    expect(isShowMeOnly('show me the logs?')).toBe(true);
    expect(isShowMeOnly('open alerts!')).toBe(true);
    expect(isShowMeOnly('Display The Dashboards?!')).toBe(true);
    // Interior punctuation is not stripped, so this is not the complete phrase.
    expect(isShowMeOnly('show me the logs? and metrics')).toBe(false);
  });
});

/** Decode the `panes` param the way Grafana's v1Migrator receives it. */
function panesOf(href: string): Record<string, any> {
  const raw = new URL(href, 'http://x').searchParams.get('panes');
  expect(raw).not.toBeNull();
  return JSON.parse(raw!);
}

describe('exploreUrl / dashboardUrl', () => {
  test('pane key satisfies v1Migrator: 3 chars from ID_ALPHABET, not all digits', () => {
    // useStateSync/migrators/v1.ts silently replaces any other key with a
    // random generateExploreId(), which would discard our pane id. Re-implement
    // the parser's own predicate so this pins the constraint, not the literal.
    const ID_ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';
    const href = exploreUrl({
      uid: 'loki-1',
      type: 'loki',
      query: { expr: '{namespace="prod"}', queryType: 'range' },
    });
    const keys = Object.keys(panesOf(href));
    expect(keys).toHaveLength(1);
    const key = keys[0];

    const wouldBeReplaced =
      key.length !== 3 || /^\d+$/.test(key) || key.split('').some((ch) => ID_ALPHABET.indexOf(ch) === -1);
    expect(wouldBeReplaced).toBe(false);
    expect(key).toBe('dot');
  });

  test('Explore pane is structurally what applyDefaults expects', () => {
    // Structural, not substring: renaming `queries` or dropping refId must fail.
    const href = exploreUrl({
      uid: 'loki-1',
      type: 'loki',
      query: { expr: '{namespace="prod"}', queryType: 'range' },
    });
    expect(Object.values(panesOf(href))[0]).toEqual({
      datasource: 'loki-1',
      queries: [
        {
          refId: 'A',
          datasource: { type: 'loki', uid: 'loki-1' },
          expr: '{namespace="prod"}',
          queryType: 'range',
        },
      ],
      range: { from: 'now-15m', to: 'now' },
    });
  });

  test('Explore panes include datasource uid and query', () => {
    const href = exploreUrl({
      uid: 'loki-1',
      type: 'loki',
      query: { expr: '{namespace="prod"}', queryType: 'range' },
    });
    expect(href.startsWith('/explore?')).toBe(true);
    expect(href).toContain('schemaVersion=1');
    expect(href).toContain('loki-1');
    expect(href).toContain('namespace');
  });


  test('dashboard is /d/uid', () => {
    expect(dashboardUrl('abc12def')).toBe('/d/abc12def');
  });

  test('appSubUrl prefix is kept on Explore and dashboard URLs', () => {
    const original = config.appSubUrl;
    config.appSubUrl = '/grafana';
    try {
      const href = exploreUrl({
        uid: 'loki-1',
        type: 'loki',
        query: { expr: '{namespace="prod"}', queryType: 'range' },
      });
      expect(href.startsWith('/grafana/explore?')).toBe(true);
      expect(dashboardUrl('abc12def')).toBe('/grafana/d/abc12def');

      const links = buildDrilldownLinks({
        lokiUid: 'loki-1',
        promUid: 'prom-1',
        logql: '{namespace="prod"}',
        promql: 'up',
        tempoSearch: '',
        traceIds: [],
        dashboardUids: ['dashuid1'],
      });
      expect(links.find((l) => l.id === 'explore-logs')?.href.startsWith('/grafana/explore?')).toBe(true);
      expect(links.find((l) => l.id === 'dash-dashuid1')?.href).toBe('/grafana/d/dashuid1');
    } finally {
      config.appSubUrl = original;
    }
  });

  test('trailing slash on appSubUrl is not doubled', () => {
    const original = config.appSubUrl;
    config.appSubUrl = '/grafana/';
    try {
      expect(dashboardUrl('abc12def')).toBe('/grafana/d/abc12def');
    } finally {
      config.appSubUrl = original;
    }
  });
});

describe('buildDrilldownLinks', () => {
  test('Explore plus Logs Drilldown when app is installed', () => {
    const links = buildDrilldownLinks({
      lokiUid: 'loki-1',
      promUid: 'prom-1',
      tempoUid: 'tempo-1',
      logql: '{namespace="prod"}',
      promql: 'up',
      tempoSearch: 'checkout',
      traceIds: ['abcdef123456'],
      dashboardUids: ['dashuid1'],
    });
    const labels = links.map((l) => l.label);
    expect(labels).toContain('Explore logs');
    expect(labels).toContain('Logs Drilldown');
    expect(labels).toContain('Explore metrics');
    expect(labels).not.toContain('Metrics Drilldown');
    expect(labels).toContain('Explore traces');
    expect(labels).toContain('Trace abcdef12');
    expect(labels).toContain('Dashboard dashuid1');
    expect(links.find((l) => l.id === 'dash-dashuid1')?.href).toBe('/d/dashuid1');
  });

  test('Tempo search term survives as traceqlSearch filters, not as `query`', () => {
    // 11.4 drives traceqlSearch from TempoQuery.filters: datasource.ts runs
    // generateQueryFromFilters(filters) and TraceQLSearch.tsx regenerates the
    // displayed query from filters, so a term passed as `query` is discarded.
    const links = buildDrilldownLinks({
      tempoUid: 'tempo-1',
      logql: '',
      promql: '',
      tempoSearch: 'checkout-api',
      traceIds: [],
      dashboardUids: [],
    });
    const href = links.find((l) => l.id === 'explore-traces')!.href;
    const query = Object.values(panesOf(href))[0].queries[0];

    expect(query.queryType).toBe('traceqlSearch');
    // The term must live in filters — this is what actually executes.
    expect(query.filters).toEqual([
      {
        id: 'service-name',
        scope: 'resource',
        tag: 'service.name',
        operator: '=',
        value: 'checkout-api',
        valueType: 'string',
      },
    ]);
    // generateQueryFromFilters() would render exactly this.
    expect(`{${query.filters.map((f: any) => `${f.scope}.${f.tag}${f.operator}"${f.value}"`).join(' && ')}}`).toBe(
      '{resource.service.name="checkout-api"}'
    );
    // A stray `query` string is ignored by Tempo in this mode; don't emit one.
    expect(query.query).toBeUndefined();
  });

  test('blank Tempo search still emits the required `filters` array', () => {
    // TempoQuery.filters is required in dataquery.gen.ts; omitting it entirely
    // is a schema violation. Empty term => unfiltered search, not an empty chip.
    const links = buildDrilldownLinks({
      tempoUid: 'tempo-1',
      logql: '',
      promql: '',
      tempoSearch: '',
      traceIds: [],
      dashboardUids: [],
    });
    const href = links.find((l) => l.id === 'explore-traces')!.href;
    const query = Object.values(panesOf(href))[0].queries[0];
    expect(query.filters).toEqual([]);
  });

  test('per-trace-ID links stay on queryType traceql with the id as `query`', () => {
    // Unchanged by design: TempoQuery.query is documented "TraceQL query or trace ID".
    const links = buildDrilldownLinks({
      tempoUid: 'tempo-1',
      logql: '',
      promql: '',
      tempoSearch: 'checkout-api',
      traceIds: ['abcdef123456'],
      dashboardUids: [],
    });
    const href = links.find((l) => l.id === 'trace-abcdef123456')!.href;
    const query = Object.values(panesOf(href))[0].queries[0];
    expect(query.queryType).toBe('traceql');
    expect(query.query).toBe('abcdef123456');
  });
});
