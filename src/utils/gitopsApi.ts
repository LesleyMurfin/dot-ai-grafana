import { lastValueFrom, Observable } from 'rxjs';
import { getBackendSrv } from '@grafana/runtime';
import pluginJson from '../plugin.json';

type FetchResponseLike = {
  data?: unknown;
  status?: number;
};

export type GitOpsStatus = {
  ready: boolean;
  reason: string;
  provider?: string;
  owner?: string;
  repo?: string;
  baseBranch?: string;
};

export type GitOpsProposalFile = {
  path: string;
  action: string;
  diff: string;
};

export type GitOpsProposal = {
  ok: boolean;
  dry: boolean;
  created: boolean;
  reason?: string;
  error?: string;
  title?: string;
  body?: string;
  provider?: string;
  owner?: string;
  repo?: string;
  baseBranch?: string;
  files?: GitOpsProposalFile[];
};

const CLOSED: GitOpsStatus = { ready: false, reason: 'status_unavailable' };

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function payloadOf(body: FetchResponseLike | undefined): unknown {
  return body && typeof body === 'object' && 'data' in body ? body.data : body;
}

export function gitopsReasonCopy(reason: string): string {
  switch (reason) {
    case 'not_configured':
      return 'GitOps PR execute is off until owner, repo, and PR-create token are set.';
    case 'missing_owner':
      return 'GitOps PR execute is off: missing owner.';
    case 'missing_repo':
      return 'GitOps PR execute is off: missing repo.';
    case 'missing_token':
      return 'GitOps PR execute is off: missing PR-create token.';
    case 'token_mixup':
      return 'PR-create token must not be the analysis token. Execute stays off.';
    case 'unsupported_provider':
      return 'GitHub only in this version.';
    case 'status_unavailable':
      return 'GitOps PR execute is off: status unavailable.';
    case 'ready':
      return '';
    default:
      return 'GitOps PR execute is off.';
  }
}

export function parseGitOpsStatus(value: unknown): GitOpsStatus {
  const rec = asRecord(value);
  if (!rec || typeof rec.ready !== 'boolean' || typeof rec.reason !== 'string') {
    return { ...CLOSED };
  }
  return {
    ready: rec.ready,
    reason: rec.reason,
    provider: typeof rec.provider === 'string' ? rec.provider : undefined,
    owner: typeof rec.owner === 'string' ? rec.owner : undefined,
    repo: typeof rec.repo === 'string' ? rec.repo : undefined,
    baseBranch: typeof rec.baseBranch === 'string' ? rec.baseBranch : undefined,
  };
}

function parseFiles(value: unknown): GitOpsProposalFile[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const files: GitOpsProposalFile[] = [];
  for (const item of value) {
    const rec = asRecord(item);
    if (!rec || typeof rec.path !== 'string' || typeof rec.diff !== 'string') {
      continue;
    }
    files.push({
      path: rec.path,
      action: typeof rec.action === 'string' ? rec.action : 'preview',
      diff: rec.diff,
    });
  }
  return files;
}

export function parseGitOpsProposal(value: unknown): GitOpsProposal {
  const rec = asRecord(value);
  if (!rec) {
    return { ok: false, dry: true, created: false, error: 'Invalid proposal response' };
  }
  return {
    ok: rec.ok === true,
    dry: rec.dry === true,
    created: rec.created === true,
    reason: typeof rec.reason === 'string' ? rec.reason : undefined,
    error: typeof rec.error === 'string' ? rec.error : undefined,
    title: typeof rec.title === 'string' ? rec.title : undefined,
    body: typeof rec.body === 'string' ? rec.body : undefined,
    provider: typeof rec.provider === 'string' ? rec.provider : undefined,
    owner: typeof rec.owner === 'string' ? rec.owner : undefined,
    repo: typeof rec.repo === 'string' ? rec.repo : undefined,
    baseBranch: typeof rec.baseBranch === 'string' ? rec.baseBranch : undefined,
    files: parseFiles(rec.files),
  };
}

async function fetchPluginResource(path: string, method: 'GET' | 'POST', data?: Record<string, unknown>) {
  const response = getBackendSrv().fetch({
    url: `/api/plugins/${pluginJson.id}/resources/${path}`,
    method,
    ...(data ? { data } : {}),
    showErrorAlert: false,
    showSuccessAlert: false,
  });
  return lastValueFrom(response as unknown as Observable<FetchResponseLike>);
}

function errorPayload(e: unknown): unknown {
  if (e && typeof e === 'object' && 'data' in e) {
    return (e as { data: unknown }).data;
  }
  return undefined;
}

/** GET /gitops-status. Fail closed when the body is missing or malformed. */
export async function fetchGitOpsStatus(): Promise<GitOpsStatus> {
  try {
    const body = await fetchPluginResource('gitops-status', 'GET');
    return parseGitOpsStatus(payloadOf(body));
  } catch (e) {
    const parsed = parseGitOpsStatus(errorPayload(e));
    if (parsed.reason !== 'status_unavailable') {
      return parsed;
    }
    return { ...CLOSED };
  }
}

/**
 * POST /gitops-propose — dry title/body/diff only.
 * Never sends apply/execute or a caller-chosen owner/repo (M3 creates the PR).
 */
export async function proposeGitOpsPR(analysis: string): Promise<GitOpsProposal> {
  try {
    const body = await fetchPluginResource('gitops-propose', 'POST', { analysis });
    return parseGitOpsProposal(payloadOf(body));
  } catch (e) {
    const fromBody = parseGitOpsProposal(errorPayload(e));
    if (fromBody.error || fromBody.reason) {
      return { ...fromBody, dry: true, created: false };
    }
    const message = e instanceof Error ? e.message : 'Propose failed';
    return { ok: false, dry: true, created: false, error: message };
  }
}
