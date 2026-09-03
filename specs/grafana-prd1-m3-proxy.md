# Spec: Grafana PRD #1 — M3 backend proxy

**Status:** ready for ADW BUILD (standing approval)  
**Depends on:** M2 config @ `385354b` / PR #2  
**Code home:** `LesleyMurfin/dot-ai-grafana`  
**Branch:** `feat/prd1-m3-proxy` stacked on `feat/prd1-m2-config`

## Summary

Wire Go backend resource handlers `POST /query` and `POST /remediate` to proxy JSON to dot-ai `POST /api/v1/tools/query` and `POST /api/v1/tools/remediate` using saved `apiUrl` + Bearer `apiKey`. Preserve upstream status/body (including future `202` async). No product UI (M4/M5). Analysis-only remediate (no execute). Fail clear when unconfigured.

## Files to Touch

| Path | Action |
|------|--------|
| `pkg/plugin/app.go` | Longer client timeout for tool proxy (or dual clients) |
| `pkg/plugin/resources.go` | Replace query/remediate stubs with `proxyTool`; shared helper |
| `pkg/plugin/resources_test.go` | httptest proxy tests: success, 401, 500, unconfigured, method |
| `README.md` | Note M3 proxy wired |

## Step-by-Step

1. Branch from M2 tip.
2. Add `proxyDotAI(ctx, method, toolPath, body)` helper: require apiURL+apiKey; `Authorization: Bearer`; forward Content-Type; copy limited response body; map transport errors → 502.
3. `handleQuery` / `handleRemediate`: POST only; read body (cap e.g. 1MiB); proxy to `/api/v1/tools/query` or `/remediate`.
4. Timeouts: tool calls ≤120s (D7 async preferred when upstream returns 202 — pass through status/body unchanged for FE poll later).
5. Do not strip error envelopes (LLM EXECUTION_ERROR must surface for M7).
6. Tests with httptest; keep test-connection tests green.
7. Verify; commit -s; PR stacked on M2 branch; peer-review ship gate.

## Verification

```bash
export PATH="/data/opt/revive/orca_serve/state/factory/tmp/go/go/bin:/data/opt/revive/orca_serve/state/factory/tmp/gopath/bin:$PATH"
export GOPATH=/data/opt/revive/orca_serve/state/factory/tmp/gopath
cd <worktree>
grep -q 'tools/query' pkg/plugin/resources.go
grep -q 'tools/remediate' pkg/plugin/resources.go
go test ./pkg/...
npm run typecheck && npm run build && npm run test:ci
```

Pass = go tests cover proxy; build green; stubs replaced for query/remediate only.

## Notes for Next Agent

- M4 Query UI consumes `/api/plugins/<id>/resources/query` and renders `data.result.summary` (D1).
- M5 Remediate analysis UI same pattern; never execute.
- If upstream adds job poll URLs, add thin `/session` proxy in follow-up — not required if body embeds poll info.
- D5 Bearer; no token in logs.
