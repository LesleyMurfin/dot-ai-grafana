#!/usr/bin/env node
/**
 * Golden Ask harness — drives the 3 golden UI Asks and scores them from the
 * backend ask log (`/var/lib/grafana/dotai-ask.log`), not from UI text alone.
 *
 * Measures follow docs/grafana-stack-test-plan.md §7 (M1 current_empty,
 * M2 first_hop, M3 hops, M5 used_current) and are computed by the same jq
 * program documented there. Fail-closed: the process exits non-zero when an
 * observability Ask scores hops < 2 or current_empty, when a window is
 * unreadable/short, when hops > 3, or when any hop status != 200.
 *
 *   live:     node scripts/golden-ask.mjs
 *   offline:  node scripts/golden-ask.mjs --dry-run --log scripts/dotai-ask.jsonl \
 *               --from 2026-09-01T20:07:54Z --to 2026-09-01T20:09:55Z
 *
 * Flags: --dry-run  score an existing log window, no browser, no Asks
 *        --log F    read the ask log from F instead of kubectl exec
 *        --from/--to RFC3339 window bounds (dry-run; live uses harness clock)
 *        --out F    write the results JSON to F
 */
import fs from 'fs';
import { execFileSync } from 'child_process';

const argv = process.argv.slice(2);
const has = (n) => argv.includes(`--${n}`);
const flag = (n, def = null) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : def;
};

const DRY_RUN = has('dry-run') || process.env.GOLDEN_ASK_DRY_RUN === '1';
const LOG_FILE = flag('log', process.env.ASK_LOG_FILE);
const OUT = flag('out', DRY_RUN ? null : 'scripts/golden-ask-results.json');
const base = process.env.GRAFANA_URL || 'http://10.43.25.61';
const ASK_LOG_NS = process.env.ASK_LOG_NS || 'riley-monitoring';
const ASK_LOG_DEPLOY = process.env.ASK_LOG_DEPLOY || 'deploy/kube-prometheus-stack-grafana';
const ASK_LOG_PATH = process.env.ASK_LOG_PATH || '/var/lib/grafana/dotai-ask.log';

/** MAX_ASK_HOPS from src/utils/askOrchestrator.ts — >3 upstream POSTs is a hard fail. */
const MAX_HOPS = 3;

/**
 * Golden Asks and their fail-closed gates.
 *
 * `minHops` is only asserted where the orchestrator's hop count is structural,
 * not answer-dependent: an unscoped question always takes the `across` hop
 * (askOrchestrator.ts `if (unscoped && hops === 1)`), so top-issues owes 2 hops.
 *
 * The scoped argocd Ask does NOT owe 2 hops. Hop 2 there is the `conflict`
 * escalation, which only fires when hop 1 denied facts Current already holds.
 * A hop-1 answer that reports the pod straight from Current is the *better*
 * outcome and must pass (live proof: ask-log 2026-09-01T21:13:46Z, hop 1,
 * current_empty=false, no denial). So the gate is `escalateOnDenial`: fail only
 * when a denial went unescalated, or when a lone hop answered without Current.
 */
const ASKS = [
  {
    q: 'what are the top issues across all clusters',
    kind: 'observability',
    minHops: 2,
    requireBranch: 'across',
    requireCurrent: true,
  },
  {
    q: 'show logs for pod argocd-application-controller in namespace riley-gitops',
    kind: 'observability',
    minHops: 1,
    escalateOnDenial: true,
    requireCurrent: true,
  },
  { q: 'list namespaces', kind: 'inventory', minHops: 1, requireCurrent: false },
];

/**
 * §7 measure program, verbatim from docs/grafana-stack-test-plan.md plus the
 * raw meta fields (`hop`, `hops_field`, `branch`, `current_empty_field`,
 * `first_hop_field`) needed to slice the NDJSON into per-Ask hop groups, and a
 * `denies` measure for the escalation gate.
 *
 * `denies` deliberately re-derives the denial from `.summary` instead of
 * trusting the orchestrator's own `branch`: the regression under test is the
 * orchestrator failing to escalate a denial, which a branch-only check could
 * never see. Phrases mirror DENIAL_PHRASE in src/utils/askOrchestrator.ts and,
 * like it, require a Kubernetes subject in the same sentence and ignore a
 * quoted HTTP 4xx/5xx "not found".
 */
const JQ_MEASURES = String.raw`
  def hdrre: "^(Loki last 15m|Prometheus last 15m|Tempo last 15m|Alertmanager)( \\([^)]*\\))?:$";
  def isnote($x): (["no log lines","no metric samples","no traces","no alerts"]
    | any(. as $p | $x | startswith($p))) or ($x | test("datasource missing"));
  def stop: ["prometheus","alertmanager","namespace","question","analysis","mutations",
    "cluster","current","datasource","missing","grafana"];
  def toks($s): [$s | ascii_downcase | gsub("[^a-z0-9._/-]+"; " ") | split(" ")[]
    | select(length >= 6)] | unique;
  . as $e
  | (($e.body // "") | split("\n")) as $L
  | [range(0; $L|length) | select($L[.] | test(hdrre))] as $h
  | [$h[] | ($L[.+1] // "")] as $first
  | [$h[] | $L[.]] as $hl
  | [$first[] | select(isnote(.))] as $nl
  | (($L | index("Current:")) // -1) as $ci
  | ([($L|index("Map:")), ($L|index("Question:")), ($L|index("Issue:")), ($L|length)]
      | map(select(. != null)) | min) as $ce
  | (if $ci < 0 then "" else ($L[$ci+1:$ce] | join("\n")) end) as $cur
  | ((toks($cur) - toks(($hl + $nl) | join("\n"))) - stop) as $ev
  | (toks($e.summary // "")) as $st
  | (($e.summary // "") | gsub("[45][0-9]{2}[^.]{0,12}?(not found|not available)"; " ")
      | ascii_downcase | split(".")) as $sent
  | [$sent[]
      | select(test("does not exist|doesn.t exist|do not exist|don.t exist|not found|no such|unknown namespace|could not find|couldn.t find|was not found|not currently deployed|not available|from a different cluster"))
      | select(test("namespace|pod|deployment|workload|statefulset|daemonset|replicaset|container|service|application|cluster|vcluster|context"))] as $dn
  | {time:$e.time, tool:$e.tool, status:$e.status,
     hop:$e.hop, hops_field:$e.hops, branch:$e.branch,
     current_empty_field:$e.current_empty, first_hop_field:$e.first_hop,
     current_empty: (($h|length) == 0 or ([$first[] | isnote(.)] | all)),
     first_hop: (if ($h|length) > 0 then "grafana" else "dot-ai" end),
     truncated: (($e.body // "") | endswith("…")),
     evidence_n: ($ev|length),
     denies: (($dn|length) > 0),
     used_current: ([$ev[] | select(. as $x | $st | any(startswith($x)))] | length > 0)}
`;

const stamp = (d = new Date()) => d.toISOString().replace(/\.\d+Z$/, 'Z');

/** Pull the ask log: a local copy when given, else kubectl exec + cat. */
function readAskLog() {
  if (LOG_FILE) {
    if (!fs.existsSync(LOG_FILE)) {
      throw new Error(`ask log not readable: ${LOG_FILE}`);
    }
    return LOG_FILE;
  }
  const dest = 'scripts/golden-ask-log.jsonl';
  const out = execFileSync(
    'kubectl',
    ['-n', ASK_LOG_NS, 'exec', ASK_LOG_DEPLOY, '-c', 'grafana', '--', 'cat', ASK_LOG_PATH],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }
  );
  fs.writeFileSync(dest, out);
  return dest;
}

/** Run the §7 jq program over the NDJSON log; one measure object per hop line. */
function measure(logPath) {
  const out = execFileSync('jq', ['-c', JQ_MEASURES, logPath], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return out
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));
}

/**
 * Slice a window into per-Ask hop groups. A record with `hop <= 1` (or with no
 * hop meta at all — fail-closed rule 1) opens a new Ask; hop 2/3 continue it.
 */
function groupHops(rows) {
  const groups = [];
  for (const m of rows) {
    const starts = typeof m.hop !== 'number' || m.hop <= 1;
    if (starts || groups.length === 0) {
      groups.push([m]);
    } else {
      groups[groups.length - 1].push(m);
    }
  }
  return groups;
}

/** Aggregate one hop group into the §7 per-Ask scores. */
function scoreGroup(group) {
  const first = group[0];
  return {
    hops: group.length, // M3: NDJSON lines in the window
    hops_field: Math.max(...group.map((m) => m.hops_field || 0)),
    // M1, fail-closed: empty when the body says so OR the UI meta says so.
    current_empty: first.current_empty === true || first.current_empty_field === true,
    first_hop: first.first_hop, // M2, body-derived
    first_hop_field: first.first_hop_field ?? null,
    used_current: group.some((m) => m.used_current === true), // M5
    denies_hop1: first.denies === true,
    branches: group.map((m) => m.branch ?? null),
    truncated: group.some((m) => m.truncated === true),
    evidence_n: Math.max(...group.map((m) => m.evidence_n || 0)),
    status: group.map((m) => m.status),
    times: group.map((m) => m.time),
  };
}

/** Apply the fail-closed gates; returns the scored Asks plus failure strings. */
function scoreWindow(rows, from, to) {
  const failures = [];
  const windowed = rows.filter((m) => m.time >= from && m.time <= to);
  if (windowed.length === 0) {
    failures.push(`no ask-log lines in window ${from}..${to}`);
    return { asks: [], failures };
  }
  const groups = groupHops(windowed);
  if (groups.length !== ASKS.length) {
    failures.push(
      `window ${from}..${to} holds ${groups.length} Ask group(s) (${windowed.length} lines), expected ${ASKS.length}`
    );
  }
  const asks = ASKS.map((spec, i) => {
    const group = groups[i];
    if (!group) {
      failures.push(`[${spec.q}] no ask-log lines — scored fail-closed`);
      return { ...spec, missing: true, hops: 0, current_empty: true, used_current: false };
    }
    const s = scoreGroup(group);
    if (s.hops < spec.minHops) {
      failures.push(`[${spec.q}] hops=${s.hops} < required ${spec.minHops}`);
    }
    if (s.hops > MAX_HOPS) {
      failures.push(`[${spec.q}] hops=${s.hops} exceeds MAX_ASK_HOPS=${MAX_HOPS}`);
    }
    if (spec.requireBranch && s.branches.some((b) => b !== null)) {
      if (!s.branches.includes(spec.requireBranch)) {
        failures.push(
          `[${spec.q}] no '${spec.requireBranch}' hop — branches: ${s.branches.join(',') || 'none'}`
        );
      }
    }
    if (spec.escalateOnDenial) {
      // Hop 1 denied facts Current already holds and nothing escalated it.
      if (s.denies_hop1 && s.hops < 2) {
        failures.push(`[${spec.q}] hop-1 denial not escalated (hops=${s.hops}, no conflict hop)`);
      }
      // A lone hop is only legitimate when it actually answered from Current.
      if (!s.denies_hop1 && s.hops === 1 && !s.used_current) {
        failures.push(`[${spec.q}] single-hop answer not grounded in Current (used_current=false)`);
      }
    }
    if (spec.requireCurrent && s.current_empty) {
      failures.push(`[${spec.q}] current_empty=true on an observability Ask`);
    }
    if (s.status.some((c) => c !== 200)) {
      failures.push(`[${spec.q}] non-200 hop status: ${s.status.join(',')}`);
    }
    return { ...spec, ...s };
  });
  return { asks, failures };
}

/** Drive the 3 golden Asks through the real UI; returns per-Ask UI observations. */
async function runAsks() {
  const { chromium } = await import('playwright');
  const user = process.env.GRAFANA_ADMIN_USER;
  const pass = process.env.GRAFANA_ADMIN_PASSWORD;
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();
  page.setDefaultTimeout(120000);

  await page.goto(base + '/login', { waitUntil: 'networkidle' });
  await page.fill('input[name="user"]', user);
  await page.fill('input[name="password"]', pass);
  await page.click('button[type="submit"]');
  await page.waitForTimeout(2000);

  const ui = [];
  for (const spec of ASKS) {
    const t0 = Date.now();
    const pageErrs = [];
    page.on('pageerror', (e) => pageErrs.push(String(e)));
    await page.goto(base + '/a/devopstoolkit-dotai-app/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);
    const intent = page.locator('textarea').first();
    await intent.waitFor({ state: 'visible', timeout: 60000 });
    await intent.fill(spec.q);
    const submit = page.getByRole('button', { name: /^Ask$/i });
    await submit.click();
    await page.waitForTimeout(2000);
    await page
      .waitForFunction(
        () => {
          const loading = document.body.innerText.includes('Waiting for dot-ai');
          const hasResp =
            document.body.innerText.includes('Response') ||
            document.body.innerText.includes('Request failed');
          return !loading && hasResp;
        },
        { timeout: 180000 }
      )
      .catch(() => {});
    await page.waitForTimeout(1000);
    const bodyText = await page.locator('body').innerText();
    const row = {
      q: spec.q,
      ms: Date.now() - t0,
      t0: stamp(new Date(t0)),
      t1: stamp(),
      chunk: /ChunkLoadError/i.test(bodyText),
      hasResponse: /Response/i.test(bodyText),
      hasError: /Request failed/i.test(bodyText),
      hasCurrent: /Current/i.test(bodyText),
      hasLokiHeader: /Loki last 15m/i.test(bodyText),
      snippet: bodyText.replace(/\s+/g, ' ').slice(0, 400),
      pageErrs,
    };
    ui.push(row);
    console.log(JSON.stringify(row));
  }
  await browser.close();
  return ui;
}

const run = { mode: DRY_RUN ? 'dry-run' : 'live' };
let ui = [];
let from = flag('from', process.env.ASK_WINDOW_FROM);
let to = flag('to', process.env.ASK_WINDOW_TO);

if (DRY_RUN) {
  if (!LOG_FILE) {
    console.error('--dry-run requires --log <ask-log.jsonl> (or ASK_LOG_FILE)');
    process.exit(2);
  }
  console.log(`# dry-run: scoring ${LOG_FILE} only — no Asks driven, UI gates not evaluated`);
} else {
  const runT0 = stamp();
  ui = await runAsks();
  // Let the backend flush the last NDJSON line before we read it.
  await new Promise((r) => setTimeout(r, 3000));
  from = from || runT0;
  to = to || stamp();
}
if (!from) from = '';
if (!to) to = '9999';
run.window = { from, to };

const failures = [];
let scored = { asks: [], failures: ['ask log never scored'] };
try {
  const logPath = readAskLog();
  run.log = logPath;
  scored = scoreWindow(measure(logPath), from, to);
} catch (e) {
  scored = { asks: [], failures: [`ask-log score failed: ${e.message}`] };
}
failures.push(...scored.failures);

for (const row of ui) {
  if (row.chunk) failures.push(`[${row.q}] ChunkLoadError in UI`);
  if (row.hasError) failures.push(`[${row.q}] UI shows "Request failed"`);
}

console.log(
  '\n| Ask | hops | branches | hop1_denies | current_empty | used_current | first_hop | status |'
);
console.log('|-----|------|----------|-------------|---------------|--------------|-----------|--------|');
for (const a of scored.asks) {
  console.log(
    `| ${a.q} | ${a.hops} | ${(a.branches || []).map((b) => b ?? '-').join('>') || '-'} | ${a.denies_hop1 ?? '-'} | ${a.current_empty} | ${a.used_current} | ${a.first_hop ?? '-'} | ${(a.status || []).join(',') || '-'} |`
  );
}

const results = { ...run, ui, asks: scored.asks, failures };
if (OUT) {
  fs.writeFileSync(OUT, JSON.stringify(results, null, 2));
  console.log(`\nwrote ${OUT}`);
}

if (failures.length) {
  console.error('\nFAIL (fail-closed gates):');
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`\nPASS ${scored.asks.length} golden Asks in ${from}..${to}`);
