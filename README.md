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
