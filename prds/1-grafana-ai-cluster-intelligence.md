# PRD: Grafana App Plugin for AI-Powered Kubernetes Cluster Intelligence

**Issue**: [#1](https://github.com/vfarcic/dot-ai-grafana/issues/1)
**Priority**: High
**Status**: In Progress
**Updated**: 2026-09-01T17:00:31-0600

## Problem Statement

Teams using Grafana for Kubernetes observability must context-switch to separate tools when they want to:
- Ask natural language questions about their cluster resources (e.g., "show all failing pods in production")
- Get AI-powered analysis of cluster issues (e.g., "why is my-app crashing?")

This breaks workflow, adds friction, and creates a gap between observing a problem in Grafana and understanding it through AI-powered analysis.

## Solution Overview

A Grafana App Plugin that combines **this K3s cluster**, **this Grafana observability stack**, and **dot-ai** in one Ask — Grafana is not only the host UI shell.

Two read-only dot-ai tools, same page:

1. **Query** — Natural language questions about Kubernetes cluster resources
2. **Remediate (Analysis Only)** — AI-powered issue analysis without execution capability

**Map** is the existing Grafana datasources already configured on this instance: **Loki, Prometheus, Tempo, and Alertmanager**. The plugin reads them through Grafana’s runtime (`getDataSourceSrv` / `ds.query` / `getBackendSrv`) — no new datasource picker, no new screens, no parallel observability UI.

**UI surface stays the existing thread:** Tool selector, intent/issue box, Ask, Analyze this, Current (sent), History (display-only). Stack context is packed into **Current**, then shipped as plain-text `intent` / `issue` on the same POST shapes. No rich visualizations — text responses only.

## User Journey

1. User is viewing dashboards in Grafana and notices an anomaly
2. User navigates to the dot-ai plugin page (accessible from Grafana sidebar)
3. User selects "Query" or "Remediate" from the tool dropdown
4. User types their question/intent in natural language
5. User submits and sees the AI-generated text response
6. User can ask follow-up questions or switch tools

## Technical Scope

### Architecture

- **Grafana App Plugin** with a custom page (React + TypeScript) — plugin id `lesleymurfin-dotai-app`
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

## Success Criteria

- Plugin installs cleanly into Grafana (9.x+/10.x/11.x)
- Users can submit natural language queries and receive text responses
- Users can submit issue descriptions and receive analysis text
- Configuration via Grafana plugin settings works (MCP URL + auth token)
- Response times are comparable to direct MCP server calls (< 500ms overhead from plugin)
- Plugin follows Grafana UI conventions and feels native

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Grafana plugin API changes across versions | Plugin breaks on upgrade | Target Grafana 10.x+ with stable APIs, test across versions |
| MCP server authentication complexity | Users can't configure plugin | Clear setup docs, connection test button in settings |
| Go backend proxy adds latency | Slow responses | Minimal proxy logic, streaming if Grafana supports it |
| Plugin review process (if publishing to marketplace) | Delayed availability | Start with unsigned/private distribution, publish later |

## Dependencies

- dot-ai MCP server running and accessible from Grafana instance
- MCP server exposes `/api/v1/tools/query` and `/api/v1/tools/remediate` endpoints
- Grafana 10.x or later (for stable app plugin APIs)
- `@grafana/create-plugin` toolchain for scaffolding

## Milestones

- [x] **Plugin scaffolding and build pipeline** — Grafana app plugin project created with `@grafana/create-plugin`, builds successfully, loads in Grafana dev environment
- [x] **Plugin configuration page** — Admin can configure MCP server URL and auth token via Grafana plugin settings, with connection test
- [x] **Backend proxy (Go)** — Backend plugin component proxies requests to MCP server with configured auth, handles errors gracefully
- [x] **Query tool UI** — Users can type natural language queries, submit, and see text responses from the MCP server
- [x] **Remediate analysis UI** — Users can describe issues, submit, and see AI-powered analysis text (no execution)
- [x] **Tool selector and shared layout** — Dropdown to switch between Query and Remediate, shared input/response layout, context-aware placeholders
- [x] **Error handling and loading states** — Connection errors, auth failures, timeouts displayed clearly; loading spinner during requests
- [~] **Documentation and installation guide** — README with setup instructions, configuration guide, and screenshots
- [~] **Grafana version compatibility testing** — Verified working on Grafana 10.x and 11.x


## Progress (evidence log only — not a second milestone list; SSOT is ## Milestones above)


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
| 2026-09-01 | Plugin id `lesleymurfin-dotai-app`; code home LesleyMurfin/dot-ai-grafana fork | `src/plugin.json` id; README/CLAUDE.md; unsigned allow-list uses this id |
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


