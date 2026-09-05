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

function hasApp(pluginId: string): boolean {
  const apps = (config as { apps?: Record<string, unknown> } | undefined)?.apps;
  return Boolean(apps && apps[pluginId]);
}

/** Grafana 11+ Explore panes URL. Not dashboard /api HTTP. */
export function exploreUrl(args: {
  uid: string;
  type: string;
  query: Record<string, unknown>;
}): string {
  const panes = {
    dotai: {
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

export function dashboardUrl(uid: string): string {
  return `${appBase()}/d/${encodeURIComponent(uid)}`;
}

export function drilldownAppUrl(pluginId: string): string | undefined {
  if (!hasApp(pluginId)) {
    return undefined;
  }
  return `${appBase()}/a/${pluginId}`;
}

export function buildDrilldownLinks(args: {
  lokiUid?: string;
  promUid?: string;
  tempoUid?: string;
  logql: string;
  promql: string;
  tempoSearch: string;
  traceIds: string[];
  /** Firing-alert-attached dashboard UIDs. Validated below — never trust text into a URL. */
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
        query: { queryType: 'traceqlSearch', query: args.tempoSearch, limit: 5 },
      }),
    });
    const tracesApp = drilldownAppUrl('grafana-exploretraces-app');
    if (tracesApp) {
      links.push({ id: 'drilldown-traces', label: 'Traces Drilldown', href: tracesApp });
    }
    const traceIds = [...new Set(args.traceIds)].slice(0, 5);
    for (const id of traceIds) {
      // Two trace ids can share the same 8-char prefix; fall back to the full id
      // for the label whenever that prefix is not unique within this batch, so
      // the rendered links stay visually distinguishable.
      const prefix = id.slice(0, 8);
      const collides = traceIds.some((other) => other !== id && other.slice(0, 8) === prefix);
      links.push({
        id: `trace-${id}`,
        label: `Trace ${collides ? id : prefix}`,
        href: exploreUrl({
          uid: args.tempoUid,
          type: 'tempo',
          query: { queryType: 'traceql', query: id },
        }),
      });
    }
  }

  // Model/alert-authored text must never become part of a link href. dashboardUids
  // already passed dashboardUidsFromAlertFrames' own shape check on the way in
  // (src/utils/grafanaStack.ts), but this loop re-validates at the point the URL is
  // actually built so buildDrilldownLinks stays safe for any future caller too.
  for (const uid of args.dashboardUids.slice(0, 5)) {
    if (!/^[A-Za-z0-9_-]{5,40}$/.test(uid)) {
      continue;
    }
    links.push({
      id: `dash-${uid}`,
      label: `Dashboard ${uid}`,
      href: dashboardUrl(uid),
    });
  }

  return links;
}
