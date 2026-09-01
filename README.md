# dot-ai Grafana App Plugin

Grafana **App plugin with backend** for AI-powered Kubernetes cluster intelligence via [dot-ai](https://github.com/vfarcic/dot-ai) REST tools (`query`, analysis-only `remediate`).

- **Plugin ID:** `lesleymurfin-dotai-app`
- **Grafana floor:** `grafanaDependency: ">=11.0.0"` (reference host **11.4**)
- **Code home:** `LesleyMurfin/dot-ai-grafana` (this fork)

## Status (M4–M7 tools UI)

Admin configuration page: `jsonData.apiUrl` (MCP Server URL) + `secureJsonData.apiKey` (Auth Token) + **Test connection** (`POST /api/v1/tools/version` via backend resource). Tools UI (Query/Remediate selector, loading/errors) + backend proxies `POST /query` and `POST /remediate` to dot-ai tools REST with Bearer auth. Product UI is M4+.

## Develop

```bash
npm install
npm run build
# backend
mage -v build:linux   # or: mage -v
```

Optional local Grafana:

```bash
npm run server   # docker compose
```

## Install (unsigned / private)

- **Host:** k3s Grafana `kube-prometheus-stack-grafana` in the monitoring namespace (plugin id `lesleymurfin-dotai-app`).
- **Restart-safe:** Grafana `/var/lib/grafana` is PVC `kube-prometheus-stack-grafana` (longhorn 5Gi) — **not** emptyDir. Plugin dist under `plugins/lesleymurfin-dotai-app` and `grafana.db` survive pod delete/rollout.
- **Unsigned allow list** (must persist on the Deployment env / helm values):

```bash
GF_PLUGINS_ALLOW_LOADING_UNSIGNED_PLUGINS=lesleymurfin-dotai-app
```

- **GitOps SoT:** Application CR / Helm values for the Grafana stack (persist in your GitOps repo):
  - `grafana.persistence.enabled=true` (PVC / longhorn / 5Gi)
  - `grafana.env.GF_PLUGINS_ALLOW_LOADING_UNSIGNED_PLUGINS=lesleymurfin-dotai-app`
  - Live install may already be patched; keep the same keys in Helm values so a future sync does not regress.

- **Deploy/refresh plugin bits:**

```bash
npm run build && mage -v build:linux
POD=$(kubectl -n monitoring get pod -l app.kubernetes.io/name=grafana -o jsonpath='{.items[0].metadata.name}')
tar czf - -C dist . | kubectl -n monitoring exec -i "$POD" -c grafana -- sh -c 'mkdir -p /var/lib/grafana/plugins/lesleymurfin-dotai-app && cd /var/lib/grafana/plugins/lesleymurfin-dotai-app && tar xzf - && chown -R 472:472 .'
kubectl -n monitoring delete pod -l app.kubernetes.io/name=grafana
# prove: GET /api/plugins/lesleymurfin-dotai-app/settings → 200 after new pod Ready
```

- Configure **MCP Server URL** (`apiUrl`) + **Auth Token** (encrypted, no-`apply` / analysis-only). **Test connection** → dot-ai `POST /api/v1/tools/version`.

## Test

Unit (Go backend + frontend Jest) and Playwright e2e against **k3s Grafana** (not docker compose):

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

1. As Grafana Admin open **Administration → Plugins → dot-ai → Configuration** (or the Configuration nav item).
2. Set **MCP Server URL** to the dot-ai **tools REST** base (e.g. `http://dot-ai.dot-ai.svc:3456`). Do **not** point this at agentgateway or Context Forge.
3. Set **Auth Token** (encrypted) — use a **no-apply** token (analysis only).
4. Click **Test connection** (calls `POST /api/v1/tools/version` with `Authorization: Bearer`).
5. Save settings, then open the app page from the sidebar.

## Usage

1. Choose **Query** or **Remediate (analysis only)** from the tool dropdown (disabled while a request is in flight).
2. Enter a plain-language question or issue description (no special prefixes).
3. Submit and read the text response (`data.result.summary` when present). Remediate POSTs `{ issue }` (plus `intent` for proxy parity); analysis only — no execute.
4. Errors (auth, connectivity, upstream `EXECUTION_ERROR`) appear in an alert; loading shows a spinner.

## Architecture (Phase 1)

- Frontend app page → Grafana plugin resource API → Go backend → dot-ai `:3456` tools REST.
- Secrets never leave Grafana encrypted store to the browser after save.
- Remediate is **analysis only** — no execute UI.

## Screenshots

Add screenshots after a signed/private install on Grafana 11.4+ (M9).

## Compatibility

- **Floor:** `grafanaDependency: ">=11.0.0"`
- **Reference pins:** `@grafana/data|ui|runtime|schema@11.4.0` (must-pass host **11.4**)
- **Also target:** current Grafana 13.x via CI `plugin-e2e` matrix when runners available
