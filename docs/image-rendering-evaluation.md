# Image rendering evaluation: grafana/grafana-image-renderer — NOT ADOPTED

Evaluated 2026-09-05.

## Question

Would the [Grafana Image Renderer](https://github.com/grafana/grafana-image-renderer) help
future dot-ai-grafana workstreams (PRDs #1–#5)?

## Verdict

**Not adopted.** On the five grounds below:

- **Scope** — none of PRD #1's in-scope milestones or PRD #2/#3/#4/#5's upstream successors need
  a rendered image; every surface either stays inside an authenticated Grafana session (a
  `/d/<uid>` link) or is explicitly text-only.
- **Direction** — PRD #1 is explicit that this contribution is text-response-only, with rich
  visualizations explicitly out of scope (`prds/1-grafana-ai-cluster-intelligence.md:62,252`).
- **Architecture** — the renderer is a separate backend service configured on the Grafana
  instance itself (`GF_RENDERING_SERVER_URL` / `GF_RENDERING_RENDERER_TOKEN`), not something a
  plugin can declare as a dependency; nothing in this repo's `docker-compose.yaml` or
  `src/plugin.json` wires it in, and none should be added.
- **Ownership** — deploying the renderer, if ever justified, is a platform/host decision beside
  the Grafana instance, made by whoever owns that Grafana deployment (self-managed per
  `prds/1-grafana-ai-cluster-intelligence.md:188`) — not a dot-ai-grafana plugin change.
- **Reachability** — no `grafana` and no `grafana-image-renderer` workload exists in any cluster
  reachable through the context-forge gateways; the Grafana this project targets is hosted
  outside them, so adopting the renderer would be an ops change on that external platform, not a
  change to this repository (see Environment findings below).

## What the renderer is

`grafana/grafana-image-renderer` (Apache-2.0, Go) is a backend service that renders Grafana
panels and dashboards to PNG, PDF, or CSV via headless Chromium. CSV export and Grafana Reports
are Enterprise/Cloud features. It ships as Docker images (linux/amd64, linux/arm64) or as Linux
and Windows binaries — no macOS binary, and the binaries do not bundle a browser; you must supply
Chromium yourself via `--browser.path`. Grafana talks to it over `[rendering] server_url` plus a
required secret `renderer_token` (env `GF_RENDERING_SERVER_URL` /
`GF_RENDERING_RENDERER_TOKEN`); the renderer itself authenticates render requests with
`--server.auth-token` / `AUTH_TOKEN` (the service requires a secret token on every render
request; `-` is simply the default token value) and exposes metrics
on `/metrics`. The historical distribution as a Grafana *plugin* is deprecated and no longer
updated — only the standalone service, and only its latest version, is supported. Grafana's own
`get_panel_image` MCP tool requires this service to be installed.

## Workstream-by-workstream check

| PRD | Workstream | Needs server-side rendering? | Reason | Citation |
|---|---|---|---|---|
| #1 | Grafana AI cluster intelligence (Query/Remediate plugin) | No | Explicitly text-response-only; rich visualizations are out of scope | `prds/1-grafana-ai-cluster-intelligence.md:62`, `:252` |
| #2 | GitOps-PR execute (superseded upstream by vfarcic#5) | No | Mechanism is opening a Git PR that a human merges; the plugin never runs `kubectl apply` and carries no image payload | [vfarcic/dot-ai-grafana#5](https://github.com/vfarcic/dot-ai-grafana/issues/5) |
| #3 | M7 Map/Explore/show-me/markdown, 0.2.x (superseded upstream by vfarcic#6) | No | Design sends the operator INTO a live, authenticated Grafana session via `/d/<uid>`, Explore panes, or Drilldown apps — never a static export; explicitly excludes inventory-style API calls, let alone rendering | [vfarcic/dot-ai-grafana#6](https://github.com/vfarcic/dot-ai-grafana/issues/6), [#23](https://github.com/LesleyMurfin/dot-ai-grafana/issues/23) |
| #4 | Evidence-grounded change safety (superseded upstream by vfarcic#7) | No | Pre-flight/blast-radius/post-merge evidence attaches to the engine's existing `operate` change-safety envelope as data, not images; open question is engine vs. plugin placement, not rendering | [vfarcic/dot-ai-grafana#7](https://github.com/vfarcic/dot-ai-grafana/issues/7) |
| #5 | Plugin usability / shipping polish (superseded upstream by vfarcic#8) | No | "Docs, screenshots, compatibility matrix" — the screenshots are human-authored README images (PRD #1 M8), not server-rendered dashboard exports | `prds/1-grafana-ai-cluster-intelligence.md:403`, `:579` (`src/plugin.json` `screenshots: []`) |

Also relevant: PRD #1's dashboard deep-link milestone (M7) pre-fills an intent from a panel
link's URL query param / template variable (`prds/1-grafana-ai-cluster-intelligence.md:400`) —
that is Grafana's native data-link mechanism, not a render. Phase 2/3 forward-roadmap milestones
(M10–M16, `:420`–`:422`, `:453`–`:456`) add shared-server wiring, a Headlamp role split, an
optional GitOps-PR surface, and core `mcp-grafana`/Kubeshark/predictive-signal evidence sources —
none of them add a rendering requirement, and M13–M15 are explicitly marked "Not this companion
repo."

## Why it cannot be a plugin dependency

Grafana-side configuration for the renderer lives in `grafana.ini` / environment
(`GF_RENDERING_SERVER_URL`, `GF_RENDERING_RENDERER_TOKEN`) — that is host/instance configuration
set by whoever runs Grafana, not something a plugin manifest or plugin backend can declare or
provision. This mirrors PRD #1's own architecture stance: the plugin targets **self-managed
Grafana only**, with Grafana Cloud explicitly not planned for this delivery track
(`prds/1-grafana-ai-cluster-intelligence.md:188`), and success is measured by installing cleanly
into an existing Grafana instance (`prds/1-grafana-ai-cluster-intelligence.md:316`) — not by
provisioning sidecar services alongside it. A plugin that required a renderer sidecar to function
would break that "installs cleanly" criterion for every adopter who hasn't separately stood one
up.

## Operational cost if ever adopted

Grafana's docs recommend at least 16 GiB memory and at least 4 CPU cores for the renderer, and
if a memory limit is set, `GOMEMLIMIT` should be set below it — roughly 1 GiB of `GOMEMLIMIT` per
8 GiB of container memory. That is a nontrivial, separately-scaled service, reinforcing that it
is a platform-owner's capacity decision, not something a plugin should implicitly require.

## Environment findings (context only — not a dot-ai-grafana work item)

These are riley_infrastructure's environment, not this repo's:

- On 2026-09-05 every Grafana MCP read through the context-forge gateway
  (`search_dashboards`, `list_datasources`, `search_folders`) returned HTTP 401 Unauthorized.
  Prior riley_infrastructure diagnosis (session "Grafana-MCP-Server", 2026-09-04) traced this to
  `Deployment/grafana-mcp` (namespace `riley-monitoring`, `grafana/mcp-grafana:0.11.3`) using a
  `Secret/grafana-mcp-token` tied to a Grafana service account orphaned since ~2026-06-14, and to
  `riley-vault-0` / `ClusterSecretStore vault-backend` being sealed-awaiting-unseal, which blocks
  rotating that secret. A planned fix pins `grafana/mcp-grafana:1.3.0` (floor 1.1.0) with a header
  deny-list condition covering `X-Grafana-Service-Account-Token`, `X-Grafana-API-Key`, and
  `X-Grafana-Org-Id`.
- Listing Deployments/Services through the `observability` and `management` context-forge
  gateways showed identical federated vcluster contents with no `grafana` and no
  `grafana-image-renderer` workload anywhere. Grafana is hosted outside the clusters these
  gateways expose — so deploying a renderer would be an ops task on that external host platform,
  never a change to this repo.

Neither finding changes the verdict above; they are recorded here only so a future reader
doesn't rediscover the same environment gap while re-evaluating this decision.

## What would reverse this decision

1. A workstream needs visual evidence delivered **outside** an authenticated Grafana session —
   for example a panel image embedded in a GitOps-PR body or a chat/email notification — where a
   `/d/<uid>` link isn't viewable by the recipient.
2. Upstream adds reporting, scheduled export, or PDF delivery to its roadmap.
3. An agent-side workflow is approved to attach real panel images as evidence **and** the Grafana
   MCP credential is restored, since `get_panel_image` requires the renderer.

In all three cases the renderer would be deployed beside the Grafana instance by its platform
owner — it would still not become a dependency of this plugin.

## Sources

- https://github.com/grafana/grafana-image-renderer
- `prds/1-grafana-ai-cluster-intelligence.md:62, :188, :252, :316, :400, :403, :420, :421, :422, :453, :454, :455, :456, :579`
- `src/plugin.json:34`
- `docker-compose.yaml` (single `grafana` service, no renderer sidecar)
- riley_infrastructure session "Grafana-MCP-Server" (2026-09-04)
