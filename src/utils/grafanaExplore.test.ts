import { config } from '@grafana/runtime';
import { buildDrilldownLinks, dashboardUrl, exploreUrl } from './grafanaExplore';

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
        dashboardUids: [],
      });
      expect(links.find((l) => l.id === 'explore-logs')?.href.startsWith('/grafana/explore?')).toBe(
        true
      );
    } finally {
      config.appSubUrl = original;
    }
  });
});

describe('dashboardUrl', () => {
  test('dashboard is /d/uid', () => {
    expect(dashboardUrl('abc12def')).toBe('/d/abc12def');
  });

  test('appSubUrl prefix is kept on dashboard URLs', () => {
    const original = config.appSubUrl;
    config.appSubUrl = '/grafana';
    try {
      expect(dashboardUrl('abc12def')).toBe('/grafana/d/abc12def');
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
      dashboardUids: [],
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
      dashboardUids: [],
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
      dashboardUids: [],
    });
    const traceLinks = links.filter((l) => l.id.startsWith('trace-'));
    expect(traceLinks).toHaveLength(1);
    expect(traceLinks[0].id).toBe('trace-abc123450000');
    expect(new Set(links.map((l) => l.id)).size).toBe(links.length);
  });

  test('renders a dashboard link for each valid dashboardUid', () => {
    const links = buildDrilldownLinks({
      logql: '',
      promql: '',
      tempoSearch: '',
      traceIds: [],
      dashboardUids: ['dashuid1', 'k8s-workloads-overview-prod'],
    });
    const labels = links.map((l) => l.label);
    expect(labels).toContain('Dashboard dashuid1');
    expect(labels).toContain('Dashboard k8s-workloads-overview-prod');
    expect(links.find((l) => l.id === 'dash-dashuid1')?.href).toBe('/d/dashuid1');
  });

  test('rejects a dashboardUid that fails the conservative shape check', () => {
    const links = buildDrilldownLinks({
      logql: '',
      promql: '',
      tempoSearch: '',
      traceIds: [],
      dashboardUids: ['ok-uid-1', '../../etc/passwd', 'javascript:alert(1)', 'ab', ''],
    });
    expect(links.map((l) => l.id)).toEqual(['dash-ok-uid-1']);
    expect(links[0].href).toBe('/d/ok-uid-1');
    expect(JSON.stringify(links)).not.toMatch(/javascript:|\.\.\//);
  });

  test('5 invalid uids ahead of a valid one do not starve it out of the 5-link budget', () => {
    // Old behavior sliced to 5 BEFORE validating, so 5 invalid entries ahead of a
    // valid uid consumed the whole budget and the valid uid never rendered.
    const links = buildDrilldownLinks({
      logql: '',
      promql: '',
      tempoSearch: '',
      traceIds: [],
      dashboardUids: ['ab', '../../etc/passwd', 'javascript:alert(1)', '', 'x', 'ok-uid-1'],
    });
    expect(links.map((l) => l.id)).toEqual(['dash-ok-uid-1']);
    expect(links[0].href).toBe('/d/ok-uid-1');
  });
});
