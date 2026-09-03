# Spec: Grafana PRD #1 — M8 documentation + stack proof

**Depends on:** M4 Ask path (orchestrate + Grafana pack), M2/M3 config+proxy  
**Plugin id:** `lesleymurfin-dotai-app`  
**Role:** Docs and test-plan alignment with PRD **as it is now** (K3s + Grafana stack + dot-ai; not Grafana-host-only).

## Current State

- **README.md** covers install (unsigned), config (`apiUrl` + Auth Token + Test connection), Query/Remediate usage, progressive context (Current sent, History display-only), and architecture. **Namespace drift still open:** README.md:30 (“k3s Grafana kube-prometheus-stack-grafana in the monitoring namespace”) and README.md:47-49 (`kubectl -n monitoring …` ×3) vs live **`riley-monitoring`** (`docs/grafana-stack-test-plan.md:27-29`, drift note at `:51-52`).
- **Ask-log body cap drift (new).** Test-plan §7 still says ask-log `body` is “≤512 runes” (`docs/grafana-stack-test-plan.md:411`) and fail-closed rule 2 still says “512-rune cut” (`:472`), but the code cap is now **4096**: `askBodyPreview` `const max = 4096` (`pkg/plugin/resources.go:110`), asserted by `TestAskBodyPreviewStripsSecrets` expecting 4097 runes incl. ellipsis (`resources_test.go:1596`). `summary`/`error` stay `truncateRunes(…, 512)` (`resources.go:214-215`). M4 records the raise as done — §7’s M5 `used_current` scoring notes are stale and must be corrected in the docs change set.
- **`docs/progressive-context.md`** documents client-only packing: Stable + Current + Map + box; no `sessionId`; Grafana DS via `getDataSourceSrv` / `ds.query`.
- **`docs/grafana-stack-test-plan.md`** is the combination proof SSOT: environment facts, Current shape, fixtures, L0–L4 checks, owner gate X1, and **§7 Measures** scored from `/var/lib/grafana/dotai-ask.log`.
- **PRD** (`prds/1-grafana-ai-cluster-intelligence.md`) binds stack-in-one-Ask, no new UI, analysis-only, plugin id `lesleymurfin-dotai-app`.
- **`src/plugin.json`** `"screenshots": []` still empty; README Screenshots section defers to M9.
- **README already has `## Compatibility`** (floor `>=11.0.0`, pins 11.4.0) — not a partial matrix; M9 owns dual-version e2e evidence, not inventing the section.

## Summary

Keep README + progressive-context truthful to the orchestrated Ask path and stack combination. Treat **`docs/grafana-stack-test-plan.md` §7** as the measure contract (M1–M5: `current_empty`, `first_hop`, `hops` cap 3, `latency_ms`, `used_current`). Fix install namespace drift to `riley-monitoring`. Correct §7 body cap 512→4096. No new UI docs or session-protocol fiction.

## Files to Touch

| Path | Action |
|------|--------|
| `README.md` | Align Usage/Architecture with orchestrate loop + never-skip Grafana; fix `riley-monitoring`; link test-plan §7 |
| `docs/progressive-context.md` | Note Ask may multi-hop (cap 3); Current still packed each hop; History never sent |
| `docs/grafana-stack-test-plan.md` | Correct §7 body cap 512→4096; keep fail-closed rules otherwise; keep field names unless M4 renames |
| `src/plugin.json` | Screenshots optional defer to M9; do not invent paths |
| `prds/1-…` | **Read-only** unless a separate PRD task owns it |

## Step-by-Step

1. **README — product truth**  
   - State clearly: Ask combines K3s (dot-ai) + Grafana stack DS reads into **Current**, then POSTs plain `intent`/`issue`.  
   - Document first-hop + loop cap 3 at a high level (pointer to code/`askOrchestrator`, not a second protocol).  
   - Cluster-wide questions still hit Loki/Prom (no skip-on-no-pod).  
   - History display-only; Current sent; analysis-only remediate; Test connection = `POST …/version`.

2. **README — install**  
   - Replace `monitoring` namespace with **`riley-monitoring`** in kubectl examples (match test-plan §1).  
   - Keep unsigned allow-list id `lesleymurfin-dotai-app`.  
   - Point “full stack proof” at `docs/grafana-stack-test-plan.md` (including **§7 Measures** and ask-log path).

3. **progressive-context.md**  
   - Keep compose order and DS discovery pattern.  
   - Add one short note: Query Ask may issue up to **3** dot-ai POSTs per user click; each POST may carry a fresh/refined Current; Grafana DS reads do not count as hops.

4. **Test plan §7 (do not rewrite casually)**  
   - Measures stay fail-closed from `/var/lib/grafana/dotai-ask.log`:  
     - **M1** `current_empty`  
     - **M2** `first_hop` (`grafana` \| `dot-ai`)  
     - **M3** `hops` (cap 3 per Golden Ask window)  
     - **M4** `latency_ms` (harness clock only)  
     - **M5** `used_current`  
   - Document that UI Ask packs Current into `intent`; raw API curls will not — score separately.  
   - X1 combination gate unchanged.  
   - **Correct §7's body cap from 512 → 4096 runes** (both the field table and fail-closed rule 2); summary/error stay 512.

5. **Out of scope for M8**  
   - No marketplace publish docs, no execute/GitOps-PR (PRD #2), no new screenshots requirement if host unavailable (note TODO).

## Verification

```bash
grep -E 'Test connection|analysis only|Current|History|lesleymurfin-dotai-app' README.md
grep -n 'riley-monitoring' README.md docs/grafana-stack-test-plan.md
grep -n 'dotai-ask.log\|## 7. Measures\|hops\|first_hop\|used_current\|4096\|512' docs/grafana-stack-test-plan.md
grep -n 'getDataSourceSrv\|History\|sessionId\|cap' docs/progressive-context.md
# must not reintroduce host-only framing as the product
! grep -qi 'grafana is only the host' README.md docs/progressive-context.md || true
# install snippets must not still say monitoring-only
! grep -n 'kubectl -n monitoring' README.md || true
```

Pass = README + progressive-context match PRD stack-in-one-Ask; test-plan §7 still defines the five measures against the ask-log with **body ≤4096**; install snippets use `riley-monitoring`.

## Notes for Next Agent

- M9 owns dual-version / screenshot matrix; do not block M8 on marketplace.  
- If OrchestrateIterate renames meta fields, update §7 jq and README in the **same** change set.  
- Never paste Grafana admin passwords into docs or specs.  
- Endpoint plane warning remains: `apiUrl` is dot-ai **tools REST**, not agentgateway.
