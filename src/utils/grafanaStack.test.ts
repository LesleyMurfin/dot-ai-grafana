import { of } from 'rxjs';
import { getBackendSrv, getDataSourceSrv } from '@grafana/runtime';
import {
  buildLogQL,
  CLUSTER_LOGQL,
  fetchStackContext,
  getDataSourceByType,
  linesFromAlertmanagerAlerts,
  linesFromLokiFrames,
  LOG_LINE_CAP,
  parsePodNamespace,
} from './grafanaStack';

jest.mock('@grafana/runtime', () => ({
  getDataSourceSrv: jest.fn(),
  getBackendSrv: jest.fn(),
}));

const mockGet = jest.fn();
const mockGetList = jest.fn();
const mockBackendGet = jest.fn();
const AM_URL = '/api/datasources/proxy/uid/am-1';

function frameWithLineField(lines: string[]) {
  return {
    fields: [{ name: 'Line', type: 'string', values: lines }],
  };
}

function frameWithValue(labels: Record<string, string>, value: number) {
  return {
    name: labels.pod || 'series',
    fields: [{ name: 'Value', type: 'number', values: [value], labels }],
  };
}

function alertmanagerAlert(overrides?: {
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
  startsAt?: string;
  state?: string;
}) {
  return {
    labels: { alertname: 'KubePodCrashLooping', severity: 'critical', ...overrides?.labels },
    annotations: { summary: 'pod is crash looping', ...overrides?.annotations },
    startsAt: overrides?.startsAt ?? '2026-09-05T00:00:00.000Z',
    status: { state: overrides?.state ?? 'active' },
  };
}

beforeEach(() => {
  mockGet.mockReset();
  mockGetList.mockReset();
  mockBackendGet.mockReset();
  mockBackendGet.mockResolvedValue([]);
  (getDataSourceSrv as jest.Mock).mockReturnValue({
    get: mockGet,
    getList: mockGetList,
  });
  (getBackendSrv as jest.Mock).mockReturnValue({
    get: mockBackendGet,
  });
  mockGetList.mockImplementation((opts?: { type?: string }) => {
    const all = [
      { uid: 'loki-1', name: 'Loki', type: 'loki' },
      { uid: 'prom-1', name: 'Prometheus', type: 'prometheus' },
      { uid: 'tempo-1', name: 'Tempo', type: 'tempo' },
      { uid: 'am-1', name: 'Alertmanager', type: 'alertmanager', url: AM_URL },
    ];
    if (opts?.type) {
      return all.filter((s) => s.type === opts.type);
    }
    return all;
  });
});

describe('parsePodNamespace / buildLogQL', () => {
  test('parses pod and namespace', () => {
    expect(parsePodNamespace('logs for pod checkout-api in namespace prod')).toEqual({
      pod: 'checkout-api',
      namespace: 'prod',
    });
    expect(buildLogQL({ pod: 'checkout-api', namespace: 'prod' })).toBe(
      '{namespace="prod",pod=~"checkout-api.*"}'
    );
  });

  test('show logs for pod checkout-api in namespace prod still works', () => {
    expect(parsePodNamespace('show logs for pod checkout-api in namespace prod')).toEqual({
      pod: 'checkout-api',
      namespace: 'prod',
    });
  });

  test('does not invent pods from which/what questions', () => {
    expect(parsePodNamespace('which pods are not ready')).toEqual({});
    expect(parsePodNamespace('what pods exist')).toEqual({});
  });

  test('rejects stopword and non-RFC1123 captures', () => {
    expect(parsePodNamespace('pod are in namespace prod').pod).toBeUndefined();
    expect(parsePodNamespace('pod _bad in namespace prod').pod).toBeUndefined();
    expect(
      parsePodNamespace('show me the logs for the top issue we need to address in our environment')
    ).toEqual({});
  });

  test('English stopwords and in-fallback do not become pod names', () => {
    expect(parsePodNamespace('show failing pods in production')).toEqual({});
    expect(parsePodNamespace('top issues in the cluster')).toEqual({});
    expect(parsePodNamespace('which pods are crashlooping in staging')).toEqual({});
    expect(parsePodNamespace('why is checkout-api CrashLooping in prod?')).toEqual({
      pod: 'checkout-api',
    });
    expect(parsePodNamespace('show logs for pod checkout-api in namespace production')).toEqual({
      pod: 'checkout-api',
      namespace: 'production',
    });
  });

  test('generated LogQL never uses invented pod/ns labels', () => {
    expect(buildLogQL(parsePodNamespace('show failing pods in production'))).toBe(CLUSTER_LOGQL);
    expect(buildLogQL(parsePodNamespace('top issues in the cluster'))).toBe(CLUSTER_LOGQL);
    expect(buildLogQL(parsePodNamespace('which pods are crashlooping in staging'))).toBe(CLUSTER_LOGQL);

    const crashLogQL = buildLogQL(parsePodNamespace('why is checkout-api CrashLooping in prod?'));
    expect(crashLogQL).toBe('{pod=~"checkout-api.*"}');
    expect(crashLogQL).not.toMatch(/CrashLooping/i);
    expect(crashLogQL).not.toMatch(/namespace="prod"/);

    expect(buildLogQL(parsePodNamespace('show logs for pod checkout-api in namespace production'))).toBe(
      '{namespace="production",pod=~"checkout-api.*"}'
    );

    const invented = /pod=~"(in|issues|are|CrashLooping)\.\*"/;
    for (const q of [
      'show failing pods in production',
      'top issues in the cluster',
      'which pods are crashlooping in staging',
      'why is checkout-api CrashLooping in prod?',
      'show logs for pod checkout-api in namespace production',
    ]) {
      expect(buildLogQL(parsePodNamespace(q))).not.toMatch(invented);
      expect(buildLogQL(parsePodNamespace(q))).not.toMatch(/namespace="the"/);
    }
  });

});

describe('linesFromLokiFrames', () => {
  test('caps extracted lines', () => {
    const many = Array.from({ length: 40 }, (_, i) => `log-line-${i}`);
    expect(linesFromLokiFrames([frameWithLineField(many) as never])).toHaveLength(LOG_LINE_CAP);
  });
});

describe('linesFromAlertmanagerAlerts', () => {
  test('formats alertname/severity/state/since/summary and caps at the given limit', () => {
    const many = Array.from({ length: 20 }, (_, i) => alertmanagerAlert({ labels: { alertname: `alert-${i}` } }));
    const capped = linesFromAlertmanagerAlerts(many, 8);
    expect(capped).toHaveLength(8);
    expect(capped[0]).toBe(
      'alert-0 severity=critical state=active since=2026-09-05T00:00:00.000Z summary=pod is crash looping'
    );
  });

  test('ignores non-array input', () => {
    expect(linesFromAlertmanagerAlerts(null, 8)).toEqual([]);
    expect(linesFromAlertmanagerAlerts(undefined, 8)).toEqual([]);
    expect(linesFromAlertmanagerAlerts({ not: 'an array' }, 8)).toEqual([]);
  });
});

describe('fetchStackContext', () => {
  test('Current includes mocked Loki log lines via ds.query', async () => {
    const lokiLines = ['OOMKilled container', 'Back-off restarting failed container'];
    mockGet.mockImplementation(async (ref: string) => {
      if (ref === 'loki-1' || ref === 'Loki') {
        return {
          query: () => of({ data: [frameWithLineField(lokiLines)] }),
        };
      }
      if (ref === 'prom-1' || ref === 'Prometheus') {
        return {
          query: () =>
            of({
              data: [frameWithValue({ pod: 'checkout-api', namespace: 'prod' }, 12)],
            }),
        };
      }
      if (ref === 'tempo-1' || ref === 'Tempo') {
        return {
          query: () =>
            of({
              data: [{ fields: [{ name: 'traceID', type: 'string', values: ['abc123'] }] }],
            }),
        };
      }
      if (ref === 'am-1' || ref === 'Alertmanager') {
        // Real AlertManagerDatasource.query() is a stub that always returns
        // { data: [] } — alerts come from mockBackendGet (getBackendSrv().get()) below,
        // not from ds.query(). See fetchAlertmanagerAlerts() in grafanaStack.ts.
        return { query: () => of({ data: [] }) };
      }
      return { query: () => of({ data: [] }) };
    });
    mockBackendGet.mockImplementation(async (url: string) => {
      if (url.startsWith(`${AM_URL}/api/v2/alerts`)) {
        return [alertmanagerAlert()];
      }
      return [];
    });

    const result = await fetchStackContext('why is pod checkout-api crashing in namespace prod?');

    expect(mockGetList).toHaveBeenCalled();
    expect(result.logLines).toEqual(lokiLines);
    expect(result.current).toContain('Loki last 15m');
    expect(result.current).toContain('OOMKilled container');
    expect(result.current).toContain('Prometheus last 15m');
    expect(result.current).toContain('restarts=12');
    expect(result.current).toContain('Tempo last 15m');
    expect(result.current).toContain('trace abc123');
    expect(result.current).toContain('Alertmanager');
    expect(result.current).toContain('KubePodCrashLooping');
    expect(result.current).toContain('severity=critical');
    expect(mockBackendGet).toHaveBeenCalledWith(expect.stringContaining(`${AM_URL}/api/v2/alerts`));
    expect(result.mapHint).toMatch(/Loki/);
    expect(result.mapHint).toMatch(/Prometheus/);
    expect(result.mapHint).toMatch(/Tempo/);
    expect(result.mapHint).toMatch(/Alertmanager/);
    expect(JSON.stringify(mockGet.mock.calls)).not.toMatch(/P8E80F9AEF21F6940/);
    expect(JSON.stringify(mockGet.mock.calls)).not.toMatch(/datasources\/proxy/);
  });

  test('one-line note when Loki datasource missing', async () => {
    mockGetList.mockImplementation((opts?: { type?: string }) => {
      if (opts?.type === 'loki') {
        return [];
      }
      if (opts?.type === 'prometheus') {
        return [{ uid: 'prom-1', name: 'Prometheus', type: 'prometheus' }];
      }
      return [];
    });
    mockGet.mockImplementation(async (ref: string) => {
      if (ref === 'prom-1') {
        return { query: () => of({ data: [] }) };
      }
      throw new Error('not found');
    });

    const result = await fetchStackContext('pod api in namespace default');
    expect(result.current).toMatch(/Loki datasource missing/);
  });

  test('no pod/ns still calls Loki and Prom with cluster-wide expr', async () => {
    const lokiQuery = jest.fn((_req: { targets: Array<{ expr: string }> }) =>
      of({ data: [frameWithLineField(['error something'])] })
    );
    const promQuery = jest.fn(() =>
      of({
        data: [frameWithValue({ pod: 'x', namespace: 'y' }, 2)],
      })
    );
    mockGet.mockImplementation(async (ref: string) => {
      if (ref === 'loki-1' || ref === 'Loki') {
        return { query: lokiQuery };
      }
      if (ref === 'prom-1' || ref === 'Prometheus') {
        return { query: promQuery };
      }
      return { query: () => of({ data: [] }) };
    });

    const result = await fetchStackContext('how healthy is the cluster?');
    expect(lokiQuery).toHaveBeenCalled();
    expect(promQuery).toHaveBeenCalled();
    expect(result.current).toContain('Loki last 15m');
    expect(result.current).toContain('error something');
    expect(result.currentEmpty).toBe(false);
    const lokiReq = lokiQuery.mock.calls[0][0];
    expect(lokiReq.targets[0].expr).toMatch(/namespace=~/);
  });

  // Issue #47: "all: true" alone is necessary but not sufficient — Grafana's built-in
  // AlertManagerDatasource.query() is a permanent stub returning { data: [] }, so alert
  // evidence must come from getBackendSrv().get() against the datasource's own proxy
  // route (GET .../api/v2/alerts), never from ds.query().
  test('fetches real alerts from the Alertmanager proxy route, not the ds.query() stub', async () => {
    mockGet.mockImplementation(async () => ({ query: () => of({ data: [] }) }));
    mockBackendGet.mockImplementation(async (url: string) => {
      if (url === `${AM_URL}/api/v2/alerts`) {
        return [
          alertmanagerAlert({ labels: { alertname: 'KubeDeploymentReplicasMismatch', severity: 'warning' } }),
        ];
      }
      return [];
    });

    const result = await fetchStackContext('how healthy is the cluster?');

    expect(mockBackendGet).toHaveBeenCalledWith(`${AM_URL}/api/v2/alerts`);
    expect(result.alertLines).toHaveLength(1);
    expect(result.current).toContain('KubeDeploymentReplicasMismatch');
    expect(result.current).toContain('severity=warning');
    expect(result.current).toContain('state=active');
    expect(result.current).toContain('summary=pod is crash looping');
    expect(result.currentEmpty).toBe(false);
  });

  test('reports a failed Alertmanager proxy call distinctly from "no alerts", never silently empty', async () => {
    mockGet.mockImplementation(async () => ({ query: () => of({ data: [] }) }));
    mockBackendGet.mockImplementation(async (url: string) => {
      if (url === `${AM_URL}/api/v2/alerts`) {
        throw new Error('403 Forbidden');
      }
      return [];
    });

    const result = await fetchStackContext('how healthy is the cluster?');

    const amSection = result.current.split('Alertmanager:')[1] ?? '';
    expect(amSection).toMatch(/Alertmanager alerts unavailable/);
    expect(amSection).toMatch(/403 Forbidden/);
    expect(amSection).not.toMatch(/no alerts/);
    expect(result.alertLines).toEqual([]);
  });

  test('scopes the Alertmanager proxy query to the parsed pod/namespace like Loki/Prometheus', async () => {
    mockGet.mockImplementation(async () => ({ query: () => of({ data: [] }) }));
    mockBackendGet.mockResolvedValue([]);

    await fetchStackContext('why is pod checkout-api crashing in namespace prod?');

    expect(mockBackendGet).toHaveBeenCalledWith(
      `${AM_URL}/api/v2/alerts?filter=namespace%3D%22prod%22&filter=pod%3D~%22checkout-api.*%22`
    );
  });

  test('does not scope the Alertmanager proxy query when the question has no pod/namespace', async () => {
    mockGet.mockImplementation(async () => ({ query: () => of({ data: [] }) }));
    mockBackendGet.mockResolvedValue([]);

    await fetchStackContext('how healthy is the cluster?');

    expect(mockBackendGet).toHaveBeenCalledWith(`${AM_URL}/api/v2/alerts`);
  });
});

describe('getDataSourceByType selection', () => {
  test('prefers the default datasource over the first listed', async () => {
    mockGetList.mockImplementation(() => [
      { uid: 'loki-a', name: 'Extra Loki', type: 'loki' },
      { uid: 'loki-b', name: 'Team Loki', type: 'loki', isDefault: true },
    ]);
    mockGet.mockImplementation(async () => ({ query: () => of({ data: [] }) }));

    const picked = await getDataSourceByType('loki');
    expect(picked?.settings?.uid).toBe('loki-b');
    expect(mockGet).toHaveBeenCalledWith('loki-b');
  });

  test('falls back to the type-named datasource when none is default', async () => {
    mockGetList.mockImplementation(() => [
      { uid: 'loki-a', name: 'Extra Loki', type: 'loki' },
      { uid: 'loki-b', name: 'Loki', type: 'loki' },
    ]);
    mockGet.mockImplementation(async () => ({ query: () => of({ data: [] }) }));

    const picked = await getDataSourceByType('loki');
    expect(picked?.settings?.uid).toBe('loki-b');
  });

  test('falls back to the first configured when neither default nor named match', async () => {
    mockGetList.mockImplementation(() => [
      { uid: 'loki-a', name: 'Extra Loki', type: 'loki' },
      { uid: 'loki-b', name: 'Other Loki', type: 'loki' },
    ]);
    mockGet.mockImplementation(async () => ({ query: () => of({ data: [] }) }));

    const picked = await getDataSourceByType('loki');
    expect(picked?.settings?.uid).toBe('loki-a');
  });

  test('ignores datasources of another type', async () => {
    mockGetList.mockImplementation(() => [
      { uid: 'prom-1', name: 'Prometheus', type: 'prometheus', isDefault: true },
      { uid: 'loki-a', name: 'Extra Loki', type: 'loki' },
    ]);
    mockGet.mockImplementation(async () => ({ query: () => of({ data: [] }) }));

    const picked = await getDataSourceByType('loki');
    expect(picked?.settings?.uid).toBe('loki-a');
  });
});

describe('getDataSourceByType real getList filtering (issue #47)', () => {
  // Mirrors grafana/grafana public/app/features/plugins/datasource_srv.ts DatasourceSrv.getList:
  // without `all: true`, a datasource is excluded unless its plugin meta declares at least one of
  // metrics/annotations/tracing/logs/alerting. Grafana's built-in Alertmanager datasource plugin
  // (public/app/plugins/datasource/alertmanager/plugin.json) declares none of those — only
  // `"metrics": false` — so it is invisible to getList({ type: 'alertmanager' }) unless `all: true`
  // is passed.
  type FakeMeta = {
    metrics: boolean;
    logs: boolean;
    tracing: boolean;
    annotations: boolean;
    alerting: boolean;
  };
  type FakeEntry = { uid: string; name: string; type: string; meta: FakeMeta };

  function realisticGetList(opts?: { type?: string; all?: boolean }) {
    const noMeta: FakeMeta = { metrics: false, logs: false, tracing: false, annotations: false, alerting: false };
    const all: FakeEntry[] = [
      { uid: 'loki-1', name: 'Loki', type: 'loki', meta: { ...noMeta, logs: true, metrics: true } },
      { uid: 'prom-1', name: 'Prometheus', type: 'prometheus', meta: { ...noMeta, metrics: true, alerting: true } },
      { uid: 'tempo-1', name: 'Tempo', type: 'tempo', meta: { ...noMeta, tracing: true } },
      { uid: 'am-1', name: 'Alertmanager', type: 'alertmanager', meta: { ...noMeta, metrics: false } },
    ];
    return all.filter((s) => {
      if (opts?.type && s.type !== opts.type) {
        return false;
      }
      const queryable = s.meta.metrics || s.meta.logs || s.meta.tracing || s.meta.annotations || s.meta.alerting;
      return opts?.all || queryable;
    });
  }

  test('finds the built-in Alertmanager datasource under real getList capability filtering', async () => {
    mockGetList.mockImplementation(realisticGetList);
    mockGet.mockImplementation(async () => ({ query: () => of({ data: [] }) }));

    const picked = await getDataSourceByType('alertmanager');

    expect(picked?.settings?.uid).toBe('am-1');
  });
});
