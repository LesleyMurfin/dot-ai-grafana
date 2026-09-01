import { lastValueFrom, Observable } from 'rxjs';
import { getBackendSrv } from '@grafana/runtime';
import pluginJson from '../plugin.json';

export type DotAITool = 'query' | 'remediate';

/**
 * Which follow-up decision produced a POST. Declared here rather than in askOrchestrator
 * because that module imports this one; a second literal union would drift.
 */
export type AskBranch = 'initial' | 'across' | 'conflict' | 'hedge' | 'refine';

const ASK_BRANCHES: readonly AskBranch[] = ['initial', 'across', 'conflict', 'hedge', 'refine'];

/** Optional Ask orchestration fields logged by the backend (stripped before upstream). */
export type AskCallMeta = {
  hop?: number;
  hops?: number;
  current_empty?: boolean;
  first_hop?: 'grafana' | 'dot-ai';
  branch?: AskBranch;
};

/** Normalized result for UI consumers (maps backend `error` → errorMessage). */
export type ToolCallResult = {
  ok: boolean;
  status: number;
  summary: string;
  raw: unknown;
  errorMessage?: string;
};

/** Backend resource JSON contract (pkg/plugin resources). */
type ResourceContract = {
  ok: boolean;
  status: number;
  summary: string;
  error: string;
};

type FetchResponseLike = {
  data?: unknown;
  status?: number;
};

function asContract(value: unknown): ResourceContract | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  const rec = value as Record<string, unknown>;
  if (typeof rec.ok !== 'boolean' || typeof rec.status !== 'number') {
    return undefined;
  }
  return {
    ok: rec.ok,
    status: rec.status,
    summary: typeof rec.summary === 'string' ? rec.summary : '',
    error: typeof rec.error === 'string' ? rec.error : '',
  };
}

/** Single cast boundary for Grafana dual-package rxjs types. */
async function fetchResource(
  tool: DotAITool,
  text: string,
  meta?: AskCallMeta
): Promise<FetchResponseLike> {
  // Query uses {intent}; remediate requires upstream {issue}. Send both on remediate
  // so the Go proxy and tools REST stay aligned (analysis-only; no execute flags).
  // Meta fields are for ask-log only; backend strips them before upstream.
  const data: Record<string, unknown> =
    tool === 'remediate' ? { issue: text, intent: text } : { intent: text };
  if (meta) {
    if (typeof meta.hop === 'number') {
      data.hop = meta.hop;
    }
    if (typeof meta.hops === 'number') {
      data.hops = meta.hops;
    }
    if (typeof meta.current_empty === 'boolean') {
      data.current_empty = meta.current_empty;
    }
    if (meta.first_hop === 'grafana' || meta.first_hop === 'dot-ai') {
      data.first_hop = meta.first_hop;
    }
    if (meta.branch && ASK_BRANCHES.includes(meta.branch)) {
      data.branch = meta.branch;
    }
  }
  const response = await getBackendSrv().fetch({
    url: `/api/plugins/${pluginJson.id}/resources/${tool}`,
    method: 'POST',
    data,
    showErrorAlert: false,
    showSuccessAlert: false,
  });
  return lastValueFrom(response as unknown as Observable<FetchResponseLike>);
}

export async function callDotAITool(
  tool: DotAITool,
  intent: string,
  meta?: AskCallMeta
): Promise<ToolCallResult> {
  try {
    const body = await fetchResource(tool, intent, meta);
    // Grafana FetchResponse wraps JSON in `.data`; tolerate bare contract too.
    const payload = body && typeof body === 'object' && 'data' in body ? body.data : body;
    const contract = asContract(payload);
    if (contract) {
      return {
        ok: contract.ok,
        status: contract.status,
        summary: contract.summary,
        raw: payload,
        errorMessage: contract.ok ? undefined : contract.error || `Request failed (HTTP ${contract.status})`,
      };
    }
    const status = typeof body?.status === 'number' ? body.status : 0;
    return {
      ok: false,
      status,
      summary: '',
      raw: payload,
      errorMessage: 'Invalid resource response',
    };
  } catch (e) {
    const errObj = e && typeof e === 'object' ? (e as Record<string, unknown>) : undefined;
    const errData = errObj && 'data' in errObj ? errObj.data : undefined;
    const contract = asContract(errData);
    if (contract) {
      return {
        ok: contract.ok,
        status: contract.status,
        summary: contract.summary,
        raw: errData,
        errorMessage: contract.ok ? undefined : contract.error || `Request failed (HTTP ${contract.status})`,
      };
    }
    const status = errObj && typeof errObj.status === 'number' ? errObj.status : 0;
    const message =
      e instanceof Error
        ? e.message
        : errObj && typeof errObj.message === 'string'
          ? errObj.message
          : 'Request failed';
    return {
      ok: false,
      status,
      summary: '',
      raw: errData ?? e,
      errorMessage: message,
    };
  }
}
