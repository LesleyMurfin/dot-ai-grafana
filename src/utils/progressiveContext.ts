import { DotAITool } from './dotaiApi';

/** Display-only turn; never included in POST body text. */
export type HistoryTurn = {
  role: 'you' | 'answer';
  text: string;
};

export type ToolThread = {
  current: string;
  map: string;
  history: HistoryTurn[];
};

/** Max History turns shown on screen (each You or Answer counts as one). */
export const MAX_HISTORY_TURNS = 5;

/** Cap for the rewritten Current block (chars). */
export const MAX_CURRENT_CHARS = 1200;

/** Cap for the Map line (chars). */
export const MAX_MAP_CHARS = 400;

export function emptyThread(): ToolThread {
  return { current: '', map: '', history: [] };
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
 */
const HINT_STOPWORDS: Record<string, true> = {
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

/**
 * Pack Stable + Current + Map + box for the next POST.
 * History is intentionally omitted.
 */
export function buildRequestText(args: {
  tool: DotAITool;
  current: string;
  map: string;
  box: string;
}): string {
  const parts: string[] = [stablePreamble(args.tool)];
  const current = args.current.trim();
  const map = args.map.trim();
  const box = args.box.trim();

  if (current) {
    parts.push('', 'Current:', current);
  }
  if (map) {
    parts.push('', 'Map:', map);
  }
  parts.push('', args.tool === 'remediate' ? 'Issue:' : 'Question:', box);
  return parts.join('\n');
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
