import pluginJson from '../src/plugin.json';

/** Plugin id under test (must match src/plugin.json). */
export const PLUGIN_ID = pluginJson.id;

/** Unique stub markers — must never appear in browser-visible plugin responses. */
export const UPSTREAM_SECRET_MARKER = 'UPSTREAM_SECRET_STACK_DO_NOT_LEAK';
export const UPSTREAM_INTERNAL_FIELD = 'raw_upstream_internal_do_not_leak';

/** Provisioned bearer (secureJsonData). Must never appear in settings/resources/bundle. */
export const PROVISIONED_API_KEY = 'bydesign-e2e-bearer-token-do-not-leak';

export type ToolName = 'query' | 'remediate' | 'test-connection' | 'health';

export function resourcePath(tool: ToolName): string {
  return `/api/plugins/${PLUGIN_ID}/resources/${tool}`;
}

export type ToolEnvelope = {
  ok?: boolean;
  status?: number;
  summary?: string;
  error?: string;
  [key: string]: unknown;
};

export function asEnvelope(body: unknown): ToolEnvelope {
  if (body && typeof body === 'object') {
    return body as ToolEnvelope;
  }
  return {};
}

/** True when body looks like the stable tool proxy envelope (not a raw upstream dump). */
export function isStableEnvelope(body: unknown): boolean {
  if (!body || typeof body !== 'object') {
    return false;
  }
  const o = body as Record<string, unknown>;
  return 'ok' in o && 'status' in o && 'summary' in o && 'error' in o;
}

export function bodyContainsForbidden(body: unknown, ...needles: string[]): string[] {
  const text = typeof body === 'string' ? body : JSON.stringify(body ?? '');
  return needles.filter((n) => n && text.includes(n));
}
