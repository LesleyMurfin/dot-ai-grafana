import { of, throwError } from 'rxjs';
import { getBackendSrv } from '@grafana/runtime';
import { callDotAITool } from './dotaiApi';

jest.mock('@grafana/runtime', () => ({
  getBackendSrv: jest.fn(),
}));

const mockFetch = jest.fn();

beforeEach(() => {
  mockFetch.mockReset();
  (getBackendSrv as jest.Mock).mockReturnValue({ fetch: mockFetch });
});

describe('callDotAITool', () => {
  test('always POSTs { intent } for query and remediate', async () => {
    mockFetch.mockReturnValue(
      of({
        status: 200,
        data: { ok: true, status: 200, summary: 'fine', error: '' },
      })
    );

    await callDotAITool('query', 'list pods');
    expect(mockFetch).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'POST',
        url: '/api/plugins/lesleymurfin-dotai-app/resources/query',
        data: { intent: 'list pods' },
      })
    );

    mockFetch.mockClear();
    mockFetch.mockReturnValue(
      of({
        status: 200,
        data: { ok: true, status: 200, summary: 'guidance', error: '' },
      })
    );

    await callDotAITool('remediate', 'CrashLoopBackOff on api');
    expect(mockFetch).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'POST',
        url: '/api/plugins/lesleymurfin-dotai-app/resources/remediate',
        data: { intent: 'CrashLoopBackOff on api' },
      })
    );
  });

  test('maps 200 contract success body to ToolCallResult', async () => {
    mockFetch.mockReturnValue(
      of({
        status: 200,
        data: { ok: true, status: 200, summary: 'cluster healthy', error: '' },
      })
    );

    const result = await callDotAITool('query', 'health');
    expect(result).toEqual({
      ok: true,
      status: 200,
      summary: 'cluster healthy',
      raw: { ok: true, status: 200, summary: 'cluster healthy', error: '' },
      errorMessage: undefined,
    });
  });

  test('maps contract error body (ok false) without envelope probing', async () => {
    mockFetch.mockReturnValue(
      of({
        status: 200,
        data: { ok: false, status: 400, summary: '', error: 'issue is required' },
      })
    );

    const result = await callDotAITool('remediate', '');
    expect(result.ok).toBe(false);
    expect(result.status).toBe(400);
    expect(result.errorMessage).toBe('issue is required');
    expect(result.summary).toBe('');
  });

  test('fetch reject/throw becomes ToolCallResult error (finding 5)', async () => {
    mockFetch.mockReturnValue(throwError(() => new Error('network down')));

    const result = await callDotAITool('query', 'anything');
    expect(result.ok).toBe(false);
    expect(result.status).toBe(0);
    expect(result.summary).toBe('');
    expect(result.errorMessage).toBe('network down');
  });

  test('fetch reject with status/data surfaces message', async () => {
    mockFetch.mockReturnValue(
      throwError(() => ({
        status: 502,
        message: 'Bad Gateway',
        data: { detail: 'upstream' },
      }))
    );

    const result = await callDotAITool('query', 'x');
    expect(result.ok).toBe(false);
    expect(result.status).toBe(502);
    expect(result.errorMessage).toBe('Bad Gateway');
    expect(result.raw).toEqual({ detail: 'upstream' });
  });
});
