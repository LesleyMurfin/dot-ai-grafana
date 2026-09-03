# PRD: Grafana Map / Explore / show-me (M7, post v1)

**Issue**: https://github.com/vfarcic/dot-ai-grafana/issues/6
**PRD**: **#6** (Map / Explore / show-me; after #1 v1; GitOps execute is #5)
**Priority**: High (follows PRD #1 ship)
**Status**: Draft
**Updated**: 2026-09-02

Plugin **0.2.x** of `devopstoolkit-dotai-app`. Unsigned alpha **0.1.0** stays PRD #1 / [vfarcic/dot-ai-grafana#3](https://github.com/vfarcic/dot-ai-grafana/pull/3).

## Problem

PRD #1 v1 packs Loki / Prometheus / Tempo / Alertmanager into **Current** and POSTs Query / Remediate. Operators still cannot:

- Open the Grafana dashboard / Explore / Drilldown that already holds that evidence
- Ask “show me the logs|alerts|traces|metrics|dashboards” without a wasted dot-ai POST
- Read GFM answers (v1 dumps the summary in `<pre>`)

These four landed **after** Viktor reviewed [vfarcic/dot-ai-grafana#3](https://github.com/vfarcic/dot-ai-grafana/pull/3) at `7af77b3`, then were **parked** off that PR ([prior working branch]((prior working-branch PR; not linked))) so v1 stays thin. PRD #1 **M7 stays Not in v1**. This file owns M7.

## Solution

After PRD #1 is live, **Map** is Grafana-host navigation (not a second observability UI). **Current** still packs evidence. Ask still analysis-only.

```
Ask
  │
  ├─ "show me logs|alerts|traces|metrics|dashboards"
  │     skip dot-ai POST  →  keep Current  →  open Map links
  │
  └─ else  pack Current  →  POST query/remediate  →  markdown Answer
                                                          Map
                                                          Current (collapsed)
```

Map links:

1. `/d/<uid>` when a firing alert carries `dashboardUid` (`85de5d4`)
2. Grafana **11+ Explore panes URL** + Drilldown apps **if installed** (`da65c76`): `grafana-lokiexplore-app`, `grafana-metricsdrilldown-app`, `grafana-exploretraces-app`
3. Answer as sanitized GFM; collapse Current (`a64e7df`) — presentation only

Never `GET /api/search`. Never `/api/datasources`. Plugin calls stay SDK `/api/plugins/<id>/resources/*`.

## Scope

- Post–PRD #1 only. Depends on v1 analysis-only Query/Remediate + Current packing.
- `dashboardUid` from Alertmanager frames → Map `/d/<uid>` (Grafana annotation already on the firing alert). No dashboard search.
- Explore panes URL (Grafana 11+). Drilldown `/a/<pluginId>` only when `config.apps` has that app.
- `isShowMeOnly` matching contract (must be unit-tested):
  - Lowercase the question; strip surrounding punctuation (`.?!`).
  - Match a **complete phrase**: `(show me|open|display) the? (logs|alerts|traces|metrics|dashboards)`. No partial-word hits.
  - **Diagnosis wins:** if the same question also has a diagnosis token (`why`, `fix`, `crash`, `failing`, `analyze`, `remediate`), **POST** — show-me does not skip.
  - `SHOW ME LOGS.` → skip POST (hops = 0); keep Current; open Map links.
  - `show me the logs — why is checkout-api crashing?` → POST.
  - `show me dashboards`: skip POST. Map `/d/<uid>` **only** when Current has a firing-alert `dashboardUid`. **Empty state:** no UID → no `/d/` link, no search, Ask still succeeds (Current + Explore/Drilldown if those apps exist). Never `GET /api/search`.
- Render Answer with Grafana `renderMarkdown` (sanitized). Collapse Current. Answer above Map.
- Target **0.2.x** after PRD #1 / PR #3 (unsigned 0.1.0) merges.

## Out of scope

- `GET /api/search`, `/api/datasources`, custom Loki/Prom HTTP clients.
- Grafana 12+ Dashboard `/apis` inventory (later). Firing-alert `dashboardUid` is the v0.2 dashboard-to-open path.
- Changing plugin resource paths (stay `/api/plugins/<id>/resources/*`).
- Panel data-link intent prefill (original PRD #1 M7 wording) — not this slice.
- GitOps remediate execute — [prds/5-gitops-pr-remediate.md](5-gitops-pr-remediate.md) / [prior working branch]((prior working-branch PR; not linked)).
- Any change to PRD #1 v1 / unsigned **0.1.0** on vfarcic#3.
- Remediate v2 “improve dashboards/alerts so we catch this next time.”
- Marketplace signing, execute/apply, operate/recommend.

## Success criteria

- Firing-alert `dashboardUid` appears as Map `/d/<uid>`; no `/api/search`.
- Map offers Explore panes plus Logs/Metrics/Traces Drilldown when those apps are installed; omitted when not.
- “show me the logs” (and alerts/traces/metrics) skips dot-ai, keeps Current, Map Explore/Drilldown links work when those apps are installed.
- “show me dashboards” skips dot-ai; Map `/d/<uid>` only for firing-alert `dashboardUid`; no UID → no `/d/` link, no search, Ask still succeeds.
- Answer renders markdown; Current starts collapsed.
- Plugin resources remain `/api/plugins/devopstoolkit-dotai-app/resources/*`.
- Ships as **0.2.x** on the fork; 0.1.0 v1 on vfarcic#3 unchanged.

## Milestones

- [x] PRD GitHub issue filed on vfarcic/dot-ai-grafana (#6)
- [ ] `dashboardUid` → Map `/d/<uid>` (restore `85de5d4`)
- [ ] Explore panes + Drilldown Map links if apps installed (restore `da65c76`)
- [ ] show-me skip POST; keep Current; open Map links
- [ ] markdown Answer; collapse Current (restore `a64e7df`)
- [ ] 0.2.x on fork; no vfarcic target until PR #3 merges

## Decisions

| date | decision | rationale |
|------|----------|-----------|
| 2026-09-02 | Park Map / Explore / show-me / markdown off vfarcic/dot-ai-grafana#3 after review at `7af77b3` | Keep unsigned 0.1.0 v1 thin |
| 2026-09-02 | PRD #1 M7 stays **Not in v1**; this file owns M7 | Same split as PRD #5 vs analysis-only v1 |
| 2026-09-02 | Never `GET /api/search` or `/api/datasources` | Grafana 13 deprecates legacy search; dashboard-to-open is firing-alert `dashboardUid` now, Dashboard `/apis` later |
| 2026-09-02 | Plugin resource paths stay SDK `/api/plugins/<id>/resources/*` | Not Grafana 12+ Kubernetes-style `/apis` HTTP |
| 2026-09-02 | Target **0.2.x** `devopstoolkit-dotai-app` after PRD #1 / PR #3 | 0.1.0 is v1 on vfarcic/dot-ai-grafana#3 |
| 2026-09-02 | GitOps execute is **not** this PRD | See PRD #5 / issue #5 |
| 2026-09-02 | `show me dashboards` is alert-`dashboardUid` only; empty = no `/d/` link | Never `/api/search`; Dashboard `/apis` later |
| 2026-09-02 | Diagnosis tokens beat show-me; punctuation/case ignored | `SHOW ME LOGS.` skips; mixed `why` POSTs |

## Work Log

### 2026-09-02 — PRD opened from parked M7 extras

- **Issue**: Map `/d/<uid>`, Explore/Drilldown links, show-me skip POST, and markdown Answer landed after Viktor’s vfarcic#3 review at `7af77b3`, then were reverted so v1 stays analysis-only packing.
- **Action**: Draft PRD #6 (problem, scope, out, milestones). Does not edit `prds/1`. Does not mix GitOps execute.
- **Prompt**: Own parked M7 as post-v1 0.2.x on the fork.

### 2026-09-02 — Split documented; show-me contract

- **Issue**: CodeRabbit on #22: show-me matching unspecified; `show me dashboards` had no empty state.
- **Action**: Issue #6 filed. Matching contract + dashboard empty state written here. PRD #1 (prior working branch) and PRD #5 (fork #18) now point here.
