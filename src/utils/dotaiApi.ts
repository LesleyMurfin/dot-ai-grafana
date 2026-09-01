import { lastValueFrom, Observable } from 'rxjs';
import { getBackendSrv } from '@grafana/runtime';
import pluginJson from '../plugin.json';

export type DotAITool = 'query' | 'remediate';

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
async function fetchResource(tool: DotAITool, intent: string): Promise<FetchResponseLike> {
  const response = await getBackendSrv().fetch({
    url: `/api/plugins/${pluginJson.id}/resources/${tool}`,
    method: 'POST',
    data: { intent },
    showErrorAlert: false,
    showSuccessAlert: false,
  });
  return lastValueFrom(response as unknown as Observable<FetchResponseLike>);
}

export async function callDotAITool(tool: DotAITool, intent: string): Promise<ToolCallResult> {
  try {
    const body = await fetchResource(tool, intent);
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
