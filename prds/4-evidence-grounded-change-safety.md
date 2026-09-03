# PRD: Evidence-grounded change safety and verification

**Issue**: https://github.com/LesleyMurfin/dot-ai-grafana/issues/31
**PRD**: **#4** (free after #1 v1, #2 GitOps-PR execute, #3 M7 Map)
**Priority**: High (closes the change loop only Grafana can close; depends on PRD #2 for PR trigger)
**Status**: Draft
**Updated**: 2026-09-03

> **Filename:** `prds/4-evidence-grounded-change-safety.md`. Tracking issue [#31](https://github.com/LesleyMurfin/dot-ai-grafana/issues/31). PRD index is **4** even if the GitHub issue number differs.

## Current State

- **Goal:** Make Grafana the place where a GitOps change is **pre-flighted against live telemetry**, judged for **whether now is a safe time**, **verified after merge**, and optionally **recorded back into operational knowledge** — not a second Kubernetes day-2 manager.
- **Active milestone:** None started. Tracking issue #31 filed; needs PRD #2 PR path (or a test double) for integration demos that end in a real PR.
- **Next action:** Freeze M1 Outcome/Demo; inventory which `impact_analysis` / remediate fields the engine already returns vs what the plugin must join from Current; clarify `manageKnowledge` write-back capability with upstream ([UNVERIFIED]).
- **Write rule (estate):** dot-ai may read broadly; cluster writes go through **Git** only. Direct apply into KRO-owned namespaces is manufactured drift (estate GitOps source-of-truth policy: no direct apply into abstraction-owned namespaces). Grafana's blessed execute trigger is **PRD #2 propose → GitOps PR**, not live apply.
- **Surface demarcation (Viktor):** Grafana = observability-first intelligence + GitOps-PR triggering. Headlamp = day-2 object lifecycle and direct resource actions. Do not turn this plugin into a duplicate cluster manager.
- **Rationale captured (2026-09-03):** Change-safety failure patterns from large-operator field experience, the third capability (**is now a safe time?**), and the bidirectional knowledge loop (`manageKnowledge` read + write-back) are now in this PRD.
- **Attachment (2026-09-03):** This PRD now attaches to `operate`'s existing change-safety envelope (dry-run → approval → execute → validate; Risk Assessment; `opr-` sessions) rather than inventing a parallel one. Whether telemetry-aware risk and metric-recovery validation land in the **engine** (ADR-0020/`operate` consuming already-live **`grafana-mcp`**, topology graph when deployed) or the **plugin** is an open architectural question for Viktor — see §Where this attaches and §Open architectural question. Note: **`grafana-mcp` is already live** per ADR-0020; the open question is wiring into change-safety reasoning, not building the MCP from scratch.
- **North star + principles (2026-09-03):** This PRD is the **Grafana surface** of **ADR-0020** — *Agentic SRE-ops framework on Temporal (dot-ai knowledge reason, evidence + graph sense, GitOps-PR act)* (estate design hub — Agentic SRE-ops framework ADR, Proposed 2026-08-07) — not a competing framework. Operator multi-plane overlay framing, four binding design principles, and join-key hard part under §North star / §Design principles. Per ADR-0020 live-state: **`grafana-mcp` is already live**; topology graph and Kubeshark are the genuine missing planes.
- **Not this PRD:** Map/markdown/show-me (PRD #3); analysis-only v1 packing (PRD #1); PR mechanism internals (PRD #2); thread/wait/ship usability (PRD #5); Headlamp Recommend/Operate live wizards.

## North star: an instrument for the operator

**Placement:** immediately after `## Current State` and before `## Problem`, so the framework citation and operator framing precede the failure modes.

### This PRD does not invent the north star

The estate north star already exists: **ADR-0020 — Agentic SRE-ops framework on Temporal (dot-ai knowledge reason, evidence + graph sense, GitOps-PR act)** (*Status: Proposed*, 2026-08-07; path in the design hub: estate design hub — Agentic SRE-ops framework ADR). **PRD #4 is the Grafana surface of that framework** — diagnose/watch, evidence-grounded change safety, and the human decision point on the observability doorway — **not** a second agentic architecture.

ADR-0020 already composes six capabilities this PRD must not restate as original invention:

1. **Resource-agnostic reasoner** — dot-ai over the live Kubernetes API (consumes evidence; does not replace observability).
2. **K8s-native evidence stack** — Prometheus, Loki, Hubble, Kubeshark (tier-3), K8s API; largely via **`mcp-grafana` / `grafana-mcp`**.
3. **Durable orchestration** — Temporal (retries, human gates, long DAGs).
4. **Single write path** — git + KRO → ArgoCD (GitOps-PR only).
5. **Ingestable vector Knowledge Base** — semantic sense (*what does this mean*).
6. **Topology graph** — structural sense (*what depends on this / blast radius / does this causal path exist*).

Load-bearing ADR decisions this PRD inherits:

- **D3 — two complementary knowledge representations.** Vector KB and topology graph answer **different** questions and **must both be present**; GraphRAG fuses them. That is the mature form of "do not collapse disagreeing senses into one story."
- **D6 — GitOps-PR is the only mutation path**; confidence + blast-radius gate autonomy (HIGH auto / MEDIUM human signal / LOW analysis-only).
- **D8 — graph and evidence stack are derived read-only projections**, never authoritative; **graph freshness is safety-critical** because blast-radius gates actuation.
- **Surfaces (D5):** *Grafana (diagnose/watch, read-only) + Headlamp (resource-centric operate) — two doorways to one dot-ai server.* Independently matches Viktor's demarcation already in this PRD.

ADR-0020's seven-step skeleton is a **superset** of this PRD's change loop:

| ADR-0020 step | What PRD #4 serves on the Grafana doorway |
|---------------|-------------------------------------------|
| 1 Trigger | Out of scope here (alerts/schedules/drift live elsewhere); plugin may *receive* context |
| 2 Enrich | **Yes** — pack/join live evidence for the change identity (pre-flight / safe-time) |
| 3 Reason | Consumes dot-ai reasoner output; does not replace Temporal/dot-ai reasoning |
| 4 Validate | **Yes** — show deterministic/graph + telemetry ground truth the human can check |
| 5 Decide | **Yes** — human-facing decision UX (MEDIUM path); show blast-radius + dissenting evidence |
| 6 Act | **PRD #2 only** — propose GitOps PR; no live apply (aligns D6) |
| 7 Record | **Yes (intent)** — evidence artifact + knowledge write-back **[UNVERIFIED]** on `manageKnowledge` |

**What belongs to the broader framework (not this plugin alone):** Temporal orchestration, topology-graph deployment/projector, autonomy HIGH/MEDIUM/LOW policy engine, domain validation oracles, Kubeshark tier-3 MOPs, core GraphRAG, and estate-wide KB corpora. **What this plugin owns:** observability-first presentation, multi-plane overlay UX on the change path, join of packed Current/stack evidence to impact/safe-time, PRD #2 arming order, post-merge metric verify bound to change identity, and making dissent visible at the human gate.

### Operator framing (why Grafana)

Twenty-five years of network operations keep returning to the same need: **real-time data the operator can pull, overlay, and slice**, and the ability to **look forward** at what a change will do *before* it is committed. The cinematic shorthand for that forward look is the film *Minority Report* — reach into the data, see what is about to happen, act with eyes open. After that single reference, this document stays in operator language.

Chat transcripts scroll; instruments stay put. The owner’s multi-plane destination — inventory, topology, state, telemetry, logs, alarms, packet captures, netflow composited as one working set — is how an operator experiences ADR-0020’s evidence stack + graph + KB on the Grafana doorway. Build the instrument for Kubernetes first; extending the same shape to the network remains a hypothesis (below).

### Eight planes — honest live state

Statuses below follow **ADR-0020 live-state verification (2026-08-07)** plus what this companion already packs on the Ask/Current path. Correct a prior mis-frame: **`grafana-mcp` (`mcp-grafana`) is already live** in `monitoring`, targeting in-cluster Grafana with a SA token — ADR-0020 calls it *the single cheapest integration already running*. Hubble is **live**. The two **genuinely missing** overlay planes are the **topology graph** (net-new) and **Kubeshark** (not deployed; privileged, MOP-gated tier-3).

| plane | Provider (this estate) | status |
|-------|------------------------|--------|
| **Inventory** | dot-ai resource inventory / `ResourceSyncConfig` → vector DB; K8s API listing via `query` | **Live** (engine/API); not yet a first-class Grafana overlay pane |
| **Topology** | ADR-0020 topology graph (structural sense); today only partial stand-ins (ownerRefs / KRO parentage; `visualizationUrl` when Web UI configured) | **Not deployed** (graph is net-new per ADR-0020); stand-ins only |
| **State** | Live Kubernetes API via dot-ai `query` | **Live** |
| **Telemetry** | Prometheus (`mcp-grafana` + Grafana datasource / Current packing) | **Live** |
| **Logs** | Loki | **Live** |
| **Alarms** | Alertmanager | **Live** |
| **Packet captures** | Kubeshark (tier-3 PCAP / L7) | **Not deployed** — privileged, on-demand, MOP-gated (ADR-0020); also named tier-3 in PRD #1 |
| **Netflow / flows** | Cilium **Hubble** (`hubble-relay` / UI; `mcp-grafana` sensor path in ADR-0020 D5) | **Live** in-cluster; Grafana overlay join on the change path still open work |

**Implication for wiring:** observational planes need **join and UX in this surface**, not greenfield builds. Remaining net-new estate work called by ADR-0020 — topology graph, Kubeshark, Temporal skeleton, validation oracles — is **framework scope**. This companion must consume graph/capture when present and stay honest when absent (empty/inconclusive, never fake green).

### Hypothesis: same instrument, network planes

**[INFERENCE]** The same overlay generalises from Kubernetes to the network because a network operator already lives with the identical eight planes under different names: CMDB (inventory), L2/L3 topology, device configuration/state, SNMP/gNMI telemetry, syslog, fault-management alarms, taps (packet capture), and IPFIX/NetFlow. Kubernetes is the **proving ground**, not the final destination. This is a product hypothesis, not a delivery claim in PRD #4 scope, and not a claim that ADR-0020 already decided network CMDB joins.

### The hard part is the join key

The reason a multi-plane overlay has rarely shipped for networks is not lack of vision. The planes **do not share join keys**. Correlating a packet capture to a flow to an alarm to an inventory record requires common **identity**, **time**, and **topology** keys. Kubernetes gives those nearly free: namespace, pod, labels, owner references, UID, and a single cluster clock. A traditional network does not.

That complements ADR-0020 rather than duplicating it: the **topology graph (D3/D8)** is the structural store those keys must feed; **graph freshness** is safety-critical because blast-radius gates actuation (D8). Without stable join keys, GraphRAG and blast-radius are theatre. So Kubernetes is not merely the easier demo — it is where join keys already exist, which is why it is the right proving ground. **[INFERENCE]** Identifying and enforcing those keys across panes is what must be solved before any extension to the network is credible; the join key (plus a fresh graph) is the product spine, not a pile of panes.

**Implication:** on the Grafana doorway the product is an **instrument the operator works with**, not a chatbot that answers questions. PRD #4’s loop (safe-time → pre-flight → PRD #2 PR → verify → record) is how ADR-0020 steps enrich / validate / decide / record feel to a human on that doorway. A design that collapses into a scrolling answer log, a single green/red verdict the operator cannot interrogate, or disconnected panes without shared keys, has left both the operator need and ADR-0020.

## Design principles

Binding for this Grafana surface. Where they overlap ADR-0020, they are **derived**, not parallel law. Each principle states what it forbids and how a Demo would prove compliance.

### 1. Overlay, not transcript

- **The principle:** Composite multi-plane evidence into one operator-facing working view; do not make a scrolling chat log the primary change-safety surface.
- **Why:** ADR-0020 composes an evidence stack + graph + KB as senses the operator (and the skeleton) use together; chat-only UX buries concurrent degradation and disagreeing channels (§Why change safety fails in practice). Progressive-context blocks (Stable / Current / Map / History in `src/utils/progressiveContext.ts`) are a text-only seed of overlay, not the destination.
- **What it rules out:** Change-safety UX whose primary artifact is a linear assistant transcript; packing graph impact and telemetry in separate hops without a shared composite pane; eight unrelated tabs with no shared selection/identity.
- **How you would know it is being followed:** **Demo** — fixture with graph/impact dependents *and* a firing alert shows both in one pre-flight/safe-time surface without multi-turn scroll archaeology; missing planes render empty/inconclusive in-place; selection keeps panes on the same identity key.

### 2. Manipulate, not just ask

- **The principle:** Let the operator slice and re-cut evidence already gathered; do not require a new LLM round-trip for every re-filter of the same packed data.
- **Why:** ADR-0020 D5 names Grafana as **diagnose/watch, read-only** — an instrument doorway, not a second reasoner. Night operators must pull *this* dependency, alert, or burn window without another model hop. Seed: `isShowMeOnly()` in `src/utils/grafanaExplore.ts` and 0-hop Explore navigation from Grafana datasources.
- **What it rules out:** Forcing every “show only blast-set alerts” through a fresh Ask/operate completion; agency that is only “type another question.”
- **Observability-first demarcation (resolved tension):** “Manipulate” means slicing and overlaying **data** (time-series, alerts, packed Current, Explore links, future flow/capture panes). It does **not** mean mutating **Kubernetes objects** from Grafana. Object lifecycle stays with Headlamp; Grafana’s only write trigger remains **PRD #2 propose → GitOps PR** (ADR-0020 D6 + Viktor demarcation; I-026/I-077 deferred).
- **How you would know it is being followed:** **Demo** — after one pack of graph + telemetry, operator filters to alerting blast-set members (or opens Explore) with **zero** new dot-ai completion; no object-edit/live-apply control on the path.

### 3. Pre-cognition for changes

- **The principle:** Before the operator commits a change (arms PR create), render predicted impact and whether **now** is a safe time from live evidence and graph/blast context.
- **Why:** Maps to ADR-0020 steps **Validate** and **Decide** before **Act**, and to this PRD’s co-equal capabilities (safe-time, pre-flight, verify). Graph-only `impact_analysis` and replica-only “healthy” cannot see relative-to-history degradation (§Pre-flight is graph-only today; field concurrent-degradation pattern).
- **What it rules out:** Arming Propose on graph or ticket text alone; treating dry-run command success as sufficient forward view; skipping safe-time because autonomy policy lives “somewhere in Temporal.”
- **How you would know it is being followed:** **Demo** — PR control stays disarmed until safe-time + pre-flight have rendered; degraded fixture warns *before* PRD #2; quiet fixture shows honest clear/empty — never silent skip.

### 4. Show the minority report

- **The principle:** When evidence senses disagree, show each verdict side by side with the dissent visible; never collapse conflicting signals into one averaged confidence or a single risk badge the operator cannot unpack.
- **Why (derived from ADR-0020 D3 + this PRD’s field evidence):** D3 requires **two stores** — vector KB (*what does this mean*) and topology graph (*what depends on this / blast radius / does this causal path exist*) — **both present**, fused by GraphRAG, not averaged away. The same discipline extends to **graph/structural risk vs live telemetry** on the change path. `operate` today emits a single **Risk Assessment** (e.g. paraphrased worked example: *"LOW RISK — Scaling up from 2 to 4 replicas on healthy deployment"*) where “healthy” is **replica/cluster state**, not traffic, alerts, burn, or concurrent reconcile ([Operate Guide](https://devopstoolkit.ai/docs/ai-engine/tools/operate); §The precise gap). Field experience records the failure: a change that looked safe proceeding over a system **already degraded by an unrelated concurrent event** (§Why change safety fails in practice). Suppressing dissent into one green light is exactly that failure mode.
- **Relation to ADR-0020 D6 confidence tiers:** HIGH/MEDIUM/LOW may still **gate autonomy** (auto PR / human signal / analysis-only). That tier is a **policy outcome**, not a license to hide contributing channels. If graph says low blast and telemetry says page-severity burn, the human MEDIUM surface must show **both**, then the tier — not a fused “0.73 safe” that dropped the dissent.
- **What it rules out:** Single collapsed `Risk Assessment` / primary averaged confidence / one traffic-light when channels disagree; UI that shows only the winning verdict; shipping I-098 telemetry enrichment as a quieter one-badge string; treating vector *or* graph as optional when the other is present.
- **How you would know it is being followed:** **Demo** — fixture where structural/graph risk is low **and** telemetry is hot: decision surface shows **graph verdict** and **telemetry verdict** as separate labeled results with dissent explicit; optional autonomy tier is secondary and labeled as policy, not as substitute evidence; inverse fixture keeps both channels. One chip with no breakdown fails the demo.

### Principles → plan map

| principle | ADR-0020 anchor | already serving (milestones / ideas) | gap |
|-----------|-----------------|--------------------------------------|-----|
| 1 Overlay, not transcript | Evidence stack + graph + KB as co-present senses; Grafana diagnose/watch doorway | **Partial:** M1.S2 pre-flight panel; I-086, I-089, I-091, I-102. Progressive-context packing is text-only. | **No milestone** yet for durable multi-plane instrument UI or shared join keys. **I-103**, **I-108**, **I-110**. M1.S2 must not pass as transcript-shaped chrome. Topology/Kubeshark panes stay honest empty until estate deploys them (**I-109**). |
| 2 Manipulate, not just ask | D5 Grafana read-only doorway; D6 no live mutate from this surface | **Partial seed:** `isShowMeOnly` / 0-hop Explore; I-089 chips; I-087 links; I-026/I-077 deferred | **No slice** demos LLM-free re-filter of packed pre-flight evidence (**I-105**). |
| 3 Pre-cognition for changes | D1 steps Validate → Decide → Act; D6/D8 blast-radius before act | **In plan:** M1, M2, I-086, I-088, I-091, I-092, I-096; **I-106** names forward view | Delivery not started; warn vs hard-gate still open (§Open questions). |
| 4 Show the minority report | **D3** vector + graph both present; validate against graph; human sees blast-radius | **Partial intent:** success criteria “disagree with graph says safe”; I-086, I-091, I-098 | **I-098** can still be mis-read as one enriched badge. **No Demo** yet requires side-by-side dissent or forbids primary averaged score — **I-104**, **I-107**. D6 confidence tier must not become the only visible signal. |

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

That extension point is exactly what **`grafana-mcp` / `mcp-grafana`** is for. **ADR-0020 live-state (2026-08-07) verified it is already deployed** (`grafana-mcp` in `monitoring`, in-cluster Grafana + SA token) — *the single cheapest integration is already running*. PRD #1 may still track deeper engine packaging under historical M13 labels; do **not** read that as "MCP does not exist." The remaining work is **wiring** live MCP evidence (and, when deployed, the topology graph) into `operate`/`remediate` risk and into this plugin's pre-flight/verify UX so every doorway inherits telemetry-aware safety — see the open architectural question next.

## Open architectural question: engine or plugin?

If telemetry can enter `operate` through engine-side MCP registration, **much of what this PRD wants may be a core-repo concern rather than a Grafana-plugin concern.** That tension must stay visible. Two fair readings:

### Reading A — this belongs in the engine

Consume already-live `grafana-mcp` from the **engine** (and register any missing tool surface area). Then `operate` and `remediate` can perform telemetry-aware risk assessment and richer post-execution checks for **every** surface at once — CLI, Headlamp, Web UI, and Grafana — with **no** plugin-specific join code. That is consistent with PRD #1 **DD11**'s thin-client boundary and with dot-ai's orchestrator-neutral design: intelligence and safety reasoning stay in the engine; surfaces present and approve. Under Reading A, a large fraction of "is now safe?" and even "did the metric move?" is engine work; the companion repo should not rebuild it client-side.

### Reading B — the plugin still owns something

Even a telemetry-aware engine still leaves a **human** deciding in a **surface**. Estate governance (MOP/CRA STOP triggers, change windows) is exercised by a person watching dashboards and owning go/no-go. The operator who must judge "is now a safe time" is often **already in Grafana**. Post-merge verification is as much a **display and binding** problem (change identity ↔ panels ↔ Explore ↔ evidence artifact) as a reasoning problem. Under Reading B, the engine may supply richer Risk Assessment and validation text, but the plugin still owns presentation at the decision point, STOP-checklist UX, verify-bound-to-PR views, and the human approval context that GitOps-PR (PRD #2) sits inside.

**[INFERENCE] — likely split, not a decision.** Capability-shaped guess for discussion only:

- **Engine (core `vfarcic/dot-ai`, via live `grafana-mcp` + `operate`/`remediate` enrichment; topology graph when ADR-0020 deploys it):** telemetry-augmented **Risk Assessment**; optional post-execution hooks that can assert metric/signal movement when MCP tools are available; shared session fields (`opr-…`, Policies Checked, Patterns Applied) every surface can render.
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
- Thread history, async 202 job-poll, ship/identity docs (**PRD #5**).
- Engine forks; org signal config via existing patterns where possible.
- Guaranteeing `manageKnowledge` write-back before upstream capability is verified.

## Open questions for Viktor

- Does `manageKnowledge` support **incremental write-back** of execution evidence (structured append / update of an existing knowledge URI), or only whole-document ingest by URI? **[UNVERIFIED]** — blocks I-094 delivery shape. (Existing question; **[UNVERIFIED]** flag carried forward — not newly opened here.)
- Should **telemetry-aware risk assessment** for `operate` and `remediate` be delivered primarily by the **engine consuming already-live `grafana-mcp`** (ADR-0020) rather than by the Grafana plugin joining telemetry only client-side? See §Where this attaches and §Open architectural question. (MCP deploy is not the blocker; **wiring** is.)
- Given live `grafana-mcp`, what remains **genuinely plugin-side** — is it only presentation, change-identity binding, and the human decision point (Reading B), or does the plugin still own substantive safe-time/verify logic?
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

Same contract as **PRD #5** (plugin usability): frozen **Outcome / Demo / Budget**; free design; loop log; exits **SHIPPED** or **PARKED** only; milestone fence with one integration demo. PARKED is success if the wedge is weak.

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

A Grafana **Build** (`recommend`) or **Update** (`operate`) wizard would duplicate Headlamp and is the **most likely rejection**. Live `executeRemediation` from Grafana would also violate estate GitOps source-of-truth policy (no direct apply).

| id | title | why deferred |
|----|-------|--------------|
| I-026 | Expand operate and recommend (Grafana surface) | Day-2 lifecycle = Headlamp. Grafana execute participation = PRD #2 GitOps PR + this PRD's pre-flight/verify, not operate/recommend wizards. |
| I-077 | Leave Recommend wizard to Headlamp (qualified) | Stands: do not clone Headlamp Recommend/Operate UI in Grafana. Kept so "Build/Update-in-Grafana" remains a visible non-choice if someone reopens it. |

Related still-true outs:

- **I-076** resource-detail injection → Headlamp (PRD #5 usability register / out-of-scope).
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
| 2026-09-03 | GitOps source-of-truth: write via Git only | No direct apply from plugin into KRO-owned ns |
| 2026-09-03 | I-026 / I-077 retained as deferred | Owner asked Build/Update ideas preserved without claiming territory |
| 2026-09-03 | Third co-equal capability: **is now a safe time?** | Field experience at a large telecom operator: concurrent degradation + invisible baseline; only time-series answers; MOP/CRA STOP triggers need live evaluation |
| 2026-09-03 | Bidirectional knowledge loop in scope (read + write intent) | Runbooks must surface in Grafana; post-change evidence must travel across shifts; `manageKnowledge` write-back **[UNVERIFIED]** |
| 2026-09-03 | I-091…I-097 opened | Safe-time, concurrent change, evidence capture/write-back, runbook-beside-alert, STOP-vs-telemetry, shift context |
| 2026-09-03 | Attach PRD #4 to existing `operate` envelope; engine-vs-plugin open | Operate Guide documents dry-run/approval/validate + Risk Assessment; `grafana-mcp` already live (ADR-0020); wiring into operate/plugin still open; Viktor owns core-vs-companion (DD11) |
| 2026-09-03 | I-098…I-102 opened | Telemetry-enriched operate risk; metric-recovery validation; mcp-grafana wiring note; opr visualizationUrl in Grafana; Policies/Patterns visible at decision point |
| 2026-09-03 | North star = **ADR-0020**; PRD #4 = Grafana surface | Cite ADR-0020 six capabilities + D3/D6/D8/D5; do not author a competing framework; this PRD serves enrich/validate/decide/record on the Grafana doorway |
| 2026-09-03 | Product is an **operator instrument** (multi-plane overlay), not a chat surface | Operator framing under ADR-0020: pull/overlay/slice live planes and look forward before commit; Kubernetes proving ground; chat transcript is not the primary change-safety UX |
| 2026-09-03 | Conflicting evidence is **surfaced**, not collapsed | Principle 4 derived from ADR-0020 D3 (vector + graph both present) + field concurrent-degradation failure; forbids single averaged confidence / collapsed Risk Assessment as primary signal; D6 autonomy tier is policy outcome, not hidden dissent |
| 2026-09-03 | I-103…I-110 opened | Multi-plane overlay; dissent-visible dual verdict; operator slice without LLM hop; forward predicted-impact; reject primary collapsed confidence; Kubeshark missing + Hubble live (ADR-0020); correlation join keys as network-extension prerequisite |
| 2026-09-03 | Live-state correction: `grafana-mcp` **live**; Hubble **live**; topology graph + Kubeshark **missing** | ADR-0020 live-state table 2026-08-07 supersedes earlier "M13 unbuilt" framing for mcp-grafana |

## Idea register (append-only)

### Rules

Append-only; never delete ids; full prose. Moved ids keep original numbers. New work continues **I-086+** (I-091…I-110 active extensions).

### Arithmetic

| item | count |
|------|-------|
| Moved full rows (considered-and-deferred) | 2 (I-026, I-077) |
| New active-scope rows | 25 (I-086…I-110) |
| **Register rows in this file** | **27** |
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
| I-098 | Enrich `operate` Risk Assessment with live telemetry | Today `operate` already emits **Risk Assessment** with a stated level and reasoning, but the public worked example rates a 2→4 replica scale as **LOW RISK** from replica/cluster health ("healthy" ≈ 2/2 running), not from traffic, firing alerts, error-budget burn, or concurrent reconcile ([Operate Guide](https://devopstoolkit.ai/docs/ai-engine/tools/operate)). Enrich that field with live telemetry so "is now a safe time?" is answered inside the existing envelope rather than beside it. Visible change: Risk Assessment cites Prom/Alertmanager (or MCP-derived) factors alongside graph/cluster state; inconclusive when signals absent — never invent green. Delivery may be engine-side (wiring already-live grafana-mcp) and/or plugin presentation — ownership open for Viktor. | [Operate Guide](https://devopstoolkit.ai/docs/ai-engine/tools/operate) Risk Assessment example; this PRD §Where this attaches gap; I-091 | owner-idea | OPEN | — |
| I-099 | Extend post-execution validation to metric recovered | `operate` step 8 validates that the **operation completed** (iterative AI validation of successful completion per docs), not that the **metric recovered**. Extend validation (engine hook and/or Grafana verify bound to `opr-`/PR identity) so "did it work?" means the intended signal moved. Visible change: recovered / not recovered / inconclusive tied to change session, with Explore links — complements I-087 without inventing a second verifier brand. Hook existence in core today is **[UNVERIFIED]**. | [Operate Guide](https://devopstoolkit.ai/docs/ai-engine/tools/operate) step 8 / iterative validation; this PRD post-merge capability; I-087 | owner-idea | OPEN | — |
| I-100 | Wire already-live `grafana-mcp` into engine change-safety | **Correction (ADR-0020 live-state 2026-08-07):** `grafana-mcp` / `mcp-grafana` is **already deployed** in `monitoring` (in-cluster Grafana + SA token) — not a greenfield build. The Operate Guide names MCP integration to augment analysis with external tools (Prometheus example). Work remaining is **wiring** that live MCP (and Hubble sensors ADR-0020 already counts on) into `operate`/`remediate` risk and validation so every surface inherits telemetry-aware safety, plus optional deeper packaging notes historically labeled PRD #1 M13. Visible change: engine/session risk cites MCP-backed factors; companion documents dependency on live MCP rather than "await M13 deploy." **Not** re-implementing grafana-mcp in this repo. | ADR-0020 live-state table; Operate Guide MCP feature; Reading A | owner-idea | OPEN | — |
| I-101 | Surface `operate` `visualizationUrl` (`opr-` sessions) in Grafana | `operate` already returns Session ID `opr-…` and a `visualizationUrl` when `webUI.baseUrl` is configured ([Operate Guide](https://devopstoolkit.ai/docs/ai-engine/tools/operate)). Surface those in the Grafana plugin so operators can open the existing analysis view from the observability decision point — mirroring the query-session topology idea already captured elsewhere in the programme. Visible change: deep link / chip from pre-flight or change session to `/v/opr-…` (or documented fallback when Web UI base URL unset). | Operate Guide Session ID + Visualization fields; companion topology/session patterns [INFERENCE] | owner-idea | OPEN | — |
| I-102 | Show Policies Checked and Patterns Applied at Grafana decision point | `operate` output already includes **Policies Checked** (pass/fail) and **Patterns Applied** in the worked example ([Operate Guide](https://devopstoolkit.ai/docs/ai-engine/tools/operate)). Render those fields in the Grafana change/pre-flight surface so estate governance is **visible where the human decides**, not only in CLI/Headlamp/Web UI transcripts. Visible change: governance chips or checklist beside safe-time/pre-flight; pairs with I-096 STOP evaluation without re-implementing policy engines. | Operate Guide example output fields; Reading B human decision surface; I-096 | owner-idea | OPEN | — |
| I-103 | Multi-plane composite overlay as primary change-safety view | Replace chat-transcript-primary change UX with a **multi-plane composite overlay**: inventory, topology, live state, telemetry, logs, alarms, and (when present) captures/flows in one operator working view — not a scrolling answer log and not eight unrelated tabs. Builds on progressive-context block names (Stable / Current / Map / History) as a packing primitive while committing the visible surface to instrument layout with **shared selection/identity**. Visible change: pre-flight/safe-time entry opens an overlay where each plane has a stable region keyed to the same workload/change identity; transcript if present is secondary. Serves Design principle 1 and §North star eight-plane table. | owner north-star 2026-09-03 (multi-plane ultimate); `src/utils/progressiveContext.ts`; this PRD §Design principles P1 | owner-idea | OPEN | — |
| I-104 | Side-by-side graph and telemetry verdicts with dissent visible | When `impact_analysis` / graph structural risk and live telemetry (alerts, traffic, burn, concurrent reconcile) disagree, render **two labeled verdicts** side by side and mark which channel dissents. Do **not** fold them into `operate`'s single collapsed **Risk Assessment** badge or any primary averaged confidence number. Connects directly to the documented field failure: change looking safe while the estate is already degraded by an unrelated concurrent event, and to the Operate Guide example where LOW RISK follows from replica health alone. Visible change: decision row shows e.g. graph=low structural risk | telemetry=hot (alert/burn) with dissent callout; both remain readable after the human chooses go/stop. Serves Design principle 4; hardens I-086/I-091/I-098. | owner north-star 2026-09-03; Operate Guide Risk Assessment example; Problem §concurrent degradation; §The precise gap | owner-idea | OPEN | — |
| I-105 | Operator-driven slice of packed evidence without LLM hop | After graph+telemetry evidence is packed once for a change session, the operator can **filter, focus, and deep-link** that working set (blast-set members, alert chips, burn window, Explore) without a new LLM completion. Extends the `isShowMeOnly()` / 0-hop Explore seed (`src/utils/grafanaExplore.ts`) onto the pre-flight/verify path. **Not** object mutation: slicing **data** only; cluster writes remain PRD #2 GitOps PR. Visible change: UI affordance to restrict the overlay to e.g. alerting dependents with zero dot-ai POST for that gesture (testable). Serves Design principle 2. | owner north-star 2026-09-03; grafanaExplore `isShowMeOnly`; surface demarcation | owner-idea | OPEN | — |
| I-106 | Forward view: predicted impact before commit | Before PR create is armed, render an explicit **forward view**: what the change is predicted to touch (graph blast + live risk factors) and whether now is a safe time, as a first-class panel the operator must see. This names pre-cognition as UI, not only as backend join. Visible change: predicted-impact summary + safe-time status appear above Propose; M2 disarm rule binds to this view having rendered (or honest inconclusive). Serves Design principle 3; pairs M1/M2, I-086, I-088, I-091. | owner north-star 2026-09-03; this PRD Solution loop; M2.S2 | owner-idea | OPEN | — |
| I-107 | Reject single collapsed confidence as primary risk signal | Product rule: a single confidence score, fused probability, or one-colour risk chip must **not** be the primary risk signal on the change path when multiple evidence channels exist. Secondary summary is allowed only if every contributing channel remains visible and dissent is not dropped (see I-104). Explicitly argues against shipping telemetry enrichment as a quieter way to keep one `Risk Assessment` string. Visible change: review checklist / Demo failure if primary control is one number or one badge without channel breakdown; docs state the prohibition. Serves Design principle 4; pairs I-098 without weakening it. | owner north-star 2026-09-03; operate single Risk Assessment anti-pattern; field concurrent-degradation pattern | owner-idea | OPEN | — |
| I-108 | Eight-plane overlay goal (K8s proving ground) | Track the full multi-plane goal named in §North star: inventory, topology, state, telemetry, logs, alarms, packet captures, netflow/flows as one instrument. Kubernetes is the proving ground where join keys exist; network extension is hypothesis only (**[INFERENCE]**). Visible change: north-star table stays authoritative; milestone freezes that claim "overlay" must name which planes are in-demo vs empty/inconclusive, never pretend topology-graph or Kubeshark panes are live before the estate deploys them; Hubble/netflow may be live while still unwired in-plugin. | owner widened vision 2026-09-03; §North star eight-plane table | owner-idea | OPEN | — |
| I-109 | Missing planes: topology graph (net-new) + Kubeshark (not deployed); Hubble live | Per **ADR-0020 live-state**: **Hubble is live**; **`grafana-mcp` is live**; the two genuinely missing overlay planes are the **topology graph** (net-new structural store, D3/D8) and **Kubeshark** (tier-3 PCAP, privileged, MOP-gated, not deployed). Do not treat Hubble/netflow as unbuilt. Visible change: overlay reserves honest empty states for graph + Kubeshark; flow/netflow pane may bind to live Hubble when join keys exist; no Kubeshark client or graph database built in this companion — estate/framework owns deploy. Historical PRD #1 M14 tier-3 naming for captures remains a pointer, not a claim this repo implements it. | ADR-0020 live-state + D3/D5/D8; §North star eight-plane table | owner-idea | OPEN | — |
| I-110 | Correlation join keys as prerequisite for network extension | Before any credible extension of the overlay from Kubernetes to the network, define and enforce **correlation keys** (identity, time, topology) that join inventory ↔ topology ↔ state ↔ telemetry ↔ logs ↔ alarms ↔ captures ↔ flows. Kubernetes supplies namespace/pod/labels/ownerRef/UID/cluster clock nearly free; networks do not. Visible change: a written key model for the K8s proving ground (which fields stitch panes today) and an explicit **blocker** note that network CMDB/L2/L3/IPFIX/syslog joins are out of scope until keys are solved — the join key is the product, not the pane count. **[INFERENCE]** on network generalisation. | owner widened vision 2026-09-03; §North star hard part; multi-plane hypothesis | owner-idea | OPEN | — |



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

### 2026-09-03 — North star + design principles

- **Issue:** PRD #4 had capabilities and `operate` attachment but no binding link to the estate north star; risk of chat-shaped UX, single collapsed risk verdict, and a competing vision doc. Owner multi-plane overlay framing still required under that framework.
- **Action:** Rewrite §North star as **Grafana surface of ADR-0020** (cite six capabilities, D3/D6/D8/D5, seven-step map for enrich/validate/decide/record); keep operator multi-plane framing, eight-plane table with **ADR-0020 live-state** (`grafana-mcp`+Hubble **live**; topology graph + Kubeshark **missing**), network hypothesis **[INFERENCE]**, join-key hard part; §Design principles derived from ADR where overlapping (esp. D3 → principle 4); register **I-103…I-110**; amend I-100/I-109 for live-state correction. Film metaphor once. Anonymisation verified.
- **Prompt:** Parent assignment VisionPrinciples + Main steers (multi-plane, then ADR-0020 citation + live-state correction); commit, do not push.
