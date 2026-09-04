---
sidebar_position: 1
---

# DevOps AI Toolkit Grafana Plugin

**AI-powered Kubernetes cluster intelligence inside Grafana — query and analysis-only remediate with natural language.**

This page describes the plugin after the ready-to-merge access-control and Prior-packing changes land; it is not a snapshot of today's `main` alone.

---

## What is the Grafana Plugin?

The [DevOps AI Toolkit](https://devopstoolkit.ai) Grafana Plugin brings AI-powered cluster diagnosis into [Grafana](https://grafana.com). It is the diagnosis half of the pair: Grafana owns **query** and **analysis-only remediate**; the [Headlamp plugin](https://devopstoolkit.ai/docs/headlamp) owns operate / execute.

The Grafana plugin backend talks to the [dot-ai MCP server](https://devopstoolkit.ai/docs/ai-engine) tools REST API over `Authorization: Bearer` (not the Headlamp `X-Dot-AI-Authorization` Kubernetes-proxy header). The Auth Token is one shared engine credential stored in Grafana encrypted settings. **Grafana org Editor or Admin** may invoke Query and Remediate; **Admin** configures the plugin and runs Test connection. Scope the token analysis-only (no apply).

## Features

### Query

Ask natural language questions about your cluster. Responses are text summaries.

On Query, the page reads configured Loki, Prometheus, Tempo, and Alertmanager datasources via Grafana's datasource service (no hardcoded UIDs) and packs **Current** + **Map** into the same `{intent}` string. The on-screen **History** panel keeps the last 5 turns in full for display. A condensed **Prior:** block (referents over prose, soft-capped around 240 characters) is packed into that intent when the 1000-character budget still has room after Stable/Current/Map/Question; under pressure the packer sheds Map first, then shrinks Prior, then may drop Prior entirely before the hard cap — so Prior is not guaranteed on a busy cluster. There is no chat `sessionId`. One Ask may issue up to 3 dot-ai POSTs (for example an unscoped question or an answer that conflicts with Current).

While an Ask is in flight, **Cancel** aborts it. Failures show an error Alert with distinct titles (timed out, authentication failed, permission denied, not found, unreachable, cancelled); **Retry** re-runs the same intent text. When **Send Grafana evidence** is on, an info Alert notes that datasource facts go to your configured dot-ai server.

[Query tool documentation](https://devopstoolkit.ai/docs/ai-engine/tools/query)

### Remediate (analysis only)

Get AI-powered issue analysis. Remediate is one hop and reuses Query Current. Request bodies are allowlisted to analysis-only fields (`issue` / `intent`). There is no execute, apply, or mutation UI. An **Analysis only** info banner states that Remediate never executes changes (use the Headlamp plugin for operate/execute). Cancel, Retry, and the same error titles apply as on Query.

[Remediate tool documentation](https://devopstoolkit.ai/docs/ai-engine/tools/remediate)

## Quick Start

### Prerequisites

- [Grafana](https://grafana.com) >= 11.0 (reference host **11.4**)
- A reachable [dot-ai MCP server](https://devopstoolkit.ai/docs/ai-engine/setup/deployment) (tools REST, typically port 3456)

### Install

This plugin installs into **a Grafana you already run**. It is deliberately not part of the [dot-ai-stack](https://github.com/vfarcic/dot-ai-stack) umbrella chart: that chart deploys the dot-ai MCP server, controller, and UI, and does not deploy Grafana.

The plugin is **unsigned** and is **not** distributed via grafana.com. Grafana must be told to load it:

```bash
GF_PLUGINS_ALLOW_LOADING_UNSIGNED_PLUGINS=devopstoolkit-dotai-app
```

**From a release**

1. Download the `devopstoolkit-dotai-app-<version>.zip` from the [latest release](https://github.com/vfarcic/dot-ai-grafana/releases).
2. Verify it against the published `.sha256`.
3. Unzip it into Grafana's plugin directory.
4. Set `GF_PLUGINS_ALLOW_LOADING_UNSIGNED_PLUGINS=devopstoolkit-dotai-app` and restart Grafana.

**From source**

```bash
npm install
npm run build
mage -v build:linux
```

Copy `dist/` into Grafana's plugin directory as `devopstoolkit-dotai-app`, set the unsigned-load env var above, then restart Grafana.

### Configure

As Grafana Admin: **Administration → Plugins → dot-ai → Configuration**.

| Setting | Default | Description |
|---------|---------|-------------|
| MCP Server URL | _(empty)_ | Absolute `http(s)` base for the dot-ai tools REST API. HTTPS required except loopback / RFC1918 / in-cluster `*.svc` / `*.cluster.local` (example: `http://dot-ai.dot-ai.svc:3456`). Public `http` is rejected. Do not point this at agentgateway or Context Forge — only the dot-ai tools REST base. |
| Auth Token | _(empty)_ | Shared Bearer credential stored in Grafana encrypted settings (`Authorization: Bearer`). Outbound Query and Remediate use this single engine token; **Editor or Admin** may invoke those routes (403 before any upstream dial for Viewer/empty/unknown). Scope the token to analysis-only (no apply). |
| Debug Log | Off | Enable/disable JSONL ask log at `/var/lib/grafana/dotai-ask.log`. JSONL may include packed Current (Loki/Prom lines). No Grafana tokens. |
| Show context | On | Show Current, Map, and History on the page. Display toggle only; independent of Send Grafana evidence. Intent packing (Current/Map/Prior) still runs when this is off. |
| Send Grafana evidence | On | When on, Asks pack Loki/Prometheus/Tempo/Alertmanager facts and the page shows a consent info Alert. Missing/undefined = send. Independent of Show context. |
| Test connection | — | Admin-only. Probes `POST /api/v1/tools/version` through the plugin backend |

**Access model.** Grafana **Admin** opens **Administration → Plugins → dot-ai → Configuration** and runs **Test connection**. **Editor or above** may call Query and Remediate; the backend refuses other roles with 403 before dialing the engine. The Auth Token remains one shared credential for the plugin instance — role gates who may use it, not which per-user token is sent.

## How It Works

```text
  Ask ── Remediate: pack Query Current + issue ── 1x POST /remediate
    │
    └── Query
          Read Loki/Prom/Tempo/AM  →  Current + Map + condensed Prior (budget-dependent)
          classifyFirstHop:
            alerts/logs/metrics/traces/"top issues"/default → grafana
            list/show namespaces|pods|…                   → dot-ai
          hop 1: POST /query  intent=Stable+Current+Prior?+Map+question
          hop 2: unscoped → across   OR   answer denies Current → conflict
          hop 3: still hedges → hedge     (cap 3)
          Go strips hop meta, writes ask log, Bearer to dot-ai
          dot-ai query toolLoop (kubectl/MCP) returns summary
```

```text
Browser
  └── Grafana plugin resource API
        └── Go backend (Grafana plugin SDK HTTP client)
              └── dot-ai :3456 tools REST
                    (/api/v1/tools/query, /remediate, /version)
```

Remediate bodies are allowlisted to analysis-only fields (`issue` / `intent`). Auth for this Grafana path is `Authorization: Bearer` (not `X-Dot-AI-Authorization`, which is the Headlamp Kubernetes API proxy header).

Query and remediate calls use a **120s** ceiling; version/health probes use **15s**. That is shorter than Headlamp's long AI tool window because Grafana does not expose an equivalent long-poll proxy. The plugin does **not** implement async `202` + job poll; if a call hits 120s, retry or narrow the question.

## Compatibility

| Grafana | Support |
|---------|---------|
| >= 11.0 | Minimum supported |
| 11.4 | Reference host (`@grafana/*` libraries pinned here) |
| Later majors | Exercised via the project's dynamic CI e2e Grafana image matrix; local docker default is currently **13.1.0** |

## Releasing

Release process, changelog assembly, and fragment naming live in the repository [README Releasing section](https://github.com/vfarcic/dot-ai-grafana/blob/main/README.md#releasing). User-visible changes land as `changelog.d/<issue>.<type>.md` fragments (`feature`, `bugfix`, `breaking`, `doc`, `misc`); this page does not duplicate that process.

## Support

- **GitHub Issues**: [Bug reports and feature requests](https://github.com/vfarcic/dot-ai-grafana/issues)

## Related Projects

- **[AI Engine](https://devopstoolkit.ai/docs/ai-engine)** — DevOps AI Toolkit MCP server this plugin connects to
- **[Headlamp plugin](https://devopstoolkit.ai/docs/headlamp)** — operate / execute companion
- **[Web UI](https://devopstoolkit.ai/docs/ui)** — Standalone web UI (alternative frontend)
- **[CLI](https://devopstoolkit.ai/docs/cli)** — CLI for terminal-based interaction
- **[Controller](https://devopstoolkit.ai/docs/controller)** — Kubernetes controller for autonomous operations

---

**DevOps AI Toolkit Grafana Plugin** — AI-powered Kubernetes diagnosis inside Grafana.
