# dot-ai Grafana App Plugin

Grafana **App plugin with backend** for AI-powered Kubernetes cluster intelligence via [dot-ai](https://github.com/vfarcic/dot-ai) REST tools (`query`, analysis-only `remediate`).

- **Plugin ID:** `lesleymurfin-dotai-app`
- **Grafana floor:** `grafanaDependency: ">=11.0.0"` (reference host **11.4**)
- **Code home:** `LesleyMurfin/dot-ai-grafana` (this fork)

## Status (M1 scaffold)

Frontend scaffold + Go backend stubs for `/query`, `/remediate`, `/health`. Not wired to a live dot-ai API yet (M3).

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

3. Configure plugin settings (M2): `apiUrl` (dot-ai REST base) + secure token (`Authorization: Bearer`).
4. Use a **no-`apply`** token (analysis-only).

## Product PRDs

Upstream / fork PRD text lives under `prds/`.
