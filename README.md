# DevOps AI Toolkit Grafana Plugin

AI-powered Kubernetes cluster intelligence inside [Grafana](https://grafana.com) — powered by [DevOps AI Toolkit](https://devopstoolkit.ai).

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

This plugin installs into **a Grafana you already run**. It is deliberately not
part of the [dot-ai-stack](https://github.com/vfarcic/dot-ai-stack) umbrella
chart: that chart deploys the dot-ai MCP server, controller and UI, and does not
deploy Grafana, so there is nothing there for a Grafana plugin to install into.
Point this plugin at your dot-ai MCP server via [Configuration](#configuration).

### From a release

Download the `devopstoolkit-dotai-app-<version>.zip` from the
[latest release](https://github.com/vfarcic/dot-ai-grafana/releases), verify it
against the published `.sha256`, and unzip it into Grafana's plugin directory.

Releases are **unsigned**, so Grafana must be told to load it:

```bash
GF_PLUGINS_ALLOW_LOADING_UNSIGNED_PLUGINS=devopstoolkit-dotai-app
```

### From source

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

## Releasing

Tag the version and the [release workflow](.github/workflows/release.yml) does
the rest — it syncs `package.json` from the tag (so `plugin.json` reports the
right version), assembles `changelog.d/` fragments into `CHANGELOG.md` with
towncrier, and attaches the plugin zip plus its SHA256 to the GitHub release:

```bash
git tag v0.2.0 && git push origin v0.2.0
```

Every user-visible change should land with a fragment in `changelog.d/`, named
`<issue>.<type>.md` where type is one of `feature`, `bugfix`, `breaking`,
`doc`, `misc`. CI renders them on every PR, so a malformed fragment fails there
rather than at release time.

## Configuration

As Grafana Admin: **Administration → Plugins → dot-ai → Configuration**.

| Setting | Description |
|---|---|
| MCP Server URL | Absolute `http(s)` base for the dot-ai tools REST API (example: `http://dot-ai.dot-ai.svc:3456`) |
| Auth Token | Bearer token stored in Grafana encrypted settings (`Authorization: Bearer`) |
| Test connection | `POST /api/v1/tools/version` through the plugin backend |

Do not point `apiUrl` at agentgateway or Context Forge — only the dot-ai tools REST base.

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
