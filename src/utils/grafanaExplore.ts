import { config } from '@grafana/runtime';

export type DrilldownLink = {
  id: string;
  label: string;
  href: string;
};

function appBase(): string {
  return String((config as { appSubUrl?: string } | undefined)?.appSubUrl || '').replace(/\/$/, '');
}

function orgId(): number {
  const boot = (config as { bootData?: { user?: { orgId?: number } } } | undefined)?.bootData;
  return boot?.user?.orgId ?? 1;
}

/**
 * Installed, NOT enabled — a known limitation.
 *
 * `config.apps` is boot config from `frontendsettings.go`: `pluginSettings()`
 * synthesizes an entry for every *installed* app when no DB row exists, and
 * `AppPluginConfig` (@grafana/runtime 11.4) carries no `enabled` field at all —
 * enablement only influences `preload`. So when an admin explicitly disables a
 * Drilldown app we still return true, render the link, and `/a/<id>` lands on
 * "Application Not Enabled".
 *
 * There is no reliable *synchronous* enablement signal in the 11.4 typed
 * surface. The two signals that do reflect enablement both cost more than the
 * bug: `config.bootData.navTree` conflates enablement with per-role nav
 * visibility and `addToNav`, so it would hide working links (a worse failure
 * than a rare broken one), and `/api/plugins/<id>/settings` is async while this
 * builder is sync. Revisit if a later `@grafana/runtime` exposes `enabled`.
 */
function hasApp(pluginId: string): boolean {
  const apps = (config as { apps?: Record<string, unknown> } | undefined)?.apps;
  return Boolean(apps && apps[pluginId]);
}

/**
 * Explore pane key. `v1Migrator.parse` (useStateSync/migrators/v1.ts) replaces
 * any key that is not exactly 3 chars from ID_ALPHABET (`0-9a-z`, not all
 * digits) with a random `generateExploreId()`, so a longer key like `dotai` is
 * silently discarded. Keep this 3 chars — see the constraint test.
 */
const PANE_KEY = 'dot';

/** Grafana 11+ Explore panes URL. Not dashboard /api HTTP. */
export function exploreUrl(args: {
  uid: string;
  type: string;
  query: Record<string, unknown>;
}): string {
  const panes = {
    [PANE_KEY]: {
      datasource: args.uid,
      queries: [
        {
          refId: 'A',
          datasource: { type: args.type, uid: args.uid },
          ...args.query,
        },
      ],
      range: { from: 'now-15m', to: 'now' },
    },
  };
  const params = new URLSearchParams({
    schemaVersion: '1',
    panes: JSON.stringify(panes),
    orgId: String(orgId()),
  });
  return `${appBase()}/explore?${params.toString()}`;
}

/**
 * Tempo `traceqlSearch` is driven by `TempoQuery.filters`, never by `query`.
 *
 * In 11.4 `dataquery.gen.ts` declares `filters: Array<TraceqlFilter>` as
 * required and documents `query` as "TraceQL query or trace ID" (i.e. the
 * `traceql` mode). At execution `datasource.ts` runs
 * `generateQueryFromFilters(appliedQuery.filters)` and never reads `query`;
 * `TraceQLSearch.tsx` likewise regenerates the displayed query from `filters`.
 * So a search term passed as `query` alongside `traceqlSearch` is dropped on
 * the floor and Explore opens with an empty search.
 *
 * We mirror Grafana's own builder (`makeTempoLink`, datasource.ts): an exact
 * `resource.service.name` filter, which yields `{resource.service.name="…"}`
 * and lands as a visible, editable chip in the Search tab. The scope literal is
 * `TraceqlSearchScope.Resource`; the enum lives in the Tempo plugin and is not
 * exported from any `@grafana/*` package, so it is inlined as its value.
 *
 * A blank term emits `filters: []` — the required field, an unfiltered search —
 * rather than a filter with an empty value, matching Grafana's own guard.
 */
function tempoSearchQuery(term: string): Record<string, unknown> {
  const filters = term
    ? [
        {
          id: 'service-name',
          scope: 'resource',
          tag: 'service.name',
          operator: '=',
          value: term,
          valueType: 'string',
        },
      ]
    : [];
  return { queryType: 'traceqlSearch', filters, limit: 5 };
}

export function dashboardUrl(uid: string): string {
  return `${appBase()}/d/${encodeURIComponent(uid)}`;
}

export function drilldownAppUrl(pluginId: string): string | undefined {
  if (!hasApp(pluginId)) {
    return undefined;
  }
  return `${appBase()}/a/${pluginId}`;
}

/**
 * Diagnosis tokens that force POST (show-me must not skip the engine).
 *
 * INTENTIONALLY UNREACHABLE TODAY — do not delete. `SHOW_ME_PRODUCTION` below
 * is fully anchored with no tail, so it accepts exactly 30 pure navigation
 * phrases, none of which contains a token here; removing this changes no
 * current result. It is defence for a later slice that widens the production
 * (e.g. re-adding a `for <resource>` tail), at which point it becomes
 * load-bearing and is the only thing keeping "show me the logs for the crashing
 * pod" off the 0-hop skip.
 *
 * Stems, not exact words: `\b`-exact tokens let every inflection through
 * (`errors`, `crashing`, `failed`, `analysis`) — precisely the phrasing a
 * widened production would see. Extras beyond the contract six (how, improve,
 * root cause, because, issue(s), unhealthy) bias toward POST, the safe
 * direction when the 0-hop skip would otherwise fire.
 *
 * Exported so its stemming can be tested directly while it is unreachable.
 */
export const DIAGNOSIS_TOKENS =
  /\b(why|error\w*|crash\w*|fail\w*|analy[sz]\w*|remediate|how|improve|root cause|because|issue|issues|unhealthy)\b/;

/** The written contract production. Fully anchored — no `for <resource>` tail. */
const SHOW_ME_PRODUCTION = /^(show me|open|display)( the)? (logs|alerts|traces|metrics|dashboards)$/;

/**
 * True when the Ask is only a pure navigation phrase:
 * `(show me|open|display) the? (logs|alerts|traces|metrics|dashboards)`.
 * Diagnosis tokens force POST (show-me does not skip). False positives on the
 * 0-hop skip are dangerous — when ambiguous, return false so the engine runs.
 */
export function isShowMeOnly(question: string): boolean {
  // Lowercase; collapse whitespace; strip only surrounding .?! (keep interior).
  const q = question
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[.?!]+|[.?!]+$/g, '')
    .trim();
  if (!q) {
    return false;
  }
  // Diagnosis wins. See DIAGNOSIS_TOKENS — unreachable today, deliberately kept.
  if (DIAGNOSIS_TOKENS.test(q)) {
    return false;
  }

  return SHOW_ME_PRODUCTION.test(q);
}


export function buildDrilldownLinks(args: {
  lokiUid?: string;
  promUid?: string;
  tempoUid?: string;
  logql: string;
  promql: string;
  tempoSearch: string;
  traceIds: string[];
  dashboardUids: string[];
}): DrilldownLink[] {
  const links: DrilldownLink[] = [];

  if (args.lokiUid) {
    links.push({
      id: 'explore-logs',
      label: 'Explore logs',
      href: exploreUrl({
        uid: args.lokiUid,
        type: 'loki',
        query: { expr: args.logql, queryType: 'range' },
      }),
    });
    const logsApp = drilldownAppUrl('grafana-lokiexplore-app');
    if (logsApp) {
      links.push({ id: 'drilldown-logs', label: 'Logs Drilldown', href: logsApp });
    }
  }

  if (args.promUid) {
    links.push({
      id: 'explore-metrics',
      label: 'Explore metrics',
      href: exploreUrl({
        uid: args.promUid,
        type: 'prometheus',
        query: { expr: args.promql, instant: true },
      }),
    });
    const metricsApp = drilldownAppUrl('grafana-metricsdrilldown-app');
    if (metricsApp) {
      links.push({ id: 'drilldown-metrics', label: 'Metrics Drilldown', href: metricsApp });
    }
  }

  if (args.tempoUid) {
    links.push({
      id: 'explore-traces',
      label: 'Explore traces',
      href: exploreUrl({
        uid: args.tempoUid,
        type: 'tempo',
        query: tempoSearchQuery(args.tempoSearch),
      }),
    });
    const tracesApp = drilldownAppUrl('grafana-exploretraces-app');
    if (tracesApp) {
      links.push({ id: 'drilldown-traces', label: 'Traces Drilldown', href: tracesApp });
    }
    for (const id of args.traceIds.slice(0, 5)) {
      links.push({
        id: `trace-${id}`,
        label: `Trace ${id.slice(0, 8)}`,
        href: exploreUrl({
          uid: args.tempoUid,
          type: 'tempo',
          query: { queryType: 'traceql', query: id },
        }),
      });
    }
  }

  for (const uid of args.dashboardUids.slice(0, 5)) {
    links.push({
      id: `dash-${uid}`,
      label: `Dashboard ${uid}`,
      href: dashboardUrl(uid),
    });
  }

  return links;
}
