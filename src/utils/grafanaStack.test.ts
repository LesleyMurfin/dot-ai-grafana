import { of } from 'rxjs';
import { getDataSourceSrv } from '@grafana/runtime';
import {
  buildLogQL,
  fetchStackContext,
  getDataSourceByType,
  linesFromLokiFrames,
  LOG_LINE_CAP,
  parsePodNamespace,
} from './grafanaStack';

jest.mock('@grafana/runtime', () => ({
  getDataSourceSrv: jest.fn(),
}));

const mockGet = jest.fn();
const mockGetList = jest.fn();

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

beforeEach(() => {
  mockGet.mockReset();
  mockGetList.mockReset();
  (getDataSourceSrv as jest.Mock).mockReturnValue({
    get: mockGet,
    getList: mockGetList,
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
});

describe('linesFromLokiFrames', () => {
  test('caps extracted lines', () => {
    const many = Array.from({ length: 40 }, (_, i) => `log-line-${i}`);
    expect(linesFromLokiFrames([frameWithLineField(many) as never])).toHaveLength(LOG_LINE_CAP);
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
        return {
          query: () =>
            of({
              data: [{ fields: [{ name: 'alertname', type: 'string', values: ['KubePodCrashLooping'] }] }],
            }),
        };
      }
      return { query: () => of({ data: [] }) };
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
