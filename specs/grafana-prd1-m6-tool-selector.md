# Spec: Grafana PRD #1 — M6 tool selector + shared layout

**Depends on:** M4 Query Ask path, M5 Remediate analysis path  
**Plugin id:** `devopstoolkit-dotai-app`  
**Role:** BUILD/docs (spec text only) — shared page chrome; **no new UI**.

## Current State

- **Implemented.** `src/pages/DotAIPage.tsx` renders a `Select` inside `Field label="Tool"` with `inputId="dotai-tool"`, options Query / `Remediate (analysis only)`, `disabled` while loading. Switching tool clears response + error and keeps **per-tool threads** (`type Threads = Record<DotAITool, ToolThread>`, `activeThread = threads[tool]`).
- **Shared layout (one page).** Single `TextArea` (`testIds.dotai.intent`) with context-aware `placeholder` and Field label/description derived from `tool` via `useMemo` (`Issue description` + “Analysis only — this plugin never executes changes.” vs `Question` + “Plain-language intent sent to dot-ai query.”). Submit button label flips `Ask` ↔ `Analyze`. Shared result blocks Current / Map / History / Response with ids in `src/components/testIds.ts` (`dotai-container|intent|submit|response|error|loading|history|current|map|clear-thread|analyze-this`).
- **Scaffold pages already gone.** `src/pages/` holds only `DotAIPage.tsx` (+ test); `src/components/App/App.tsx` routes `*` → lazy `DotAIPage`; `src/plugin.json` includes is just the app page + Configuration. The M6 note “remove unused scaffold pages from nav if safe” is **done** — nothing left to remove and **no new UI** may be added.

## Summary

Dropdown to switch Query vs Remediate; shared input/response layout; context-aware placeholders. One page, no new screens, analysis-only Remediate option label.

## Files to Touch

DotAI page + testIds; remove unused scaffold pages from nav if safe (**already done** — verify only). Spec-only this turn unless drift reappears.

## Step-by-Step

1. Confirm the tool `Select` stays a single control on the shared page and remains disabled during a request.
2. Confirm placeholders/labels stay `tool`-derived and per-tool threads are not merged.
3. Confirm nav/includes still expose exactly the app page + Configuration — do not reintroduce scaffold pages or add new UI.

## Verification

```bash
grep -R "Query\|Remediate\|Select" src/pages src/components
grep -n "dotai-tool\|Threads\|TOOL_OPTIONS" src/pages/DotAIPage.tsx
grep -n '"type": "page"\|Configuration' src/plugin.json
npm run build
```

Pass = one Select, per-tool threads, shared layout only, no scaffold pages, no new UI.

## Notes for Next Agent

M7 errors/loading if not already on shared layout (they are — verify, do not redesign). PRD binding: stack + orchestrate + analysis-only + **no new UI**.
