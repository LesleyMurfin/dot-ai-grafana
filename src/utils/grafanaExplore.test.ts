import {
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
  test('show/open logs alerts traces metrics dashboards', () => {
    expect(isShowMeOnly('show me the logs')).toBe(true);
    expect(isShowMeOnly('show me the alerts for checkout')).toBe(true);
    expect(isShowMeOnly('open traces')).toBe(true);
    expect(isShowMeOnly('show me metrics for ns/prod')).toBe(true);
    expect(isShowMeOnly('show me dashboards')).toBe(true);
  });


  test('diagnosis still goes to dot-ai', () => {
    expect(isShowMeOnly('why are there errors for pod api')).toBe(false);
    expect(isShowMeOnly('how do we improve alerts')).toBe(false);
    expect(isShowMeOnly('show failing pods')).toBe(false);
    expect(isShowMeOnly('show logs for pod api')).toBe(false);
    expect(isShowMeOnly('list namespaces')).toBe(false);
  });

});

describe('exploreUrl / dashboardUrl', () => {
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
});
