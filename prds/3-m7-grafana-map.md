# PRD: Grafana Map / Explore / show-me (M7, post v1)

**Issue**: https://github.com/LesleyMurfin/dot-ai-grafana/issues/23
**Priority**: High (follows PRD #1 ship)
**Status**: Mostly implemented on `ai/quality-review` — remaining: show-me contract gaps + 0.2.x ship
**Updated**: 2026-09-03

Plugin **0.2.x** of `devopstoolkit-dotai-app`. Unsigned alpha **0.1.0** stays PRD #1 / [vfarcic/dot-ai-grafana#3](https://github.com/vfarcic/dot-ai-grafana/pull/3).

## Current State

This is **PRD #3** (Map / Explore / show-me / markdown Answer). An upstream comment on [vfarcic/dot-ai-grafana#3](https://github.com/vfarcic/dot-ai-grafana/pull/3) briefly mis-numbered this work as **PRD #5**; that comment is being corrected separately (sibling `UpstreamComment`). Repo numbering stands: Map = **#3**, evidence-grounded change safety = **#4**, plugin usability = **#5**.

The original parked commits (`85de5d4` dashboard `/d/<uid>`, `da65c76` Explore/Drilldown + show-me, `a64e7df` markdown Answer + collapsed Current) were **re-implemented on `ai/quality-review`**, not restored by reverting the park PR ([LesleyMurfin#21](https://github.com/LesleyMurfin/dot-ai-grafana/pull/21)). They are **not** on this branch (`feat/prd3-m7-grafana-map` @ `81cfb31`).

| Capability | Where it lives now (branch `ai/quality-review`) | Commit |
|------------|--------------------------------------------------|--------|
| `dashboardUrl` + alert `dashboardUid` → Map `/d/<uid>` | `src/utils/grafanaExplore.ts` (`dashboardUrl`), `src/utils/grafanaStack.ts` (`dashboardUidsFromAlertFrames`) | `73d8adc` |
| Explore panes + Drilldown apps | `src/utils/grafanaExplore.ts` (`exploreUrl`, `drilldownAppUrl`, `buildDrilldownLinks`) | `73d8adc` |
| show-me skip POST (0-hop) | `isShowMeOnly` in `grafanaExplore.ts`; gate in `askOrchestrator.ts` | `73d8adc` / `e66e2a6` |
| markdown Answer | `src/components/ResponseMarkdown.tsx` | `66a736a` |
| Current collapsed by default | `src/pages/DotAIPage.tsx` (`currentOpen` default `false` + `Collapse`) | `57b6d36` |

**To get this code onto this branch (or a release line):** merge or cherry-pick the `ai/quality-review` Map stack (`66a736a`, `73d8adc`, `e66e2a6`, `57b6d36` and dependents), or land via whatever PR path ships `ai/quality-review` and close this PRD against that. Do **not** re-restore the parked SHAs by replaying the old reverts — the quality-review re-implementation is the body of work.

**What still remains for PRD #3** (see milestones + contract audit):

1. Close **show-me contract gaps** on `isShowMeOnly` (punctuation strip; tighten `for …` so resource nouns like `pod api-7f` still POST; add missing diagnosis token `analyze`; tests).
2. **Ship 0.2.x** on the fork once the Map stack is on a release line (`package.json` is still `0.1.0` on `ai/quality-review`). Do not target `vfarcic` until PRD #1 / upstream PR #3 merges.

Genuinely remaining product surface is small. This PRD still warrants a separate tracking doc until those two items close and the quality-review code is on a shippable branch; it does **not** warrant re-planning the four Map capabilities as greenfield.

## Problem

PRD #1 v1 packs Loki / Prometheus / Tempo / Alertmanager into **Current** and POSTs Query / Remediate. Operators still cannot:

- Open the Grafana dashboard / Explore / Drilldown that already holds that evidence
- Ask “show me the logs|alerts|traces|metrics|dashboards” without a wasted dot-ai POST
- Read GFM answers (v1 dumps the summary in `<pre>`)

These four landed **after** Viktor reviewed [vfarcic/dot-ai-grafana#3](https://github.com/vfarcic/dot-ai-grafana/pull/3) at `7af77b3`, then were **parked** off that PR ([LesleyMurfin#21](https://github.com/LesleyMurfin/dot-ai-grafana/pull/21)) so v1 stays thin. PRD #1 **M7 stays Not in v1**. This file owns M7. Re-implementation now exists on `ai/quality-review` (see Current State).

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

1. `/d/<uid>` when a firing alert carries `dashboardUid` (originally `85de5d4`; now `dashboardUrl` / `dashboardUidsFromAlertFrames` on `ai/quality-review` @ `73d8adc`)
2. Grafana **11+ Explore panes URL** + Drilldown apps **if installed** (originally `da65c76`; now `exploreUrl` / `buildDrilldownLinks` @ `73d8adc`): `grafana-lokiexplore-app`, `grafana-metricsdrilldown-app`, `grafana-exploretraces-app`
3. Answer as sanitized GFM; collapse Current (originally `a64e7df`; now `ResponseMarkdown` @ `66a736a` + `DotAIPage` Collapse @ `57b6d36`) — presentation only

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
- Target **0.2.x** on **LesleyMurfin/dot-ai-grafana** only. Do not target `vfarcic` until PRD #1 / PR #3 merges.

## Out of scope

- `GET /api/search`, `/api/datasources`, custom Loki/Prom HTTP clients.
- Grafana 12+ Dashboard `/apis` inventory (later). Firing-alert `dashboardUid` is the v0.2 dashboard-to-open path.
- Changing plugin resource paths (stay `/api/plugins/<id>/resources/*`).
- Panel data-link intent prefill (original PRD #1 M7 wording) — not this slice.
- GitOps remediate execute — [prds/2-gitops-pr-remediate.md](2-gitops-pr-remediate.md) / [LesleyMurfin#18](https://github.com/LesleyMurfin/dot-ai-grafana/pull/18).
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

- [x] PRD GitHub issue filed on `LesleyMurfin/dot-ai-grafana` (#23)
- [x] `dashboardUid` → Map `/d/<uid>` — **DONE** on `ai/quality-review` (not this branch): `dashboardUrl` `src/utils/grafanaExplore.ts:50`, `dashboardUidsFromAlertFrames` `src/utils/grafanaStack.ts:320`, wired via `buildDrilldownLinks` `…:152–157` and stack pack `…:601`; commit `73d8adc` (re-impl of parked `85de5d4`). **Bring-up:** land that commit’s tree onto the ship line.
- [x] Explore panes + Drilldown Map links if apps installed — **DONE** on `ai/quality-review`: `exploreUrl` `grafanaExplore.ts:24`, `drilldownAppUrl` `…:54`, `buildDrilldownLinks` `…:81`, `hasApp` via `config.apps`; tests in `grafanaExplore.test.ts`; commit `73d8adc` (re-impl of parked `da65c76`).
- [ ] show-me skip POST; keep Current; open Map links — **PARTIAL** on `ai/quality-review`: `isShowMeOnly` `grafanaExplore.ts:65`, 0-hop gate `askOrchestrator.ts:445` (`hops: 0`, keeps Current + drilldowns), covered by `askOrchestrator.test.ts` (“show me the logs skips dot-ai…”) and partial `grafanaExplore.test.ts`. Commits `73d8adc` / `e66e2a6`. **Remaining:** enforce the matching contract below (punctuation strip; complete-phrase / no over-match on `for pod …`; diagnosis token `analyze`; unit tests per clause). See Work Log 2026-09-03 contract audit.
- [x] markdown Answer; collapse Current — **DONE** on `ai/quality-review`: `ResponseMarkdown` `src/components/ResponseMarkdown.tsx:11` (`renderMarkdown`, sanitized GFM) @ `66a736a`; page wire `DotAIPage.tsx:276`; Current `Collapse` default closed `currentOpen = false` `DotAIPage.tsx:42` + `…:304–308` @ `57b6d36` (re-impl of parked `a64e7df`).
- [ ] 0.2.x on fork; no vfarcic target until PR #3 merges — **NOT STARTED**: `package.json` / plugin version still **0.1.0** on `ai/quality-review`; no 0.2.x release cut. Keep fork-first; do not target `vfarcic` until PRD #1 / upstream PR #3 merges.

### Verdict table (2026-09-03 reconciliation against `ai/quality-review`)

| # | Milestone | Verdict | Evidence |
|---|-----------|---------|----------|
| 1 | Issue #23 filed | **DONE** | https://github.com/LesleyMurfin/dot-ai-grafana/issues/23 |
| 2 | `dashboardUid` → `/d/<uid>` | **DONE** (code on `ai/quality-review` only) | `dashboardUrl` `grafanaExplore.ts:50`; `dashboardUidsFromAlertFrames` `grafanaStack.ts:320`; `buildDrilldownLinks` dashboard loop `grafanaExplore.ts:152`; `73d8adc` |
| 3 | Explore + Drilldown Map links | **DONE** (code on `ai/quality-review` only) | `exploreUrl` `:24`; `drilldownAppUrl` `:54`; `buildDrilldownLinks` `:81`; `73d8adc` |
| 4 | show-me skip POST | **PARTIAL** | `isShowMeOnly` `:65`; gate `askOrchestrator.ts:445`; happy path tested; contract gaps remain (below) |
| 5 | markdown Answer; collapse Current | **DONE** (code on `ai/quality-review` only) | `ResponseMarkdown` `:11` @ `66a736a`; `DotAIPage.tsx:42,276,304` @ `57b6d36` |
| 6 | 0.2.x ship on fork | **NOT STARTED** | version still `0.1.0` |

## Decisions

| date | decision | rationale |
|------|----------|-----------|
| 2026-09-02 | Park Map / Explore / show-me / markdown off vfarcic#3 after review at `7af77b3` | Keep unsigned 0.1.0 v1 thin; LesleyMurfin#21 reverts `a64e7df`, `da65c76`, `85de5d4` |
| 2026-09-02 | PRD #1 M7 stays **Not in v1**; this file owns M7 | Same split as PRD #2 vs analysis-only v1 |
| 2026-09-02 | Never `GET /api/search` or `/api/datasources` | Grafana 13 deprecates legacy search; dashboard-to-open is firing-alert `dashboardUid` now, Dashboard `/apis` later |
| 2026-09-02 | Plugin resource paths stay SDK `/api/plugins/<id>/resources/*` | Not Grafana 12+ Kubernetes-style `/apis` HTTP |
| 2026-09-02 | Target **0.2.x** `devopstoolkit-dotai-app`; fork-first `LesleyMurfin/dot-ai-grafana` | 0.1.0 is v1 on vfarcic#3; do not target vfarcic until PRD #1 / PR #3 merges |
| 2026-09-02 | GitOps execute is **not** this PRD | prds/2 / LesleyMurfin#18 / issue #13 |
| 2026-09-02 | `show me dashboards` is alert-`dashboardUid` only; empty = no `/d/` link | Never `/api/search`; Dashboard `/apis` later |
| 2026-09-02 | Diagnosis tokens beat show-me; punctuation/case ignored | `SHOW ME LOGS.` skips; mixed `why` POSTs |

## Work Log

### 2026-09-02 — PRD opened from parked M7 extras

- **Issue**: Map `/d/<uid>`, Explore/Drilldown links, show-me skip POST, and markdown Answer landed after Viktor’s vfarcic#3 review at `7af77b3`, then were reverted so v1 stays analysis-only packing.
- **Action**: Draft PRD #3 (problem, scope, out, milestones). Does not edit `prds/1`. Does not mix GitOps execute.
- **Prompt**: Own parked M7 as post-v1 0.2.x on the fork.

### 2026-09-02 — Split documented; show-me contract

- **Issue**: CodeRabbit on #22: show-me matching unspecified; `show me dashboards` had no empty state.
- **Action**: Issue #23 filed. Matching contract + dashboard empty state written here. PRD #1 (fork #21) and PRD #2 (fork #18) now point here.

### 2026-09-03 — Reconcile PRD against re-implemented code

- **Issue**: Milestones still said “restore `85de5d4` / `da65c76` / `a64e7df`” while the same capabilities already exist on `ai/quality-review` (`66a736a` markdown, `73d8adc` Explore/drilldown/`isShowMeOnly`, `e66e2a6` 0-hop orchestration, `57b6d36` page Collapse). Two plans, one body of code. This branch never received that tree.
- **Action**: Added **Current State**; reticked milestones with `file:line` + commits; left show-me **PARTIAL** and 0.2.x **NOT STARTED**. Preserved Decisions, Out of scope, and the `isShowMeOnly` matching contract verbatim. Confirmed numbering is **PRD #3** (upstream mis-label as #5 corrected elsewhere).
- **Contract audit** (`isShowMeOnly` @ `ai/quality-review` `src/utils/grafanaExplore.ts:65`, tests `grafanaExplore.test.ts` + orchestrator 0-hop test):

  | Clause | Result | Notes |
  |--------|--------|-------|
  | Lowercase the question | **PASS** | `question.toLowerCase()` `:67`. Implicit via other cases; no dedicated case-only test. |
  | Strip surrounding punctuation (`.?!`) | **FAIL** | No strip. `isShowMeOnly('SHOW ME LOGS.')` → `false` (should skip POST per contract). No covering test. |
  | Complete phrase `(show me\|open\|display) the? (logs\|…)` | **PARTIAL** | Regex anchors full string but adds optional `(\s+for\b.*)?` (`:75`), which is broader than the written phrase. Tests cover happy phrases + some rejects (`grafanaExplore.test.ts`). |
  | No partial-word hits | **PASS** | Word-ish alternation; `show logs for pod api` → `false` (needs `me`). Test: diagnosis block. |
  | Diagnosis tokens beat show-me (`why`, `fix`, `crash`, `failing`, `analyze`, `remediate`) | **PARTIAL** | Impl uses `why\|how\|fix\|remediat\|improve\|root cause\|because\|issue\|issues\|crash\|failing\|unhealthy` (`:71`). Has `why`/`fix`/`crash`/`failing`/`remediat*`. **Missing `analyze`.** Extra tokens beyond the contract list. Tests cover `why`/`how`/`failing` paths, not `analyze`. |
  | `SHOW ME LOGS.` → skip POST | **FAIL** | Fails punctuation strip (above). No test. |
  | `show me the logs — why is checkout-api crashing?` → POST | **PASS** | `why` diagnosis → `false`. Covered indirectly (`why are there errors…`). |
  | `show me dashboards` skip + empty `/d/` when no UID | **PASS** (skip) / **PASS** (empty via no uids fed to `buildDrilldownLinks`) | Skip: test `show me dashboards` → true. Empty `/d/`: dashboard links only for provided `dashboardUids` (`:152`); no `/api/search`. |
  | **Known gap:** `isShowMeOnly('show me the logs for pod api-7f')` | **STILL TRUE** (gap open) | Still returns `true` and would skip the call — optional `for .*` swallows the pod. **No “no resource noun follows” guard; no failing test.** |
  | Would the PRD contract have caught the pod gap? | **Yes** | Contract requires a **complete phrase** equal to `(show me\|open\|display) the? (logs\|…)`, with no `for <resource>` production. Strict phrase match rejects trailing `for pod api-7f`. The gap is an **implementation** widening (`for\b.*`), not a missing PRD rule. |

- **Remaining work for this PRD:** (1) fix `isShowMeOnly` to match the contract (strip `.?!`; complete-phrase only or explicit resource-noun reject; add `analyze`); (2) unit tests per failing clause including the pod-name case; (3) land quality-review Map stack on a shippable line; (4) cut **0.2.x** on the fork.
