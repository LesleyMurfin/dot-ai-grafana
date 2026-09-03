# Spec: Grafana PRD #1 — M5 Remediate analysis UI

**Depends on:** M3 proxy + M4 Ask path (orchestrate)  
**Plugin id:** `devopstoolkit-dotai-app`  
**Role:** BUILD/docs (spec text only) — analysis-only Remediate; no new UI, no execute.

## Current State

- **Implemented end-to-end.** `src/pages/DotAIPage.tsx` exposes `TOOL_OPTIONS` entry `Remediate (analysis only)` with description `AI issue analysis — no execute`; submit routes through `runAskOrchestrator`.
- **Single hop.** `src/utils/askOrchestrator.ts:157-196` handles `tool === 'remediate'` as a **single hop**: `hop:1, hops:1, first_hop:'dot-ai'`, `current_empty` from the thread, body packed by `buildRequestText({current, map, box: question})`. It never calls `fetchStackContext`, so Remediate reuses whatever Current the Query leg produced rather than fetching the Grafana stack itself.
- **Backend sanitize.** `pkg/plugin/resources.go:478-485` `handleRemediate` proxies to `/api/v1/tools/remediate`; `sanitizeRemediateBody` (`:487-512`) accepts `intent`/`issue`, maps bare `intent`→`issue`, **errors on empty issue (never forwards `{}`)**, and drops execute/apply/mode/confirmation tokens so even a direct POST cannot trigger execution. Upstream 401/403 are remapped to 502 at `:695-702`.
- **No execute UI.** Zero apply/execute controls. The only extra affordance is `Analyze this` (`testIds.dotai.analyzeThis`), which copies Query Current into the Remediate box and switches tool — analysis only. D3/D4 (no execute controls, no-apply token) still hold.
- **Coverage.** `pkg/plugin/resources_test.go:958 TestRemediateAnalysisOnly`; `src/pages/DotAIPage.test.tsx:69` tool switch, `:393` remediate submit without execute, `:429` Analyze this.
- **Open upstream (not a plugin defect).** `docs/grafana-stack-test-plan.md` K4/D9 records live `POST /api/v1/tools/remediate` returning `success:false`, `EXECUTION_ERROR: Failed to parse AI final analysis response: No JSON found…` (~35 s). Prose analysis is produced but dot-ai's own parser rejects it; the plugin correctly renders the error alert. Gate C7/D9 cannot pass until dot-ai is fixed.

## Summary

Analysis-only remediate path: intent/description input, `POST .../resources/remediate`, show text analysis. No execute controls (D3). Aligns with PRD: Grafana stack + orchestrate + **no new UI** + analysis-only.

## Files to Touch

Same tools page as M4/M6; remediate mode in selector or route. Spec-only this turn — no `src/` edits required if implementation already matches Current State.

## Step-by-Step

1. POST body with issue description field(s) matching REST expectations (`intent` or `issue` — prefer `intent` plain text).
2. Render summary/analysis text only.
3. No apply/execute buttons.
4. Keep remediate on the single-hop orchestrator path (`first_hop=dot-ai`); do not add a second hop or stack fetch on Remediate submit.
5. Keep `Analyze this` as copy-Current + switch-tool only — never an execute path.

## Verification

```bash
grep -R "resources/remediate\|analysis" src/
grep -n "tool === 'remediate'\|first_hop.*dot-ai\|sanitizeRemediateBody" src/utils/askOrchestrator.ts pkg/plugin/resources.go
npm run test:ci && npm run build
```

Pass = single-hop remediate, sanitize drops execute tokens, no apply UI, Analyze this is analysis-only.

## Notes for Next Agent

Token must remain no-apply (D4). Upstream EXECUTION_ERROR on live remediate is a **dot-ai** parser issue (test-plan K4/D9), not a plugin defect — do not "fix" it by inventing execute UI or relaxing sanitize.
