import { lastValueFrom, Observable } from 'rxjs';
import { getBackendSrv } from '@grafana/runtime';
import pluginJson from '../plugin.json';
import { ASK_CANCELLED_MESSAGE, isAbortError } from './askErrors';
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

/**
 * Shown whenever the 120s tool-client ceiling (pkg/plugin newPluginHTTPClient) ends an Ask.
 * One line, actionable; there is no async 202 path to point at.
 */
export const ASK_TIMEOUT_MESSAGE =
  'Ask stopped at the 120s limit per hop (up to 3 hops); retry or narrow the question.';

const TIMEOUT_TEXT = /abort|timed out|timeout|deadline exceeded|gateway time-?out/i;

/**
 * The 120s expiry reaches the browser three ways: a client-side abort, an upstream 504,
 * or the Go proxy's 502 envelope carrying "context deadline exceeded". A plain 502
 * (dial refused, bad gateway) is a different fault and keeps its own text.
 */
function timeoutAware(status: number, message: string, name?: string): string {
  if (name === 'AbortError' || message === ASK_CANCELLED_MESSAGE) {
    return ASK_CANCELLED_MESSAGE;
  }
  if (name === 'TimeoutError' || status === 504 || TIMEOUT_TEXT.test(message)) {
    return ASK_TIMEOUT_MESSAGE;
  }
  return message;
}

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
function abortedError(): Error {
  const err = new Error(ASK_CANCELLED_MESSAGE);
  err.name = 'AbortError';
  return err;
}

function withAbort<T>(source: Observable<T>, signal?: AbortSignal): Observable<T> {
  if (!signal) {
    return source;
  }
  return new Observable<T>((subscriber) => {
    if (signal.aborted) {
      subscriber.error(abortedError());
      return;
    }
    const inner = source.subscribe(subscriber);
    const onAbort = () => {
      inner.unsubscribe();
      subscriber.error(abortedError());
    };
    signal.addEventListener('abort', onAbort);
    return () => {
      signal.removeEventListener('abort', onAbort);
      inner.unsubscribe();
    };
  });
}

async function fetchResource(
  tool: DotAITool,
  text: string,
  meta?: AskCallMeta,
  signal?: AbortSignal
): Promise<FetchResponseLike> {
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
  const response = getBackendSrv().fetch({
    // Plugin SDK CallResource — not Grafana dashboard/folder HTTP (/api vs /apis).
    url: `/api/plugins/${pluginJson.id}/resources/${tool}`,
    method: 'POST',
    data,
    showErrorAlert: false,
    showSuccessAlert: false,
  });
  return lastValueFrom(withAbort(response as unknown as Observable<FetchResponseLike>, signal));
}

export async function callDotAITool(
  tool: DotAITool,
  intent: string,
  meta?: AskCallMeta,
  signal?: AbortSignal
): Promise<ToolCallResult> {
  try {
    const body = await fetchResource(tool, intent, meta, signal);
    const payload = body && typeof body === 'object' && 'data' in body ? body.data : body;
    const contract = asContract(payload);
    if (contract) {
      return {
        ok: contract.ok,
        status: contract.status,
        summary: contract.summary,
        raw: payload,
        errorMessage: contract.ok
          ? undefined
          : timeoutAware(contract.status, contract.error || `Request failed (HTTP ${contract.status})`),
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
    if (isAbortError(e)) {
      return {
        ok: false,
        status: 0,
        summary: '',
        raw: null,
        errorMessage: ASK_CANCELLED_MESSAGE,
      };
    }
    const errObj = e && typeof e === 'object' ? e : undefined;
    const errData =
      errObj && 'data' in errObj ? (errObj as { data: unknown }).data : undefined;
    const contract = asContract(errData);
    if (contract) {
      return {
        ok: contract.ok,
        status: contract.status,
        summary: contract.summary,
        raw: errData,
        errorMessage: contract.ok
          ? undefined
          : timeoutAware(contract.status, contract.error || `Request failed (HTTP ${contract.status})`),
      };
    }
    let status = 0;
    let name: string | undefined;
    let message = 'Request failed';
    if (errObj && 'status' in errObj && typeof errObj.status === 'number') {
      status = errObj.status;
    }
    if (e instanceof Error) {
      name = e.name;
      message = e.message;
    } else if (errObj && 'name' in errObj && typeof errObj.name === 'string') {
      name = errObj.name;
    } else if (errObj && 'message' in errObj && typeof errObj.message === 'string') {
      message = errObj.message;
    }
    return {
      ok: false,
      status,
      summary: '',
      raw: errData ?? e,
      errorMessage: timeoutAware(status, message, name),
    };
  }
}
