# Spec: Grafana PRD #1 — M1 plugin scaffold

**Status:** ready for ADW after M0 results PASS + human approve  
**Depends on:** `specs/grafana-prd1-m0-validation.md` complete  
**Code home:** `LesleyMurfin/dot-ai-grafana` fork (not riley_infrastructure)  
**Branch suggestion:** `feat/prd1-m1-scaffold` from `upstream/main` (or `main` synced)

## Summary

Scaffold a Grafana **App plugin with backend** via `@grafana/create-plugin`, pin frontend deps for **Grafana 11.4**, add placeholder Go resource handlers for `/query` `/remediate` `/health` (stubs OK), ensure the app builds and can load unsigned. No full UI product yet (M4/M5).

## Files to Touch

| Path | Action |
|------|--------|
| Fork root after scaffold | `package.json`, `src/`, `pkg/`, `Magefile.go`, `docker-compose` / config as create-plugin emits |
| `src/plugin.json` (or package) | `grafanaDependency: ">=11.0.0"`; app type; nav |
| `pkg/` backend | Stub resource routes matching PRD tool map |
| `README.md` | Minimal install + unsigned plugin note |
| Capture PRD | Do **not** modify unless syncing status only |

## Step-by-Step

1. Worktree/checkout **fork** `LesleyMurfin/dot-ai-grafana` on a **feature** branch from current `main` (not the docs-only PR branch if it only has prds/).
2. If repo is still docs-only: run `@grafana/create-plugin` app+backend in-repo (or generate into clean tree and preserve `prds/` + CLAUDE.md).
3. Pin `@grafana/data`, `@grafana/ui`, `@grafana/runtime` to versions supporting **11.4** (do not leave default 13-only if that breaks 11.4).
4. Backend stubs: POST proxies that return clear “not wired” or echo until M3; structure for `httpclient` + bearer later.
5. `npm install` / `npm run build` (and Mage backend build if present) must succeed.
6. Document unsigned load: `allow_loading_unsigned_plugins=<plugin-id>`.
7. Commit with DCO (`git commit -s`); open PR to **fork main** or stack; upstream code PR only when M0–M1 quality is reviewable (docs PR #2 already open).

## Verification

```bash
# In plugin fork worktree after scaffold
test -f package.json
test -f src/plugin.json || test -f src/module.tsx || test -f src/module.ts
npm run build
# backend if present:
# mage -v build:backend   # or project-equivalent
```

Pass = frontend build green; plugin metadata present; backend package builds if scaffolded.

## Notes for Next Agent

- **ADW:** every handoff needs `/peer-review` (NLM+IR); see `drafts/omp/AUTONOMOUS-ADW-MISSION.md`.
- Defaults: `drafts/omp/DEFAULTS-LOCKED.md` — do not re-ask engineer.
- M2 = config page (apiUrl + secureJsonData token + Test-connection via `version`).
- M3 = real proxy + tests + async timeout path per M0 decision.
- Auth: prefer `Authorization: Bearer` for direct Go→dot-ai; `X-Dot-AI-Authorization` only if K8s proxy path.
- Query presentation: `data.result.summary` only; plain intent (no `[visualization]` prefix).
