# Spec: Grafana PRD #1 — M2 plugin configuration

**Status:** ready for ADW BUILD (standing Phase 1 approval + plan peer-review)  
**Depends on:** M1 scaffold at `bbc95f8` (stack OK; do not wait for merge)  
**Code home:** `LesleyMurfin/dot-ai-grafana` fork only  
**Branch:** `feat/prd1-m2-config` stacked on `feat/prd1-m1-scaffold`

## Summary

Deliver the admin **plugin configuration page**: non-secret `jsonData.apiUrl` (dot-ai REST base), secret auth token in `secureJsonData.apiKey` (UI label: Auth Token), Save settings, and a **Test connection** action that proves the plugin can reach dot-ai by `POST {apiUrl}/api/v1/tools/version` with `Authorization: Bearer <token>`. No query/remediate product UI (M4/M5); no full proxy surface beyond test/health (M3).

## Files to Touch

| Path | Action |
|------|--------|
| `src/components/AppConfig/AppConfig.tsx` | Labels, Test connection, preventDefault submit, status messaging |
| `src/components/AppConfig/AppConfig.test.tsx` | Cover Test button + labels |
| `src/components/testIds.ts` | Add `testConnection` (+ optional status) test ids |
| `pkg/plugin/app.go` | Load `apiUrl` + decrypted `apiKey` from `AppInstanceSettings`; HTTP client |
| `pkg/plugin/resources.go` | `POST /test-connection` → version probe; tighten `/health` when configured |
| `pkg/plugin/resources_test.go` | Unit tests with `httptest` for version success/401/misconfig |
| `tests/appConfig.spec.ts` | Keep save path; assert Test connection control present |
| `README.md` | Config: apiUrl + token + Test connection note |
| Capture `specs/` + `reports/adw/` | This spec + peer-review + RUNLOG (not in plugin PR unless mirrored) |

## Step-by-Step

1. Confirm worktree on `feat/prd1-m2-config` at M1 tip; do not touch `.config/`.
2. Backend: parse settings in `NewApp`; store trimmed `apiUrl` and `apiKey`.
3. Backend: implement `handleTestConnection` (POST only):
   - Resolve URL/token from instance settings; optional JSON body overrides (`apiUrl`, `apiKey`) for unsaved draft.
   - Require both; else `400` with clear message.
   - `POST {base}/api/v1/tools/version` with `Authorization: Bearer`, `Content-Type: application/json`, body `{}`, timeout ≤15s.
   - Map response: 2xx → `200` JSON `{status:"ok", connected?, message, upstreamStatus}`; non-2xx → `502`/`401` JSON with upstream snippet; transport error → `502`.
4. Backend: when configured, `handleHealth` may call the same version helper (still accept GET/POST); when unconfigured keep explicit not-configured / not_wired style message (not a silent ok that pretends cluster health).
5. Frontend AppConfig:
   - Field labels: **MCP Server URL** (`apiUrl`), **Auth Token** (`apiKey` secure field).
   - Descriptions: REST base (no path suffix required beyond host); token must be no-`apply` (D4).
   - **Save API settings** unchanged contract (enabled/pinned + jsonData + secureJsonData only when new secret entered).
   - **Test connection** button: POST `/api/plugins/${pluginId}/resources/test-connection` with draft `{apiUrl, apiKey?}`; show success/error Alert; do not log token.
6. Tests: Jest for control presence; Go table tests with fake upstream; e2e still saves settings.
7. Verify commands below; commit `-s`; open PR to fork (stack base OK); no merge (D13).

## Verification

```bash
cd /data/opt/revive/orca_serve/state/factory/workspaces/dot-ai-grafana/feat-prd1-m2-config
export PATH="/data/opt/revive/orca_serve/state/factory/tmp/go/go/bin:/data/opt/revive/orca_serve/state/factory/tmp/gopath/bin:$PATH"
export GOPATH=/data/opt/revive/orca_serve/state/factory/tmp/gopath
test -f src/components/AppConfig/AppConfig.tsx
grep -q 'test-connection\|testConnection\|Test connection' src/components/AppConfig/AppConfig.tsx
grep -q 'apiUrl' src/components/AppConfig/AppConfig.tsx
grep -q 'handleTestConnection\|/test-connection' pkg/plugin/resources.go
npm run typecheck
npm run build
npm run test:ci
go test ./pkg/...
# optional live (env from capture ../.env.dot-ai.local):
# curl -sS -X POST "$DOT_AI_BASE/api/v1/tools/version" -H "Authorization: Bearer $DOT_AI_TOKEN" -H 'Content-Type: application/json' -d '{}'
```

Pass = typecheck+build+jest green; go test green including test-connection cases; AppConfig exposes Save + Test connection; secret remains `secureJsonData` only.

## Notes for Next Agent

- Secure JSON key stays **`apiKey`** (scaffold/e2e/provisioning); product language is Auth Token.
- M3: real `/query` + `/remediate` proxy reusing the same settings + Bearer helper; async 202+poll default (D7).
- Auth: direct Bearer (D5); `X-Dot-AI-Authorization` only if K8s proxy path required (D6).
- Do not wait for M1 merge; stack PRs.
- Peer-review every handoff with `nlm` CLI; store under `reports/adw/M2-*-peer-review.md`.
