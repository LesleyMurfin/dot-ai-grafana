# Grafana stack test plan — prove the combination

**Scope.** Prove that **this K3s cluster** + **this Grafana stack** (Loki / Prometheus / Tempo /
Alertmanager) + **dot-ai** (query + analysis-only remediate) work *together* through the
`lesleymurfin-dotai-app` plugin. Proving the plugin merely *hosts* dot-ai is **not** a pass.

**No new UI.** Every check below uses surfaces that already exist: the **Tool** select, the
question/issue **box**, **Ask** / **Analyze**, **Clear thread**, **Analyze this**, and the
**Current / Map / History / Response** blocks on `/a/lesleymurfin-dotai-app/`. A check that requires
a new screen, tab, panel, datasource picker, or route is out of scope and must be rejected.

**The one rule that overrides everything (owner gate).** A turn passes only when the answer is
grounded. It **fails** when the response is generic "go check the logs" with **no Grafana data in
Current** *and* **no cluster fact from dot-ai**. See [X1](#x-combination-gate).

---

## 1. Environment — verified facts, do not guess

All values below were read from the live cluster and Grafana on 2026-09-01. Use them verbatim.

| Thing | Value |
|---|---|
| Grafana (ClusterIP, plain HTTP — **use this for Playwright**) | `http://10.43.25.61` |
| Grafana (ingress, human browser) | `https://grafana.internal.riley.team` |
| Grafana version | `11.4.0` |
| Grafana namespace / service | `riley-monitoring` / `kube-prometheus-stack-grafana` (port 80) |
| Grafana pod selector | `-n riley-monitoring -l app.kubernetes.io/name=grafana` |
| Admin secret | `riley-monitoring/grafana-admin-credentials` keys `username`, `password` |
| Plugin id | `lesleymurfin-dotai-app` |
| App page path | `/a/lesleymurfin-dotai-app/` |
| Config page path | `/plugins/lesleymurfin-dotai-app` |
| Plugin dist inside the pod | `/var/lib/grafana/plugins/lesleymurfin-dotai-app/` |
| Loki datasource uid | `P8E80F9AEF21F6940` (name `Loki`) |
| Prometheus datasource uid | `prometheus` (name `Prometheus`) |
| Tempo datasource uid | `tempo` (name `Tempo`) |
| Alertmanager datasource uid | `alertmanager` (name `alertmanager` type, name `Alertmanager`) |
| dot-ai tools REST (ClusterIP) | `http://10.43.31.212:3456` |
| dot-ai apiUrl stored in the plugin | `http://dot-ai.dot-ai.svc.cluster.local:3456` |
| dot-ai apiKey | stored encrypted (`secureJsonFields.apiKey = true`) |
| dot-ai tools REST version | `2.0.0` |

**How the plugin picks datasources.** `src/utils/grafanaStack.ts` resolves each source **by type** —
`getDataSourceSrv().getList({ type })` then `get(ref)` then `ds.query(request)`. There is **no
hardcoded uid, no proxy URL, and no picker UI**. The uids in the table above are still what *you*
need for the `curl` checks in L3, and B3 asserts that no uid was hardcoded back into the bundle.

Because every source goes through `ds.query()`, the browser issues **`POST /api/ds/query`** — that is
the single network pattern Playwright and the Network tab should watch.

> **Namespace:** the live Grafana runs in **`riley-monitoring`** — use it everywhere in this plan.
> (`README.md` previously said `monitoring`; that drift is fixed.)

> **Ingress TLS:** `grafana.internal.riley.team` is served with an internal CA
> (`riley-monitoring/grafana-internal-ca`) that this runner does not trust. `curl` needs `-k` (or the
> CA bundle); a human browser shows a trust prompt once. **Do not** point Playwright at the ingress
> for that reason — point it at `http://10.43.25.61`.

### Credentials — never printed

Every command here pulls the admin password into a shell variable and hands it straight to `curl`.
**No command echoes it.** Do not paste credentials into tickets, logs, or spec files.

```bash
export GRAFANA_URL=http://10.43.25.61
export GRAFANA_ADMIN_USER=$(kubectl -n riley-monitoring get secret grafana-admin-credentials -o jsonpath='{.data.username}' | base64 -d)
export GRAFANA_ADMIN_PASSWORD=$(kubectl -n riley-monitoring get secret grafana-admin-credentials -o jsonpath='{.data.password}' | base64 -d)
# sanity: prints only the HTTP code
curl -sS -o /dev/null -w '%{http_code}\n' -u "$GRAFANA_ADMIN_USER:$GRAFANA_ADMIN_PASSWORD" "$GRAFANA_URL/api/datasources"
```

`GRAFANA_ADMIN_USER` / `GRAFANA_ADMIN_PASSWORD` are exactly the variables `@grafana/plugin-e2e`
reads for its `auth` project, so the same exports drive both `curl` and Playwright.

### Toolchain

| Need | Check | If missing |
|---|---|---|
| Node 22 | `node -v` (`.nvmrc` = 22) | `nvm use` |
| Playwright 1.62 + chromium | `npx playwright --version` | `npx playwright install chromium` |
| Go 1.26 | `go version` | not installed on this runner — use the container form in [U9](#l1-unit-tests) |
| kubectl against host K3s | `kubectl -n riley-monitoring get pods` | fix kubeconfig before starting |

---

## 2. What Current must look like

On a **Query** turn the plugin calls `fetchStackContext(question)` **before** posting to dot-ai, and
packs the result into Current, which is then packed into the `intent` string. Current is built from
four fixed blocks, in this order, each with a scope suffix of the form
` (pod/POD ns/NAMESPACE)` when the question named a pod/namespace:

```text
Loki last 15m (pod/POD ns/NS):
<log lines, max 30>

Prometheus last 15m (pod/POD ns/NS):
<restart facts, max 8 series>

Tempo last 15m (pod/POD ns/NS):
<traces, max 5>

Alertmanager (pod/POD ns/NS):
<alerts, max 8>
```

Empty blocks are **honest notes**, not omissions — assert these literal strings:

| Block | Empty text |
|---|---|
| Loki | `no log lines for this pod/namespace in the last 15m` |
| Prometheus | `no metric samples for this pod/namespace in the last 15m` |
| Tempo | `no traces for this target in the last 15m` |
| Alertmanager | `no alerts`, or `Alertmanager datasource missing` when the datasource is absent |

**Trap that will otherwise cause false failures.** After a successful answer the page runs
`rewriteCurrent(...)`, so the on-screen Current is **replaced** by the post-answer rewrite and the
four block headers are no longer visible. The durable assertion is therefore:

1. the four headers appear in the **POST body** sent to `.../resources/query` (Current is packed
   into `intent`), and/or
2. the headers are visible in `dotai-current` **while the request is in flight** (before the answer
   lands).

Do not assert the headers in Current *after* the response has rendered.

---

## 3. Fixtures — which namespace/pod to use, and why it matters

This is the part people get wrong. **Grafana's datasources and dot-ai do not observe the same
cluster view.**

- The **Grafana stack observes the host K3s cluster** (namespaces `riley-gitops`,
  `riley-monitoring`, `vc-core`, ...). Loki additionally ingests vcluster workloads, tagged with
  `vcluster_name` and stored under the **host** namespace (`vc-core`) with host pod names shaped
  `NAME-x-VCLUSTER_NAMESPACE-x-vcluster-VCLUSTER`.
- **dot-ai answers from the Context Forge `core` gateway**, i.e. the **`core` vcluster**, which has
  7 namespaces: `default`, `dot-ai`, `kube-node-lease`, `kube-public`, `kube-system`, `monitoring`,
  `riley-discovery`.

So `kube-system` names *two different sets of pods* depending on who you ask. A test that ignores
this either fails for the wrong reason or "passes" while comparing unrelated objects.

**Fixture A — Grafana-side, high log volume (host cluster).** Guarantees a non-empty Loki window.

| Field | Value |
|---|---|
| Question to type | `show logs for pod argocd-application-controller in namespace riley-gitops` |
| Loki selector built | `{namespace="riley-gitops",pod=~"argocd-application-controller.*"}` |
| PromQL built | `sum by (pod, namespace) (kube_pod_container_status_restarts_total{namespace="riley-gitops",pod=~"argocd-application-controller.*"})` |
| Measured Loki volume | about 57k lines / 15m (Current caps at 30) |
| Measured Prometheus result | `argocd-application-controller-0` = `0` restarts (a real sample — Current must show a fact, not the empty note) |
| Expected Current header | `Loki last 15m (pod/argocd-application-controller ns/riley-gitops):` |

**Fixture B — dot-ai-side (core vcluster), cross-referenceable.** Use when a check must line up
Grafana data against a dot-ai cluster fact.

| Field | Value |
|---|---|
| Question to type | `show logs for pod coredns in namespace kube-system` |
| dot-ai ground truth | `kube-system` holds exactly **1** pod: `coredns-f78467f9f-d7wjr` (Running, 0 restarts) |
| Matching Loki selector (host view) | `{namespace="vc-core",vcluster_name="core",pod=~"coredns.*"}` -> host pod `coredns-f78467f9f-d7wjr-x-kube-system-x-vcluster-core`, about 104 lines / 1h |
| Trap | the literal selector the plugin builds, `{namespace="kube-system",pod=~"coredns.*"}`, hits the **host** kube-system coredns `coredns-ffc94f5b8-dx5dp` (about 7 lines/1h) — a *different pod* from dot-ai's answer |

**Fixture C — empty-window negative.** `show logs for pod nonexistent-xyz in namespace riley-gitops`
-> zero streams -> all four blocks must carry their honest empty note.

**Fixture D — the non-Loki datasources, measured live.**

| Source | Probe | Live value 2026-09-01 |
|---|---|---|
| Prometheus | `count(up)` | `74` |
| Alertmanager | active alerts | `124` (top: `KubeJobFailed` 16, `KubePodNotReady` 9, `KubeContainerWaiting` 7) |
| Tempo | search, last 24h | `{"traces":[]}` — **no traces exist**; intrinsic tags only |

Tempo being empty is **a fact of this environment, not a plugin bug**. Correct Tempo behaviour is
the `no traces for this target in the last 15m` note — never fabricated spans.

---

## 4. Known state as of 2026-09-01 (each maps to a check)

Run the plan against this baseline; these are the things it is built to catch.

| # | Finding | Evidence | Check |
|---|---|---|---|
| K1 | **Resolved 2026-09-01.** The served `module.js` was stale (17,868 bytes, no datasource wiring). After the stack connect landed it is 24,894 bytes and contains `Loki last 15m`, `Prometheus last 15m`, `Tempo last 15m`, `Alertmanager` and `getDataSourceSrv`, with **zero** occurrences of a hardcoded uid. Keep B3 as the standing regression guard | `curl` the served `module.js`, then `grep -c -F` | [B3](#l0-build--deploy-gate) |
| K2 | dot-ai's cluster is not Grafana's cluster (7 vcluster namespaces vs 60+ host namespaces). Asking about `riley-gitops` returns *"namespace does not exist"* while Loki holds about 98k lines/15m for it | dot-ai `query` vs `kubectl get ns` | [D7](#l3-live-datasource--dot-ai-checks) |
| K3 | dot-ai reports the coredns pod as `coredns-f78467f9f-4c77r`; the `core` gateway it says it used, and the vcluster annotation `vcluster.loft.sh/object-name`, both say **`coredns-f78467f9f-d7wjr`**. Reproduced twice, two phrasings | dot-ai `query` vs `core-pods-list-in-namespace` | [D8](#l3-live-datasource--dot-ai-checks) |
| K4 | `remediate` returns `success:false`, `EXECUTION_ERROR: Failed to parse AI final analysis response: No JSON found...` — the prose analysis is produced, dot-ai's own parser rejects it (about 35 s) | `POST /api/v1/tools/remediate` | [D9](#l3-live-datasource--dot-ai-checks) |
| K5 | Tempo holds zero traces over 24h | `GET /api/search` through the datasource proxy | [D3](#l3-live-datasource--dot-ai-checks) |

K2 and K3 are why the [X1](#x-combination-gate) gate demands "Grafana data **and** a dot-ai cluster
fact, cross-checked against ground truth" instead of "the answer looked good".

---

## 5. Layers

| Layer | Runs where | Upstream | Command |
|---|---|---|---|
| L0 build/deploy gate | runner + Grafana pod | n/a | `npm run build`, `curl`, `kubectl` |
| L1 unit | runner, jsdom + Go | mocked | `npm run test:ci`, `go test ./...` |
| L2 e2e | Playwright -> k3s Grafana | **mocked** via `page.route` | `GRAFANA_URL=http://10.43.25.61 npm run e2e -- --workers=1` |
| L3 live data | runner -> Grafana proxy + dot-ai | **live** | `curl` |
| L4 live click path | human browser -> ingress | **live** | manual, `https://grafana.internal.riley.team` |

L2 stays hermetic (mocked dot-ai) so it can gate PRs. L3 and L4 are what actually prove the
combination.

---

## L0 Build / deploy gate

| ID | Step | Expected | Fail if |
|---|---|---|---|
| **B1** | `npm run build` then list `dist` `.js` files | Exactly `module.js` (+ `module.js.map`). `webpack.config.ts` forces `splitChunks:false`, `runtimeChunk:false`, `LimitChunkCountPlugin({maxChunks:1})` | Any extra numbered chunk (`260.js`, `NNN.js`) appears — Grafana 11.4 404s those and the page dies with `ChunkLoadError` |
| **B2** | `grep -cE '__webpack_require__[.](e[|]u)[|]ChunkLoadError' dist/module.js` | `0` | Non-zero: the bundle still carries async-chunk loading machinery |
| **B3** | `curl -sSk -o /tmp/m.js "$GRAFANA_URL/public/plugins/lesleymurfin-dotai-app/module.js"`, then `grep -c -F` for each marker | HTTP 200; `Loki last 15m`, `Prometheus last 15m`, `Tempo last 15m`, `Alertmanager`, `getDataSourceSrv`, `dotai-analyze-this` each `1`; and `P8E80F9AEF21F6940` exactly `0` | A marker is `0` -> a stale build is deployed; rebuild and redeploy per README before running L3/L4. The uid marker being non-zero -> a hardcoded uid regressed back in, defeating type discovery |
| **B4** | `curl -sS -u "$GRAFANA_ADMIN_USER:$GRAFANA_ADMIN_PASSWORD" "$GRAFANA_URL/api/plugins/lesleymurfin-dotai-app/settings"` | `enabled: true`, `jsonData.apiUrl` set to the dot-ai tools REST base, `secureJsonFields.apiKey: true` | `enabled:false`, empty `apiUrl`, or `apiKey:false` — the app cannot answer anything |
| **B5** | `kubectl -n riley-monitoring exec deploy/kube-prometheus-stack-grafana -c grafana -- ls /var/lib/grafana/plugins/lesleymurfin-dotai-app/` | Contains `module.js`, `plugin.json`, `gpx_dot_ai_linux_amd64` | The backend binary is missing -> every `/resources/` call 404s |
| **B6** | Load `/a/lesleymurfin-dotai-app/` with devtools open | Zero console errors, no `ChunkLoadError`, no 404 under `/public/plugins/lesleymurfin-dotai-app/` | Any of those -> stop, fix the build, do not continue |
| **B7** | `curl -sS -u ... "$GRAFANA_URL/api/datasources"` and check types | One datasource each of type `loki`, `prometheus`, `tempo`, `alertmanager` | A type is missing or duplicated -> `getList({type})` picks the first match, so Current will silently read from the wrong instance |

## L1 Unit tests

Command: `npm run test:ci` (jest, `--passWithNoTests --maxWorkers 4`).

| ID | Target | Expected | Fail if |
|---|---|---|---|
| **U1** | `src/utils/progressiveContext.test.ts` — `buildRequestText` | Output is Stable + Current + Map + box, in that order; **History never appears**; Current capped at `MAX_CURRENT_CHARS` (1200), Map at `MAX_MAP_CHARS` (400) | Any history text leaks into the packed string, or a cap is not enforced |
| **U2** | `src/utils/grafanaStack.ts` — `parsePodNamespace`, `buildLogQL`, `buildPromQL` | Fixture A's question parses to pod `argocd-application-controller` + namespace `riley-gitops` and builds the Fixture A selector and PromQL; with no pod/ns hint both builders return `null` | A selector is unanchored or label-free (it would scrape the whole cluster), or regex metacharacters in a pod name are not escaped |
| **U3** | `src/utils/grafanaStack.ts` — frame extraction | `linesFromLokiFrames` caps at `LOG_LINE_CAP` (30) and de-duplicates; `factsFromPromFrames` caps at `PROM_SERIES_CAP` (8); `tracesFromTempoFrames` caps at `TEMPO_TRACE_CAP` (5); alerts cap at `ALERT_CAP` (8); window is `WINDOW_MS` (15m) | Any cap exceeded — an unbounded Current blows the `intent` size budget |
| **U4** | `src/utils/grafanaStack.test.ts` — discovery | Datasources are resolved via `getList({ type })` + `get(ref)`; the recorded calls contain **no** hardcoded uid and **no** `datasources/proxy` URL | Either string appears -> discovery regressed to hardcoding and the plugin breaks on any other Grafana |
| **U5** | `src/utils/grafanaStack.test.ts` — Current assembly | Current contains all four headers `Loki last 15m`, `Prometheus last 15m`, `Tempo last 15m`, `Alertmanager`, plus the payload from each mocked frame; Map names all four discovered datasources | A block is dropped when one source returns data and another does not |
| **U6** | `src/utils/grafanaStack.ts` — failure isolation | A throwing/absent datasource yields its literal note (`no log lines...`, `no metric samples...`, `no traces...`, `no alerts`, `Alertmanager datasource missing`) and the other three blocks still populate | One failing source empties Current or rejects the whole turn |
| **U7** | `src/pages/DotAIPage.test.tsx` — keyboard and threads | **Enter** submits; **Shift+Enter** inserts a newline and does *not* submit; empty/whitespace box keeps submit disabled; submit reads `Ask` / `Analyze` / `Running...`; during loading the select, textarea and submit are disabled; Query and Remediate keep independent Current/Map/History; **Clear thread** resets only the active tool; **Analyze this** copies Query Current into the Remediate box and leaves Query History intact | Enter inserts a newline, Shift+Enter submits, a request can be double-fired, or switching tools wipes a thread |
| **U8** | `src/utils/dotaiApi.test.ts` | `query` posts `{ intent }`; `remediate` posts `{ issue, intent }`; no `sessionId`, no visualization prefix, no execute/apply flag; a non-ok envelope surfaces `errorMessage` | Any execute-capable field is sent — this plugin is analysis-only |
| **U9** | Go backend, `pkg/plugin/resources_test.go` | `go test ./...` reports `ok`. Covers `/resources/query`, `/resources/remediate`, `/resources/version` proxying with `Authorization: Bearer`, plus the admin gate on test-connection | Any test fails, or a token reaches a response body or log line |

Go is not installed on this runner; container form:

```bash
docker run --rm -v "$PWD":/src -w /src golang:1.26 go test ./...
```

## L2 E2E (Playwright, mocked dot-ai)

```bash
export GRAFANA_URL=http://10.43.25.61          # k3s Grafana ClusterIP — NOT docker compose, NOT the ingress
export GRAFANA_ADMIN_USER=$(kubectl -n riley-monitoring get secret grafana-admin-credentials -o jsonpath='{.data.username}' | base64 -d)
export GRAFANA_ADMIN_PASSWORD=$(kubectl -n riley-monitoring get secret grafana-admin-credentials -o jsonpath='{.data.password}' | base64 -d)
npm run e2e -- --workers=1

# one spec only
npm run e2e -- --workers=1 tests/appNavigation.spec.ts
# report
npx playwright show-report
```

`--workers=1` is mandatory: these tests share one live Grafana and one plugin settings row.
`playwright.config.ts` takes `baseURL` from `GRAFANA_URL` and the `auth` project signs in with
`GRAFANA_ADMIN_USER` / `GRAFANA_ADMIN_PASSWORD`, storing the session in
`playwright/.auth/admin.json`. Docker compose (`npm run server`) is **not** used for this plan.

Two routes matter, and only two:

| What | Pattern |
|---|---|
| Grafana datasource query (Loki, Prometheus, Tempo, Alertmanager — all four) | `**/api/ds/query*` |
| dot-ai through the plugin backend | `**/api/plugins/lesleymurfin-dotai-app/resources/query` (and `/remediate`) |

> **Never let e2e mutate live config.** `tests/appConfig.spec.ts` already refuses to overwrite an
> `apiUrl` that looks live (`dot-ai`, `10.43.`, `.svc`, `cluster.local`). Any new spec that touches
> the config page must keep that guard. Clobbering `apiUrl` breaks the app for real users.

Existing coverage in `tests/appNavigation.spec.ts`: page renders, Tool options are Query and
Remediate, mocked query response, mocked remediate response with the `Analyze` label, error testid on
backend failure. The checks below extend it. Test ids come from `src/components/testIds.ts`
(`dotai-container`, `dotai-intent`, `dotai-submit`, `dotai-response`, `dotai-error`, `dotai-loading`,
`dotai-history`, `dotai-current`, `dotai-map`, `dotai-clear-thread`, `dotai-analyze-this`).

| ID | Step | Expected | Fail if |
|---|---|---|---|
| **E1** | `gotoPage('/')` | `dotai-container`, `dotai-intent`, `dotai-submit` visible; submit disabled while the box is empty | Anything missing -> the plugin did not mount |
| **E2** | Open the `Tool` combobox | Exactly two options: `Query` and `Remediate (analysis only)`. No datasource picker anywhere on the page | A third option, a datasource selector, or any execute/apply control |
| **E3** | Fill the box, press `Enter` | Exactly one POST to `.../resources/query`; `dotai-loading` then `dotai-response` | No request fired, or two requests fired |
| **E4** | Type `line one`, press `Shift+Enter`, type `line two` | The textarea value contains a newline; **no** request fires; submit stays enabled | A request fires on Shift+Enter |
| **E5** | Switch to Remediate | Field label becomes `Issue description`, the description says analysis-only, submit reads `Analyze`, and the POST goes to `.../resources/remediate` with `{issue,intent}` | Label, route, or body unchanged, or an execute affordance appears |
| **E6** | Assert the route after every interaction | URL stays `/a/lesleymurfin-dotai-app/`; no new tab, panel, or modal | Navigation to a new screen — violates "no new UI" |
| **E7** | Query turn, switch to Remediate, switch back | Query `dotai-history` still shows the earlier You/Answer pair (max 5 turns); the Remediate thread is independent | Either thread is wiped by switching |
| **E8** | After a successful query, click `dotai-analyze-this` | Tool switches to Remediate, the box is pre-filled with Query Current, Query History is intact, still analysis-only | The button is absent while Current is non-empty, or Query history is cleared |
| **E9** | Click `dotai-clear-thread` on Remediate | Only Remediate Current/Map/History/Response reset; the Query thread is intact | Both threads reset |
| **E10** | Route `**/api/ds/query*` to a canned multi-frame response carrying a unique marker per source, then Ask Fixture A and capture the `.../resources/query` request body | The `/api/ds/query` call fires **before** the dot-ai POST, and the POST body contains `Loki last 15m`, `Prometheus last 15m`, `Tempo last 15m`, `Alertmanager` **and** every source marker | The datasource call never fires, fires after the POST, or a marker is missing from the body — Current was decorative and dot-ai answered blind |
| **E11** | Same as E10, asserting `dotai-current` **while the request is in flight** (hold the dot-ai route open) | The four headers are visible on screen during loading | Current is empty during the turn. (Do **not** assert headers after the answer — `rewriteCurrent` replaces the block; see section 2) |
| **E12** | Route `**/api/ds/query*` to an empty frame set, then Ask Fixture C | Current carries `no log lines for this pod/namespace in the last 15m`, `no metric samples for this pod/namespace in the last 15m`, `no traces for this target in the last 15m`, `no alerts` — and the POST still happens | Current claims data it does not have, or the block is silently dropped |
| **E13** | Route `**/api/ds/query*` to HTTP 500, then Ask | The turn still completes; each block shows its failure note; `dotai-error` is not used for a datasource hiccup unless the whole turn failed | The page hangs on the spinner, or an unhandled rejection reaches the console |
| **E14** | Route `.../resources/query` to `{ok:false, ...}` | `dotai-error` alert visible carrying the upstream message | The failure is swallowed and the user sees a stale or blank response |
| **E15** | Remediate turn with `**/api/ds/query*` routed | **No** `/api/ds/query` call is made — the stack fetch is Query-only | Remediate silently queries datasources, changing the documented contract |

New live-data specs must `skip` (not fail) when the plugin or dot-ai is unreachable, matching the
existing convention.

## L3 Live datasource + dot-ai checks

No browser. These prove each leg independently, so a later UI failure can be attributed. Export the
environment block from section 1 first. These use the datasource **proxy** paths deliberately: the
plugin does not, but `curl` has no `getDataSourceSrv`, and proving the datasource itself holds data
is the point.

| ID | Step | Expected | Fail if |
|---|---|---|---|
| **D1** | Loki `query_range` through `/api/datasources/proxy/uid/P8E80F9AEF21F6940/loki/api/v1/query_range` for the Fixture A selector, last 15m, `limit=30` | At least one stream, 30 lines available | Zero -> pick another namespace using `topk(8, sum by (namespace) (count_over_time({namespace=~".+"}[15m])))` before blaming the plugin |
| **D2** | Prometheus instant query `count(up)` through `/api/datasources/proxy/uid/prometheus/api/v1/query`, then the Fixture A PromQL | `count(up)` is a number (was `74`); the Fixture A PromQL returns `argocd-application-controller-0` = `0` | Empty or null -> the Prometheus block in Current will be an honest empty note, and any metrics claim in the answer is unfounded |
| **D3** | `GET /api/datasources/proxy/uid/tempo/api/search?limit=3` with a 24h start/end | HTTP 200 and reachable. Currently zero traces — **expected** here (K5) | HTTP error or timeout -> the Tempo datasource is broken. Once traces exist, Current must quote real trace ids |
| **D4** | `GET /api/datasources/proxy/uid/alertmanager/api/v2/alerts`, count `status.state == "active"` | Greater than zero (was `124`) | Zero or an HTTP error -> the alerts leg cannot be proven this run; record it, do not fake it |
| **D5** | `POST http://10.43.31.212:3456/api/v1/tools/version` with `{}` | `2.0.0` or newer | Non-200 or timeout -> the dot-ai leg is down and L4 cannot pass |
| **D6** | `POST .../api/v1/tools/query` with `{"intent":"List the pods in namespace kube-system with their status."}` | A concrete cluster fact — pod name(s) plus status, about 5 s | The summary is advice-only ("check the logs", "you should investigate") with no resource name -> the dot-ai leg fails [X1](#x-combination-gate) on its own |
| **D7** | **Scope parity.** `POST .../tools/query` with `{"intent":"List all namespaces."}`, compared against `kubectl get ns` | The namespaces dot-ai names exist in the cluster the Grafana datasources observe | dot-ai lists only the 7 `core` vcluster namespaces (**current state, K2**) -> Grafana-side and dot-ai-side facts describe different clusters. Use Fixture B and record the mismatch; do not cross-reference Fixture A facts against dot-ai |
| **D8** | **Fact accuracy.** Ask dot-ai *"What is the exact name of the coredns pod in namespace kube-system?"*, then read ground truth from the host: `kubectl -n vc-core get pod -o jsonpath` of annotation `vcluster.loft.sh/object-name` | Exact string match | Any character differs. **Currently fails (K3):** dot-ai says `coredns-f78467f9f-4c77r`, ground truth is `coredns-f78467f9f-d7wjr`. A plausible-looking wrong name is a **fail**, not a pass |
| **D9** | `POST .../api/v1/tools/remediate` with `{"issue":"coredns in kube-system is restarting; analysis only","intent":"..."}` | `success: true` with an analysis summary, and nothing applied to the cluster | `success:false` with `EXECUTION_ERROR` (**current state, K4**) -> the Analyze leg is blocked upstream. The plugin correctly shows an error alert, but C7 cannot pass until dot-ai is fixed |

## L4 Live click path (human, ingress)

Open `https://grafana.internal.riley.team`, accept the internal-CA prompt once, sign in as an admin.
Keep devtools open on the Network tab, filtered to `query`. **Nothing here needs a screen that does
not already exist.**

| ID | Click path | Expected on screen | Fail if |
|---|---|---|---|
| **C1** | Sidebar -> **dot-ai** (or go to `/a/lesleymurfin-dotai-app/`) | The page renders: Tool select, question box, **Ask**, **Clear thread**. Console clean | Blank page, `ChunkLoadError`, or a 404 for `module.js` |
| **C2** | Network tab, filter `module.js` | A single `module.js`, HTTP 200, and **no** numbered chunk request | A `NNN.js` request appears (404 -> white screen) |
| **C3** | Type Fixture A's question, press **Shift+Enter** mid-sentence | The caret moves to a new line; nothing submits | The request fires |
| **C4** | Press **Enter**, and watch the page **while the spinner is up** | `Waiting for dot-ai...` spinner; **Current** shows `Loki last 15m (pod/argocd-application-controller ns/riley-gitops):` followed by real argocd log lines, then `Prometheus last 15m ...` with a restart fact, then `Tempo last 15m ...`, then `Alertmanager ...`; **Map** names the discovered Loki/Prometheus/Tempo/Alertmanager datasources plus `ns/riley-gitops`; then **Response** from dot-ai and a new **History** pair | Current is empty during the turn, or shows generic prose instead of the four blocks. In the Network tab, `POST /api/ds/query` must fire **before** `.../resources/query` |
| **C5** | Open the `.../resources/query` request in the Network tab and read the payload | The `intent` string contains the four block headers and the real log/metric content | The datasource content is missing from the body — dot-ai answered blind and the turn fails [X1](#x-combination-gate) |
| **C6** | Read the Response against [X1](#x-combination-gate) | The answer references something concrete from the packed context and/or a named cluster resource | The answer is only "check the logs" / "investigate further" with no Grafana data in Current and no cluster fact — **hard fail** |
| **C7** | Click **Analyze this** | Tool flips to **Remediate (analysis only)**, the issue box is pre-filled with Query Current, Query History survives a switch back, and no execute control exists | A new screen or route, an execute control, or a wiped Query thread |
| **C8** | Press **Enter** on the Remediate turn | Analysis text in Response, or a clear error alert while dot-ai remediate is failing (K4). **No** `/api/ds/query` call fires for Remediate. Nothing is applied to the cluster | The plugin claims a change was applied, or the error is silently swallowed |
| **C9** | Ask Fixture B (`show logs for pod coredns in namespace kube-system`) | Current holds real log lines **and** the answer names the coredns pod. Cross-check that name against D8 ground truth | The names disagree -> record as K3; the combination is not proven for that object |
| **C10** | Ask Fixture C (`... pod nonexistent-xyz in namespace riley-gitops`) | All four blocks show their honest empty notes (`no log lines for this pod/namespace in the last 15m` and friends) | Current invents lines, or the blocks disappear entirely |
| **C11** | On the C4 turn, read the **Prometheus** and **Alertmanager** blocks specifically | A real restart fact (e.g. `argocd-application-controller-0` ... `0`) and real alert names such as `KubeJobFailed` or `KubePodNotReady` | Those blocks are empty while the answer *talks about* metrics or alerts — fabrication, hard fail |
| **C12** | On the C4 turn, read the **Tempo** block | `no traces for this target in the last 15m` (K5) | Fabricated trace or span ids |
| **C13** | Click **Clear thread** | Only the active tool's Current/Map/History/Response clear | Both threads clear, or the page navigates away |

## X. Combination gate

<a id="x-combination-gate"></a>

Applies to **C4, C5, C6, C9, C11** — the turns meant to prove the whole stack.

A turn **passes** only when **both** hold:

1. **Grafana data is in Current** — real content under the `Loki last 15m`, `Prometheus last 15m`,
   `Tempo last 15m` or `Alertmanager` headers, or the literal honest empty note for that block —
   **and that content reaches the dot-ai POST body**; **and**
2. **dot-ai contributed a cluster fact** — a named resource, count, status, or event that is
   verifiable against `kubectl` or the Context Forge gateway.

A turn **fails** when the answer is generic guidance ("check the logs", "review the pod events",
"investigate the deployment") **with no Grafana data in Current and no cluster fact**. Fabrication —
any resource name, metric, alert, or trace id that does not survive a `kubectl` or datasource
cross-check — is also a fail, and is worse than an empty Current.

---

## 6. Run order and sign-off

```bash
# 0. environment
export GRAFANA_URL=http://10.43.25.61
export GRAFANA_ADMIN_USER=$(kubectl -n riley-monitoring get secret grafana-admin-credentials -o jsonpath='{.data.username}' | base64 -d)
export GRAFANA_ADMIN_PASSWORD=$(kubectl -n riley-monitoring get secret grafana-admin-credentials -o jsonpath='{.data.password}' | base64 -d)

# 1. build + unit
npm run build
npm run test:ci
go test ./...        # or: docker run --rm -v "$PWD":/src -w /src golang:1.26 go test ./...

# 2. deploy gate — B3: markers present, hardcoded uid absent
curl -sSk -o /tmp/m.js "$GRAFANA_URL/public/plugins/lesleymurfin-dotai-app/module.js"
for s in "Loki last 15m" "Prometheus last 15m" "Tempo last 15m" "Alertmanager" "getDataSourceSrv"; do
  printf '%-22s %s\n' "$s" "$(grep -c -F "$s" /tmp/m.js)"
done
grep -c -F P8E80F9AEF21F6940 /tmp/m.js   # must be 0 (grep exits 1 on zero matches; that is the PASS)

# 3. e2e against k3s Grafana
npm run e2e -- --workers=1

# 4. live legs: run D1 through D9

# 5. live click path: open https://grafana.internal.riley.team and walk C1 through C13
```

**Sign-off requires:** L0 all pass, L1 all pass, L2 all pass, L3 D1/D2/D4/D5/D6 pass (D3 may be
"reachable but empty"), L4 C1-C7 and C10-C13 pass, and **X1 satisfied on at least one Loki turn and
one non-Loki (Prometheus or Alertmanager) turn**.

Record the D7, D8 and D9 outcomes verbatim in the run report. While K2, K3 and K4 stand, the honest
verdict is *"Grafana leg proven end-to-end into the dot-ai request, dot-ai leg proven separately,
cross-cluster correlation blocked"* — not a green tick.

---

## 7. Measures

<a id="measures"></a>

Fail-closed scores read from the Ask log the backend already writes at
`/var/lib/grafana/dotai-ask.log` (NDJSON, one line per completed `query`/`remediate`; rotates to
`.1` at 1 MiB). **No new UI.** Fields: `time`, `tool`, `body` (packed intent/issue, **≤4096 runes**
with the last 1024 runes preserved verbatim, secrets stripped), `status`, `summary`, `error`.
`summary` and `error` stay capped at **512** runes — only `body` was raised.

**Packing note.** UI **Ask** packs Current into `intent` before POST. A raw API
`POST .../resources/query` (or direct curl to dot-ai) does **not** — those lines look like short
`body` with no `Loki last 15m` headers. Score UI turns and raw-API turns separately.

### Five measures

| # | Measure | Type | Read from | Value rule (fail-closed) |
|---|---|---|---|---|
| **M1** | `current_empty` | bool | ask-log `.body` | `true` when there is no `Current:` / no four headers, **or** every header’s first line is an honest empty note (`no log lines…`, `no metric samples…`, `no traces…`, `no alerts`, `…datasource missing`). A header cut by the 4096-rune body cap counts as **empty**. |
| **M2** | `first_hop` | `grafana`\|`dot-ai` | ask-log `.body` | `grafana` if `.body` carries ≥1 of `Loki last 15m` / `Prometheus last 15m` / `Tempo last 15m` / `Alertmanager`; else `dot-ai` (remediate + raw API). |
| **M3** | `hops` | int (cap 3) | ask-log line count in `[T0,T1]` | Count NDJSON lines whose `.time` falls in one serialized Golden Ask window. |
| **M4** | `latency_ms` | int | harness clock only | Log `time` is RFC3339 **seconds** — cannot measure latency. Use `curl -w '%{time_total}'` (L3) or `Date.now()` deltas (L2/L4). |
| **M5** | `used_current` | bool | `.body` Current × `.summary` | `true` when ≥1 evidence token (≥6 chars from the Current region, minus headers/empty-notes/stopwords) also appears in `.summary`. No Current → `false`. |

### Read the log

```bash
# pull (no credentials; log holds no secrets)
kubectl -n riley-monitoring exec deploy/kube-prometheus-stack-grafana -c grafana -- \
  cat /var/lib/grafana/dotai-ask.log > /tmp/dotai-ask.jsonl

# one JSON object per turn → /tmp/dotai-measures.jsonl
jq -c '
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
  | {time:$e.time, tool:$e.tool, status:$e.status,
     current_empty: (($h|length) == 0 or ([$first[] | isnote(.)] | all)),
     first_hop: (if ($h|length) > 0 then "grafana" else "dot-ai" end),
     truncated: (($e.body // "") | test("\u2026\\[\\+[0-9]+\\]\u2026")),
     used_current: ([$ev[] | select(. as $x | $st | any(startswith($x)))] | length > 0)}
' /tmp/dotai-ask.jsonl > /tmp/dotai-measures.jsonl

# hops in a window (T0/T1 = date -u +%Y-%m-%dT%H:%M:%SZ around one ask)
jq -c --arg t0 "$T0" --arg t1 "$T1" 'select(.time >= $t0 and .time <= $t1)' \
  /tmp/dotai-ask.jsonl | wc -l
```

### Fail-closed rules

1. Missing log file, unreadable line, or empty body → treat turn as `current_empty=true`,
   `first_hop=dot-ai`, `used_current=false`.
2. A truncated body carries the infix marker `…[+N]…` (head 3072 runes + elision + verbatim
   1024-rune tail — it does **not** end in a bare `…`). If a header falls in the elided middle and
   has no following line, that block is empty.
3. Do not score raw-API POSTs as UI Ask failures: short body without headers is expected there.
4. M5 never credits header text, empty-note vocabulary, or question echo (`pod/…`, `ns/…`) alone.
5. `hops > 3` or `status != 200` on a Golden Ask window is a hard fail for that window.

