import { of, throwError } from 'rxjs';
import { getBackendSrv } from '@grafana/runtime';
import {
  fetchGitOpsStatus,
  gitopsReasonCopy,
  parseGitOpsProposal,
  parseGitOpsStatus,
  proposeGitOpsPR,
} from './gitopsApi';

jest.mock('@grafana/runtime', () => ({
  getBackendSrv: jest.fn(),
}));

const mockFetch = jest.fn();

beforeEach(() => {
  mockFetch.mockReset();
  (getBackendSrv as jest.Mock).mockReturnValue({ fetch: mockFetch });
});

describe('gitopsReasonCopy', () => {
  test('maps M1 reason codes to the PRD failure-mode copy', () => {
    expect(gitopsReasonCopy('not_configured')).toMatch(/owner, repo, and PR-create token/i);
    expect(gitopsReasonCopy('missing_token')).toMatch(/missing PR-create token/i);
    expect(gitopsReasonCopy('missing_repo')).toMatch(/missing repo/i);
    expect(gitopsReasonCopy('missing_owner')).toMatch(/missing owner/i);
    expect(gitopsReasonCopy('token_mixup')).toMatch(/must not be the analysis token/i);
    expect(gitopsReasonCopy('unsupported_provider')).toMatch(/GitHub only/i);
    expect(gitopsReasonCopy('ready')).toBe('');
  });
});

describe('parseGitOpsStatus', () => {
  test('fail-closed on garbage', () => {
    expect(parseGitOpsStatus(null)).toEqual({ ready: false, reason: 'status_unavailable' });
    expect(parseGitOpsStatus({ ready: true })).toEqual({ ready: false, reason: 'status_unavailable' });
  });

  test('accepts the M1 status DTO', () => {
    expect(
      parseGitOpsStatus({
        ready: true,
        reason: 'ready',
        provider: 'github',
        owner: 'acme',
        repo: 'gitops-prod',
        baseBranch: 'main',
      })
    ).toEqual({
      ready: true,
      reason: 'ready',
      provider: 'github',
      owner: 'acme',
      repo: 'gitops-prod',
      baseBranch: 'main',
    });
  });
});

describe('fetchGitOpsStatus', () => {
  test('GETs /gitops-status and never POSTs', async () => {
    mockFetch.mockReturnValue(
      of({
        status: 200,
        data: { ready: false, reason: 'not_configured' },
      })
    );

    await expect(fetchGitOpsStatus()).resolves.toEqual({ ready: false, reason: 'not_configured' });
    expect(mockFetch).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'GET',
        url: '/api/plugins/devopstoolkit-dotai-app/resources/gitops-status',
      })
    );
    expect(mockFetch.mock.calls[0][0]).not.toHaveProperty('data');
  });

  test('transport failure is fail-closed', async () => {
    mockFetch.mockReturnValue(throwError(() => new Error('network down')));
    await expect(fetchGitOpsStatus()).resolves.toEqual({ ready: false, reason: 'status_unavailable' });
  });
});

describe('proposeGitOpsPR', () => {
  const dry = {
    ok: true,
    dry: true,
    created: false,
    reason: 'ready',
    title: 'fix: checkout-api CrashLoop',
    body: 'Preview only',
    owner: 'acme',
    repo: 'gitops-prod',
    files: [{ path: 'values.yaml', action: 'preview', diff: '+# preview' }],
  };

  test('POSTs analysis only — no apply/execute/owner/repo', async () => {
    mockFetch.mockReturnValue(of({ status: 200, data: dry }));

    const result = await proposeGitOpsPR('checkout-api CrashLoop');
    expect(result).toEqual(dry);
    expect(mockFetch).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'POST',
        url: '/api/plugins/devopstoolkit-dotai-app/resources/gitops-propose',
        data: { analysis: 'checkout-api CrashLoop' },
      })
    );
    const sent = mockFetch.mock.calls[0][0].data as Record<string, unknown>;
    expect(sent).not.toHaveProperty('apply');
    expect(sent).not.toHaveProperty('execute');
    expect(sent).not.toHaveProperty('owner');
    expect(sent).not.toHaveProperty('repo');
    expect(result.created).toBe(false);
    expect(result.dry).toBe(true);
  });

  test('409 not-ready envelope stays dry', async () => {
    mockFetch.mockReturnValue(
      throwError(() => ({
        status: 409,
        data: {
          ok: false,
          dry: true,
          created: false,
          reason: 'missing_token',
          error: 'GitOps PR execute is off: missing PR-create token.',
        },
      }))
    );

    const result = await proposeGitOpsPR('x');
    expect(result.ok).toBe(false);
    expect(result.created).toBe(false);
    expect(result.dry).toBe(true);
    expect(result.reason).toBe('missing_token');
    expect(result.error).toMatch(/missing PR-create token/i);
  });
});

describe('parseGitOpsProposal', () => {
  test('created true from a rogue body is preserved for the UI to reject', () => {
    const parsed = parseGitOpsProposal({ ok: true, dry: false, created: true, title: 'nope' });
    expect(parsed.created).toBe(true);
    expect(parsed.dry).toBe(false);
  });
});
