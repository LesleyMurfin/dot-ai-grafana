import { lastValueFrom } from 'rxjs';
import { getBackendSrv } from '@grafana/runtime';
import pluginJson from '../plugin.json';

export type DotAITool = 'query' | 'remediate';

export type ToolRequestBody = {
  intent: string;
};

export type ToolCallResult = {
  ok: boolean;
  status: number;
  summary: string;
  raw: unknown;
  errorMessage?: string;
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return undefined;
}

/** D1: prefer data.result.summary; tolerate a few envelope shapes. */
export function extractSummary(payload: unknown): string | undefined {
  const root = asRecord(payload);
  if (!root) {
    return undefined;
  }

  const data = asRecord(root.data) ?? root;
  const result = asRecord(data.result) ?? asRecord(root.result);
  if (result) {
    const summary = result.summary;
    if (typeof summary === 'string' && summary.trim()) {
      return summary;
    }
    const analysis = result.analysis;
    if (typeof analysis === 'string' && analysis.trim()) {
      return analysis;
    }
    const message = result.message;
    if (typeof message === 'string' && message.trim()) {
      return message;
    }
  }

  if (typeof data.summary === 'string' && data.summary.trim()) {
    return data.summary;
  }
  if (typeof root.summary === 'string' && root.summary.trim()) {
    return root.summary;
  }
  return undefined;
}

export function extractErrorMessage(payload: unknown, fallback: string): string {
  const root = asRecord(payload);
  if (!root) {
    return fallback;
  }
  const err = asRecord(root.error);
  if (err && typeof err.message === 'string' && err.message.trim()) {
    const code = typeof err.code === 'string' ? `${err.code}: ` : '';
    return code + err.message;
  }
  if (typeof root.message === 'string' && root.message.trim()) {
    return root.message;
  }
  return fallback;
}

function unwrapFetchBody(body: unknown): unknown {
  const rec = asRecord(body);
  if (rec && 'data' in rec) {
    return rec.data;
  }
  return body;
}

export async function callDotAITool(tool: DotAITool, intent: string): Promise<ToolCallResult> {
  const id = pluginJson.id;
  const response = await getBackendSrv().fetch({
    url: `/api/plugins/${id}/resources/${tool}`,
    method: 'POST',
    data: { intent } satisfies ToolRequestBody,
    showErrorAlert: false,
    showSuccessAlert: false,
  });

  try {
    const body = await lastValueFrom(response as unknown as Parameters<typeof lastValueFrom>[0]);
    const status =
      body && typeof body === 'object' && 'status' in body && typeof (body as { status: unknown }).status === 'number'
        ? (body as { status: number }).status
        : 200;
    const payload = unwrapFetchBody(body);
    const summary = extractSummary(payload);
    if (status >= 200 && status < 300 && summary) {
      return { ok: true, status, summary, raw: payload };
    }
    if (status >= 200 && status < 300) {
      const text = typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2);
      return {
        ok: true,
        status,
        summary: text.slice(0, 8000),
        raw: payload,
      };
    }
    return {
      ok: false,
      status,
      summary: '',
      raw: payload,
      errorMessage: extractErrorMessage(payload, `Request failed (HTTP ${status})`),
    };
  } catch (e) {
    const errPayload = e && typeof e === 'object' && 'data' in e ? (e as { data: unknown }).data : undefined;
    const status =
      e && typeof e === 'object' && 'status' in e && typeof (e as { status: unknown }).status === 'number'
        ? (e as { status: number }).status
        : 0;
    const message = extractErrorMessage(errPayload, e instanceof Error ? e.message : 'Request failed');
    return {
      ok: false,
      status,
      summary: '',
      raw: errPayload ?? e,
      errorMessage: message,
    };
  }
}
