import { DotAITool } from './dotaiApi';
import { DrilldownLink } from './grafanaExplore';

/** Display-only turn; never included in POST body text. */
export type HistoryTurn = {
  role: 'you' | 'answer';
  text: string;
};

export type ToolThread = {
  current: string;
  map: string;
  history: HistoryTurn[];
  /** UI-only Explore/Drilldown links. Never POSTed. */
  drilldowns: DrilldownLink[];
};

/** Max History turns shown on screen (each You or Answer counts as one). */
export const MAX_HISTORY_TURNS = 5;

/** Cap for rewritten Current (chars). Leaves headroom so packed intent stays ≤ MAX_INTENT_CHARS. */
export const MAX_CURRENT_CHARS = 700;

/** Cap for the Map line (chars). */
export const MAX_MAP_CHARS = 400;

/** Hard cap for packed query/remediate intent sent to dot-ai (chars). */
export const MAX_INTENT_CHARS = 1000;

export function emptyThread(): ToolThread {
  return { current: '', map: '', history: [], drilldowns: [] };
}


export function stablePreamble(tool: DotAITool): string {
  if (tool === 'remediate') {
    return 'Tool: Remediate. Analysis only — do not apply or mutate cluster state. Answer FROM Current when present. Prefer Current facts over generic advice.';
  }
  return 'Tool: Query. Analysis and cluster facts only — no mutations. Answer FROM Current when present. Prefer concrete Current facts (logs, metrics, alerts, cluster data) over generic advice.';
}

function oneLine(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= max) {
    return flat;
  }
  return `${flat.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

function cap(text: string, max: number): string {
  const t = text.trim();
  if (t.length <= max) {
    return t;
  }
  return `${t.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

/**
 * Filler words that must never become a resource-name or namespace chip.
 * Prose such as "namespaces are in Active status" is not an inventory fact.
 * Shared with parsePodNamespace so free-text questions do not invent pod names.
 */
export const HINT_STOPWORDS: Record<string, true> = {
  are: true,
  is: true,
  was: true,
  were: true,
  be: true,
  been: true,
  being: true,
  found: true,
  running: true,
};
/**
 * Pack Stable + Current + Map + box for the next POST.
 * History is intentionally omitted.
 * Always ≤ MAX_INTENT_CHARS: drop Map, then Tempo, then trim Loki, then hard cap.
 */
export function buildRequestText(args: {
  tool: DotAITool;
  current: string;
  map: string;
  box: string;
}): string {
  const box = args.box.trim();
  let current = args.current.trim();
  let map = args.map.trim();

  const pack = (c: string, m: string): string => {
    const parts: string[] = [stablePreamble(args.tool)];
    if (c) {
      parts.push('', 'Current:', c);
    }
    if (m) {
      parts.push('', 'Map:', m);
    }
    parts.push('', args.tool === 'remediate' ? 'Issue:' : 'Question:', box);
    return parts.join('\n');
  };

  let text = pack(current, map);
  if (text.length <= MAX_INTENT_CHARS) {
    return text;
  }

  // 1. Drop Map
  map = '';
  text = pack(current, map);
  if (text.length <= MAX_INTENT_CHARS) {
    return text;
  }

  // 2. Drop Tempo section from Current
  current = dropTempoSection(current);
  text = pack(current, map);
  if (text.length <= MAX_INTENT_CHARS) {
    return text;
  }

  // 3. Trim Loki body lines until under budget
  current = trimLokiSection(current, (c) => pack(c, map).length, MAX_INTENT_CHARS);
  text = pack(current, map);
  if (text.length <= MAX_INTENT_CHARS) {
    return text;
  }

  // 4. Hard cap full packed string
  return cap(text, MAX_INTENT_CHARS);
}

/** Remove the Tempo last-15m block from a stack Current string. */
function dropTempoSection(current: string): string {
  const next = current.replace(
    /\n*Tempo last 15m[^\n]*:\n[\s\S]*?(?=\n\n(?:Loki|Prometheus|Alertmanager)\b|\n*$)/i,
    '\n'
  );
  return next.replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Peel Loki log lines from the end of the Loki block until packed length ≤ max.
 */
function trimLokiSection(
  current: string,
  measure: (c: string) => number,
  max: number
): string {
  const match =
    /^(Loki last 15m[^\n]*:\n)([\s\S]*?)(?=\n\n(?:Prometheus|Tempo|Alertmanager)\b|\n*$)/i.exec(
      current
    );
  if (!match) {
    return current;
  }
  const header = match[1];
  let body = match[2];
  const rest = current.slice(match[0].length);
  const rebuild = (b: string) => `${header}${b}${rest}`.replace(/\n{3,}/g, '\n\n').trim();

  let out = rebuild(body);
  while (measure(out) > max) {
    const lines = body.split('\n').filter((line, idx, arr) => line !== '' || idx < arr.length - 1);
    if (lines.length <= 1) {
      body = '…';
      out = rebuild(body);
      break;
    }
    lines.pop();
    body = lines.join('\n');
    out = rebuild(body);
  }
  return out;
}

/**
 * Best-effort short names / where-only hints from free text.
 * Keeps Map small; not a full inventory.
 */
export function extractResourceHints(...chunks: string[]): string {
  const text = chunks.join('\n');
  const found = new Set<string>();

  const nsRe = /\b(?:namespace|ns)[/:=\s]+([a-z0-9][a-z0-9-]{0,62})\b/gi;
  let m: RegExpExecArray | null;
  while ((m = nsRe.exec(text)) !== null) {
    found.add(`ns/${m[1]}`);
  }

  const podRe = /\b(?:pod[s]?[/:\s]+)([a-z0-9][a-z0-9.-]{0,252})\b/gi;
  while ((m = podRe.exec(text)) !== null) {
    found.add(`pod/${m[1]}`);
  }

  // bare "name in namespace" / "name (namespace)" light patterns.
  // Free text like "namespaces are in Active status" would otherwise yield
  // junk chips such as "are@Active", so both sides reject filler words.
  const inNs = /\b([a-z0-9][a-z0-9.-]{1,60})\s+in\s+([a-z0-9][a-z0-9-]{0,62})\b/gi;
  while ((m = inNs.exec(text)) !== null) {
    if (HINT_STOPWORDS[m[1].toLowerCase()] || HINT_STOPWORDS[m[2].toLowerCase()]) {
      continue;
    }
    found.add(`${m[1]}@${m[2]}`);
  }

  return cap([...found].slice(0, 12).join(', '), MAX_MAP_CHARS);
}

export function mergeMap(previous: string, ...chunks: string[]): string {
  const parts = new Set<string>();
  for (const piece of [previous, extractResourceHints(...chunks)]) {
    for (const token of piece.split(/,\s*/)) {
      const t = token.trim();
      if (t) {
        parts.add(t);
      }
    }
  }
  return cap([...parts].slice(0, 12).join(', '), MAX_MAP_CHARS);
}

/** Replace Current with one rewritten block after a successful answer. */
export function rewriteCurrent(previous: string, userText: string, answer: string): string {
  const resources = extractResourceHints(previous, userText, answer);
  const lines = [
    resources ? `Resources: ${resources}` : undefined,
    `Asked: ${oneLine(userText, 180)}`,
    `What's true now: ${oneLine(answer, 500)}`,
    'Next: follow up in Query, or Analyze this for remediation analysis.',
  ].filter((line): line is string => Boolean(line));
  return cap(lines.join('\n'), MAX_CURRENT_CHARS);
}


/** Append You + Answer; keep only the last MAX_HISTORY_TURNS for display. */
export function appendHistory(history: HistoryTurn[], you: string, answer: string): HistoryTurn[] {
  const next = [
    ...history,
    { role: 'you' as const, text: you.trim() },
    { role: 'answer' as const, text: answer.trim() },
  ];
  return next.slice(-MAX_HISTORY_TURNS);
}
