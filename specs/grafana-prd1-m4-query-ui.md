# Spec: Grafana PRD #1 — M4 Query / Ask path (OrchestrateIterate)

**Depends on:** M3 proxy, progressive context + grafanaStack packing  
**Plugin id:** `devopstoolkit-dotai-app`  
**Branch / worktree:** featherduster (this plugin worktree)  
**Role:** **TEST** (ADW) — golden UI Asks + §7 ask-log score + focused jest; fail-closed on hops/current_empty.

## Current State

**TEST window (latest, supersedes the 20:07Z window below):** `2026-09-01T21:15:49Z` → `21:17:37Z` via `node scripts/golden-ask.mjs` (live, EXIT=0) against `http://10.43.25.61`, post-restart pod (started `21:04:26Z`) serving the branch-attribution bundle. Ask-log lines 56–61. **Verdict: PASS.** `branch` present on **all 6** hop lines; bodies untruncated (4096 cap holds, `truncated=false` on all Asks).

| Ask | hops | branch sequence | current_empty | used_current | first_hop | status | summary snippet |
|-----|------|-----------------|---------------|--------------|-----------|--------|-----------------|
| top issues across all clusters | **3** | initial→across→conflict | **false** | **true** (evidence_n=87) | grafana | 200,200,200 | hop3: "dot-ai-controller-manager OOM Kills… from live Loki, Prometheus, Tempo, and Alertmanager data" |
| logs pod argocd-application-controller ns riley-gitops | **2** | initial→conflict | **false** | **true** (evidence_n=64) | grafana | 200,200 | hop1 denied ("does not exist in the current cluster"); hop2 conflict corrected: "actively running on the host cluster… ArgoCD application reconciliation" |
| list namespaces | 1 | initial | true (inventory) | false | dot-ai | 200 | "Cluster has 7 namespaces… All namespaces are in Active status" |

Gates: hops≥2 on unscoped top-issues ✓ (≤ MAX_ASK_HOPS=3 ✓); argocd hop1 denial → conflict hop2 ✓; current_empty=false on (1)(2) ✓; list-ns first_hop=dot-ai ✓; no ChunkLoadError / pageErrs on any Ask ✓; branch on every post-restart hop ✓. TEST-filed improvements (see TEST yield, 21:17Z window): (1) 512-rune summary cap makes conflict/hedge triggers unattributable — 45/54 log lines clipped at 513, and Ask 1's hop3 `conflict` has no denial phrase within hop2's visible summary (suspected false positive burning the hop cap, unprovable from the log); (2) conflict follow-up prompt duplicates every directive line verbatim (hop3 body, 21:17:03Z); (3) `extractResourceHints` "X in Y" pattern turned "namespaces are in Active status" into Current chip `are@Active` on the live list-ns thread (src/utils/progressiveContext.ts:73).

**TEST window:** `2026-09-01T20:07:54Z` → `20:09:55Z` via `node scripts/golden-ask.mjs` against `http://10.43.25.61` / plugin `devopstoolkit-dotai-app`. Ask-log: `/var/lib/grafana/dotai-ask.log`. Suite log: `scripts/golden-func.log`. **Verdict: PASS** (no BUILD loop this turn).

| Ask | hops | current_empty | used_current | first_hop | status | summary snippet |
|-----|------|---------------|--------------|-----------|--------|-----------------|
| top issues across all clusters | **2** | **false** | false\* | grafana | 200,200 | Prometheus reload **403 Forbidden** / config failure from packed Loki+Prom |
| logs pod argocd-application-controller ns riley-gitops | **2** | **false** | **true** | grafana | 200,200 | hop1 denied ns; hop2 conflict follow-up kept Loki Current (`riley-gitops` evidence) |
| list namespaces | 1 | true (inventory) | false | dot-ai | 200 | 7 ns: default, dot-ai, kube-*, monitoring, riley-discovery |

\*M5 `used_current=false` on top-issues was **ask-log body truncation** (cap was 1024 runes, not 512 as first reported; evidence tokens sat past the cut); hop summaries still cited 403/Prometheus from the full Current sent upstream. Fail-closed scorer only.

**BUILD follow-up (2026-09-01T20:15Z):** `askBodyPreview` cap raised **1024 → 4096** in `pkg/plugin/resources.go`; `go test ./pkg/plugin/` ok. Rebuilt `dist/gpx_dot_ai_linux_amd64` (`mage -v build:linux`, md5 `fe26270572fd5169484cbd8758163b66`), copied to the Grafana PVC (same md5) and rolled the deployment. Smoke POST to `/resources/query` returned 200 and logged an **untruncated 2209-rune `body`** retaining both the `Current:` block and the question tail — the measure input is no longer clipped. Frontend unchanged, so no webpack rebuild.

**BUILD follow-up (2026-09-01, improvement (2) — hop2 must not deny Current):** `conflictFollowUp` in `src/utils/askOrchestrator.ts` now takes the Current block as a second argument and names its evidence instead of hedging. New exported `currentEvidenceSources(stackCurrent)` returns only the blocks carrying real lines (e.g. `['Loki','Alertmanager']`, skipping `no metric samples` / `no traces` / `datasource missing`); `answerConflictsWithCurrent` reduces to *denial ∧ sources.length>0*, and the hop-2 prompt now states which datasources hold evidence and for which `pod/… ns/…`, then orders **"Do NOT deny facts in Current"**, bans *"does not exist, was not found, is not deployed"*, asserts the queried kube context is one cluster among several, and requires the answer be composed **FROM** the Current lines. The soft *"solely because it is absent from the default kube context"* wording that let hop2 re-hedge on `riley-gitops` is gone and a test asserts it stays gone. `npx jest src/utils/askOrchestrator.test.ts` = **13 passed**, including a conflict-hop case proving the second dot-ai call packs the Loki/Alertmanager evidence, names `pod/argocd-application-controller ns/riley-gitops`, omits Prometheus (no data), and does not surface a bare namespace-does-not-exist to the user. `npm run build` clean: single `dist/module.js`, md5 `04478f4c87e1cac371c3746a64bb72f8`, B2 chunk-loader count `0`, marker `Do NOT deny facts in Current` = 1, `solely because` = 0. **Not yet copied to the Grafana PVC** — hop-3 lands in the same file, so one deploy covers both; the deployed md5 on line below is still the previous bundle until then.

**BUILD fix (2026-09-01, TEST FAIL on the live argocd Ask — `hops=1`):** the hop-2 leg above never fired in the `20:42:55Z` window. Root cause was the `denies` alternation in `answerConflictsWithCurrent`, not the prompt: it carried the **literal** `appear to be from a different cluster` and no `not available`, so the two real hop-1 phrasings — *"…is not available in the current cluster context"* and *"…are from a different cluster/context"* — matched nothing, `conflict` stayed false, and the loop exited at one hop with a bare denial on screen. Broadened to `not available` plus `(?:appears? to be |are |is )?from a different cluster`. Bare **`not accessible` was deliberately left out**: that is a *hedge*, not a denial, and it is the marker `answerHedgesOnCurrent` uses for improvement (5) — since the grafana loop tests the conflict branch before the hedge branch, putting it in `denies` would make `hedgeFollowUp` unreachable and silently break hop 3 (call-count assertions still pass, so it would have looked green). Standing semantics: **a denial says the thing does not exist; a hedge says the speaker cannot see it.** Regression test quotes both ask-log strings verbatim and asserts *"not accessible via standard kubectl contexts"* is **not** a conflict, pinning that split. `npx jest src/utils/askOrchestrator.test.ts` = **17 passed** (includes hop-3's "still hedges → third hop" and "answers from Current → no third hop", both green, so the escalation survived); `DotAIPage.test.tsx` = **15 passed**; `tsc` 0 errors in `askOrchestrator`. Rebuilt `dist/module.js` md5 `6addf88618a936d34c30c9c6aeb095dd` (single chunk, B2=0; markers `not available`=1, `from a different cluster`=1, `Do NOT deny facts in Current`=1) — supersedes the deployed `b5f517b0328598878bc124295765d778`; hop-3 owner performs the single PVC copy, then RescoreTest re-runs the window.

**Test-strength note (why this FAIL cannot ship twice):** the first regression pass was **predicate-level only** — it asserted `answerConflictsWithCurrent(...) === true` and nothing about the loop. A true predicate does not prove hop 2 is spent, and hop-count was the actual symptom, so that gap is precisely what let `hops=1` reach the live window. Added an orchestrator-level `test.each` in the `runAskOrchestrator` block that drives `runAskOrchestrator` with each verbatim ask-log denial as the hop-1 summary and asserts **`result.hops === 2`**, `callTool` called twice, the second packed body matching `/Do NOT deny facts in Current/` and still carrying the Loki line, and the final summary no longer containing the denial. **Falsified against the old regex:** restoring the literal `appear to be from a different cluster` makes exactly these 3 tests fail (`3 failed, 16 passed`) and the other 16 stay green — so they are load-bearing on this defect and not tautological. Restored: `npx jest src/utils/askOrchestrator.test.ts` = **19 passed**. Bundle md5 is unchanged at `6addf88618a936d34c30c9c6aeb095dd` across the test-only edit, which independently confirms the deployed-vs-built gap is a copy that never happened, not a build that never ran.

**Gates (fail-closed):** hops≥2 on unscoped top-issues ✓; hops≥2 on deny-ns while Current has Loki ✓; `current_empty=false` on (1)(2) ✓; no ChunkLoadError ✓; `npx jest` grafanaStack+askOrchestrator+DotAIPage = **39 passed** (3 suites; was 31 before the hop-2 regression + hop-3 escalation cases landed — askOrchestrator alone is now 19).

**Deploy confirmed (post-fix):** the PVC copy referenced in the two BUILD notes above **has landed** — `kubectl -n riley-monitoring exec deploy/kube-prometheus-stack-grafana -c grafana -- md5sum …/module.js` returns `6addf88618a936d34c30c9c6aeb095dd`, identical to local `dist/module.js`, verified independently by three agents; the served `B3` check returned `http=200` with markers present. It was a `kubectl cp` with **no pod restart** and the backend `gpx` binary untouched. So the broadened `denies` alternation is live, and the next TEST window scores the fix rather than the stale bundle.

**BUILD fix (2026-09-01, residual R1 from the PASS window — denial false positive burned hop 3):** the `20:48Z` TEST scored PASS but spent the whole cap on unscoped `top issues`, because the hop-2 summary *quoted* an upstream `"HTTP 404 Not Found"` and the unanchored `not found` token in the `denies` alternation scored it as a denial of Current — a conflict hop with nothing to conflict with. `answerConflictsWithCurrent` now matches on **asserted** text only: whole log-shaped lines (`level=`/`ts=`/`msg=`/`caller=`/`err=`/`HTTP/1.1`) and quoted spans are stripped first, a denial preceded by an HTTP `4xx`/`5xx` status is skipped, and the phrase must name a Kubernetes subject — either inside the match (`…from a different cluster` self-qualifies) or within 60 chars either side (`not found`/`no such` do not, so they must sit next to the object they deny). Hop 3 is therefore reserved for a real conflict or `answerHedgesOnCurrent`. **Falsified:** the old alternation matches `Not Found` in that verbatim summary (`true`), the new one returns `false`, while all three live hop-1 denial cases stay conflicts. `npx jest src/utils/askOrchestrator.test.ts` = **21 passed**. **Deployed:** `dist/module.js` md5 `8b792963323cb18fb1843370694ce756` (34141 bytes), `kubectl cp` with no pod restart, in-pod md5 and `B3` served check both `8b79...` at `http=200` — this **supersedes `6addf88618a936d34c30c9c6aeb095dd`** in the two notes above, which is no longer live.

**BUILD (2026-09-01, R3 — hop attribution was unverifiable from the log):** two TEST windows could not say *which* branch produced hop 3, because the `4096` body preview truncated head-first (the question is packed **after** Current, so the follow-up marker was always cut) and the `512` summary cap hid the trigger phrase. Attribution had to be inferred from control flow. Fixed on both ends. Frontend: new `AskBranch = 'initial'|'across'|'conflict'|'hedge'|'refine'`, `AskMeta.branch` is required, and `callDotAI(box, branch)` tags every POST at its call site. Backend (`pkg/plugin/resources.go`): `askLogEntry.Branch` (`json:"branch,omitempty"`), parsed by `askMetaFromBody` against that allow-list (unknown values dropped), and added to **both** strip lists so it never reaches dot-ai and never appears in the body preview. `askBodyPreview` now uses `truncateRunesKeepTail(s, 4096, 1024)` — head + `…[+N]…` + the last 1024 runes — so the branch marker and question tail survive, honouring the contract the doc comment already claimed. **Verified end-to-end on the live pod:** a smoke POST to `/resources/query` returned `http=200` and the ask-log line carries `"hop":3,"hops":3,"first_hop":"grafana","branch":"hedge"` with no `branch` key in `body`. `go test ./pkg/plugin/` ok, `npx jest src/utils/askOrchestrator.test.ts` **21 passed**. **Deployed (one restart):** `module.js` `e7c1095c7e996cda219ded623c80f213` + `gpx_dot_ai_linux_amd64` `fc19497a6b1232cc53482e86238c6ac7`, `rollout restart deploy/kube-prometheus-stack-grafana` (pod now `…-5d6699457-dgt8p`, ask-log preserved on the PVC), backend process confirmed running from the new binary and `B3` served check `http=200` md5-matched. Supersedes `8b792963323cb18fb1843370694ce756`. **A `Secret "…" not found` finding stays a non-conflict:** `secret`/`configmap` are deliberately excluded from the denial subject list — captured verbatim from a live hop-2 answer and pinned by test, since adding them reopens R1.

**BUILD fix (2026-09-01, F1 — line-granular stripping disabled the conflict hop):** TEST FAILed bundle `7b8d7d1c` with the argocd Ask back at `hops=1`; the defect was mine and had shipped in `8b792963`, not in the `denies` alternation. `assertedText` filtered **line**-granular, but live answers arrive as **one newline-free paragraph** — hop 1 was *"The namespace 'riley-gitops' does not exist in the current cluster. However, the Loki logs … show level=info ts=… msg=…"* — so a single inline log token dropped the entire answer, denial included, and `answerConflictsWithCurrent` returned false. Stripping is now **span-granular and narrower**: only `key=value` spans (including `key="quoted value"`, which is what actually carries `msg="received non-200 response: 404 Not Found"`). Generic quoted-span stripping was **removed entirely** rather than placeholder-substituted — it was never load-bearing, because the bare quoted `"HTTP 404 Not Found"` negative is caught by the HTTP `4xx`/`5xx` guard, and keeping it would fail closed whenever an answer puts the subject only inside the quotes (*"'riley-gitops' does not exist"*). **Falsified:** on that verbatim paragraph the old line filter reduces the answer to `""` (denial `false`); the new strip keeps both the denial and its adjacent `namespace` subject (denial `true`). New regressions cover the single-paragraph shape, denial-and-log-token-in-the-same-sentence, and subject-only-inside-quotes; the 404, `Secret "…" not found` and hedge negatives all stay green. `npx jest` askOrchestrator + dotaiApi = **28 passed**. Also fixed in `7b8d7d1c`: `branch` was set in `AskMeta` but dropped by `dotaiApi.fetchResource`'s meta whitelist, so every real-UI line logged `branch=undefined` while a raw `curl` smoke passed — `AskBranch` now has a single definition in `dotaiApi.ts` (re-exported by the orchestrator) and is forwarded and validated with the other meta fields. **Deployed:** `module.js` `34cbe6a3af403fa68d258f631f1d0010`, frontend-only, no restart, `gpx` unchanged at `fc19497a6b1232cc53482e86238c6ac7`; in-pod and `B3` served both match at `http=200`. Supersedes `e7c1095c…` and `7b8d7d1c…`.

- **Product binding:** one Ask fuses host K3s Grafana stack (Loki/Prom/Tempo/AM via `getList({type})`→`ds.query`) + dot-ai across clusters/vclusters. Analysis only. **No new UI.**
- **UI path:** Query + Remediate Ask → `runAskOrchestrator`; History display-only; Current packed; hop meta on resource POST.
- **Orchestrator live behavior (this TEST):** unscoped → hop2 `acrossClustersFollowUp`; Current-vs-deny → hop2 `conflictFollowUp`; stack snapshot retained across hops; inventory list stays single hop / `first_hop=dot-ai`.
- **Stack packing:** cluster-wide `CLUSTER_LOGQL`/`CLUSTER_PROMQL` when no pod/ns (never skip-on-no-pod). **Deployed `dist/module.js` md5 `6addf88618a936d34c30c9c6aeb095dd` (33513 bytes) matches the Grafana PVC** — re-read from the pod after the post-fix roll, so the broadened hop-1 `denies` alternation is the bundle Grafana actually serves. Supersedes pod `b5f517b0328598878bc124295765d778` and the two-builds-stale `49565f7912b13f15292d8a204f1f1576`; neither is live any more.
- **Backend ask-log:** NDJSON with `hop`/`hops`/`current_empty`/`first_hop` + `body` (cap 4096) / `summary` (cap 512).
- **Remaining improvements (≤5, no new UI):** (1) ~~raise ask-log body cap~~ **done** — cap 4096, re-score `used_current` on the next TEST window; (2) ~~hop2 after ns-deny should force multi-cluster/tool path that surfaces host-ns facts instead of soft “not accessible”~~ **done (BUILD above)** — `conflictFollowUp` now names the Current datasources + target and hard-bans denial; needs a live TEST window to confirm the hop2 summary stops hedging on `riley-gitops`; (3) surface in-flight Loki/Prom headers longer (post-rewrite Current hides them — `hasLokiHeader` false in UI scrape); (4) golden harness should assert hop meta from log window, not only UI text; (5) optional third hop when hop2 still hedges on conflict.

## Summary

Make **Ask** run through **`runAskOrchestrator`**: classify first hop (Grafana **or** dot-ai from the question), pack Grafana stack into Current when the hop needs observability, loop dot-ai POSTs with **cap 3**, and **never skip Grafana on cluster-wide Ask**. Keep the existing page chrome. Fix skip-on-no-pod in stack fetch + tests. Pass hop meta through `callDotAITool` so the ask-log supports §7 measures.

## Files to Touch

| Path | Action |
|------|--------|
| `src/pages/DotAIPage.tsx` | Replace inline pack+single `callDotAITool` with `runAskOrchestrator`; keep UI surface unchanged |
| `src/utils/askOrchestrator.ts` | Harden loop: first hop, refine under cap 3, cluster-wide Grafana always when observability path |
| `src/utils/grafanaStack.ts` | Guarantee cluster-wide Loki/Prom/AM queries when no pod/ns; **no skip-on-no-pod** |
| `src/utils/dotaiApi.ts` | Already accepts `AskCallMeta` (`hop`, `hops`, `current_empty`, `first_hop`) — keep stripped before upstream |
| `src/utils/askOrchestrator.test.ts` (add if missing) | Unit: classifyFirstHop, hop cap, grafana-first packs Current, no third+ hop |
| `src/utils/grafanaStack.test.ts` | **Invert** skip test: no pod/ns **must** call Loki (and Prom) with cluster-wide expr |
| `src/pages/DotAIPage.test.tsx` | Assert page uses orchestrator path / meta; History not in POST body |
| `pkg/plugin/resources.go` (only if needed) | Ensure ask-log records body/summary/status; accept hop meta fields for log only |

**Do not:** add screens, DS pickers, session protocol fields, execute UI, or edit `/data/projects/revive_labs`.

## Step-by-Step

1. **Wire the page**  
   - Query + Remediate submit → `runAskOrchestrator({ tool, question, thread })`.  
   - Apply returned `thread` (Current rewrite, Map merge, History append) and `summary` / `errorMessage` to existing state.  
   - Loading lock unchanged. No new controls.

2. **First hop (`classifyFirstHop`)**  
   - Observability language (logs, metrics, traces, alerts, crashloop, OOM, latency, …) → **`grafana`**.  
   - Live K8s inventory (list/show namespaces, pods, deployments, …) → **`dot-ai`**.  
   - **Default → `grafana`** (combination ownership).

3. **Grafana-first path**  
   - Always `fetchStackContext(question)` **before** the first dot-ai POST (cluster-wide exprs when no pod/ns).  
   - Pack Stable + Current + Map + box; `callDotAITool('query', packed, meta)`.  
   - If stack was empty and the answer names a workload, **one refine** under remaining hop budget: re-fetch targeted stack, second POST.  
   - **Never** omit Grafana reads solely because pod/ns parse failed.

4. **dot-ai-first path**  
   - First POST may be inventory without stack.  
   - If question/answer smells observability (fail/error/crash/log/metric/…), load stack (cluster-wide OK) and follow-up POST while `hops < MAX_ASK_HOPS`.  
   - Still never skip Grafana once the observability leg is taken.

5. **Hop cap**  
   - `MAX_ASK_HOPS = 3` counts **dot-ai POSTs only** (ask-log lines). Grafana `ds.query` does not count.  
   - Hard stop at 3; do not open a 4th upstream call.

6. **Kill skip-on-no-pod**  
   - `buildLogQL` / `buildPromQL` always return an expression (`CLUSTER_*` when unscoped).  
   - `fetchStackContext` always invokes Loki + Prometheus `ds.query` when the DS exists (Alertmanager cluster-wide too).  
   - Replace unit expectation `lokiQuery).not.toHaveBeenCalled()` with **must have been called** + cluster-wide note text when empty.

7. **Meta + log**  
   - Each hop sends `hop`, `hops`, `current_empty`, `first_hop` on the plugin resource POST (backend strips before dot-ai; logs NDJSON to `/var/lib/grafana/dotai-ask.log`).  
   - Align field meanings with test-plan §7 (`current_empty`, `first_hop`, `hops`, `used_current`).

8. **Remediate**  
   - Single analysis hop; `first_hop: 'dot-ai'`; pack existing Current/Map; no execute keys.

## Verification

```bash
# types + focused units
npm run typecheck
npx jest src/utils/grafanaStack.test.ts src/utils/askOrchestrator.test.ts src/pages/DotAIPage.test.tsx --ci

# no skip-on-no-pod regression in source
grep -n "CLUSTER_LOGQL\|CLUSTER_PROMQL\|Never skip\|runAskOrchestrator\|MAX_ASK_HOPS" src/utils/grafanaStack.ts src/utils/askOrchestrator.ts src/pages/DotAIPage.tsx

# page must not single-shot around the orchestrator
grep -n "runAskOrchestrator" src/pages/DotAIPage.tsx

# stale skip assertion must be gone
! grep -n "not.toHaveBeenCalled()" src/utils/grafanaStack.test.ts | grep -i loki || true
grep -n "how healthy is the cluster" src/utils/grafanaStack.test.ts

# ask-log path (backend)
grep -n 'dotai-ask.log' pkg/plugin/resources.go
```

**Manual / live (from test plan):** one cluster-wide Query Ask (no pod name) must show Loki/Prom headers in the in-flight Current or in the POST `intent` body; `/var/lib/grafana/dotai-ask.log` gains ≤3 lines for that window; `first_hop` / `current_empty` scorable per §7.

## Notes for Next Agent

- This file is the **OrchestrateIterate BUILD contract**. Prefer editing orchestrator + page wiring over new abstractions.
- **M5** remediate UI stays analysis-only; Analyze this still copies Current → Remediate box.
- **M6/M7** selector + errors already on the shared page — do not rebuild chrome.
- **M8** documents README + points at `docs/grafana-stack-test-plan.md` §7 measures.
- Combination gate **X1**: fail if answer is generic with **no Grafana data in Current** and **no cluster fact from dot-ai**.
- Do not treat inventory-only first hop as permission to skip Grafana on a later observability refine.
- Plugin id stays `devopstoolkit-dotai-app`. Namespace for live Grafana is **`riley-monitoring`** (not `monitoring` README drift).
