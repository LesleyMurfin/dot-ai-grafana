# Quality review — dot-ai Grafana plugin

| Field | Value |
| --- | --- |
| **Date** | 2026-09-01 |
| **Skills** | `mattpocock/skills@6654f6b` |
| **Repo** | [LesleyMurfin/dot-ai-grafana](https://github.com/LesleyMurfin/dot-ai-grafana) (origin); upstream `vfarcic/dot-ai-grafana` |
| **Branch context** | `ai/featherduster` |
| **Comparator** | Viktor Farcic Headlamp plugin [`vfarcic/dot-ai-headlamp`](https://github.com/vfarcic/dot-ai-headlamp) (read-only reference) |
| **Verdict** | **No P0.** One **P1** (authz on draft URL test-connection) and four **P2** items. Safe to ship only after P1 is fixed; P2s are correctness/maintainability debt. |

## Summary

Review of the Grafana app plugin against Headlamp’s dot-ai integration and internal contracts. No critical (P0) production breakers were filed. The highest severity item is missing Grafana Admin enforcement when `/test-connection` honors a draft API URL that differs from saved settings (SEC-01 key non-reuse is already present). Remaining items: misleading AppConfig success copy, query/remediate intent+envelope contract drift, dead scaffold pages/routing, and missing unit coverage for `callDotAITool` fetch rejection.

## Findings

| Sev | File:line | Cause | Fix | Issue |
| --- | --- | --- | --- | --- |
| **P1** | `pkg/plugin/resources.go:97-106` | Draft `apiUrl` on `POST /test-connection` is applied without a Grafana Admin check. SEC-01 correctly clears the saved key when the draft URL ≠ saved URL, but any caller who can hit the resource can still drive probes at an arbitrary draft base URL. | Require Grafana Admin before honoring a draft URL that differs from the saved URL. Allow saved-URL tests without the new gate. Keep SEC-01 (never reuse saved key on a different draft URL). Reject non-Admin draft-URL attempts clearly. | [#7](https://github.com/LesleyMurfin/dot-ai-grafana/issues/7) |
| **P2** | `src/components/AppConfig/AppConfig.tsx:158-169` | Success fallback (`'Connection successful'`) is computed before `payload.status === 'ok'`, so non-ok responses can surface success-looking copy when `message` is empty. | Build the success string only on `status === 'ok'`. On error use `payload.message \|\| 'Connection test failed'`. | [#8](https://github.com/LesleyMurfin/dot-ai-grafana/issues/8) |
| **P2** | Backend `pkg/plugin/**` resource handlers + `src/utils/dotaiApi.ts` | `/query` and `/remediate` request bodies and response envelopes drift from the shared contract (intent-only POST body; remediate intent→issue; stable `{ok,status,summary,error}`). Empty issue can forward useless payloads; UI cannot rely on a single shape. | Frontend always POST `{"intent":"<string>"}` for `/query` and `/remediate`. Backend maps remediate intent→issue; allowlist fields (drop execute/apply/mode). Empty issue → **400** `issue is required` (do not forward `{}`). Always return `{ "ok": boolean, "status": number, "summary": string, "error": string }` with `ok` iff upstream 2xx; `summary` from `result.summary\|analysis\|message`, `data.summary`, or top-level `summary`; `error` otherwise. | [#9](https://github.com/LesleyMurfin/dot-ai-grafana/issues/9) |
| **P2** | Scaffold: PageOne–Four, `ROUTES` / `constants.ts`, `utils.routing.ts`, unused `testIds.pageOne`–`pageFour` | `App.tsx` already routes `*` → `DotAIPage`, leaving create-plugin scaffold pages and routing helpers dead. | Delete PageOne–Four, ROUTES/related constants, `utils.routing.ts`, and unused page testIds; clean import-only callers. Do not change plugin ID/type or `.config/`. | [#10](https://github.com/LesleyMurfin/dot-ai-grafana/issues/10) |
| **P2** | `src/utils/dotaiApi.ts` (+ unit tests) | `callDotAITool` catch path is untested when `getBackendSrv().fetch` rejects. | Add a unit test that mocks `getBackendSrv().fetch` to reject and asserts catch/error behavior. | [#11](https://github.com/LesleyMurfin/dot-ai-grafana/issues/11) |

## Known host limits

Grafana plugin resource/tool HTTP clients use a **120s** overall request timeout (SDK `httpclient`), a known Grafana-host ceiling compared with Headlamp’s ~30 minute tool window. Long-running query/remediate work is still synchronous in this pass (no async 202).

## Explicit non-goals (original review doc)

- Review-doc pass did not implement fixes (fixers own `pkg/plugin/**`, AppConfig, scaffold, `dotaiApi`).
- Do not share AppConfig parsers with `dotaiApi` in this pass.
- No async 202 tool pattern, OpenAPI client, or RFC1918 blocking of saved URLs in this pass.

## Issue index

1. https://github.com/LesleyMurfin/dot-ai-grafana/issues/7 — P1 draft URL Admin gate  
2. https://github.com/LesleyMurfin/dot-ai-grafana/issues/8 — P2 AppConfig success message ordering  
3. https://github.com/LesleyMurfin/dot-ai-grafana/issues/9 — P2 query/remediate envelope + intent  
4. https://github.com/LesleyMurfin/dot-ai-grafana/issues/10 — P2 dead scaffold removal  
5. https://github.com/LesleyMurfin/dot-ai-grafana/issues/11 — P2 `callDotAITool` fetch-reject unit test  
