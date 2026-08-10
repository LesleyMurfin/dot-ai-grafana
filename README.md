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

1. Build frontend + backend binaries and place the plugin directory where Grafana loads plugins.
2. Allow unsigned load (required until signed/catalog):

```ini
# grafana.ini
[plugins]
allow_loading_unsigned_plugins = lesleymurfin-dotai-app
```

Or env:

```bash
GF_PLUGINS_ALLOW_LOADING_UNSIGNED_PLUGINS=lesleymurfin-dotai-app
```

3. Open **Configuration**: set **MCP Server URL** (`apiUrl`) and **Auth Token** (encrypted). Click **Test connection** (calls dot-ai `POST /api/v1/tools/version` with `Authorization: Bearer`).
4. Use a **no-`apply`** token (analysis-only). Save settings before relying on plugin health.

## Product PRDs

Upstream / fork PRD text lives under `prds/`.


## Configuration

1. As Grafana Admin open **Administration → Plugins → dot-ai → Configuration** (or the Configuration nav item).
2. Set **MCP Server URL** to the dot-ai **tools REST** base (e.g. `http://dot-ai.riley-ai-ops.svc:3456`). Do **not** point this at agentgateway or Context Forge.
3. Set **Auth Token** (encrypted) — use a **no-apply** token (analysis only).
4. Click **Test connection** (calls `POST /api/v1/tools/version` with `Authorization: Bearer`).
5. Save settings, then open the app page from the sidebar.

## Usage

1. Choose **Query** or **Remediate (analysis only)** from the tool dropdown.
2. Enter a plain-language question or issue description (no special prefixes).
3. Submit and read the text response (`data.result.summary` when present).
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
