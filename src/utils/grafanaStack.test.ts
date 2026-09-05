import { of } from 'rxjs';
import { getBackendSrv, getDataSourceSrv } from '@grafana/runtime';
import {
  buildLogQL,
  CLUSTER_LOGQL,
  DASHBOARD_UID_CAP,
  dashboardHintFromUids,
  dashboardUidsFromAlertFrames,
  fetchStackContext,
  getDataSourceByType,
  linesFromLokiFrames,
  LOG_LINE_CAP,
  parsePodNamespace,
} from './grafanaStack';
import { buildRequestText } from './progressiveContext';

jest.mock('@grafana/runtime', () => ({
  getDataSourceSrv: jest.fn(),
  getBackendSrv: jest.fn(),
}));

const mockGet = jest.fn();
const mockGetList = jest.fn();
const mockAmFetch = jest.fn();

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

/** Real Alertmanager v2 alert shape (GET /api/alertmanager/grafana/api/v2/alerts response). */
type AlertmanagerAlertFixture = {
  status: { state: string };
  labels: Record<string, string>;
  annotations: Record<string, string>;
};

function alertmanagerAlert(
  labels: Record<string, string>,
  annotations: Record<string, string> = {}
): AlertmanagerAlertFixture {
  return { status: { state: 'active' }, labels, annotations };
}

beforeEach(() => {
  mockGet.mockReset();
  mockGetList.mockReset();
  mockAmFetch.mockReset();
  mockAmFetch.mockReturnValue(of({ data: [] }));
  (getDataSourceSrv as jest.Mock).mockReturnValue({
    get: mockGet,
    getList: mockGetList,
  });
  (getBackendSrv as jest.Mock).mockReturnValue({
    fetch: mockAmFetch,
  });
  mockGetList.mockImplementation((opts?: { type?: string }) => {
    const all = [
      { uid: 'loki-1', name: 'Loki', type: 'loki' },
      { uid: 'prom-1', name: 'Prometheus', type: 'prometheus' },
      { uid: 'tempo-1', name: 'Tempo', type: 'tempo' },
      { uid: 'am-1', name: 'Alertmanager', type: 'alertmanager' },
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

describe('fetchStackContext', () => {
  test('Current includes Loki/Prometheus/Tempo via ds.query and Alertmanager via the unified-alerting API', async () => {
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
      return { query: () => of({ data: [] }) };
    });
    // ds.query() on the built-in `alertmanager` datasource is a stub that always resolves
    // `{ data: [] }` on real Grafana (verified against 13.1.0) — the real mechanism is
    // GET /api/alertmanager/grafana/api/v2/alerts via getBackendSrv().fetch().
    mockAmFetch.mockReturnValue(
      of({
        data: [
          alertmanagerAlert(
            { alertname: 'KubePodCrashLooping', pod: 'checkout-api', namespace: 'prod' },
            { summary: 'back-off restarting failed container' }
          ),
        ],
      })
    );

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
    expect(result.current).toContain('back-off restarting failed container');
    expect(result.mapHint).toMatch(/Loki/);
    expect(result.mapHint).toMatch(/Prometheus/);
    expect(result.mapHint).toMatch(/Tempo/);
    expect(result.mapHint).toMatch(/Alertmanager/);
    expect(mockAmFetch).toHaveBeenCalledWith(
      expect.objectContaining({ url: '/api/alertmanager/grafana/api/v2/alerts', method: 'GET' })
    );
    expect(JSON.stringify(mockGet.mock.calls)).not.toMatch(/P8E80F9AEF21F6940/);
    expect(JSON.stringify(mockGet.mock.calls)).not.toMatch(/datasources\/proxy/);
    // Narrowed invariant: dashboard/folder discovery never goes through the deprecated
    // Search API — Alertmanager evidence itself legitimately calls unified-alerting HTTP.
    expect(JSON.stringify(mockGet.mock.calls)).not.toMatch(/api\/search/);
    expect(JSON.stringify(mockAmFetch.mock.calls)).not.toMatch(/api\/search/);
  });

  test('Alertmanager evidence is scoped to the target pod/namespace and excludes non-matching alerts', async () => {
    mockGet.mockImplementation(async () => ({ query: () => of({ data: [] }) }));
    mockAmFetch.mockReturnValue(
      of({
        data: [
          alertmanagerAlert({ alertname: 'KubePodCrashLooping', pod: 'checkout-api', namespace: 'prod' }),
          alertmanagerAlert({ alertname: 'HighMemory', pod: 'billing-api', namespace: 'prod' }),
          alertmanagerAlert({ alertname: 'DiskFull', pod: 'checkout-api', namespace: 'staging' }),
        ],
      })
    );

    const result = await fetchStackContext('why is pod checkout-api crashing in namespace prod?');

    expect(result.alertLines).toEqual(['KubePodCrashLooping: firing']);
    expect(result.current).not.toContain('HighMemory');
    expect(result.current).not.toContain('DiskFull');
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

  // Dashboards are alert-derived, so the block has three cases and only two are worth
  // budget. Current (700) and Map (400) are fixed, so every char spent here is a char of
  // real evidence the packer sheds. Measured with the 30x77-char dump below and no firing
  // alerts: Current 2523 chars packing to 957 and keeping 8 Loki lines, against 2588
  // chars packing to 943 and keeping 7 when the "(none linked on firing alerts)"
  // placeholder is emitted anyway. The placeholder cost the operator log line 07.
  const lokiDump = Array.from(
    { length: 30 },
    (_, i) => `k8s error line ${String(i).padStart(2, '0')} ${'x'.repeat(60)}`
  );

  function mockStack(alerts: AlertmanagerAlertFixture[]) {
    mockGet.mockImplementation(async (ref: string) => {
      if (ref === 'loki-1' || ref === 'Loki') {
        return { query: () => of({ data: [frameWithLineField(lokiDump)] }) };
      }
      if (ref === 'prom-1' || ref === 'Prometheus') {
        return {
          query: () => of({ data: [frameWithValue({ pod: 'checkout-api', namespace: 'prod' }, 12)] }),
        };
      }
      return { query: () => of({ data: [] }) };
    });
    // ds.query() on the built-in `alertmanager` datasource is a stub that always resolves
    // `{ data: [] }` on real Grafana — Alertmanager evidence goes through mockAmFetch,
    // the real mechanism, same as the fetchStackContext describe block above.
    mockAmFetch.mockReturnValue(of({ data: alerts }));
  }

  test('no firing alerts: no Dashboards block', async () => {
    mockStack([]);

    const result = await fetchStackContext('top issues in the cluster');

    expect(result.alertLines).toEqual([]);
    expect(result.current).not.toContain('Dashboards');
    expect(result.mapHint).not.toContain('dashboards');
    expect(result.mapHint).not.toMatch(/,\s*$/);
  });

  test('alerts firing with no dashboard link: the explicit negative is still emitted', async () => {
    mockStack([alertmanagerAlert({ alertname: 'KubePodCrashLooping' })]);

    const result = await fetchStackContext('top issues in the cluster');

    expect(result.current).toContain('KubePodCrashLooping');
    expect(result.current).toContain('Dashboards (from firing alerts):');
    expect(result.current).toContain('(none linked on firing alerts)');
    expect(result.mapHint).toContain('dashboards: none linked on firing alerts');
  });

  test('alerts firing with dashboard links: the links are named in Current and Map', async () => {
    mockStack([alertmanagerAlert({ alertname: 'KubePodCrashLooping' }, { dashboardUID: 'abc12def' })]);

    const result = await fetchStackContext('top issues in the cluster');

    expect(result.current).toContain('Dashboards (from firing alerts):');
    expect(result.current).toContain('/d/abc12def');
    expect(result.current).not.toContain('none linked');
    expect(result.mapHint).toContain('dashboards: /d/abc12def');
  });

  test('never calls GET /api/search to resolve dashboard links from firing alerts', async () => {
    mockStack([alertmanagerAlert({ alertname: 'KubePodCrashLooping' }, { dashboardUID: 'abc12def' })]);

    const result = await fetchStackContext('top issues in the cluster');

    expect(result.current).toContain('/d/abc12def');
    // Narrowed invariant: dashboard-link resolution reads the alerts already fetched
    // for evidence — it never issues a second, separate Search API call.
    expect(JSON.stringify(mockAmFetch.mock.calls)).not.toMatch(/api\/search/);
    expect(JSON.stringify(mockGet.mock.calls)).not.toMatch(/api\/search/);
  });

  test('hundreds of firing-alert dashboard uids stay bounded and real evidence survives the pack', async () => {
    // 200 distinct valid uids — an alert-per-dashboard cluster far past the 5-link
    // cap buildDrilldownLinks already enforces, and past DASHBOARD_UID_CAP.
    const manyUids = Array.from({ length: 200 }, (_, i) => `dash-uid-${String(i).padStart(3, '0')}`);
    mockStack([
      { name: 'alertname', type: 'string', values: manyUids.map((_, i) => `Alert${i}`) },
      { name: 'dashboardUid', type: 'string', values: manyUids },
    ]);

    const result = await fetchStackContext('top issues in the cluster');

    // Bounded at the source: no matter how many distinct dashboard uids the firing
    // alerts carry, the Dashboards block in both Current and Map never grows past
    // DASHBOARD_UID_CAP.
    expect(result.current.match(/\/d\//g) ?? []).toHaveLength(DASHBOARD_UID_CAP);
    expect(result.mapHint.match(/\/d\//g) ?? []).toHaveLength(DASHBOARD_UID_CAP);

    // With the cap in place, real Loki evidence survives the actual packer. TRIM_ORDER
    // never peels the Dashboards block, so an uncapped list of 200 "/d/dash-uid-NNN"
    // lines (~2.6KB) would alone blow the 700-char Current budget and force every real
    // Loki/Prometheus/Alertmanager line to be shed before the packer ever touched a
    // dashboard link.
    const packed = buildRequestText({
      tool: 'query',
      current: result.current,
      map: result.mapHint,
      box: 'top issues in the cluster',
    });
    expect(packed).toContain('k8s error line');
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

describe('dashboardUidsFromAlertFrames', () => {
  test('reads dashboardUid field and labels; ignores junk', () => {
    const uids = dashboardUidsFromAlertFrames([
      {
        fields: [
          { name: 'alertname', type: 'string', values: ['KubePodCrashLooping'] },
          { name: 'dashboardUid', type: 'string', values: ['abc12def'] },
        ],
      } as never,
      {
        fields: [
          {
            name: 'alertname',
            type: 'string',
            values: ['Other'],
            labels: { __dashboardUid__: 'panel-uid-1' },
          },
        ],
      } as never,
      {
        fields: [{ name: 'dashboardUid', type: 'string', values: ['no'] }],
      } as never,
    ]);
    expect(uids).toEqual(['abc12def', 'panel-uid-1']);
    expect(dashboardHintFromUids([])).toBe('');
    expect(dashboardHintFromUids(uids)).toContain('/d/abc12def');
  });

  test('rejects malicious/malformed strings — no javascript:/traversal survives the shape check', () => {
    const uids = dashboardUidsFromAlertFrames([
      {
        fields: [
          {
            name: 'dashboardUid',
            type: 'string',
            values: ['javascript:alert(1)', '../../etc/passwd', 'ok-uid-1'],
          },
        ],
      } as never,
    ]);
    expect(uids).toEqual(['ok-uid-1']);
  });

  test('caps extraction at DASHBOARD_UID_CAP even when hundreds of distinct uids are present', () => {
    const many = Array.from({ length: 200 }, (_, i) => `dash-uid-${String(i).padStart(3, '0')}`);
    const uids = dashboardUidsFromAlertFrames([
      { fields: [{ name: 'dashboardUid', type: 'string', values: many }] } as never,
    ]);
    expect(uids).toHaveLength(DASHBOARD_UID_CAP);
    expect(uids).toEqual(many.slice(0, DASHBOARD_UID_CAP));
  });
});
