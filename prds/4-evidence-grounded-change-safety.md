# PRD: Evidence-grounded change safety and verification

**Issue**: TBD — file on LesleyMurfin/dot-ai-grafana (number confirmed only on filing)
**PRD**: **#4** (free after #1 v1, #2 GitOps-PR execute, #3 M7 Map)
**Priority**: High (closes the change loop only Grafana can close; depends on PRD #2 for PR trigger)
**Status**: Draft
**Updated**: 2026-09-03

> **Filename:** `prds/4-evidence-grounded-change-safety.md`. Set **Issue** when filed. PRD index is **4** even if the GitHub issue number differs.

## Current State

- **Goal:** Make Grafana the place where a GitOps change is **pre-flighted against live telemetry**, judged for **whether now is a safe time**, **verified after merge**, and optionally **recorded back into operational knowledge** — not a second Kubernetes day-2 manager.
- **Active milestone:** None started. Draft until issue filed; needs PRD #2 PR path (or a test double) for integration demos that end in a real PR.
- **Next action:** File issue; freeze M1 Outcome/Demo; inventory which `impact_analysis` / remediate fields the engine already returns vs what the plugin must join from Current; clarify `manageKnowledge` write-back capability with upstream ([UNVERIFIED]).
- **Write rule (estate):** dot-ai may read broadly; cluster writes go through **Git** only. Direct apply into KRO-owned namespaces is manufactured drift (ADR-0019, `riley_infrastructure`). Grafana's blessed execute trigger is **PRD #2 propose → GitOps PR**, not live apply.
- **Surface demarcation (Viktor):** Grafana = observability-first intelligence + GitOps-PR triggering. Headlamp = day-2 object lifecycle and direct resource actions. Do not turn this plugin into a duplicate cluster manager.
- **Rationale captured (2026-09-03):** Change-safety failure patterns from large-operator field experience, the third capability (**is now a safe time?**), and the bidirectional knowledge loop (`manageKnowledge` read + write-back) are now in this PRD.
- **Attachment (2026-09-03):** This PRD now attaches to `operate`'s existing change-safety envelope (dry-run → approval → execute → validate; Risk Assessment; `opr-` sessions) rather than inventing a parallel one. Whether telemetry-aware risk and metric-recovery validation land in the **engine** (via PRD #1 M13 `mcp-grafana`) or the **plugin** is an open architectural question for Viktor — see §Where this attaches and §Open architectural question.
- **Not this PRD:** Map/markdown/show-me (PRD #3); analysis-only v1 packing (PRD #1); PR mechanism internals (PRD #2); thread/wait/ship usability (unnumbered usability PRD); Headlamp Recommend/Operate live wizards.

## Problem

Three halves of the change loop need **time-series**. None is fully owned by an existing PRD.

### Why change safety fails in practice

Field experience running changes at a large telecommunications operator shows the same breakdown repeating. It is an **information and systems** failure — not a failure of the people on the change window.

**Runbooks go dark.** Procedures are absent, stale, or not understood at the moment of execution. The change proceeds without a reliable, current description of what it touches, so the executor works from a ticket summary rather than from evidence of prior outcomes.

**Context does not travel across shifts.** The person who wrote the plan is often not the person who runs it at 03:00 in another time zone. Understanding stays in chat threads and individual memory; the ticket carries steps, not the why, the known side effects, or the last time this path failed. Handover is a systems gap: nothing durable carries context forward when a shift ends.

**Nobody knows where to look.** Impact confirmation depends on knowing which dashboards, services, and customer-facing signals matter for *this* change. When that map is missing, customer-visible failure is discovered by customers (or by overnight firefighting) rather than by the change process itself. The failure mode is invisible state at execution time, not lack of care.

**Concurrent degradation multiplies risk.** A change that is safe in isolation becomes catastrophic when the system is **already degraded by an unrelated concurrent event** — another change reconciling, an active incident, anomalous traffic, a burn already in progress. Because the pre-existing state was never visible at execution time, the larger outage is hard to attribute and easy to repeat. Graph-only blast radius cannot see that the network (or cluster estate) is already in an unusual state relative to its own history; only live time-series and change-in-flight signals can.

These four patterns convert "search a runbook" into a harder product problem: **make the relevant knowledge present at the moment of change, make current system health visible before act, and write back what actually happened so the next executor inherits evidence.**

### Pre-flight is graph-only today

`impact_analysis` (and similar blast-radius reasoning) answers from the **Kubernetes dependency graph**: who depends on whom, what might break if this object changes. That is necessary and insufficient.

With Grafana in the path we can also answer:

- Is this serving traffic **right now**?
- Does it have a **firing alert**?
- What is the **error budget / burn** posture?
- **Is now a safe time** to change this at all (degraded baseline, concurrent change, active incident)?

"Safe per the graph" and "backs a workload at 400 rps with an active page" are different answers. Shipping a GitOps PR without that join is how "green" changes land in red production. A Kubernetes state snapshot shows what **exists**; it does not show whether the system is currently unusual relative to its own history. Only time-series (and related live signals) answer that.

### Post-merge has no closer

After the PR merges and ArgoCD applies:

- **Headlamp** can show object state; it has **no** telemetry loop to say the metric recovered.
- **Grafana Assistant** can chat about panels; it does **not** own the GitOps act or the remediate session that opened the PR.
- **PRD #2** opens the PR; it does not define verify-after-apply.

The differentiator is closing **diagnose → (is it safe now?) → (what will it touch?) → GitOps PR → apply → verify → record what happened** on one observability-first surface.

### Knowledge is one-way today

dot-ai ships `manageKnowledge`: ingest documents by URI, semantic search, delete by URI; answers carry source references. Headlamp already surfaces a Knowledge Base search; the Grafana plugin has **none**.

That is still a **read** posture. The field patterns above demand **read and write**:

- **Read:** surface the relevant runbook next to the alert or change that needs it — in Grafana, not in another system the night operator may not open.
- **Write:** after a change, capture what actually happened (resources that moved, metrics that deviated, alerts that fired and cleared, recovery duration) and attach that evidence to the runbook so the next executor inherits history instead of tribal knowledge.

Whether `manageKnowledge` supports **incremental write-back of execution evidence** (as opposed to ingest-by-URI of whole documents) is **[UNVERIFIED]**. Do not assume write-back works until confirmed with upstream or engine docs; treat it as an open product/engineering question (see Open questions and I-094).

### What this is not

Analysis-only v1 was **sequencing** (Viktor: ship the smaller read-only thing, then a separate PRD for the GitOps-PR path) — not a permanent ban on Grafana participating in change. The execute path he explicitly blessed for Grafana is **GitOps-PR** (**PRD #2**). This PRD does not replace PRD #2 and does not add a Grafana `operate`/Update object-lifecycle wizard.

## Where this attaches: the `operate` tool

This PRD must not invent a second change-safety envelope. The engine already ships one: the **`operate` tool**. What follows is what the public docs already document, the precise gap relative to this PRD's three capabilities, and the extension point the engine itself names. Source for every load-bearing claim in this section: [Operate Guide](https://devopstoolkit.ai/docs/ai-engine/tools/operate).

### What `operate` already does

Documented eight-step flow ([Operate Guide — How AI-Driven Operations Work](https://devopstoolkit.ai/docs/ai-engine/tools/operate)):

| stage | what `operate` does today | source |
|-------|---------------------------|--------|
| 1. Intent analysis | AI understands the operator's natural-language operational goal | [Operate Guide](https://devopstoolkit.ai/docs/ai-engine/tools/operate) |
| 2. Cluster investigation | Inspects current state and discovers relevant resources | same |
| 3. Context integration | Applies organizational patterns, policies, and cluster capabilities | same; optional patterns/policies via org-data guides |
| 4. Solution design | Generates an operational plan that satisfies the intent | same |
| 5. Dry-run validation | Tests every proposed change before it is shown for approval | same; Key Features: "Dry-run validation — All changes tested before proposing" |
| 6. User approval | Operator reviews proposed changes with full transparency | same |
| 7. Execution | Executes **exactly** the approved commands | same; Key Features: "Safe execution — Exact approved commands executed with comprehensive validation" |
| 8. Validation | AI verifies the **operation completed successfully** | same; Key Features: "Iterative validation — Verifies operations completed successfully with AI analysis" |

Documented product features already on the same page (not a wishlist): natural-language operations; cluster-aware decisions; Helm release support; pattern-driven operations; policy enforcement before execution; dry-run validation; safe execution of approved commands; iterative post-execution validation; **MCP server integration** to augment analysis with external MCP tools ([Operate Guide — Key Features](https://devopstoolkit.ai/docs/ai-engine/tools/operate)).

The worked example's analysis output already carries structured fields a change-safety surface needs ([Operate Guide — Complete Workflow Example](https://devopstoolkit.ai/docs/ai-engine/tools/operate)):

| output field | what it already conveys |
|--------------|-------------------------|
| Current State | Target object, replica health (e.g. 2/2 running), image, strategy, resources |
| Proposed Changes | What will change, with rationale |
| Commands to Execute | Exact commands the operator is asked to approve |
| Dry-Run Validation | Pass/fail of the proposed change before execution |
| Patterns Applied | Organizational patterns that shaped the plan (or None) |
| Capabilities Used | Cluster capabilities the plan relied on |
| Policies Checked | Governance rules evaluated, with pass/fail |
| Risk Assessment | Stated risk level plus reasoning |
| Session ID | `opr-…` session identity for the operation |
| Visualization (`visualizationUrl`) | Interactive analysis view when `webUI.baseUrl` is configured (`/v/opr-…`) |

Be clear: a great deal of the envelope this PRD cares about **already exists** in core `operate`. This companion work is an **enhancement of that envelope**, not a parallel invention.

### The precise gap

In the docs' own worked example, risk is stated as **LOW RISK** for scaling demo-api from 2 to 4 replicas, with reasoning along the lines of a non-disruptive scale on a deployment whose current state shows healthy replica counts (2/2 running) — paraphrased for the reader as *"LOW RISK — Scaling up from 2 to 4 replicas on healthy deployment"* ([Operate Guide — Complete Workflow Example](https://devopstoolkit.ai/docs/ai-engine/tools/operate)). **"Healthy" there is derived from replica count and cluster state.** It is **not** derived from:

- live traffic / request rate relative to baseline,
- firing alerts on the blast set or shared dependencies,
- error-budget burn,
- whether another change is mid-reconcile.

That is exactly the gap behind this PRD's first capability — **is now a safe time?** — and part of **what will it touch?** when "touch" includes live risk factors, not only graph dependents.

Step 8 is equally precise about what it does **not** do. Documented validation "verifies operations completed successfully" / "Verifies operations completed successfully with AI analysis" ([Operate Guide](https://devopstoolkit.ai/docs/ai-engine/tools/operate)). That is **operation-completed** validation (did the scale/apply land; does cluster state match the intent), **not** **metric-recovered** validation (did the SLO/error signal the change was meant to move actually move). That is this PRD's third capability — **did it work?** in telemetry terms.

| this PRD capability | what `operate` already covers | what is still missing |
|---------------------|-------------------------------|------------------------|
| **Is now a safe time?** | Risk Assessment + Policies Checked + dry-run before approval | Risk grounded in **traffic / alerts / burn / concurrent reconcile**, not replica/cluster health alone |
| **What will it touch?** | Current State, Proposed Changes, commands, Patterns/Capabilities, graph- and capability-aware plan | Join of blast set with **live** alert/traffic/burn factors (and runbook presence) at decision time |
| **Did it work?** | Step 8 AI validation that the **operation completed** | Validation that the **metric recovered** (or intended signal moved), bound to the change/`opr-` session |

Read this PRD as **folding evidence into an existing envelope**, not as standing up a second one beside `operate`.

### The extension point already exists

The same Operate Guide lists: **"MCP server integration — Augment analysis with tools from external MCP servers (e.g., Prometheus metrics)"**, with a pointer to MCP Server Integration in the deployment docs ([Operate Guide — Key Features](https://devopstoolkit.ai/docs/ai-engine/tools/operate)). The engine already anticipates telemetry augmentation of analysis.

That extension point is PRD #1's milestone **M13 (`mcp-grafana`)**. PRD #1 marks M13 as **core `vfarcic/dot-ai` work** and explicitly **"Not this companion repo."** If telemetry-aware risk assessment is delivered by registering `mcp-grafana` with the engine, every surface that already calls `operate` (CLI, Web UI, Headlamp, and any Grafana path that reuses the tool) inherits it — see the open architectural question next.

## Open architectural question: engine or plugin?

If telemetry can enter `operate` through engine-side MCP registration, **much of what this PRD wants may be a core-repo concern rather than a Grafana-plugin concern.** That tension must stay visible. Two fair readings:

### Reading A — this belongs in the engine

Register `mcp-grafana` (PRD #1 M13) with the **engine**. Then `operate` and `remediate` can perform telemetry-aware risk assessment and richer post-execution checks for **every** surface at once — CLI, Headlamp, Web UI, and Grafana — with **no** plugin-specific join code. That is consistent with PRD #1 **DD11**'s thin-client boundary and with dot-ai's orchestrator-neutral design: intelligence and safety reasoning stay in the engine; surfaces present and approve. Under Reading A, a large fraction of "is now safe?" and even "did the metric move?" is engine work; the companion repo should not rebuild it client-side.

### Reading B — the plugin still owns something

Even a telemetry-aware engine still leaves a **human** deciding in a **surface**. Estate governance (MOP/CRA STOP triggers, change windows) is exercised by a person watching dashboards and owning go/no-go. The operator who must judge "is now a safe time" is often **already in Grafana**. Post-merge verification is as much a **display and binding** problem (change identity ↔ panels ↔ Explore ↔ evidence artifact) as a reasoning problem. Under Reading B, the engine may supply richer Risk Assessment and validation text, but the plugin still owns presentation at the decision point, STOP-checklist UX, verify-bound-to-PR views, and the human approval context that GitOps-PR (PRD #2) sits inside.

**[INFERENCE] — likely split, not a decision.** Capability-shaped guess for discussion only:

- **Engine (core `vfarcic/dot-ai`, via M13 and `operate`/`remediate` enrichment):** telemetry-augmented **Risk Assessment**; optional post-execution hooks that can assert metric/signal movement when MCP tools are available; shared session fields (`opr-…`, Policies Checked, Patterns Applied) every surface can render.
- **Plugin (this companion):** human decision UX in the observability surface; pre-flight / safe-time **presentation** joined to PRD #2 propose; post-merge **verify view** bound to PR/session identity with Explore deep links; runbook-beside-alert and evidence artifact UX; surfacing `visualizationUrl` / governance fields at the point of approval. Not a second dry-run engine.

**Viktor decides** the core-versus-companion boundary. PRD #1 DD11 already sets a thin-client line; this PRD must not override it by assertion. Until he answers the questions in §Open questions for Viktor, milestones here stay draft and must not silently assume either Reading A or Reading B as settled product law.


## Solution

```text
Ask / remediate analysis (PRD #1)
        │
        ▼
 Is now a safe time? (this PRD)
   live alerts / burn / traffic anomaly
   concurrent change or reconcile in flight
        │
        ▼
 Pre-flight (this PRD)
   impact_analysis
   + Current/stack telemetry (traffic, alerts, burn)
   + relevant runbook surface (manageKnowledge read)
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
        │
        ▼
 Record what happened (this PRD)
   evidence artifact → runbook write-back via manageKnowledge
   [UNVERIFIED] write-back API capability
```

- **Is now a safe time?** Before a change executes (or before PR create is armed), answer from **live telemetry** whether the system is already degraded: firing alerts on the blast set or shared dependencies, error-budget burn, anomalous traffic, another change already reconciling. Estate MOP/CRA practice already carries **STOP triggers** that must be re-evaluated after each step; today those triggers are evaluated by a human reading dashboards. This PRD makes the same class of questions **evaluable against live data** in the change path `[INFERENCE]` — product still decides gate vs warn-only.
- **Pre-flight:** Before (or as a gate on) PR create, show graph impact **and** telemetry risk. Pack firing alerts and traffic/burn signals for affected objects. Optionally surface the relevant runbook beside the change (`manageKnowledge` read).
- **Trigger:** Call into **PRD #2**'s PR mechanism only. No `kubectl apply`, no Headlamp `executeRemediation` from this plugin.
- **Post-merge verify:** Given PR/session/change identity, re-query metrics/logs/alerts; report outcome; link Explore. Inconclusive when signals missing — never fake green.
- **Record what happened:** Capture post-change evidence as a durable artifact; attempt runbook write-back so context survives shift handover. Write-back mechanics remain **[UNVERIFIED]** until `manageKnowledge` capabilities are confirmed.

### Why only time-series answers "is now safe?"

A Kubernetes API snapshot answers inventory and desired/observed object state. It does **not** answer: is error budget already burning? is traffic 3× baseline? is there an active incident on a shared dependency? is ArgoCD (or another controller) already reconciling a conflicting change? Those are **relative-to-history** and **in-flight** questions. Grafana's datasources are the natural home; Headlamp without telemetry cannot judge them; Assistant without an action path cannot bind them to a GitOps change.

## Why not just use Headlamp

Headlamp already owns day-2 **object lifecycle**: kind-agnostic Remediate/Operate detail sections, live `executeRemediation`, multi-step Recommend wizard (`vfarcic/dot-ai-headlamp`). It can **act**. It has **no** live telemetry loop, so it cannot judge **whether now is a safe time** to change, nor **whether the metric recovered** after apply, nor write back time-series evidence into operational knowledge.

Grafana Assistant, in Viktor's words, "does only analysis … it cannot fix it." It can **observe** panels and chat; it does not own the GitOps act, the remediate session that opened the PR, or durable write-back of what the change did.

| Need | Headlamp | Grafana Assistant | Grafana (this PRD) |
|------|----------|-------------------|--------------------|
| Edit/approve live resource change | **Yes** (default companion path) | **No** | **No** — out of scope |
| Open GitOps PR | Not the estate's Grafana-blessed path | **No** | **PRD #2** trigger from Grafana |
| Blast radius + **live traffic/alerts/burn** | Graph/API only | Observe only | **This PRD** pre-flight |
| **Is now a safe time?** (degraded / concurrent) | **Cannot** (no telemetry) | Observe only; no change bind | **This PRD** third capability |
| Did the **metric recover** after apply? | **Cannot** (no telemetry) | Chat only; no change bind | **This PRD** post-merge verify |
| Surface runbook beside alert/change | Knowledge search in Headlamp | **No** product path here | **This PRD** (Grafana has none today) |
| Write back what happened to the runbook | **Not** this loop | **No** | **This PRD** — write-back **[UNVERIFIED]** |

The full loop — **is it safe now → what will it touch → propose as a PR → verify recovery → record what happened** — needs **telemetry and an action path in the same surface**. Proven today: Grafana reaches Prom/Loki/Alertmanager; dot-ai exposes `impact_analysis` and `manageKnowledge` (read/ingest); PRD #2 is the blessed PR path once built. Unproven / open: automatic STOP-trigger evaluation product UX; concurrent-change detection signals; `manageKnowledge` **incremental write-back** of execution evidence **[UNVERIFIED]**; Grafana-side Knowledge UI (Headlamp already has search).

**Honest limit:** If pre-flight only rephrases graph output without real metric joins, "is now safe" is a static banner with no live signals, or verify is a manual "open Explore" bookmark with no change binding, this PRD has no wedge — **PARK**. Do not "fill the gap" by cloning Headlamp's Recommend/Operate UI (see **Considered and deferred**).

## Scope

- Post–PRD #1 Ask/remediate analysis + Current packing.
- **Depends on PRD #2** for propose → GitOps PR (tokens, RBAC, SCM). **Do not re-specify PRD #2.**
- **Three co-equal capabilities:** (1) **is now a safe time?** — degraded baseline / concurrent change detection from live telemetry before act; (2) **pre-flight** — `impact_analysis` joined with traffic, alerts, burn; (3) **post-merge verify** — metric/alert recovery bound to change identity. Plus knowledge **read** in-path and evidence **write-back** intent (`manageKnowledge` write **[UNVERIFIED]**).
- Pre-flight UI + client join of `impact_analysis` (or engine equivalent) with Grafana telemetry (Prom/Loki/Alertmanager already reachable via plugin patterns).
- Safe-time / STOP-style checks: firing alerts, burn, anomalous traffic, in-flight reconcile/change signals where detectable; honest warn vs hard-gate is a product decision.
- Post-merge verification UI bound to a change identity (PR URL, session id, or equivalent).
- Signal contract for traffic / burn / alert joins; honest empty states.
- Runbook surface beside alert/change in Grafana; post-change evidence artifact; write-back exploration marked **[UNVERIFIED]**.
- e2e: pre-flight shows telemetry factor on a fixture workload with a firing alert; safe-time panel warns on degraded fixture; verify after a merged fixture change reports recovered or not recovered without cluster apply from the plugin.
- May **reuse** PRD #3 Explore/Map link builders when present; must not block on PRD #3 if links degrade to plain Explore URLs.

## Out of scope

- **PRD #3** Map/markdown/show-me ownership ([issue #23](https://github.com/LesleyMurfin/dot-ai-grafana/issues/23) / [PR #22](https://github.com/LesleyMurfin/dot-ai-grafana/pull/22)).
- **PRD #2 internals** (SCM API, token split implementation, who-may-open-PR policy engine).
- Direct `kubectl apply` / live execute from Grafana.
- Grafana **Build/Update** / `recommend` / `operate` object-lifecycle wizards (Headlamp; see Considered and deferred).
- Duplicating Headlamp resource-detail injection (I-076).
- Thread history, async 202 job-poll, ship/identity docs (usability PRD).
- Engine forks; org signal config via existing patterns where possible.
- Guaranteeing `manageKnowledge` write-back before upstream capability is verified.

## Open questions for Viktor

- Does `manageKnowledge` support **incremental write-back** of execution evidence (structured append / update of an existing knowledge URI), or only whole-document ingest by URI? **[UNVERIFIED]** — blocks I-094 delivery shape. (Existing question; **[UNVERIFIED]** flag carried forward — not newly opened here.)
- Should **telemetry-aware risk assessment** for `operate` and `remediate` be delivered by registering **`mcp-grafana` with the engine** (PRD #1 **M13**) rather than by the Grafana plugin joining telemetry client-side? See §Where this attaches and §Open architectural question.
- If the engine gains telemetry via M13, what remains **genuinely plugin-side** — is it only presentation, change-identity binding, and the human decision point (Reading B), or does the plugin still own substantive safe-time/verify logic?
- Does `operate`'s **post-execution validation** step (flow step 8) have any hook today for asserting a **metric recovered**, or is it strictly **cluster-state / operation-completed** validation? **[UNVERIFIED]** against engine internals beyond the public [Operate Guide](https://devopstoolkit.ai/docs/ai-engine/tools/operate) wording.
- Which live signals reliably mean "another change is in flight" in this estate (ArgoCD app conditions, MOP ticket state, annotation conventions)?
- Product default: **warn** vs **hard-gate** when safe-time checks fail?
- Minimum evidence schema for post-change artifacts so write-back stays useful across shifts without becoming a dump of raw frames.

## Success criteria

- Operator sees pre-flight that can disagree with "graph says safe" when telemetry says hot (traffic and/or firing alert and/or burn) on a demo fixture.
- Operator sees a first-class **is now a safe time?** result that can warn when the baseline is already degraded or a concurrent change is detected (fixture), distinct from graph blast radius.
- Operator triggers PR create only through PRD #2 path after pre-flight (or documented waive — default is show pre-flight first).
- After merge/apply (fixture), verify reports recovered / not recovered / inconclusive with evidence links — not a blank spinner.
- Post-change evidence can be captured as a durable artifact; runbook write-back is attempted only if `manageKnowledge` capability is confirmed, otherwise the gap stays explicit.
- No path in this PRD applies to the cluster.
- Docs state Headlamp vs Grafana split without claiming day-2 lifecycle parity; docs state Assistant observes but does not close the GitOps loop.


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
| 2026-09-03 | Third co-equal capability: **is now a safe time?** | Field experience at a large telecom operator: concurrent degradation + invisible baseline; only time-series answers; MOP/CRA STOP triggers need live evaluation |
| 2026-09-03 | Bidirectional knowledge loop in scope (read + write intent) | Runbooks must surface in Grafana; post-change evidence must travel across shifts; `manageKnowledge` write-back **[UNVERIFIED]** |
| 2026-09-03 | I-091…I-097 opened | Safe-time, concurrent change, evidence capture/write-back, runbook-beside-alert, STOP-vs-telemetry, shift context |
| 2026-09-03 | Attach PRD #4 to existing `operate` envelope; engine-vs-plugin open | Operate Guide documents dry-run/approval/validate + Risk Assessment; M13 is the named telemetry extension; Viktor owns core-vs-companion (DD11) |
| 2026-09-03 | I-098…I-102 opened | Telemetry-enriched operate risk; metric-recovery validation; engine mcp-grafana registration note; opr visualizationUrl in Grafana; Policies/Patterns visible at decision point |

## Idea register (append-only)

### Rules

Append-only; never delete ids; full prose. Moved ids keep original numbers. New work continues **I-086+** (I-091…I-102 active extensions).

### Arithmetic

| item | count |
|------|-------|
| Moved full rows (considered-and-deferred) | 2 (I-026, I-077) |
| New active-scope rows | 17 (I-086…I-102) |
| **Register rows in this file** | **19** |
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
| I-091 | Detect degraded baseline before change | Before a change proceeds, answer from live telemetry whether the system is **already degraded**: firing alerts on the blast set or shared dependencies, elevated error-budget burn, anomalous traffic vs baseline. A change that is "graph-safe" on a quiet estate is not the same change on an estate already in trouble. Visible change: first-class **Is now a safe time?** panel (or equivalent gate/warn) that can disagree with "proceed" when the baseline is hot — distinct from blast-radius listing. Framed as an information gap at execution time, not operator error. | large-operator field experience (anonymised); this PRD Problem §Why change safety fails; MOP/CRA STOP practice | owner-idea | OPEN | — |
| I-092 | Detect concurrent in-flight change or reconcile | Before act, detect collision risk: another change already reconciling (e.g. ArgoCD sync/progressing), overlapping MOP/change identity, or controller thrash on the same objects. Isolation-safe plans fail when concurrent work is invisible. Visible change: collision warning with the conflicting signal identity and deep link where possible; inconclusive when signals cannot be observed — never silent assume-clear. | large-operator field experience (anonymised); ArgoCD/GitOps estate [INFERENCE] signal sources vary | owner-idea | OPEN | — |
| I-093 | Capture post-change evidence artifact | After verify (or after apply marker), capture a durable artifact of **what actually happened**: resources touched, metrics that deviated, alerts that fired and cleared, recovery duration, Explore links. Purpose: the next executor inherits evidence instead of tribal knowledge left in chat. Visible change: downloadable or session-bound evidence record tied to change identity (PR URL / session id). | large-operator field experience — context does not travel across shifts; this PRD Solution §Record | owner-idea | OPEN | — |
| I-094 | Write evidence back via manageKnowledge | Push the post-change evidence artifact into the relevant runbook/knowledge entry through dot-ai `manageKnowledge` so search returns **lived outcomes**, not only static procedure text. **Capability status: [UNVERIFIED]** — engine is known to ingest by URI and answer with source references; incremental write-back / append of execution evidence is not confirmed. Visible change: only after capability proof — otherwise keep artifact local and surface the gap in UI/docs. | dot-ai `manageKnowledge` (ingest/search/delete by URI); Headlamp Knowledge Base exists; Grafana has none; write-back **[UNVERIFIED]** | owner-idea | OPEN | — |
| I-095 | Surface runbook beside firing alert in Grafana | When an alert fires (or pre-flight shows alert risk), surface the **relevant runbook** next to it in the Grafana plugin via `manageKnowledge` semantic search — not only in Headlamp's Knowledge Base UI. Operators at change time should not leave the observability surface to find "where to look." Visible change: Knowledge/runbook panel or chips bound to alert labels / impacted objects with cited sources. | Headlamp Knowledge search present; Grafana plugin has none; manageKnowledge read path | owner-idea | OPEN | — |
| I-096 | Evaluate MOP/CRA STOP triggers against live telemetry | Estate change governance already defines STOP triggers re-evaluated after each step; today a human reads dashboards to decide stop/go. Bind the same class of questions to **live Prom/Loki/Alertmanager** (and safe-time checks) so STOP is evidence-backed in the change path. Visible change: STOP checklist items show live pass/fail/inconclusive with links; product chooses warn vs hard-gate. `[INFERENCE]` exact MOP field mapping is estate-specific. | estate MOP/CRA model; this PRD Solution §Is now a safe time | owner-idea | OPEN | — |
| I-097 | Carry change context across shift handover | Package plan intent, pre-flight snapshot, open risks, and (when present) evidence/runbook links so the executor at 03:00 has what the author knew — without relying on individuals still being online. Visible change: handover summary on the change session (export or pinned panel) that survives ticket reassignment; pairs with I-093/I-094 for durability. Systems failure when context dies at shift end; not a people failure. | large-operator field experience (anonymised); Problem §context does not travel | owner-idea | OPEN | — |
| I-098 | Enrich `operate` Risk Assessment with live telemetry | Today `operate` already emits **Risk Assessment** with a stated level and reasoning, but the public worked example rates a 2→4 replica scale as **LOW RISK** from replica/cluster health ("healthy" ≈ 2/2 running), not from traffic, firing alerts, error-budget burn, or concurrent reconcile ([Operate Guide](https://devopstoolkit.ai/docs/ai-engine/tools/operate)). Enrich that field with live telemetry so "is now a safe time?" is answered inside the existing envelope rather than beside it. Visible change: Risk Assessment cites Prom/Alertmanager (or MCP-derived) factors alongside graph/cluster state; inconclusive when signals absent — never invent green. Delivery may be engine-side (M13) and/or plugin presentation — ownership open for Viktor. | [Operate Guide](https://devopstoolkit.ai/docs/ai-engine/tools/operate) Risk Assessment example; this PRD §Where this attaches gap; I-091 | owner-idea | OPEN | — |
| I-099 | Extend post-execution validation to metric recovered | `operate` step 8 validates that the **operation completed** (iterative AI validation of successful completion per docs), not that the **metric recovered**. Extend validation (engine hook and/or Grafana verify bound to `opr-`/PR identity) so "did it work?" means the intended signal moved. Visible change: recovered / not recovered / inconclusive tied to change session, with Explore links — complements I-087 without inventing a second verifier brand. Hook existence in core today is **[UNVERIFIED]**. | [Operate Guide](https://devopstoolkit.ai/docs/ai-engine/tools/operate) step 8 / iterative validation; this PRD post-merge capability; I-087 | owner-idea | OPEN | — |
| I-100 | Register `mcp-grafana` with the engine (core repo) | The Operate Guide already names MCP server integration to augment analysis with external tools, giving Prometheus metrics as the example. PRD #1 **M13 (`mcp-grafana`)** is the natural delivery of that extension point and is marked **core `vfarcic/dot-ai` work, "Not this companion repo."** Registering it with the engine would give `operate`/`remediate` telemetry-aware reasoning on **every** surface (CLI, Headlamp, Web UI, Grafana) without plugin-side reinvention. Visible change: tracked as upstream/core dependency note in this PRD — **no implementation in this companion repo**. | [Operate Guide](https://devopstoolkit.ai/docs/ai-engine/tools/operate) MCP feature; PRD #1 M13; Reading A | owner-idea | OPEN | — |
| I-101 | Surface `operate` `visualizationUrl` (`opr-` sessions) in Grafana | `operate` already returns Session ID `opr-…` and a `visualizationUrl` when `webUI.baseUrl` is configured ([Operate Guide](https://devopstoolkit.ai/docs/ai-engine/tools/operate)). Surface those in the Grafana plugin so operators can open the existing analysis view from the observability decision point — mirroring the query-session topology idea already captured elsewhere in the programme. Visible change: deep link / chip from pre-flight or change session to `/v/opr-…` (or documented fallback when Web UI base URL unset). | Operate Guide Session ID + Visualization fields; companion topology/session patterns [INFERENCE] | owner-idea | OPEN | — |
| I-102 | Show Policies Checked and Patterns Applied at Grafana decision point | `operate` output already includes **Policies Checked** (pass/fail) and **Patterns Applied** in the worked example ([Operate Guide](https://devopstoolkit.ai/docs/ai-engine/tools/operate)). Render those fields in the Grafana change/pre-flight surface so estate governance is **visible where the human decides**, not only in CLI/Headlamp/Web UI transcripts. Visible change: governance chips or checklist beside safe-time/pre-flight; pairs with I-096 STOP evaluation without re-implementing policy engines. | Operate Guide example output fields; Reading B human decision surface; I-096 | owner-idea | OPEN | — |



## Work Log

### 2026-09-03 — PRD opened (reframed from Build/Update mistake)

- **Issue:** Usability draft needed a home for change-loop work only Grafana can do. An intermediate frame ("Build/Update-in-Grafana via recommend/operate") conflicted with Viktor: Headlamp owns day-2 lifecycle; Grafana must not become a second cluster manager; GitOps-PR is the blessed Grafana execute path (already PRD #2).
- **Action:** Author PRD #4 as **evidence-grounded change safety and verification** (pre-flight telemetry join + post-merge verify). Depend on PRD #2; do not respec it. Park I-026/I-077 under Considered and deferred. Add I-086–I-090. No edits to `prds/1-*` or `prds/2-*`.
- **Prompt:** Scope correction from parent — Viktor verbatim demarcation.

### 2026-09-03 — Field insight folded in (safe-time + knowledge loop)

- **Issue:** Strongest strategic rationale from large-operator field experience was not yet in the PRD: blind/stale runbooks, context lost across shifts, "where to look" missing, and concurrent degradation invisible at execution time — all **information/systems** failures.
- **Action:** Strengthen Problem (`### Why change safety fails in practice`); add co-equal **is now a safe time?** capability and time-series rationale; reframe `manageKnowledge` as bidirectional with write-back **[UNVERIFIED]** + Open questions; extend differentiation table (Headlamp act / Assistant observe / neither write-back); register **I-091…I-097**; update Current State one-liner. No edits outside this file. Anonymised — no operator name, no individuals, no identifiable outage.
- **Prompt:** Parent assignment RunbookInsight — fold product insight into PRD #4 only.

### 2026-09-03 — Fold `operate` envelope + engine-vs-plugin tension

- **Issue:** PRD #4 risked reading as a parallel change-safety system. Public Operate Guide already documents an eight-step envelope (intent → … → dry-run → approval → execute → validate), structured output (Current State, Risk Assessment, `opr-` Session ID, `visualizationUrl`, Policies/Patterns), and MCP telemetry augmentation — while the worked example's LOW RISK and step-8 validation remain cluster/operation-scoped, not traffic/alert/burn or metric-recovered.
- **Action:** Add §Where this attaches (tables of stages + output fields; precise gap mapped to three capabilities; M13 extension point); add §Open architectural question (Reading A engine / Reading B plugin, `[INFERENCE]` split, Viktor decides); retitle/extend §Open questions for Viktor; register **I-098…I-102**; Current State attachment one-liner. No edits outside this file. Anonymisation preserved.
- **Prompt:** Parent assignment OperateFold — fold operate docs behaviour into PRD #4 only; commit, do not push.
