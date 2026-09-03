# Spec: Grafana PRD #1 — M7 errors and loading

**Depends on:** M4/M5/M6 shared DotAI page + resource proxy  
**Plugin id:** `devopstoolkit-dotai-app`  
**Role:** BUILD/docs (spec text only) — loading lock + single error Alert; no new UI.

## Current State

- **Implemented — loading.** `Spinner inline` + text “Waiting for dot-ai…” under `testIds.dotai.loading`. Submit disabled on `loading || !intent.trim()` with label “Running…”. TextArea and Select disabled in flight. `onSubmit` early-returns while `loading`. `onIntentKeyDown` submits on Enter, keeps newline on Shift+Enter, and ignores Enter while loading.
- **Implemented — errors.** One `Alert severity="error" title="Request failed"` (`testIds.dotai.error`); message from `ToolCallResult.errorMessage` normalized in `src/utils/dotaiApi.ts:88-141` — contract `error`, else `Request failed (HTTP <status>)`, else `Invalid resource response`, else the thrown `Error.message`.
- **Upstream classes covered.** `extractErrorMessage` (`pkg/plugin/resources.go:574-590`) flattens the upstream object to `"<code>: <message>"`, so an upstream `EXECUTION_ERROR` reaches the alert verbatim (asserted `pkg/plugin/resources_test.go:781` → `EXECUTION_ERROR: llm down`). Unconfigured returns `plugin not configured: set apiUrl and auth token`. Upstream 401/403 are remapped to **502** at `:695-702` so the browser never mistakes it for an expired Grafana session. Test connection reports `dot-ai version returned HTTP <code>` and never reflects raw upstream bodies (`:373-378`).
- **Coverage.** `src/pages/DotAIPage.test.tsx:257` spinner + double-submit lock, `:237` error path without History rewrite, `:353` Enter suppressed while loading.
- **Known limitation (state, do not fix here).** All failure classes render in the same Alert with the backend-supplied text — no per-class copy for connectivity vs auth vs upstream `EXECUTION_ERROR` beyond that message. README already describes the single-alert behaviour.

## Summary

Loading indicator during requests; clear errors for connection/auth/upstream EXECUTION_ERROR; disable double-submit. Shared page only — no new UI chrome.

## Files to Touch

Shared DotAI page Alert/Spinner. Spec-only this turn if implementation matches Current State.

## Step-by-Step

1. Confirm the in-flight lock (submit disabled + label “Running…”, TextArea/Select disabled, Enter ignored while loading, spinner under `testIds.dotai.loading`).
2. Confirm the single Alert renders the normalized message for each class, including flattened `EXECUTION_ERROR: …`.
3. Confirm the 401/403→502 remap is not reintroduced as a Grafana session-auth failure in the browser.

## Verification

```bash
grep -R "loading\|Spinner\|Alert\|EXECUTION" src/
grep -n "extractErrorMessage\|502\|Waiting for dot-ai" pkg/plugin/resources.go src/pages/DotAIPage.tsx
npm run test:ci && npm run build
```

Pass = double-submit lock, single error Alert, EXECUTION_ERROR text visible, 401/403→502.

## Notes for Next Agent

M8 docs; M9 compat. Do not split the Alert into per-class UI (no new UI). Live remediate `EXECUTION_ERROR` (test-plan K4/D9) is upstream parser failure — plugin path is correct when the alert shows it.
