import { config } from '@grafana/runtime';
import { buildDrilldownLinks, exploreUrl } from './grafanaExplore';

jest.mock('@grafana/runtime', () => ({
  config: {
    appSubUrl: '',
    apps: { 'grafana-lokiexplore-app': { id: 'grafana-lokiexplore-app' } },
    bootData: { user: { orgId: 1 } },
  },
}));

describe('exploreUrl', () => {
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

  test('appSubUrl prefix is kept on Explore URLs', () => {
    const original = config.appSubUrl;
    config.appSubUrl = '/grafana';
    try {
      const href = exploreUrl({
        uid: 'loki-1',
        type: 'loki',
        query: { expr: '{namespace="prod"}', queryType: 'range' },
      });
      expect(href.startsWith('/grafana/explore?')).toBe(true);

      const links = buildDrilldownLinks({
        lokiUid: 'loki-1',
        promUid: 'prom-1',
        logql: '{namespace="prod"}',
        promql: 'up',
        tempoSearch: '',
        traceIds: [],
      });
      expect(links.find((l) => l.id === 'explore-logs')?.href.startsWith('/grafana/explore?')).toBe(
        true
      );
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
    });
    const labels = links.map((l) => l.label);
    expect(labels).toContain('Explore logs');
    expect(labels).toContain('Logs Drilldown');
    expect(labels).toContain('Explore metrics');
    expect(labels).not.toContain('Metrics Drilldown');
    expect(labels).toContain('Explore traces');
    expect(labels).toContain('Trace abcdef12');
  });

  test('trace labels stay distinct when ids share an 8-char prefix', () => {
    const links = buildDrilldownLinks({
      tempoUid: 'tempo-1',
      logql: '',
      promql: '',
      tempoSearch: '',
      traceIds: ['abc123450000', 'abc123459999'],
    });
    const labels = links.filter((l) => l.id.startsWith('trace-')).map((l) => l.label);
    expect(labels).toEqual(['Trace abc123450000', 'Trace abc123459999']);
    expect(new Set(labels).size).toBe(labels.length);
  });

  test('duplicate identical trace ids produce exactly one link with a unique key', () => {
    const links = buildDrilldownLinks({
      tempoUid: 'tempo-1',
      logql: '',
      promql: '',
      tempoSearch: '',
      traceIds: ['abc123450000', 'abc123450000', 'abc123450000'],
    });
    const traceLinks = links.filter((l) => l.id.startsWith('trace-'));
    expect(traceLinks).toHaveLength(1);
    expect(traceLinks[0].id).toBe('trace-abc123450000');
    expect(new Set(links.map((l) => l.id)).size).toBe(links.length);
  });
});
