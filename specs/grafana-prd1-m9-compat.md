# Spec: Grafana PRD #1 — M9 compatibility

**Depends on:** M0–M8 plugin + docs baseline  
**Plugin id:** `lesleymurfin-dotai-app`  
**Role:** BUILD/docs (spec text only) — record grafanaDependency floor + 11.4 must-pass; CI matrix already committed.

## Current State

- **Dependency floor.** `src/plugin.json` → `dependencies.grafanaDependency: ">=11.0.0"`, `plugins: []`.
- **Pins.** `package.json` deps pin `@grafana/data|runtime|ui|schema` all **11.4.0**; dev `@grafana/plugin-e2e` ^3.10.0, `@grafana/eslint-config` ^9.0.0, `@grafana/tsconfig` ^2.2.0, `@grafana/sign-plugin` ^3.3.3.
- **Live host verified 2026-09-01** in this worktree: `curl -sS http://10.43.25.61/api/health` → `{"database":"ok","version":"11.4.0","commit":"b58701869e1a11b696010a6f28bd96b68a2cf0d0"}`; `/public/plugins/lesleymurfin-dotai-app/module.js` returns **200**. Must-pass reference host confirmed at **11.4.0**, matching the pins.
- **Multi-version matrix already wired** (not pending design): `.github/workflows/ci.yml` job `resolve-versions` uses `grafana/plugin-actions/e2e-version@e2e-version/v3.0.1` and feeds `playwright-tests` via `matrix.GRAFANA_IMAGE`, launching docker compose with `GRAFANA_VERSION`/`GRAFANA_IMAGE`. `.github/workflows/is-compatible.yml` runs `grafana/plugin-actions/is-compatible@is-compatible/v1.0.3` on every PR with `fail-if-incompatible: 'yes'`. Only CI runners gate execution.
- **E2E assets present:** `tests/appConfig.spec.ts`, `tests/appNavigation.spec.ts`, `tests/fixtures.ts`; `playwright.config.ts:29` `baseURL: process.env.GRAFANA_URL || 'http://localhost:3000'`.
- **Still open:** `reports/` does not exist, so optional `reports/adw/M9-compat.md` is unwritten; `plugin.json` `screenshots` still `[]`.

## Summary

Document grafanaDependency >=11.0 must-pass 11.4; note 13.x e2e matrix via plugin-e2e when CI allows. Capture local verification commands. No new UI.

## Files to Touch

README.md (compat section — already present; keep truthful); optional `reports/adw/M9-compat.md`; screenshots only if host assets exist (do not invent paths).

## Step-by-Step

1. Record pins `@grafana/*` 11.4.0 and dependency floor `>=11.0.0`.
2. List verification: npm build, go test, typecheck; live health `version=11.4.0`.
3. Record that `resolve-versions` + `playwright-tests` + `is-compatible` workflows are **already committed**; M9 only records the matrix outcome once runners are available (do not redesign the matrix).

## Verification

```bash
grep grafanaDependency src/plugin.json
grep '@grafana/data' package.json
grep -n 'resolve-versions\|is-compatible\|GRAFANA_IMAGE' .github/workflows/ci.yml .github/workflows/is-compatible.yml
curl -sS http://10.43.25.61/api/health
npm run build
```

Pass = floor `>=11.0.0`, pins 11.4.0, live host 11.4.0, CI matrix files present.

## Notes for Next Agent

Phase 1 complete when M0–M9 artifacts + PRs open unmerged. Do not block on marketplace screenshots if host assets are absent — leave `screenshots: []` and note TODO. Never edit M4 in this lane.
