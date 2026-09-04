# DevOps AI Toolkit Grafana Plugin

AI-powered Kubernetes cluster intelligence inside [Grafana](https://grafana.com) — powered by [DevOps AI Toolkit](https://devopstoolkit.ai).

- **Plugin ID:** `devopstoolkit-dotai-app`
- **Grafana floor:** `grafanaDependency: ">=11.0.0"` (reference host **11.4**)
- **Code home:** `LesleyMurfin/dot-ai-grafana` (this fork)

## Status

Admin configuration page: `jsonData.apiUrl` (MCP Server URL) + `secureJsonData.apiKey` (Auth Token) + **Test connection** (`POST /api/v1/tools/version` via backend resource). Tools UI (Query/Remediate selector, shared input/response layout, loading lock, single error alert) is wired to the Go backend proxies `POST /query` and `POST /remediate`, which forward to dot-ai tools REST with Bearer auth. Query packs the Grafana stack into **Current** and may iterate up to 3 dot-ai hops per Ask; Remediate is a single analysis-only hop.

Companion to the [Headlamp plugin](https://github.com/vfarcic/dot-ai-headlamp): Grafana is for diagnosis (query + analysis-only remediate). Headlamp is for operate / execute.

## What It Does

- **Query** — Ask questions about your cluster in plain English. Responses are text (`data.result.summary`).
- **Remediate (analysis only)** — Get AI-powered issue analysis. No execute, apply, or mutation UI.

## Requirements

- Grafana >= 11.0 (reference host **11.4**; `@grafana/*` libraries pinned to 11.4.0)
- [DevOps AI Toolkit](https://devopstoolkit.ai) MCP server reachable from the Grafana plugin backend
- Unsigned load until the plugin is signed:

```bash
GF_PLUGINS_ALLOW_LOADING_UNSIGNED_PLUGINS=devopstoolkit-dotai-app
```

## Installation

```bash
npm install
npm run build
mage -v build:linux
```

Copy `dist/` into Grafana's plugin directory as `devopstoolkit-dotai-app`, then restart Grafana.

Local Grafana (create-plugin docker):

```bash
npm run server
```

## Install (unsigned / private)

- **Host:** k3s Grafana `kube-prometheus-stack-grafana` in your monitoring namespace — the examples below use `NS=monitoring` (plugin id `devopstoolkit-dotai-app`).
- **Restart-safe:** Grafana `/var/lib/grafana` is PVC `kube-prometheus-stack-grafana` (longhorn 5Gi) — **not** emptyDir. Plugin dist under `plugins/devopstoolkit-dotai-app` and `grafana.db` survive pod delete/rollout.
- **Unsigned allow list** (must persist on the Deployment env / helm values):

```bash
GF_PLUGINS_ALLOW_LOADING_UNSIGNED_PLUGINS=devopstoolkit-dotai-app
```

- **GitOps SoT:** Application CR / Helm values for the Grafana stack (persist in your GitOps repo):
  - `grafana.persistence.enabled=true` (PVC / longhorn / 5Gi)
  - `grafana.env.GF_PLUGINS_ALLOW_LOADING_UNSIGNED_PLUGINS=devopstoolkit-dotai-app`
  - Live install may already be patched; keep the same keys in Helm values so a future sync does not regress.

- **Deploy/refresh plugin bits:**

```bash
npm run build && mage -v build:linux
NS=monitoring   # your Grafana namespace
POD=$(kubectl -n "$NS" get pod -l app.kubernetes.io/name=grafana -o jsonpath='{.items[0].metadata.name}')
tar czf - -C dist . | kubectl -n "$NS" exec -i "$POD" -c grafana -- sh -c 'mkdir -p /var/lib/grafana/plugins/devopstoolkit-dotai-app && cd /var/lib/grafana/plugins/devopstoolkit-dotai-app && tar xzf - && chown -R 472:472 .'
kubectl -n "$NS" delete pod -l app.kubernetes.io/name=grafana
# prove: GET /api/plugins/devopstoolkit-dotai-app/settings → 200 after new pod Ready
```

- Configure **MCP Server URL** (`apiUrl`) + **Auth Token** (encrypted, no-`apply` / analysis-only). **Test connection** → dot-ai `POST /api/v1/tools/version`.

## Test

Unit (Go backend + frontend Jest) and Playwright e2e against Grafana cover plugin load and Ask/Analyze. Full combination proof against a live Loki/Prometheus/Tempo/Alertmanager stack is an operator checklist outside this repo. Ask quality is scored fail-closed from the backend Ask log at `/var/lib/grafana/dotai-ask.log` with fields `current_empty`, `first_hop`, `hops`, `latency_ms`, `used_current`.

```bash
# Go unit tests
go test ./...

# Frontend unit tests (CI)
npm run test:ci

# Browser against your cluster Grafana UI (HTTPS ingress / port-forward as appropriate).
# Playwright e2e can use the Grafana ClusterIP plain HTTP when reachable from the runner:
export GRAFANA_URL=http://127.0.0.1:3000
export GRAFANA_ADMIN_USER=admin
# export GRAFANA_ADMIN_PASSWORD=...   # from k8s secret; do not commit
npm run e2e -- --workers=1
# equivalent: GRAFANA_URL=http://127.0.0.1:3000 npx playwright test --workers=1 --retries=0
```

Live Query/Remediate specs skip cleanly if the plugin or MCP is unreachable. Config e2e never overwrites a live `apiUrl` (cluster/`dot-ai` URL) with a fake host — do not clobber live MCP `apiUrl`.

## Product PRDs

Upstream / fork PRD text lives under `prds/`.
## Configuration

As Grafana Admin: **Administration → Plugins → dot-ai → Configuration**.

| Setting | Description |
|---|---|
| MCP Server URL | Absolute `http(s)` base for the dot-ai tools REST API (example: `http://dot-ai.dot-ai.svc:3456`) |
| Auth Token | Bearer token stored in Grafana encrypted settings (`Authorization: Bearer`) |
| Test connection | `POST /api/v1/tools/version` through the plugin backend |

Do not point `apiUrl` at agentgateway or Context Forge — only the dot-ai tools REST base.

## Usage

1. Choose **Query** or **Remediate (analysis only)** from the tool dropdown (disabled while a request is in flight).
2. Enter a plain-language question or issue description (no special prefixes, no `sessionId`). **Enter** submits (Ask/Analyze); **Shift+Enter** inserts a newline.
3. Submit and read the text response (`data.result.summary` when present). Remediate POSTs `{ issue }` (plus `intent` for proxy parity); analysis only — no execute.
4. **Progressive context + Ask loop** (client-side only — see `docs/progressive-context.md`):
   - On **Query / Ask**, before calling dot-ai the plugin discovers Grafana datasources with `getDataSourceSrv().getList({ type })` + `get(ref)` + `DataSourceApi.query` for **Loki, Prometheus, Tempo, Alertmanager** (no hardcoded uids, no proxy URL client, no picker UI). Capped DataFrame text goes into **Current**; **Map** lists the four sources + pod/ns hints. Missing DS → one-line note.
   - **Stable** + **Current** + **Map** + the input box (question) are packed into the next plain-text `intent`/`issue` for **dot-ai** (K3s + Grafana together).
   - Cluster-wide questions (no pod/namespace named) still read Loki and Prometheus — the stack leg is never skipped just because the question parses no target.
   - One user click may spend up to **3** dot-ai POSTs (`MAX_ASK_HOPS` in `src/utils/askOrchestrator.ts`): hop 1 answers from the packed Current, and hop 2/3 only fire when the question is unscoped ("all clusters") or the answer contradicts evidence already in Current. Grafana datasource reads are **not** hops. Each hop is one line in the Ask log (`current_empty`, `first_hop`, `hops`, `latency_ms`, `used_current`).
   - **History** (You/answer) is on screen only — last 5 turns — and is **not** sent in the POST body.
   - After each successful answer, **Current** is rewritten (size-capped); each tool keeps its own thread (switch does not wipe).
   - **Analyze this** (after a Query success) copies **Current** into the Remediate issue box and switches tools; Query History stays. Still analysis-only.
   - **Clear thread** resets the active tool’s Current/Map/History only.
5. Errors (auth, connectivity, upstream `EXECUTION_ERROR`) appear in an alert; loading shows a spinner.

## Timeouts

Grafana plugin resource calls are limited by the plugin host. This plugin uses the Grafana SDK HTTP client with a **120s** ceiling for query/remediate (15s for version/health). That is shorter than Headlamp's 30-minute AI tool timeout because Grafana does not expose an equivalent long-poll proxy. v1 does **not** implement async `202` + job poll; if a call hits 120s, retry or narrow the question.

## How It Works

Browser → Grafana plugin resource API → Go backend (`grafana-plugin-sdk-go` `httpclient`) → dot-ai `:3456` tools REST (`/api/v1/tools/query`, `/api/v1/tools/remediate`, `/api/v1/tools/version`).

Remediate bodies are allowlisted to analysis-only fields (`issue` / `intent`). Auth for this Grafana path is `Authorization: Bearer` (not `X-Dot-AI-Authorization`, which is the Headlamp Kubernetes API proxy header).

The published OpenAPI document for dot-ai includes execute/operate/recommend. This plugin does **not** generate a client from that full schema — that would pull mutation tools into an analysis-only Grafana app. Outbound HTTP uses the Grafana plugin SDK `httpclient` for the three read paths above.

## Related Projects

- [AI Engine](https://devopstoolkit.ai/docs/ai-engine) — MCP server this plugin connects to
- [Headlamp plugin](https://github.com/vfarcic/dot-ai-headlamp) — operate / execute companion
- [Web UI](https://devopstoolkit.ai/docs/ui) · [CLI](https://devopstoolkit.ai/docs/cli) · [Controller](https://devopstoolkit.ai/docs/controller)
