# PRD: Grafana App Plugin for AI-Powered Kubernetes Cluster Intelligence

**Issue**: [#1](https://github.com/vfarcic/dot-ai-grafana/issues/1)
**Priority**: High
**Status**: In Progress
**Updated**: 2026-09-01T17:00:31-0600

> **How this revision is organized:** This is **PRD #1 as written on `main`**, with build-ready detail layered directly on top of it. Under every `##` heading you will find the **original section text first** (unchanged — same words, same bullets, same milestones), then one or more `### Expansion:` blocks. Expansions are **additive only**. Strip every Expansion block (and the reviewer appendices) and you get the original PRD back byte-for-byte. We are not rewriting the PRD; we are building on it.

## Problem Statement

Teams using Grafana for Kubernetes observability must context-switch to separate tools when they want to:
- Ask natural language questions about their cluster resources (e.g., "show all failing pods in production")
- Get AI-powered analysis of cluster issues (e.g., "why is my-app crashing?")

This breaks workflow, adds friction, and creates a gap between observing a problem in Grafana and understanding it through AI-powered analysis.

### Expansion: Competitive landscape & differentiation

Grafana ships fast-moving, first-party AI, so this plugin must earn its place rather than duplicate it.

**What Grafana already does (2026):**
- **Grafana Assistant** — agentic LLM in the UI: NL over metrics/logs/traces, dashboard generation, and **Assistant Investigations (GA)** (points at an alert, explores signals, builds hypotheses, writes a report). **Availability caveat (verified):** self-managed requires **Grafana v13+** *and* a connected Grafana Cloud stack (pre-installed in Enterprise 13.1+); **not available on self-managed v11/v12**.
- **Sift** — automatic ML Kubernetes diagnostics (crashes, resource contention) over cluster signals.
- Viktor's own demo ([*"I Stopped Staring at Dashboards"*](https://www.youtube.com/watch?v=HI6KleJAZPY), 2026-05-25) walks through exactly this, and names the key limit: Grafana Assistant **"does only analysis … it cannot fix it — analysis without remediation is pointless."**

| Capability | Grafana Assistant / Sift | dot-ai plugin |
|---|---|---|
| NL query + AI analysis of **telemetry** in the UI | ✅ native, GA | ⚠️ overlaps — do not compete here |
| Reasons over **live K8s API state** (resources, capabilities, health) | ✗ telemetry-centric | ✅ **wedge 1** |
| **Remediation** — GitOps PR / kubectl fix, RBAC-gated | ✗ "cannot fix it" | ✅ **wedge 2** (strongest; PRD #1-out-of-scope today — see DD9) |
| Deploy / recommend manifests | ✗ | ✅ |
| **Sovereign** — in-cluster, your own LLM, no Grafana Cloud | ⚠️ Cloud-backed | ✅ **wedge 3** |

**Honest read.** The "redundant with Grafana Assistant" risk is **real only for Grafana Cloud users or self-managed v13+ shops willing to tether to Grafana Cloud**. For self-managed **v11/v12** (the reference deployment is Grafana **11.4**), air-gapped, or sovereignty-minded teams, Assistant is simply unavailable — so dot-ai in Grafana is the *only* way to get AI cluster intelligence in the UI, and the overlap largely evaporates. Even so, as *scoped* (analysis-only) this plugin captures wedges **1 (K8s-state)** and **3 (sovereign)** but omits **2 (remediation)** — dot-ai's biggest differentiator — and it overlaps `dot-ai-headlamp`, which already delivers the full dot-ai experience in a cluster UI. Net: **clearly worth building for self-managed / sovereign / pre-13 Grafana users** (which includes the reference deployment); for Grafana-Cloud/v13+ users the case rests on wedges 1/2. Positioning call: Design Decision 9 / Open Question 6.

_Sources: video `HI6KleJAZPY`; Grafana Assistant Investigations (GA) + Sift, and the self-managed **v13+ / Grafana-Cloud-required** constraint (Grafana docs, 2026); dot-ai remediate GitOps PR path (`docs/ai-engine/tools/remediate`)._

**OSS reality — Grafana gives you a socket, not a brain.** Grafana **OSS** ships no built-in
assistant; what it ships is *plumbing*: the **LLM app plugin** (a secure connector to
OpenAI/Azure OpenAI) and the **`mcp-grafana` MCP server** (grants an external AI access to your
Grafana instance). Both are building blocks whose explicit purpose is *bring your own intelligence*.
So on a self-managed OSS stack the real choice is not "dot-ai vs. Grafana Assistant" — Assistant
isn't available — it is "build an assistant yourself on the LLM plugin, or plug in an external
brain through the MCP server Grafana already provides." **dot-ai is that brain**, and the two were
built to snap together: Phase 3 evidence work (mcp-grafana + Kubeshark) consumes that socket
exactly as intended. Even a DIY assistant built on the OSS plumbing would still hit the same
ceiling as Cloud — *observe/explain within Grafana*, with **no live-K8s-state grounding, no
execute path, and no second (Headlamp) surface** — the three things dot-ai adds.

## Solution Overview

A Grafana App Plugin that combines **this K3s cluster**, **this Grafana observability stack**, and **dot-ai** in one Ask — Grafana is not only the host UI shell.

Two read-only dot-ai tools, same page:

1. **Query** — Natural language questions about Kubernetes cluster resources
2. **Remediate (Analysis Only)** — AI-powered issue analysis without execution capability

**Map** is the existing Grafana datasources already configured on this instance: **Loki, Prometheus, Tempo, and Alertmanager**. The plugin reads them through Grafana’s runtime (`getDataSourceSrv` / `ds.query` / `getBackendSrv`) — no new datasource picker, no new screens, no parallel observability UI.

**UI surface stays the existing thread:** Tool selector, intent/issue box, Ask, Analyze this, Current (sent), History (display-only). Stack context is packed into **Current**, then shipped as plain-text `intent` / `issue` on the same POST shapes. No rich visualizations — text responses only.

### Expansion: Tool → endpoint map

| Tool | Endpoint | Method | Request body | Notes |
|------|----------|--------|--------------|-------|
| Query | `/api/v1/tools/query` | POST | `{ "intent": "<text>" }` | Single-shot; `intent` 1–1000 chars. Send the **plain** intent — **do not** prefix `[visualization]` (that switches the tool into rich-visualization mode). |
| Remediate | `/api/v1/tools/remediate` | POST | `{ "issue": "<text>", "mode": "manual" }` | Analysis; execute round-trip (`sessionId`+`executeChoice`) not used. |
| System status | `/api/v1/tools/version` | POST | `{}` | Powers Test-connection **and** the always-visible cluster context: `data.result.system.kubernetes.{connected,context}`. |

Both tool calls are instances of dot-ai's universal `POST /api/v1/tools/{toolName}` endpoint; one dot-ai server serves MCP, CLI, and REST simultaneously — **no server configuration beyond a token is required.**

### Expansion: Response contract and presentation layer

dot-ai wraps every REST response in a standard envelope:

```jsonc
{
  "success": true,
  "data": { "result": { /* tool-specific */ }, "tool": "query", "executionTime": 1234 },
  "error": { "code": "…", "message": "…", "details": {} }, // only when success=false
  "meta": { "timestamp": "…", "requestId": "…", "version": "…" }
}
```

dot-ai's tools are built for an *LLM agent*, so `data.result` carries **structured JSON plus agent-oriented fields** (`agentInstructions`, `sessionId`), not a prose string. The plugin extracts the human-readable content per tool (confirmed against source and against how `dot-ai-headlamp` unwraps `data.result`):

| Tool | Render as text | Ignore in the text-only UI |
|------|----------------|-----------------------------|
| `query` | **`data.result.summary`** (`QueryOutput.summary`, `src/tools/query.ts` L54) | `agentInstructions`, `sessionId`, `visualizationUrl`, `iterations`, `toolsUsed` |
| `remediate` | `message`, `analysis.rootCause`, `analysis.confidence`, `analysis.factors[]`, `remediation.summary`, `remediation.actions[]` (`command`/`rationale`/`risk`), `guidance` | `executionChoices`, `nextAction`, `sessionId`, `visualizationUrl`, `agentInstructions` |
| `version` | `system.kubernetes.context` (shown as the active-cluster label) | everything else |

A **"Show raw response" toggle** always exposes the full `data.result` payload — a safety net if a field mapping drifts across dot-ai versions.

### Expansion: Auth header

dot-ai's auth middleware (`src/interfaces/oauth/middleware.ts` L38–39) reads **`X-Dot-AI-Authorization` first, then `Authorization` as fallback** — so a direct caller may use either. Our Go backend calls dot-ai directly and sends `Authorization: Bearer <token>`. `dot-ai-headlamp` uses the custom `X-Dot-AI-Authorization` header because it proxies through the K8s API server, which consumes `Authorization`; we send the custom header **only** when the deployment is configured to route through such a proxy (not both unconditionally).

### Expansion: Prior art — dot-ai-headlamp

Viktor's existing dot-ai UI plugin already answers our hardest questions with production choices we adopt:
- **Transport**: reaches dot-ai via Headlamp's **K8s API proxy** (`ApiProxy.request`). Grafana has no equivalent proxy → our Go-backend + `apiUrl` + token is the correct Grafana-native equivalent.
- **Timeout**: `AI_TOOL_TIMEOUT = 30 min` for all AI tools; `DEFAULT_TIMEOUT = 30 s` otherwise — AI calls are long (see [Timeout & long-call strategy](#expansion-timeout--long-call-strategy)).
- **Auth**: `X-Dot-AI-Authorization: Bearer <token>` (see above).
- **Presentation**: unwraps `data.result` (`src/api/client.ts` L89).
- **Read-only vs not**: Headlamp is *not* read-only (`executeRemediation`, `operate`, `recommend`). Our Grafana v1 is a deliberate read-only narrowing.
- **Resource context**: Headlamp invokes remediate **from a resource detail page** — the resource-scoped context we approximate via [dashboard→intent deep-linking](#technical-scope).

### Expansion: Prior art — GitHub project-setup

dot-ai already has a **first-class GitHub surface** — not a future idea for this PRD:

**[Project Setup](https://devopstoolkit.ai/docs/ai-engine/tools/project-setup)** (`project-setup` tool) audits a repository and generates governance / GitHub automation files (LICENSE, CODE_OF_CONDUCT, CONTRIBUTING, issue/PR templates, OpenSSF Scorecard workflow, Renovate, labeler, stale bot, …). Interactive scope selection + template-based generation; does **not** require Kubernetes or an LLM for generation. Related: PR templates feed the **`prd-done`** prompt workflow for intelligent PR creation ([prompts](https://devopstoolkit.ai/docs/ai-engine/tools/prompts#available-prompts)).

| Surface | Host | Job | Status vs this PRD |
|---|---|---|---|
| **GitHub — project-setup** | GitHub repo (files + Actions) | Bootstrap / audit **repo governance & automation** | **Shipped** (server tool) — recognize, do not reimplement |
| **Headlamp — `dot-ai-headlamp`** | Kubernetes UI | Resource-centric **operate** (incl. execute) | **Shipped** — Phase 2 is dual-surface *wiring*, not rebuild |
| **Grafana — this plugin** | Observability UI | Dashboard-centric **diagnose / watch** (analysis-only) | **This contribution (Phase 1)** |
| **Remediate → GitOps PR** | Git (via remediate execute) | Cluster fix as a **reviewable PR** (RBAC-gated) | Server capability; **not** the same as project-setup; optional Grafana surface in Phase 2 M12 |

**Do not conflate:** `project-setup` = *repository* standards and GitHub workflow files. Remediate's GitOps-PR path = *cluster* change proposed as a PR. Both touch GitHub; different jobs, different tools. This Grafana plugin is a third **UI** doorway (observability), complementary to Headlamp (cluster UI) and project-setup (GitHub/repo), all on the same toolkit.

### Expansion: Companion-project model

This repo / PRD is a **companion UI**, not a second product brain — the same split Viktor uses for
[`dot-ai-headlamp`](https://github.com/vfarcic/dot-ai-headlamp) (`prds/1-headlamp-plugin.md` →
"Companion Projects: **dot-ai** — MCP server providing the REST API this plugin consumes").

| Question | Lives in | Example |
|---|---|---|
| **New capability / contract / intelligence** | **`vfarcic/dot-ai`** (core PRD first) | New tool or MCP, remediate loop change, RBAC verb, OpenAPI field, KB ingest rules |
| **How it appears in a host UI** | **Companion repo PRD** (this one, or headlamp) | Page, settings, host auth glue, presentation, timeouts for *that* host |
| **Privileged / platform install** | **Deploy docs + (where live infra) MOP** — not a UI PRD | Kubeshark tap, longhorn, NetworkPolicy |

**Rule (fail-closed):** if the work changes *what the AI can do or what the server promises*, open or extend a **dot-ai** PRD and only then teach the companion UIs to call it. Companions may request a **tiny, host-agnostic** server hook when the host cannot work otherwise (Headlamp's precedent: `X-Dot-AI-Authorization` support on the server). They must **not** reimplement tools, invent parallel evidence pipelines, or own K8s browsing that the host already has.

**Companion projects (ecosystem map)**

| Project | Role |
|---|---|
| **[dot-ai](https://github.com/vfarcic/dot-ai)** | AI engine — tools, REST/MCP, RBAC, remediate, knowledge, project-setup, … |
| **[dot-ai-headlamp](https://github.com/vfarcic/dot-ai-headlamp)** | Companion UI — Headlamp (shipped; full tools incl. execute) |
| **[dot-ai-ui](https://github.com/vfarcic/dot-ai-ui)** | Companion UI — standalone web (alternative frontend) |
| **dot-ai-grafana** (this) | Companion UI — Grafana (proposed; analysis-only v1) |
| **CLI / MCP clients** | Other consumers of the same engine |

```
  NEW CAPABILITY / CONTRACT          ──►  vfarcic/dot-ai  (core PRD)
           │
           │ REST / MCP only
           ▼
  ┌────────┴────────┬──────────────┬─────────────┐
  Headlamp          Grafana        Web UI / CLI  …   (companion PRDs = host glue only)
```

<a id="prior-core-mcp-auth"></a>

#### Prior core contribution — outbound MCP auth (vfarcic/dot-ai#414 → vfarcic/dot-ai#416 → vfarcic/dot-ai#417)

We already shipped the **engine-side plug** for authenticated external MCPs on `vfarcic/dot-ai`:

| Step | Artifact | Role |
|---|---|---|
| PRD | [vfarcic/dot-ai#414](https://github.com/vfarcic/dot-ai/issues/414) | Capability: outbound MCP client auth |
| Design | [vfarcic/dot-ai#416](https://github.com/vfarcic/dot-ai/pull/416) | Design-doc PR |
| Implement | **[vfarcic/dot-ai#417](https://github.com/vfarcic/dot-ai/pull/417)** (merged 2026-04-01) | Static Bearer, custom headers, OAuth client_credentials, Helm `existingSecret` |

That is **not** Kubeshark/PCAP and **not** this Grafana UI — it is what makes Phase 3–style evidence MCPs *attachable* (secured `mcp-grafana`, a future Kubeshark MCP, etc.) without inventing auth plumbing again. This companion PRD reuses the same PRD-first discipline; any later packet/evidence capability should open a **new core PRD** on `dot-ai` (after maintainer signal or a thin spike), not grow a client inside this plugin.

### Expansion: Server impact

**This plugin requires no change to the dot-ai server, and no dot-ai user who doesn't install it sees any change.** It is a pure REST client of endpoints that already exist (PRD [vfarcic/dot-ai#354](https://github.com/vfarcic/dot-ai/issues/354)): no new endpoints, schemas, or config-model changes. Only runtime prerequisites: the REST gateway is reachable from Grafana (on by default) and an auth token exists. The recommended read-only token (no `apply`) uses dot-ai's existing RBAC (PRD [vfarcic/dot-ai#392](https://github.com/vfarcic/dot-ai/issues/392)) — a scoped credential, not a server change.

### Expansion: Design Decisions

1. **Query presentation field — RESOLVED.** query's human-readable answer is `data.result.summary` (`src/tools/query.ts` L54); send the plain intent (not `[visualization]`, which switches modes — `query.ts` L210). Keep a "Show raw response" toggle. M0 only confirms envelope unwrapping across the deployed dot-ai version.
2. **Timeout & long-call strategy.** Query is short (seconds) → a blocking POST is fine. Remediate is a multi-iteration loop up to ~30 min (`dot-ai-headlamp` `AI_TOOL_TIMEOUT`); Grafana's own guidance treats minutes-long blocking resource calls as unstable. **Leaning: async `202 + jobId` + `/status/{jobId}` poll as the *default* for remediate** — minimal, in-memory, single-instance jobs with a TTL; the UI Cancel abandons the poll; poll on a fixed interval with terminal-state handling. Blocking-with-a-tuned-[Timeout chain](#expansion-timeout--long-call-strategy) is the fallback only where the operator fully controls every hop. **M0 measures the real Grafana resource-call deadline and picks**; this is [Open Question 5](#open-questions). SSE (`/api/v1/events/remediations`, PRD [vfarcic/dot-ai#425](https://github.com/vfarcic/dot-ai/issues/425)) is the post-v1 streaming upgrade.
3. **Read-only enforcement (two layers).** **(a)** client never sends `executeChoice`/`sessionId`; the backend **fails closed** with a request-field allowlist so a crafted request can't reach an execution path; **(b)** the dot-ai token's RBAC lacks the `apply` verb (PRD [vfarcic/dot-ai#392](https://github.com/vfarcic/dot-ai/issues/392)), so remediate returns analysis + `fallbackReason` and offers no `executionChoices` **server-side** (`remediate.ts` L1606/L1625). **Both.** (b) is authoritative and requires dot-ai RBAC enabled — verified in M0.
4. **Identity model.** **Leaning:** single shared service token for v1 (dot-ai RBAC applies at token level; audit logs cannot attribute to individual Grafana users — accepted v1 risk). Per-user OAuth/Dex forwarding is a future enhancement (out of scope).
5. **Plugin identity & home — RESOLVED (2026-09-03).** Canonical Grafana plugin id is `devopstoolkit-dotai-app`; author **DevOps Toolkit**; Go module `github.com/vfarcic/dot-ai-grafana`. Evidence: upstream PR [#3](https://github.com/vfarcic/dot-ai-grafana/pull/3) body, reviewed head `feat/upstream-plugin` @ `0d33a35` `src/plugin.json:5`, `upstream/main` `src/plugin.json`, and `pkg/main.go:19` `app.Manage("devopstoolkit-dotai-app", …)`. Fork development may live under `LesleyMurfin/dot-ai-grafana`, but the **id does not change** for the contribution — a divergent `lesleymurfin-dotai-app` slug broke unsigned allow-lists and deep links and is retired.
6. **Grafana version floor & reference deployment (11.4).** The reference deployment is **Grafana 11.4 self-managed** (the adopter's production; current Grafana is 13.1). The real compatibility lever is the **`@grafana/{data,ui,runtime}` library versions**, not just `grafanaDependency`: `@grafana/create-plugin` now scaffolds against ~13.x libs, which can break at runtime on 11.4. **Leaning:** pin `@grafana/*` to the latest line whose minimum supported Grafana ≤ 11.4, set `grafanaDependency: >=11.0`, and make CI **build+smoke on 11.4 (must-pass) and a current release (13.x)**. Supporting 10.x/9.x is untested burden for versions neither the adopter nor "current" runs — offer only if the maintainer wants a broad range. (Deviation from PRD #1's `9.x+`; see Scope.)
7. **Distribution.** **Leaning:** unsigned/private first — which **requires** operator allow-listing (`allow_loading_unsigned_plugins` in `grafana.ini` / `GF_PLUGINS_ALLOW_LOADING_UNSIGNED_PLUGINS=<id>`); document it in the install guide. Grafana catalog (signing + review) later.
8. **Auth header.** Send `Authorization: Bearer`; `X-Dot-AI-Authorization` only for proxy-consuming deployments (see [Auth header](#expansion-auth-header)).
9. **Strategic positioning vs Grafana Assistant (read-only scope).** Grafana Assistant + Sift now cover NL analysis of telemetry natively, so this plugin must lead with dot-ai's wedge — **K8s API state, remediation, sovereignty** (see [Competitive landscape](#expansion-competitive-landscape--differentiation)). **Leaning:** v1 honors PRD #1's read-only scope and differentiates on **K8s-state + sovereign self-hosting** (not a telemetry-chat clone); **remediation** (GitOps PR) is the strongest differentiator but is out of PRD #1 scope — flagged as the highest-value expansion and the central go/no-go ([Open Question 6](#open-questions)). If neither wedge is compelling for the target users, the honest call is **not** to ship a standalone plugin and instead expose dot-ai via a Grafana Assistant Skill / the Grafana MCP.
10. **Deployment target: self-managed Grafana only for this contribution.** **Leaning:** design, CI, and install docs target **self-managed Grafana** (reference **11.4**; matrix includes a current 13.x). **Grafana Cloud is explicitly not planned** for this PRD's delivery track — see [Deployment targets](#expansion-deployment-targets-self-managed-vs-grafana-cloud). Cloud may still matter to other adopters (including the maintainer); it is left as an optional follow-on for whoever finds value, not a Phase 1/2/3 commitment here.
11. **Companion vs core ownership.** **Leaning:** this PRD follows the Headlamp companion pattern — UI/host only; capabilities land in **dot-ai** first. Applies especially to **Kubeshark / evidence** (Phase 3): see [Where Kubeshark connectivity lives](#where-kubeshark-connectivity-lives).

## User Journey

1. User is viewing dashboards in Grafana and notices an anomaly
2. User navigates to the dot-ai plugin page (accessible from Grafana sidebar)
3. User selects "Query" or "Remediate" from the tool dropdown
4. User types their question/intent in natural language
5. User submits and sees the AI-generated text response
6. User can ask follow-up questions or switch tools

### Expansion: UX states & firefighting controls

1. Operator sees an anomaly on a dashboard; opens the dot-ai page (sidebar) — or follows a **panel data-link** that pre-fills the intent (see Scope).
2. Selects Query or Remediate; the active **cluster/context is always displayed** (from `version → system.kubernetes.context`) so the answer's scope is unambiguous.
3. Types intent (live 1000-char counter); submits.
4. **In-flight**: spinner + **elapsed-time counter** + staged copy ("Investigating cluster state… up to a few minutes"); a **Cancel** button aborts (AbortController / abandons the async poll) and re-enables the form.
5. **Success**: plain-text answer; **Copy** on the whole response and per recommended `command`; a "Show raw response" toggle.
6. **Error**: specific `Alert` (unreachable / 401 / 403 / 404 / timeout / tool error) with a one-click **Retry** that preserves the intent.
7. Ask a follow-up (single-shot — the prior answer stays visible while composing the next).

## Technical Scope

### Architecture

- **Grafana App Plugin** with a custom page (React + TypeScript) — plugin id `devopstoolkit-dotai-app`
- **This cluster + this stack + dot-ai:** one Ask fuses K3s intelligence (via dot-ai) with live reads from Grafana’s already-wired Loki, Prometheus, Tempo, and Alertmanager datasources
- **Grafana stack → Current → dot-ai:** plugin gathers stack signals through `getDataSourceSrv` / `ds.query` / `getBackendSrv`, packs them into the client-side **Current** block, then POSTs query/remediate to dot-ai with that block in plain `intent` / `issue`
- **Backend plugin component** (Go) proxies those POSTs to the dot-ai MCP server with authentication
- Leverages Grafana’s built-in auth, RBAC, and datasource credentials — no separate observability auth path and no new DS configuration UI

### MCP Server Integration

The plugin calls two dot-ai MCP server REST endpoints:

| Tool | Endpoint | Method | Purpose |
|------|----------|--------|---------|
| Query | `/api/v1/tools/query` | POST | Natural language cluster queries |
| Remediate | `/api/v1/tools/remediate` | POST | Issue analysis (read-only) |

### Plugin Configuration

Grafana admin configures via plugin settings:
- **MCP Server URL** — dot-ai MCP server endpoint
- **Auth Token** — Authentication token for the MCP server

Observability wiring is **not** re-configured here: Loki, Prometheus, Tempo, and Alertmanager come from Grafana’s existing datasources.

### UI Components

Same minimal surface (no new screens or pickers):
- **Tool selector dropdown** — Switch between Query and Remediate
- **Intent / issue box** — Natural language input with context-aware placeholder
- **Ask** — Submit Current-packed intent/issue to dot-ai
- **Analyze this** — Copies Current → Remediate box
- **Current** — Client-built context block (includes Grafana stack reads); **sent** on Ask
- **History** — Display-only (last N turns); not sent as a session protocol
- **Response area** — Scrollable text display for the agent's response
- **Loading indicator** — While waiting for response
- **Error display** — Connection errors, auth failures, datasource read failures

### What's Explicitly Out of Scope

- Rich visualizations (Mermaid diagrams, cards, code blocks with syntax highlighting)
- Action execution (remediation execution, operate, recommend)
- GitOps-PR remediate execute (post-v1) — see `prds/2-gitops-pr-remediate.md` (PRD #2); not scoped here
- Multi-stage workflows or wizards
- **New UI for resource or datasource selection** — no new screens, no custom DS picker, no dashboard-resource browser; use Grafana’s existing Loki / Prometheus / Tempo / Alertmanager wiring only (and any selector Grafana already shows natively)
- **MCP / server session management** (no `sessionId`, no server conversation store, no multi-turn protocol fields). A **display-only** on-screen History and a client-rewritten **Current** block packed into the next plain-text `intent`/`issue` are in scope for progressive context — they are **not** MCP session management. See Decisions and `docs/progressive-context.md`.

### Expansion: Architecture — implementation detail

**dot-ai — existing, consumed as-is**: `src/interfaces/routes/index.ts` (`POST /api/v1/tools/:toolName`, PRD [vfarcic/dot-ai#354](https://github.com/vfarcic/dot-ai/issues/354)); `schema/openapi.json` + `GET /api/v1/openapi` (client generation source); `src/tools/query.ts` (input `{intent}`; answer `summary`); `src/tools/remediate.ts` (`mode:"manual"` analysis; `apply` RBAC gate L1582–1633); `src/interfaces/oauth/middleware.ts` (auth header precedence); `docs/ai-engine/api/rest-api.md` (envelope, bearer auth, status codes; `version` → `system.kubernetes.context`).

**Grafana plugin — new (mirrors `examples/app-with-backend`, built on `grafana-plugin-sdk-go`)**: `src/plugin.json` (`type:app`, `backend:true`; `includes` a page with `addToNav:true`+`defaultNav:true` + a `role:Admin` Configuration entry; `grafanaDependency` floor); `src/module.tsx` (`setRootPage(DotAiPage).addConfigPage(...)`); `src/components/AppConfig/AppConfig.tsx` (`jsonData.apiUrl` + `secureJsonData.apiKey`; Test-connection); `src/pages/DotAiPage.tsx` (`<PluginPage>`; `getBackendSrv().post('/api/plugins/<id>/resources/<tool>')`); `pkg/plugin/app.go` (`httpadapter.New(mux)`; `httpclient.New(...)` for outbound calls; `CheckHealth` → dot-ai `POST /api/v1/tools/version`, invoked by the frontend via `GET /api/plugins/<id>/health`; token via `httpadapter.PluginConfigFromContext(ctx).AppInstanceSettings.DecryptedSecureJSONData["apiKey"]`); `pkg/plugin/resources.go` (`registerRoutes`: `handleQuery`, `handleRemediate`, `handleHealth`, `handleStatus`); generated OpenAPI client package (from `schema/openapi.json`).

```
  Grafana browser (React)                  Grafana server                         dot-ai server (existing)
  +---------------------------+            +--------------------------------+     +---------------------------+
  | Config page               |  save      | Plugin Go backend              |     | REST gateway              |
  |  apiUrl · token · Test    | ---------> |  grafana-plugin-sdk-go         |     |  POST /api/v1/tools/:tool |
  |  connection               |  settings  |  /query /remediate /health     |     |            |              |
  +---------------------------+            |  /status/{jobId}               |     |            v              |
  |                           |            |  httpclient + OpenAPI client   |     | tool RBAC (apply verb)    |
  | dot-ai page               |  getBackendSrv POST                         |     |            |              |
  |  tool · intent · response | ---------> |  fail-fast · redaction         | HTTPS|            v              |
  |  cluster-context          |            |               |                | Bearer| query · remediate loop  |
  |  cancel / retry / copy    |            |               +--------------->| ----> | · version               |
  +---------------------------+            +--------------------------------+     +------------|--------------+
                                                                                              |
                                                                                              v
                                                                                   Kubernetes + AI provider
```

### Expansion: Timeout & long-call strategy

A `getBackendSrv().post(...resources...)` call crosses: browser fetch → Grafana HTTP server → gRPC to the plugin process → plugin `httpclient` → dot-ai. A plugin-set timeout governs only the **last** hop, and Grafana's resource-call gRPC/HTTP deadlines (plus any ingress `proxy_read_timeout`) cap the rest — a plugin timeout alone cannot override them. Because remediate can run minutes, the **default is the async `202`+`/status/{jobId}` poll** (Design Decision 2): the backend runs the dot-ai call in a job (in-memory, single-instance, TTL-bounded), returns `202 + jobId` immediately, and the frontend polls. A **blocking** path (with a fully-tuned chain: browser fetch, ingress, `grafana.ini`, `httpclient`) is offered only where the operator controls every hop and accepts the ceiling. M0 measures the real deadline and confirms which is default.

### Expansion: Deployment targets (self-managed vs Grafana Cloud)

(self-managed vs Grafana Cloud)

| Host | This contribution | Notes |
|---|---|---|
| **Self-managed Grafana** (OSS/Enterprise on k8s/VM; reference **11.4**) | **In scope** — primary design, CI matrix, install guide | Operator controls plugin install (incl. unsigned allow-list), backend process, and network path to dot-ai (in-cluster or HTTPS). |
| **Grafana Cloud** | **Out of scope / not planned here** | Called out so others can evaluate value; **not** a delivery commitment for this PRD. |

**Why call Cloud out at all.** Some adopters (and the maintainer) may care about Cloud-hosted Grafana. The plugin *conceptually* only needs: (1) ability to run an app+backend plugin on that Grafana, (2) a **Cloud-reachable HTTPS** `apiUrl` for the customer's dot-ai (private in-cluster URLs won't work from Cloud without an edge), and (3) catalog/signing or whatever install path Cloud allows. None of that is free: Cloud install policies for private/backend plugins, egress, SSRF defaults (this design fail-closes on non-HTTPS and many private ranges unless allowlisted), and product overlap with **Grafana Assistant** (native on Cloud) all need a deliberate owner.

**Intent for this contribution.** We design and ship for **self-managed**. We do **not** plan Cloud packaging, Cloud CI, or Cloud install docs. If the maintainer or another contributor later finds Cloud worth it, treat it as a **separate follow-on** (likely after catalog signing + a documented public/edge HTTPS path to dot-ai) — not a blocker for Phase 1.

### Expansion: Non-Functional Requirements

- **Latency / long calls**: async default (above); calls may run minutes. Cancelable; progress surfaced.
- **Fail-fast on misconfiguration** (K8s-native): an unreachable/invalid `apiUrl`, missing token, or non-2xx `version` health check surfaces a **clear error** (Test-connection + explicit error states) — never a silently-degraded "looks fine but returns nothing." Matches dot-ai's own fail-fast posture.
- **Security**:
  - Token only in `secureJsonData`; backend-only read; never logged; `Authorization` redacted and **upstream dot-ai error bodies sanitized** before surfacing to the browser. Custom auth header sent only when configured — never both unconditionally.
  - **Egress/SSRF**: `apiUrl` **must** be `https://` (reject `http://`) and the backend **must** block link-local/metadata (`169.254.169.254`), loopback, and RFC1918 targets unless an operator explicitly allowlists them (fail-closed). Admin-only config lowers but doesn't remove the risk in multi-tenant Grafana.
  - **Read-only**: enforced server-side via a no-`apply` RBAC token *and* a backend fail-closed request-field allowlist (Design Decision 3).
  - **Prompt/command injection**: free-text `intent`/`issue` reaches an LLM with read-only cluster tools; the token's read scope bounds the blast radius, and remediate's suggested `command`s are advisory/untrusted (a human runs them). Least-privilege token; rotation; per-Grafana-org isolation.
  - **Identity**: single shared token → no per-user attribution in dot-ai audit logs (accepted v1 risk).
- **Observability**: backend logs request id, tool, status, duration (no secrets).
- **Compatibility**: pin `@grafana/*` libs (to support 11.4) + `grafanaDependency: >=11.0`; CI build+smoke on **11.4 (reference deployment, must-pass) and a current release (13.x)**.
- **Accessibility**: labelled controls; announced response; keyboard submit.

## Success Criteria

- Plugin installs cleanly into Grafana (9.x+/10.x/11.x)
- Users can submit natural language queries and receive text responses
- Users can submit issue descriptions and receive analysis text
- Configuration via Grafana plugin settings works (MCP URL + auth token)
- Response times are comparable to direct MCP server calls (< 500ms overhead from plugin)
- Plugin follows Grafana UI conventions and feels native

### Expansion: Additional success criteria

- Active cluster/context always visible (from `version → system.kubernetes.context`)
- Remediate `command`s copyable; no execution path presented
- Long remediate completes via async poll (or tuned blocking) or is cancelable
- Live e2e against real Grafana (**11.4** reference + current 13.x) and live dot-ai; no-`apply` token blocks execution
- Misconfiguration fails fast; specific errors with Retry
- *(NFR)* plugin proxy < 500 ms overhead vs direct call (excluding model think time)

**Note on version floor:** original success criteria list 9.x+/10.x/11.x; this revision proposes `>=11.0` with **11.4** must-pass (see Open Questions / deliberate deltas).

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Grafana plugin API changes across versions | Plugin breaks on upgrade | Target Grafana 10.x+ with stable APIs, test across versions |
| MCP server authentication complexity | Users can't configure plugin | Clear setup docs, connection test button in settings |
| Go backend proxy adds latency | Slow responses | Minimal proxy logic, streaming if Grafana supports it |
| Plugin review process (if publishing to marketplace) | Delayed availability | Start with unsigned/private distribution, publish later |

### Expansion: Additional risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| `@grafana/*` lib drift vs 11.4 host | Runtime break on reference deploy | Pin libs for 11.4; CI matrix 11.4 + 13.x |
| Long remediate vs Grafana resource-call deadlines | Spurious timeouts | Async `202`+poll default; M0 measures deadline |
| Scope creep (Kubeshark client in this repo) | Wrong ownership | Companion model; core `dot-ai` PRD for evidence tools |

## Dependencies

- dot-ai MCP server running and accessible from Grafana instance
- MCP server exposes `/api/v1/tools/query` and `/api/v1/tools/remediate` endpoints
- Grafana 10.x or later (for stable app plugin APIs)
- `@grafana/create-plugin` toolchain for scaffolding

### Expansion: Additional dependencies

- `POST /api/v1/tools/version` and `GET /api/v1/openapi` (health / client generation)
- Auth token with read + analyze, **no** `apply` for analysis-only ([vfarcic/dot-ai#392](https://github.com/vfarcic/dot-ai/issues/392))
- `grafana-plugin-sdk-go` (`httpadapter`, `httpclient`)
- Design template: [`vfarcic/dot-ai-headlamp`](https://github.com/vfarcic/dot-ai-headlamp)
- Outbound MCP auth already in core ([vfarcic/dot-ai#417](https://github.com/vfarcic/dot-ai/pull/417)) for future evidence MCPs

**Note:** this revision proposes floor **≥ 11.0** (reference 11.4) vs original "10.x or later" — open question for maintainer.

## Milestones

> **SSOT for milestone completion.** Progress (below) is evidence only and must not be read as a second checklist.

- [x] **Plugin scaffolding and build pipeline** — Grafana app plugin project created with `@grafana/create-plugin`, builds successfully, loads in Grafana dev environment
- [x] **Plugin configuration page** — Admin can configure MCP server URL and auth token via Grafana plugin settings, with connection test
- [x] **Backend proxy (Go)** — Backend plugin component proxies requests to MCP server with configured auth, handles errors gracefully
- [x] **Query tool UI** — Users can type natural language queries, submit, and see text responses from the MCP server
- [x] **Remediate analysis UI** — Users can describe issues, submit, and see AI-powered analysis text (no execution)
- [x] **Tool selector and shared layout** — Dropdown to switch between Query and Remediate, shared input/response layout, context-aware placeholders
- [x] **Error handling and loading states** — Connection errors, auth failures, timeouts displayed clearly; loading spinner during requests
- [~] **Documentation and installation guide** — README with setup instructions, configuration guide, and screenshots
- [~] **Grafana version compatibility testing** — Verified working on Grafana 10.x and 11.x

### Expansion: Phase 1 detail (M0–M9 mapping to the checklist above)

A thin, SDK-native, **analysis-only** Grafana App plugin. Captures wedges **1 (live K8s-state)**
and **3 (sovereign / self-hosted)** — the two that matter on self-managed **v11/v12** where
Grafana Assistant is unavailable. Built in five independently-reviewable stages:

**Stage 1a — Foundation**
- [~] **M0 — Validation spike.** Against a live dot-ai: confirm `data.result.summary` unwrapping and remediate analysis fields; confirm `version → system.kubernetes.{connected,context}`; confirm a **no-`apply` token** yields analysis + `fallbackReason`; confirm the auth header; **measure the Grafana resource-call deadline** to decide blocking vs async default. *Done when the presentation table, cluster-context source, read-only guarantee, and timeout strategy are confirmed.*
- [~] **M1 — Scaffolding, build & generated client.** `@grafana/create-plugin` app+backend; `@grafana/*` libs **pinned to support Grafana 11.4** (the scaffold defaults to ~13.x); a dot-ai client **generated from `schema/openapi.json`**; builds and loads. *Done when the app appears in the sidebar (correct `includes` nav entry), the Mage backend builds, the generated client compiles, and it loads on 11.4.*

**Stage 1b — Connectivity**
- [~] **M2 — Configuration page.** apiUrl + token (secureJsonData); Test-connection (post-Save) via `version`, failing fast on misconfig, and surfacing the cluster context. *Done when settings persist and Test-connection reports OK/failure + cluster.*
- [~] **M3 — Backend proxy (Go).** `/query`, `/remediate`, `/health`, `/status/{jobId}`; `httpclient` + generated client; token injection; envelope+status mapping; async `202`+poll default (per M0); egress/SSRF fail-closed; redaction; fail-fast. *Done when unit tests cover success + all error classes + timeout + token-never-logged.*

**Stage 1c — Intelligence surfaces**
- [~] **M4 — Query UI.** Plain-text answer from `summary`; cluster-context display (from `version`); raw-response toggle; char counter. *Done when a real query renders its answer with visible cluster context.*
- [~] **M5 — Remediate analysis UI.** Analysis text; per-command Copy; **no execution surfaced**. *Done when a real remediate renders root cause + recommended actions and offers no execute path.*

**Stage 1d — Firefighting UX & dashboard integration**
- [~] **M6 — Shared layout, selector & firefighting controls.** Tool selector + context-aware placeholders; Cancel, Retry (preserves intent), elapsed-time/staged progress; response Copy; specific error `Alert`s. *Done when switching tools shares state and long/failed calls are cancelable/retryable with clear errors.*
- [~] **M7 — Dashboard deep-link.** Intent pre-filled via URL query param / template variable from a panel link. *Done when a panel data-link opens the page with the intent populated.*

**Stage 1e — Ship**
- [~] **M8 — Docs & install guide.** README: setup, config, read-only token guidance, **unsigned-plugin allow-list step**, screenshots; a `changelog.d` fragment per repo convention. *Done when a new user installs+configures from the README alone.*
- [~] **M9 — End-to-end + compatibility.** A **live-stack integration test** (real Grafana **11.4** + a current release **13.x**, live dot-ai): real Query + Remediate round-trip, token flow, and no-`apply` read-only enforcement verified end-to-end — not just mocks. *Done when the CI matrix passes and the live e2e is green on 11.4 and current.*

> **Phase 1 exit:** a self-managed 11.4 operator gets AI **cluster-state** answers + remediation
> **analysis** inside **Grafana** — sovereign, read-only, verified against a live stack.

### Expansion: Forward roadmap — Phase 2 Headlamp (proposed, not this contribution)

**Grafana diagnoses; Headlamp operates; GitHub already has project-setup.** Viktor already ships
[`dot-ai-headlamp`](https://github.com/vfarcic/dot-ai-headlamp) against the **same** dot-ai server
(full tools: remediate execute, operate, recommend — Headlamp is *not* read-only), and
**[project-setup](https://devopstoolkit.ai/docs/ai-engine/tools/project-setup)** as the GitHub/repo
governance doorway. Phase 2 is **not** "rebuild Headlamp" (or project-setup); it is **integrating
the Headlamp surface** next to the Phase 1 Grafana plugin so cluster operators have two deliberate
UI doorways — and we keep GitHub project-setup in the map so nobody "discovers" a third surface
and invents a parallel one.

- [ ] **M10 — Shared-server dual-surface wiring.** Document and verify one dot-ai deployment serves both: Grafana plugin (Phase 1, analysis-only token) **and** `dot-ai-headlamp` (resource-scoped, can use `apply` where intended). Install/runbook: Headlamp plugin enablement, auth header/`ApiProxy` path, same REST base. *Done when an operator can open the same cluster in both UIs against one dot-ai without config drift.*
- [ ] **M11 — Role split codified.** Grafana = **diagnose / watch** (dashboards → intent deep-link → analysis); Headlamp = **resource-centric operate** (invoke from a resource detail page; execute/operate where RBAC allows). Cross-links or runbook steps for "saw it in Grafana → act in Headlamp" (and the reverse). *Done when the split is written in both plugins' docs and a walkthrough works end-to-end.*
- [ ] **M12 — Optional Grafana GitOps-PR surface (wedge 2, low risk).** If [Open Question 6](#open-questions) wants action *without* leaving Grafana: surface remediate's **PR path** only (reviewable Git PR; human still merges) — still **no** direct-apply in Grafana unless a later opt-in. Direct `{sessionId, executeChoice}` remains Headlamp's home by default (it already has it). *Done when either (a) Grafana can open a PR link from analysis, or (b) the decision is explicit: execute stays Headlamp-only.*

> **Phase 2 exit:** one brain, two doorways — Grafana for firefighting from dashboards, Headlamp
> for resource-scoped operate — without duplicating intelligence or inventing a second server.

### Expansion: Forward roadmap — Phase 3 Evidence/Kubeshark (proposed; core vfarcic/dot-ai first)

Phase 1–2 reason over **live K8s state**. Deeper evidence (metrics/logs/flows, then packet/payload)
is **engine capability**, not a Grafana feature. Under the
[companion-project model](#expansion-companion-project-model), **do not implement
Kubeshark connectivity inside this plugin repo.**

#### Where Kubeshark connectivity lives

| Layer | Owns | Does **not** own |
|---|---|---|
| **Core `vfarcic/dot-ai` PRD** (open first) | Kubeshark as an MCP/tool (or evidence source): discover, auth, **redaction**, capability gate (`mcp:use` or equivalent), when remediate may call it, OpenAPI/tool schema, fail-closed without Kubeshark installed | Grafana/Headlamp page chrome |
| **Platform deploy / MOP** (adopter-specific; lives in the adopter's own platform/infra repo and change process) | Installing the privileged Kubeshark tap, NetworkPolicy, storage, on-demand vs always-on, operator approval | Tool contract or UI |
| **Companion UIs** (this Grafana PRD, Headlamp) | Optionally show analysis text that **already cites** packet evidence once the server returns it; no special Kubeshark client | Direct Kubeshark API, PCAP storage, decrypt keys, privilege |

**Order of work (fail-closed):**

1. **dot-ai PRD** — "Kubeshark evidence source / MCP for remediate" (contract + security model).
2. **Implement + document** on the server (and optional `mcpServers` registration pattern, same family as context-forge / other MCPs).
3. **Platform MOP** — install Kubeshark where an operator wants the tier (privileged; not default-on for everyone).
4. **Companion UIs** — only if presentation needs a tweak (almost always: none; remediate `summary` / factors already carry the narrative). Grafana does **not** grow a "Kubeshark panel" that bypasses the engine.

Same rule for cheaper senses: registering **`mcp-grafana`** (Prom/Loki/Hubble) is **server/config**, not a Grafana-plugin feature. The plugin already talks to **dot-ai**; it does not scrape Prometheus itself. Authenticated MCP attach is already unblocked by **[vfarcic/dot-ai#417](https://github.com/vfarcic/dot-ai/pull/417)** ([prior contribution](#prior-core-contribution--outbound-mcp-auth-vfarcicdot-ai414--vfarcicdot-ai416--vfarcicdot-ai417)).

#### Proposed milestones (ownership tagged)

- [ ] **M13 — Core: cheaper senses (`mcp-grafana`).** *dot-ai PRD + config* — register `mcp-grafana` so remediate can cite metrics/logs/flows. *Done when server-side remediate cites evidence not available from K8s state alone.* **Not this companion repo.**
- [ ] **M14 — Core: Kubeshark MCP (tier-3, on-demand).** *dot-ai PRD + implement* — payload / decrypted-TLS / PCAP tool; capability-gated, redaction-enforced, never first resort. *Done when the engine can pull gated packet evidence.* **Not this companion repo.** Platform MOP installs the tap separately.
- [ ] **M15 — Core (optional): predictive hardware signals.** Exporters → Prom → engine; diagnosis-only. *Done when trends yield human-action analysis with no autonomous hardware path.* **Not this companion repo.**
- [ ] **M16 — Companion (only if needed): surface polish.** If server responses grow new structured fields worth showing in Grafana (e.g. "evidence tier used"), add minimal presentation here — still no Kubeshark client. *Done when Phase 1 plugin renders the new fields without new privileges.* **This companion, after M13–M14 land.**

> **Phase 3 exit:** the **engine** can ground diagnosis in Prom/Loki/Hubble and, when needed,
> Kubeshark — under a core PRD and gated install. Grafana/Headlamp remain doorways; they do not
> own connectivity.

---

---

# Reviewer appendices (not part of the original PRD)

## Related / prior art (for this revision)

[#1](https://github.com/vfarcic/dot-ai-grafana/issues/1) (this PRD). Core: [vfarcic/dot-ai#354](https://github.com/vfarcic/dot-ai/issues/354), [vfarcic/dot-ai#392](https://github.com/vfarcic/dot-ai/issues/392), [vfarcic/dot-ai#143](https://github.com/vfarcic/dot-ai/issues/143), [vfarcic/dot-ai#358](https://github.com/vfarcic/dot-ai/issues/358), [vfarcic/dot-ai#425](https://github.com/vfarcic/dot-ai/issues/425), [vfarcic/dot-ai#317](https://github.com/vfarcic/dot-ai/issues/317). Headlamp: [vfarcic/dot-ai-headlamp](https://github.com/vfarcic/dot-ai-headlamp). MCP auth: [vfarcic/dot-ai#414](https://github.com/vfarcic/dot-ai/issues/414) → [vfarcic/dot-ai#416](https://github.com/vfarcic/dot-ai/pull/416) → [vfarcic/dot-ai#417](https://github.com/vfarcic/dot-ai/pull/417).

## Link conventions

Cross-repo references use full GitHub links (or `owner/repo#N`) so they resolve to the **correct** repository when this file is viewed in `vfarcic/dot-ai-grafana` (bare `#N` would otherwise mean *this* repo only):

| Ref form | Resolves to |
|---|---|
| `[#1](https://github.com/vfarcic/dot-ai-grafana/issues/1)` | This companion repo (Grafana PRD issue) |
| `[vfarcic/dot-ai#354](https://github.com/vfarcic/dot-ai/issues/354)` | Core engine issue/PRD |
| `[vfarcic/dot-ai#417](https://github.com/vfarcic/dot-ai/pull/417)` | Core engine PR |

Product **wedges 1–3** are *not* GitHub issues (written without a bare `#N` so they do not auto-link).

## Mapping to the original draft

This revision **extends the original PRD in place** (same path: `prds/1-grafana-ai-cluster-intelligence.md`).
The original draft text is kept **verbatim** under each section; `### Expansion:` blocks and the reviewer appendices are additive.
Git history retains the prior short form. **Phase 1 of this document = the original PRD's deliverable.**
Phases 2–3 are **proposed roadmap only** and are **not** part of original scope.

### Original section → this revision

| Original draft | This revision | Notes |
|---|---|---|
| **Problem Statement** | [Problem Statement](#problem-statement) + [Competitive landscape](#expansion-competitive-landscape--differentiation) | Same gap (context-switch for NL / analysis); framing expanded with Grafana Assistant / Sift so the plugin's wedge is honest |
| **Solution Overview** | [Solution Overview](#solution-overview) | Same: Query + Remediate analysis-only; plain-text presentation |
| **User Journey** | [User Journey](#user-journey) | Same path; adds cancel / retry / cluster-context / deep-link detail |
| **Architecture** | [Architecture](#architecture) + [Companion-project model](#expansion-companion-project-model) | Same app+Go proxy; contracts pinned to source; companion vs core ownership explicit |
| **MCP Server Integration** (query + remediate endpoints) | [Tool → endpoint map](#expansion-tool--endpoint-map) and [MCP Server Integration](#mcp-server-integration) | Same two tools; fields/`summary`/auth headers validated against `vfarcic/dot-ai` |
| **Plugin Configuration** (URL + token) | [Plugin Configuration](#plugin-configuration) | Same; `apiUrl` + `secureJsonData` token; Test-connection via `version` |
| **UI Components** | [UI Components](#ui-components) | Same minimal surface; firefighting controls spelled out |
| **What's Explicitly Out of Scope** | [What's Explicitly Out of Scope](#whats-explicitly-out-of-scope) | Same exclusions; plus Cloud-as-host and new engine capabilities |
| **Success Criteria** | [Success Criteria](#success-criteria) + [Additional success criteria](#expansion-additional-success-criteria) | Original list kept verbatim; extras additive |
| **Risks & Mitigations** | [Risks & Mitigations](#risks--mitigations) + [Additional risks](#expansion-additional-risks) | Original table kept verbatim; extra risks additive |
| **Dependencies** | [Dependencies](#dependencies) + [Additional dependencies](#expansion-additional-dependencies) | Original list kept verbatim; extras additive |
| **Milestones** (scaffold → ship) | [Milestones](#milestones) + Phase 1 detail M0–M9 | Original 9 checklist items kept verbatim; M0–M9 is the expansion mapping |
| *(not in original)* | Mapping / Validation / Open Questions / Link conventions | Reviewer appendices — do not replace original outline |

### Original milestones → Phase 1

| Original milestone | Phase 1 |
|---|---|
| Plugin scaffolding and build pipeline | **M1** (+ **M0** validation spike before build) |
| Plugin configuration page (+ connection test) | **M2** |
| Backend proxy (Go) | **M3** |
| Query tool UI | **M4** |
| Remediate analysis UI | **M5** |
| Tool selector and shared layout | **M6** |
| Error handling and loading states | **M6** (cancel / retry / elapsed / alerts) |
| Documentation and installation guide | **M8** |
| Grafana version compatibility testing | **M9** (11.4 must-pass + current 13.x; **floor raised** — see deltas) |
| *(new in this revision)* | **M7** dashboard→intent deep-link (still analysis-only) |

### Deliberate deltas from the original draft (please confirm or redirect)

| Topic | Original draft | This revision | Why |
|---|---|---|---|
| **Grafana version floor** | 9.x+ / 10.x / 11.x | **`grafanaDependency: >=11.0`**, reference **11.4** must-pass | Reference deployment is 11.4; untested 9/10 burden — [Open Question 3](#open-questions) |
| **Auth wording** | "Leverages Grafana auth/RBAC — no separate auth" | Grafana settings store **dot-ai** URL + token; Grafana RBAC gates who can configure | More accurate to the Go-proxy + bearer design |
| **Problem framing** | Context-switch only | + competitive landscape vs Assistant/Sift | Avoid shipping a redundant telemetry chatbot |
| **Phases 2–3** | Absent | Headlamp dual-surface; Kubeshark/evidence on **core** first | Roadmap only; [companion model](#expansion-companion-project-model) |

## Validation — assumptions checked against source

✅ verified · ⚠️ caveat · ✅→ resolved this revision.

| # | Assumption | Status | Evidence |
|---|------------|--------|----------|
| 1 | REST gateway (not only MCP) | ✅ | `docs/ai-engine/api/rest-api.md`; `schema/openapi.json` + `GET /api/v1/openapi` |
| 2 | `/tools/query` + `/tools/remediate` exist | ✅ | `src/interfaces/routes/index.ts` (`POST /api/v1/tools/:toolName`, PRD [vfarcic/dot-ai#354](https://github.com/vfarcic/dot-ai/issues/354)) |
| 3 | Auth: both headers accepted | ✅ | `src/interfaces/oauth/middleware.ts` L38–39 (`X-Dot-AI-Authorization` first, `Authorization` fallback) |
| 4 | query single-shot, input `{intent}` | ✅ | `src/tools/query.ts` L25–35 |
| 5 | **query answer field** | ✅→ | `data.result.summary` (`QueryOutput.summary`, `src/tools/query.ts` L54); plain intent, `[visualization]` switches modes (L210) |
| 6 | remediate `{issue,mode}` → single analysis | ✅ | `src/tools/remediate.ts` L1420–1633 |
| 7 | "analysis only" server-enforced | ✅ | `apply` RBAC gate, `remediate.ts` L1606/L1625 |
| 8 | responses structured JSON, need presentation | ✅ | `QueryOutput`/`RemediateOutput`; `dot-ai-headlamp` `client.ts` L89 unwraps `data.result` |
| 9 | long calls (tens of s → min) | ✅ | multi-iteration loop; `dot-ai-headlamp` `AI_TOOL_TIMEOUT = 30 min` (`client.ts` L9) |
| 10 | cluster context available | ✅→ | `POST /api/v1/tools/version` → `data.result.system.kubernetes.{connected,context}` (`rest-api.md`) |
| 11 | Grafana app+backend proxy feasible | ⚠️ | `examples/app-with-backend`; resource-call deadlines → async-default / Timeout chain |
| 12 | config = URL + secret token | ✅ | `AppConfig.tsx` (`jsonData.apiUrl` + `secureJsonData.apiKey`, write-only) |
| 13 | Grafana SDK exists for all of this | ✅ | `grafana-plugin-sdk-go` (`backend`, `httpadapter`, `httpclient`, `instancemgmt`); `@grafana/{data,ui,runtime}`; `@grafana/create-plugin`; `@grafana/plugin-e2e` |
| 14 | prior art exists | ✅ | `dot-ai-headlamp` — same thin-client pattern |
| 15 | GitHub surface already exists (project-setup) | ✅ | [project-setup docs](https://devopstoolkit.ai/docs/ai-engine/tools/project-setup) — repo audit/governance generation; distinct from remediate GitOps PR |
| 16 | Outbound MCP auth already landed (enables evidence MCPs) | ✅ | Core **[vfarcic/dot-ai#414](https://github.com/vfarcic/dot-ai/issues/414)** → design **[vfarcic/dot-ai#416](https://github.com/vfarcic/dot-ai/pull/416) → implement [vfarcic/dot-ai#417](https://github.com/vfarcic/dot-ai/pull/417) (merged) — static Bearer / headers / OAuth client_credentials for outbound MCP clients |

## Open Questions

1. **Recommended token scope** — a documented dot-ai RBAC role for "read + analyze, no `apply`" to cite in setup?
2. **Plugin identity & home** (Design Decision 5) — **RESOLVED 2026-09-03:** id `devopstoolkit-dotai-app`, author DevOps Toolkit, module `github.com/vfarcic/dot-ai-grafana`. Matches maintainer PR #3 / reviewed branch; fork home stays `LesleyMurfin/dot-ai-grafana` for development only.
3. **Grafana floor** (Design Decision 6) — confirm `>=11.0` with **11.4 as the must-pass reference deployment** + the `@grafana/*` pins; accept dropping 10.x/9.x?
4. **Distribution** (Design Decision 7) — private/unsigned first vs. catalog.
5. **Timeout strategy** (Design Decision 2 / M0) — confirm async `202`+poll as the remediate default, or is blocking-with-tuned-chain acceptable on the target Grafana?
6. **Positioning vs Grafana Assistant** (Design Decision 9 / [Competitive landscape](#expansion-competitive-landscape--differentiation)) — given Grafana Assistant + Sift, is an **analysis-only** Grafana plugin worth building, or should v1 differentiate by including **remediation** (GitOps PR) and lean on K8s-state + sovereignty? This is the central go/no-go, above the implementation questions.
7. **Grafana Cloud (optional, not planned here)** (Design Decision 10 / [Deployment targets](#expansion-deployment-targets-self-managed-vs-grafana-cloud)) — does the maintainer or community want a **later** Cloud track (catalog signing, Cloud-reachable dot-ai HTTPS, install path)? This contribution will not take it on; answer only if someone is volunteering to own that follow-on.
8. **Kubeshark / evidence ownership** (Design Decision 11 / [Where Kubeshark connectivity lives](#where-kubeshark-connectivity-lives)) — confirm: **core `dot-ai` PRD + platform MOP** for connectivity; this companion only presents server output (optional M16). Reject putting a Kubeshark client in the Grafana plugin.

## Progress

> **Evidence log only — not a second milestone list.** Checkbox completion state is authoritative solely under [Milestones](#milestones) (including the original checklist and any `### Expansion:` milestone detail). Rows below cite commits/PRs/proof; they must not be used to tick milestones. Status values mirror the Milestones SSOT and are not an independent tracker.


| date | milestone | status | evidence |
|------|-----------|--------|----------|
| 2026-09-01 | M-scaffold | [x] complete | PR #1 merged; `d46bc5d` feat(m1) scaffold app+backend; `src/plugin.json` type app + backend; e2e `tests/appNavigation.spec.ts` |
| 2026-09-01 | M-config | [x] complete | `385354b` AppConfig apiUrl+token+Test connection; PR #12 **merged** (`65cd8d5`); Admin draft-`apiUrl` gate (#7) + success-copy (#8); `AppConfig.tsx` + unit tests; working tree |
| 2026-09-01 | M-proxy | [x] complete | `22dc7a2`/`75295bf` proxy query/remediate/test-connection; envelope normalize via PR #12; `63994e7` SDK `httpclient`; `pkg/plugin/app.go` `newPluginHTTPClient`; `go test ./pkg/...` |
| 2026-09-01 | M-query | [x] complete | `f4c1d8f` DotAIPage query + `callDotAITool('query')`; stack Current packing (`grafanaStack.ts`/`progressiveContext.ts`/`askOrchestrator.ts`); live Ask **2026-09-01T22:46–22:48Z** PASS 3 golden asks (`scripts/golden-ask-results.json`: hops=3, first_hop=grafana, used_current=true); jest DotAIPage/orchestrator |
| 2026-09-01 | M-remediate | [x] complete | `f4c1d8f` remediate mode + analysis-only banner; no execute UI/payload (`dotaiApi.ts` omits execute/apply; tests assert); Execute blocked (PRD #2 owns execute); working tree |
| 2026-09-01 | M-selector | [x] complete | `f4c1d8f` Query/Remediate dropdown + shared layout; Analyze this / Clear thread; e2e + unit coverage |
| 2026-09-01 | M-errors | [x] complete | `f4c1d8f` spinner + error alerts; fetch-reject path via PR #12; AppConfig test-connection error path; loading disables controls |
| 2026-09-01 | M-docs | [~] partial | PR #5 merged (`cfc6bc1`/`11bd7b6`); README install/config; `docs/progressive-context.md` + `docs/grafana-stack-test-plan.md`; hop-cap-3 + §7 Measures; screenshots still open — `src/plugin.json` `screenshots: []` |
| 2026-09-01 | M-compat | [~] partial | `grafanaDependency: ">=11.0.0"`; `@grafana/*` 11.4 pins; 11.x reference host proven (live Ask); **10.x dual-version not proven** |
| 2026-09-01 | quality | landed | PR #12 **merged** (`65cd8d5`); issues #7–#11 **closed**; public-surface CI (`scripts/public-surface-check.sh`, `6e08d39`); webpack + jest + go tests in tree |
| 2026-09-01 | live-ask | proof | **2026-09-01T22:46:04Z–22:48:35Z** live UI: 3 golden asks PASS; first ask hops=3 first_hop=grafana used_current=true (`scripts/golden-ask-results.json` / `scripts/golden-ask-log.jsonl`). Lesley AP-003 override: working-tree + this window as `[x]` evidence for M-config–M-errors |


## Decisions

| date | decision | rationale |
|------|----------|-----------|
| 2026-09-01 | Analysis-only remediate; no execute UI | Product scope is read-only analysis; DotAIPage banner and tests assert no execute/apply payload fields |
| 2026-09-03 | Plugin id **`devopstoolkit-dotai-app`**; author DevOps Toolkit; module `github.com/vfarcic/dot-ai-grafana`; fork home `LesleyMurfin/dot-ai-grafana` for development | Contribution identity must match upstream PR #3 body + `feat/upstream-plugin` @ `0d33a35` / `upstream/main` `src/plugin.json` + `pkg/main.go`. Retired fork-only `lesleymurfin-dotai-app` drift on `ai/quality-review`. **Open Question 2 / DD5 closed.** Grafana restart required after id change. |
| 2026-09-01 | `grafanaDependency: ">=11.0.0"`; `@grafana/*` 11.4.0 pins; unsigned/private dist first | plugin.json + README pins; marketplace publish deferred (risks table) |
| 2026-09-01 | Test connection = `POST /api/v1/tools/version` with Bearer | README + backend `/test-connection` proxy contract |
| 2026-09-01 | Grafana plugin HTTP client 120s ceiling; no async 202 this pass | `docs/quality-review.md` known host limits / non-goals |
| 2026-09-01 | Draft `apiUrl` on `/test-connection` requires Grafana Admin | **On `main`** via PR #12 merge `65cd8d5`; issue #7 **closed** (was quality-review P1) |
| 2026-09-01 | Quality review 2026-09-01 board | no P0; P1 #7 + P2 #8–#11 all **closed** with PR #12 **merged** to `main` (`65cd8d5`); see `docs/quality-review.md` for original verdict index |
| 2026-09-01 | **Open Question 6:** v1 stays analysis-only; GitOps-PR remediate-execute is **PRD #2** (`prds/2-gitops-pr-remediate.md`, https://github.com/LesleyMurfin/dot-ai-grafana/issues/13), opened now — not parked as Phase 2 bullets inside this PRD | Viktor on vfarcic/dot-ai-grafana PR #2; RULE-027 — execute/mutation scope gets its own PRD so PRD #1 remains read-only |
| 2026-09-01 | Progressive context is client-only: Stable+Current+Map+box in plain `intent`/`issue`; History display-only (last 5); no `sessionId`; Analyze this copies Current → Remediate box | Clarifies upstream “session/history out of scope”: forbids MCP sessions and new REST fields, not UI thread packing. Same POST shapes. `docs/progressive-context.md` |
| 2026-09-01 | **Stack intelligence in one Ask:** this K3s + this Grafana stack (Loki, Prometheus, Tempo, Alertmanager via existing DS / `getDataSourceSrv`·`ds.query`·`getBackendSrv`) + dot-ai; Grafana is not host-only; no new UI/screens/pickers; stack reads pack into Current then POST query/remediate as plain `intent`/`issue` | Product binding for what we build now — Map = already-configured Grafana datasources; same Tool/box/Ask/Analyze this/thread; analysis-only; no `sessionId`. Replaces “Grafana as shell + resource selection from dashboards” framing |
| 2026-09-01 | **Hop cap 3** per user Ask (`MAX_ASK_HOPS = 3`); Grafana DS reads do not count as hops; first_hop grafana\|dot-ai by question class; orchestrator may multi-hop on unscoped/conflict/hedge | `src/utils/askOrchestrator.ts`; live Ask 22:46Z scored hops=3 first_hop=grafana used_current=true; RULE-027 loop bound |
| 2026-09-01 | **Stack Current packing:** client builds Current from Loki/Prometheus/Tempo/Alertmanager via type discovery (no hardcoded uid); packs Stable+Current+Map+box into plain `intent`/`issue`; History never POSTed | `src/utils/grafanaStack.ts` + `progressiveContext.ts`; U1–U6 + DotAIPage tests |
| 2026-09-01 | **Public-surface strip:** CI forbids internal host/marker/secret leakage on public docs and shipped surfaces | `scripts/public-surface-check.sh` + `.github/workflows/ci.yml` job `public-surface` (`6e08d39`) |
| 2026-09-01 | **SDK httpclient** for backend outbound HTTP (`grafana-plugin-sdk-go/backend/httpclient`); probe 15s / tools 120s; DefaultMiddlewares + DefaultTimeoutOptions | `pkg/plugin/app.go` `newPluginHTTPClient`; replaces ad-hoc `http.Client` construction |
| 2026-09-01 | **Live Ask proof window** 2026-09-01T22:46:04Z–22:48:35Z — 3 golden asks PASS (hops/first_hop/used_current scored); Execute remains blocked on this PRD | `scripts/golden-ask-results.json`; evidence for v1 Ask path; execute stays PRD #2 |





## Work Log

### 2026-09-01 — /prd update-progress

- **Issue**: PRD #1 milestone checkboxes were all unchecked despite merged M1/M8–M9 work and in-tree M2–M7 implementation.
- **Action**: Evidence-only progress refresh from scout map + workspace tree. Set M-scaffold `[x]`; M-config through M-compat `[~]`. Added Progress table with commit/PR evidence. Status left **Draft** (not `/prd start`). Session preflight / quality-circuit-breaker / `.ai/learning/anti_patterns.yaml` absent — skipped. `scripts/git.py` absent — no commit. Ledger scripts absent — WARN.
- **Prompt**: `/prd update-progress` on PRD-1 (conservative AP-003 checkboxes).

### 2026-09-01 — /prd update-decisions

- **Issue**: Product/architecture decisions lived in README, plugin.json, and quality-review but were not captured on the PRD.
- **Action**: Added Decisions table (7 rows) for analysis-only remediate, plugin id/fork home, Grafana 11 floor + pins + unsigned dist, version test-connection probe, 120s/no-async-202, Admin draft-apiUrl gate, and quality-review severity board.
- **Prompt**: `/prd update-decisions` on PRD-1 (RULE-027 where architectural).

### 2026-09-01 — Viktor PR #2 comments

- **Issue**: vfarcic/dot-ai-grafana PR #2 — keep v1 analysis-only; open separate PRD for GitOps-PR execute (not Phase 2 parking); scrub public docs of internal infra names; avoid double-tracking milestones (Progress vs Milestones).
- **Action**: Restated OQ6 in Decisions (analysis-only v1; execute → PRD #2). Pointed out-of-scope execute at `prds/2-gitops-pr-remediate.md`. Labeled Progress as evidence-only (Milestones remain SSOT). Scrubbed README internal GitOps-repo name. Created PRD #2 draft.
- **Prompt**: Finish Viktor PR #2 comments on PRD/docs in workspace (no plugin code; no commit).

### 2026-09-01 — PRD stack-intelligence rewrite

- **Issue**: PRD still framed Grafana as host-only and listed “resource selection from dashboards” OOS without binding Loki/Prometheus/Tempo/Alertmanager or Current packing.
- **Action**: Rewrote Solution / Architecture / UI / Out of scope; added Decisions row (2026-09-01) for stack-in-one-Ask + no new UI. Plugin id unchanged. No new milestones (Milestones remain SSOT).
- **Prompt**: Update PRD to match K3s + Grafana stack DS + dot-ai product (analysis-only).


### 2026-09-01 — /prd update-progress (evidence refresh)

- **Issue**: Progress table still claimed PR #12 / #7–#8 (and related #9/#11) **open** after merge.
- **Action**: Verified `gh -R LesleyMurfin/dot-ai-grafana`: PR #12 `MERGED` base `main` mergeCommit `65cd8d5` (2026-09-01T16:03:57Z); issues #7–#11 `CLOSED`. Rewrote Progress evidence rows; left milestone SSOT checkboxes unchanged (AP-003: no new `[x]` without full milestone proof). Status remains **Draft**. Session-preflight / quality-circuit-breaker / anti_patterns absent — WARN skip. Ledger hooks absent — WARN. `scripts/git.py` absent — no commit.
- **Prompt**: `/prd update-progress` continuation — align Progress with GH/workspace (issue #7 closed, PR #12 on main).

### 2026-09-01 — /prd update-decisions (evidence refresh)

- **Issue**: Decisions still said Admin draft-apiUrl gate / quality board with PR #12 open and #7 as open P1.
- **Action**: Updated those two Decisions rows only — gate **on main** via PR #12 / #7 closed; quality board #7–#11 closed with merge. No invented decisions. Status **Draft**.
- **Prompt**: `/prd update-decisions` continuation for merge facts only.



### 2026-09-01 — /prd update-progress (Hop3Build M-docs evidence)

- **Issue**: Peer Hop3Build closed remaining M8 doc gaps in-worktree and reported green typecheck/jest/build/go test; did not edit this PRD.
- **Action**: Appended/replaced M-docs Progress evidence only; left `[~]` (screenshots still open; AP-003). No Decisions change. Status **Draft**.
- **Prompt**: Peer IRC evidence note into Progress (PRD owner).


### 2026-09-01 — /prd update-progress (M-docs evidence precision)

- **Issue**: Hop3Build corrected M-docs Progress detail (test-plan :411/:423 caps; truncateRunesKeepTail shape; verbatim check commands; screenshots path + spec forbid).
- **Action**: Rewrote M-docs evidence row for exactness; kept `[~]`. Status **Draft**.
- **Prompt**: Peer correction on Progress evidence only.

### 2026-09-01 — /prd update-progress (v1 built — AP-003 override)

- **Issue**: Status still Draft and M-config–M-errors still `[~]` despite working-tree v1 + PR #12 + live Ask 22:46Z; Lesley ordered flip off Draft and `[x]` where this tree has implementation + tests.
- **Action**: Status → **In Progress**. Milestones: M-scaffold already `[x]`; M-config, M-proxy, M-query, M-remediate, M-selector, M-errors → `[x]`; M-docs stays `[~]` (`screenshots: []`); M-compat stays `[~]` (10.x unproven). Progress table rewritten with commits/PR #12/jest/go/webpack + live Ask 22:46–22:48Z (`golden-ask-results.json`: PASS 3 asks, hops=3, first_hop=grafana, used_current=true). AP-003: Lesley override of conservative `[~]` — working-tree + live Ask as evidence. Execute blocked (PRD #2). Session-preflight / QCB / anti_patterns absent — WARN skip. Ledger hooks/db absent — WARN. `scripts/git.py` absent — no commit.
- **Prompt**: `/prd update-progress` on PRD-1 (v1 built; not Draft; M-docs/M-compat `[~]` only).

### 2026-09-01 — /prd update-decisions (v1 bounds)

- **Issue**: Hop cap, stack Current packing, public-surface strip, SDK httpclient, and live Ask window were implemented/proven but missing from Decisions (or only implicit).
- **Action**: Appended five Decisions rows (hop cap 3; stack Current packing; public-surface strip; SDK httpclient; live Ask 22:46Z proof / execute still blocked). Did not duplicate progressive-context or stack-intelligence product rows. Status **In Progress**. Ledger absent — WARN. No commit (`scripts/git.py` missing).
- **Prompt**: `/prd update-decisions` on PRD-1 (missing rows only).



### 2026-09-03 — plugin identity alignment (Open Question 2)

- **Issue**: Working tree mixed `lesleymurfin-dotai-app` (plugin.json, README, docs, e2e) with `devopstoolkit-dotai-app` (pkg/main.go, some tests, upstream PR #3). Open Question 2 / DD5 still asked for maintainer input.
- **Action**: Single id repo-wide: `devopstoolkit-dotai-app`. `src/plugin.json` id + author/links aligned to reviewed upstream head; docs/provisioning/tests/specs/CI/.config updated. DD5 and Open Question 2 marked **RESOLVED**. `prds/5-*` left untouched (other owner).
- **Prompt**: IdentityFix on `ai/quality-review` (AGENTS.md default "do not change plugin ID" overridden on evidence that the reviewed branch already carries `devopstoolkit-dotai-app`).


