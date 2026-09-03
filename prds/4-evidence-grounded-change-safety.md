# PRD: Evidence-grounded change safety and verification

**Issue**: TBD — file on LesleyMurfin/dot-ai-grafana (number confirmed only on filing)
**PRD**: **#4** (free after #1 v1, #2 GitOps-PR execute, #3 M7 Map)
**Priority**: High (closes the change loop only Grafana can close; depends on PRD #2 for PR trigger)
**Status**: Draft
**Updated**: 2026-09-03

> **Filename:** `prds/4-evidence-grounded-change-safety.md`. Set **Issue** when filed. PRD index is **4** even if the GitHub issue number differs.

## Current State

- **Goal:** Make Grafana the place where a GitOps change is **pre-flighted against live telemetry** and **verified after merge** — not a second Kubernetes day-2 manager.
- **Active milestone:** None started. Draft until issue filed; needs PRD #2 PR path (or a test double) for integration demos that end in a real PR.
- **Next action:** File issue; freeze M1 Outcome/Demo; inventory which `impact_analysis` / remediate fields the engine already returns vs what the plugin must join from Current.
- **Write rule (estate):** dot-ai may read broadly; cluster writes go through **Git** only. Direct apply into KRO-owned namespaces is manufactured drift (ADR-0019, `riley_infrastructure`). Grafana's blessed execute trigger is **PRD #2 propose → GitOps PR**, not live apply.
- **Surface demarcation (Viktor):** Grafana = observability-first intelligence + GitOps-PR triggering. Headlamp = day-2 object lifecycle and direct resource actions. Do not turn this plugin into a duplicate cluster manager.
- **Not this PRD:** Map/markdown/show-me (PRD #3); analysis-only v1 packing (PRD #1); PR mechanism internals (PRD #2); thread/wait/ship usability (unnumbered usability PRD); Headlamp Recommend/Operate live wizards.

> This section outranks everything below it. When work lands, rewrite **Current State** here and demote the previous body to **Decision History** — never delete it.

## Problem

Two halves of the change loop need **time-series**. Neither is owned by an existing PRD.

### Pre-flight is graph-only today

`impact_analysis` (and similar blast-radius reasoning) answers from the **Kubernetes dependency graph**: who depends on whom, what might break if this object changes. That is necessary and insufficient.

With Grafana in the path we can also answer:

- Is this serving traffic **right now**?
- Does it have a **firing alert**?
- What is the **error budget / burn** posture?

"Safe per the graph" and "backs a workload at 400 rps with an active page" are different answers. Shipping a GitOps PR without that join is how "green" changes land in red production.

### Post-merge has no closer

After the PR merges and ArgoCD applies:

- **Headlamp** can show object state; it has **no** telemetry loop to say the metric recovered.
- **Grafana Assistant** can chat about panels; it does **not** own the GitOps act or the remediate session that opened the PR.
- **PRD #2** opens the PR; it does not define verify-after-apply.

The differentiator is closing **diagnose → (pre-flight) → GitOps PR → apply → verify** on one observability-first surface.

### What this is not

Analysis-only v1 was **sequencing** (Viktor: ship the smaller read-only thing, then a separate PRD for the GitOps-PR path) — not a permanent ban on Grafana participating in change. The execute path he explicitly blessed for Grafana is **GitOps-PR** (**PRD #2**). This PRD does not replace PRD #2 and does not add a Grafana `operate`/Update object-lifecycle wizard.

## Solution

```text
Ask / remediate analysis (PRD #1)
        │
        ▼
 Pre-flight (this PRD)
   impact_analysis
   + Current/stack telemetry (traffic, alerts, burn)
        │
        ▼
 Propose → GitOps PR (PRD #2)     ← only write trigger from Grafana
        │
        ▼
 Human review + merge + ArgoCD apply
        │
        ▼
 Post-merge verify (this PRD)
   re-query Prom/Loki/AM → recovered | not | inconclusive
   + Explore deep links (PRD #3 builders when present)
```

- **Pre-flight:** Before (or as a gate on) PR create, show graph impact **and** telemetry risk. Pack firing alerts and traffic/burn signals for affected objects.
- **Trigger:** Call into **PRD #2**'s PR mechanism only. No `kubectl apply`, no Headlamp `executeRemediation` from this plugin.
- **Post-merge verify:** Given PR/session/change identity, re-query metrics/logs/alerts; report outcome; link Explore. Inconclusive when signals missing — never fake green.

## Why not just use Headlamp

Headlamp already owns day-2 **object lifecycle**: kind-agnostic Remediate/Operate detail sections, live `executeRemediation`, multi-step Recommend wizard (`vfarcic/dot-ai-headlamp`).

| Need | Headlamp | Grafana (this PRD) |
|------|----------|--------------------|
| Edit/approve live resource change | **Yes** (default companion path) | **No** — out of scope |
| Open GitOps PR | Not the estate's Grafana-blessed path | **PRD #2** trigger from Grafana |
| Blast radius + **live traffic/alerts/burn** | Graph/API only | **This PRD** pre-flight |
| Did the **metric recover** after apply? | **Cannot** (no telemetry) | **This PRD** post-merge verify |

**Honest limit:** If pre-flight only rephrases graph output without real metric joins, or verify is a manual "open Explore" bookmark with no change binding, this PRD has no wedge — **PARK**. Do not "fill the gap" by cloning Headlamp's Recommend/Operate UI (see **Considered and deferred**).

## Scope

- Post–PRD #1 Ask/remediate analysis + Current packing.
- **Depends on PRD #2** for propose → GitOps PR (tokens, RBAC, SCM). **Do not re-specify PRD #2.**
- Pre-flight UI + client join of `impact_analysis` (or engine equivalent) with Grafana telemetry (Prom/Loki/Alertmanager already reachable via plugin patterns).
- Post-merge verification UI bound to a change identity (PR URL, session id, or equivalent).
- Signal contract for traffic / burn / alert joins; honest empty states.
- e2e: pre-flight shows telemetry factor on a fixture workload with a firing alert; verify after a merged fixture change reports recovered or not recovered without cluster apply from the plugin.
- May **reuse** PRD #3 Explore/Map link builders when present; must not block on PRD #3 if links degrade to plain Explore URLs.

## Out of scope

- **PRD #3** Map/markdown/show-me ownership ([issue #23](https://github.com/LesleyMurfin/dot-ai-grafana/issues/23) / [PR #22](https://github.com/LesleyMurfin/dot-ai-grafana/pull/22)).
- **PRD #2 internals** (SCM API, token split implementation, who-may-open-PR policy engine).
- Direct `kubectl apply` / live execute from Grafana.
- Grafana **Build/Update** / `recommend` / `operate` object-lifecycle wizards (Headlamp; see Considered and deferred).
- Duplicating Headlamp resource-detail injection (I-076).
- Thread history, async 202 job-poll, ship/identity docs (usability PRD).
- Engine forks; org signal config via existing patterns where possible.

## Success criteria

- Operator sees pre-flight that can disagree with "graph says safe" when telemetry says hot (traffic and/or firing alert and/or burn) on a demo fixture.
- Operator triggers PR create only through PRD #2 path after pre-flight (or documented waive — default is show pre-flight first).
- After merge/apply (fixture), verify reports recovered / not recovered / inconclusive with evidence links — not a blank spinner.
- No path in this PRD applies to the cluster.
- Docs state Headlamp vs Grafana split without claiming day-2 lifecycle parity.

## How slices work

Same contract as the usability PRD: frozen **Outcome / Demo / Budget**; free design; loop log; exits **SHIPPED** or **PARKED** only; milestone fence with one integration demo. PARKED is success if the wedge is weak.

## Milestones

### M1 — Pre-flight: graph impact + telemetry join

**Fence:** Read-only safety panel. No PR create UI beyond a stub button that calls PRD #2 when ready.

**Integration demo:** For a workload with a firing alert (or synthetic Current frames), pre-flight lists graph dependents **and** at least one telemetry risk (alert and/or traffic signal); for a quiet fixture, telemetry section shows clear "no active alert / no traffic signal configured" empty states — not fake green.

#### M1.S1 — Contract: impact fields + Current join points

- **Outcome:** Written mapping from engine impact/blast fields to plugin Current/stack frames (alerts, namespaced workloads, optional Prom).
- **Demo:** Doc table names concrete JSON fields and `grafanaStack` structures; gap list for missing engine fields without inventing them in UI.
- **Budget:** 2 loops
- **Status:** NOT STARTED
- **Evidence:** I-086, I-089
- **Loop log:** *(empty)*

#### M1.S2 — Pre-flight panel UI

- **Outcome:** Operator-visible pre-flight section on the change path showing graph summary + telemetry risks.
- **Demo:** From a remediate/analysis result (or dedicated entry), open Pre-flight; see both sections; expand alert chip to text that matches Current.
- **Budget:** 3 loops
- **Status:** NOT STARTED
- **Evidence:** I-086, I-089
- **Loop log:** *(empty)*

#### M1.S3 — Signal contract v0 (traffic / burn)

- **Outcome:** Documented v0 signals and empty-state behaviour when absent (I-090).
- **Demo:** README or PRD subsection lists queries/labels; running without those metrics shows inconclusive/missing — not "healthy".
- **Budget:** 3 loops
- **Status:** NOT STARTED
- **Evidence:** I-090
- **Loop log:** *(empty)*

---

### M2 — Gate PRD #2 PR create on pre-flight

**Fence:** Wire accept/propose to PRD #2 only; pre-flight must render first. No SCM re-spec.

**Integration demo:** Propose GitOps PR from Grafana; pre-flight visible in the flow; PR appears via PRD #2 mechanism; cluster untouched by plugin.

#### M2.S1 — Dependency adapter on PRD #2

- **Outcome:** Single adapter/module calling PRD #2 PR create with proposal payload; errors surfaced (no creds, denied).
- **Demo:** Unit or smoke: adapter invoked with fixture patch; mock or real PRD #2 path returns PR URL or typed error.
- **Budget:** 3 loops
- **Status:** NOT STARTED
- **Evidence:** I-088; `prds/2-gitops-pr-remediate.md`
- **Loop log:** *(empty)*

#### M2.S2 — UX order: pre-flight then propose

- **Outcome:** Primary path shows pre-flight before PR create control is armed.
- **Demo:** Cold entry: PR button disabled or secondary until pre-flight completes; after pre-flight, Propose works; no apply control exists.
- **Budget:** 3 loops
- **Status:** NOT STARTED
- **Evidence:** I-088
- **Loop log:** *(empty)*

---

### M3 — Post-merge verification

**Fence:** Verify only. No new execute path.

**Integration demo:** After a known merged fixture change (or simulated "applied" marker), Verify runs and shows recovered or not recovered against a chosen metric/alert; Explore link opens.

#### M3.S1 — Bind verify to change identity

- **Outcome:** Verify entry accepts PR URL and/or session/change id and loads baseline expectations from the pre-flight snapshot when stored.
- **Demo:** Paste fixture PR link or session id; Verify knows which workload/signals to check (or asks once, then remembers for the slice).
- **Budget:** 3 loops
- **Status:** NOT STARTED
- **Evidence:** I-087
- **Loop log:** *(empty)*

#### M3.S2 — Run verify queries and render outcome

- **Outcome:** Plugin re-queries telemetry and renders recovered | not recovered | inconclusive with timestamps and links.
- **Demo:** Force not-recovered fixture (alert still firing); UI says not recovered; force clear alert; UI says recovered; missing datasource → inconclusive.
- **Budget:** 3 loops
- **Status:** NOT STARTED
- **Evidence:** I-087, I-090
- **Loop log:** *(empty)*

---

### M4 — Docs honesty pass

**Fence:** Copy only.

**Integration demo:** README explains pre-flight + verify + PRD #2 trigger; states Headlamp owns day-2 lifecycle; points at Considered and deferred for Build/Update.

#### M4.S1 — README + demarcation

- **Outcome:** 60-second read cannot confuse Accept/Propose with live apply or claim Headlamp parity.
- **Demo:** External reader checklist passes; links to PRD #2 and #4.
- **Budget:** 2 loops
- **Status:** NOT STARTED
- **Evidence:** Viktor demarcation; I-026/I-077 deferred notes
- **Loop log:** *(empty)*

## Considered and deferred

**Not deleted — explicitly not scheduled as Grafana work.**

Viktor's surface demarcation:

- **Grafana** — observability-first intelligence and **GitOps-PR triggering**.
- **Headlamp** — day-2 **object lifecycle** and direct resource actions.

A Grafana **Build** (`recommend`) or **Update** (`operate`) wizard would duplicate Headlamp and is the **most likely rejection**. Live `executeRemediation` from Grafana would also violate ADR-0019 / GitOps-SoT in this estate.

| id | title | why deferred |
|----|-------|--------------|
| I-026 | Expand operate and recommend (Grafana surface) | Day-2 lifecycle = Headlamp. Grafana execute participation = PRD #2 GitOps PR + this PRD's pre-flight/verify, not operate/recommend wizards. |
| I-077 | Leave Recommend wizard to Headlamp (qualified) | Stands: do not clone Headlamp Recommend/Operate UI in Grafana. Kept so "Build/Update-in-Grafana" remains a visible non-choice if someone reopens it. |

Related still-true outs:

- **I-076** resource-detail injection → Headlamp (usability register / out-of-scope).
- **PRD #2** remains the only propose→PR implementation owner — this PRD consumes it.

If product strategy later reverses Viktor's demarcation, reopen these rows with a **new** PRD number — do not silently expand #4 into a cluster manager.

## Decisions

| date | decision | rationale |
|------|----------|-----------|
| 2026-09-03 | PRD #4 = evidence-grounded pre-flight + post-merge verify | Unowned; needs time-series; only Grafana closes the loop |
| 2026-09-03 | Filename `4-evidence-grounded-change-safety.md` | Matches scope; not Build/Update |
| 2026-09-03 | Do not implement Grafana operate/Build wizards | Viktor demarcation; Headlamp owns day-2 lifecycle |
| 2026-09-03 | Execute trigger = PRD #2 GitOps PR only | Viktor blessed GitOps-PR path for Grafana; analysis-only v1 was sequencing |
| 2026-09-03 | Do not duplicate PRD #2 SCM/token/RBAC specs | Single PR mechanism |
| 2026-09-03 | ADR-0019 write-to-Git | No direct apply from plugin into KRO-owned ns |
| 2026-09-03 | I-026 / I-077 retained as deferred | Owner asked Build/Update ideas preserved without claiming territory |

## Idea register (append-only)

### Rules

Append-only; never delete ids; full prose. Moved ids keep original numbers. New work continues **I-086+**.

### Arithmetic

| item | count |
|------|-------|
| Moved full rows (considered-and-deferred) | 2 (I-026, I-077) |
| New active-scope rows | 5 (I-086…I-090) |
| **Register rows in this file** | **7** |
| Usability draft stubs for I-026/I-077 | 2 |
| Original I-001…I-085 traceable | **85** |

| id | title | description | source | origin | disposition | slice |
|----|-------|-------------|--------|--------|-------------|-------|
| I-026 | Expand operate and recommend | Expand the Grafana plugin beyond Query/Remediate analysis into full `operate` and `recommend` tool surfaces. PRD #2 explicitly lists this as out of scope; Headlamp already covers broader operate. Kept here so the non-goal is not forgotten. **2026-09-03 reframe:** Not delivered as a Grafana Build/Update surface. Viktor demarcates Grafana = observability-first intelligence + GitOps-PR triggering; Headlamp = day-2 object lifecycle and direct resource actions. A Grafana operate/Update wizard would duplicate Headlamp and is the most likely rejection. Row kept visible under PRD #4 Considered-and-deferred. Active PRD #4 scope is telemetry-grounded pre-flight impact and post-merge verification around the PRD #2 PR path. | `prds/2-gitops-pr-remediate.md:31` | PRD2 | PARKED (deferred — Headlamp owns day-2 object lifecycle per Viktor demarcation) | — |
| I-077 | Leave Recommend wizard to Headlamp | Headlamp ships the Recommend multi-step deploy wizard and live operate/remediate execute (`vfarcic/dot-ai-headlamp`). **Do not** duplicate that in Grafana. Viktor: Grafana must not become a second Kubernetes cluster manager. Original "leave Recommend to Headlamp" stands for day-2 lifecycle. Grafana's unowned wedge is evidence-grounded **pre-flight** and **post-merge verification** (PRD #4 active scope), plus GitOps-PR triggering (PRD #2). This row remains for audit so Build/Update-in-Grafana stays a visible non-choice. | `vfarcic/dot-ai-headlamp` README + `src/index.tsx`; this PRD §IaC findings table | iac-role-split | PARKED (deferred — Headlamp owns Recommend wizard / live day-2; Grafana does not clone it) | — |
| I-086 | Telemetry-grounded impact pre-flight | Before a GitOps-PR change is opened or accepted, run dot-ai `impact_analysis` (or equivalent blast-radius analysis) enriched with **live Grafana telemetry**: is the target serving traffic now, does it have a firing alert, what is the error-budget or burn signal. Today blast radius from the Kubernetes dependency graph alone can say "safe per the graph" while the workload is at 400 rps with an active alert — different answers. Visible change: a Pre-flight panel on the change path showing graph impact **and** telemetry risk factors packed from Current/stack evidence. | Viktor surface demarcation 2026-09; owner PRD #4 reframe — PRE-FLIGHT; no existing PRD owns this | owner-idea | OPEN | — |
| I-087 | Post-merge metric verification | After a GitOps PR merges and ArgoCD applies, verify in Grafana whether the **metric actually recovered** (or the intended signal moved). Headlamp cannot close this loop — it has no telemetry. Grafana Assistant cannot act on the cluster/GitOps side. Visible change: a Verify step tied to the merged change (session or PR link) that re-queries Prom/Loki/Alertmanager and reports recovered / not recovered / inconclusive with links back into Explore. | Viktor surface demarcation 2026-09; owner PRD #4 reframe — POST-MERGE; differentiator vs Headlamp and Assistant | owner-idea | OPEN | — |
| I-088 | Bind pre-flight to PRD #2 PR path | Consume PRD #2's propose → GitOps PR path as the **only** execute trigger from Grafana. Pre-flight runs **before** or **as a gate on** opening the PR; this PRD does not re-specify SCM, tokens, or RBAC. Visible change: operator cannot click through to PR create without seeing pre-flight output (or an explicit waive with audit reason if product allows waiving later). | Viktor: GitOps-PR is the blessed Grafana execute path; prds/2-gitops-pr-remediate.md issue #13 | owner-idea | OPEN | — |
| I-089 | Pack firing alerts into blast radius | When impact_analysis identifies affected workloads, join Alertmanager frames already in Current (and/or live alert queries) so pre-flight lists **active alerts** on those objects. "No dependents in the graph" must not hide "this Deployment has page-severity alerts firing." Visible change: pre-flight alert chips with deep links using existing Map/Explore builders where PRD #3 has landed them. | grafanaStack.ts Alertmanager packing; impact_analysis gap | owner-idea | OPEN | — |
| I-090 | Record traffic and error-budget signals | Define the minimum PromQL (or datasource-backed) signals the plugin will treat as "serving traffic" and "error budget / burn" for pre-flight and post-merge verify — preferably from org patterns or known recording rules, not one-off hardcoding per app. Visible change: documented signal contract + empty state when metrics are missing so we never invent green. | owner PRD #4 reframe; estate SLO/recording-rule practice [INFERENCE] may vary | owner-idea | OPEN | — |

## Work Log

### 2026-09-03 — PRD opened (reframed from Build/Update mistake)

- **Issue:** Usability draft needed a home for change-loop work only Grafana can do. An intermediate frame ("Build/Update-in-Grafana via recommend/operate") conflicted with Viktor: Headlamp owns day-2 lifecycle; Grafana must not become a second cluster manager; GitOps-PR is the blessed Grafana execute path (already PRD #2).
- **Action:** Author PRD #4 as **evidence-grounded change safety and verification** (pre-flight telemetry join + post-merge verify). Depend on PRD #2; do not respec it. Park I-026/I-077 under Considered and deferred. Add I-086–I-090. No edits to `prds/1-*` or `prds/2-*`.
- **Prompt:** Scope correction from parent — Viktor verbatim demarcation.
