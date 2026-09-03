# Spec: Grafana PRD #1 — M0 validation spike

**Status:** ready for ADW after human approve  
**Upstream PRD:** `vfarcic/dot-ai-grafana` PRD #1 (expanded on `docs/prd-1-build-ready` / PR #2)  
**Slice:** Phase 1 **M0 only** (no plugin code yet)  
**Homes:** capture `revive_labs/dot-ai-grafana/`; code later on `LesleyMurfin/dot-ai-grafana`  
**Do not:** invent Kubeshark client; mutate riley_infrastructure for this design; Grafana Cloud track

## Summary

Confirm load-bearing REST/auth/read-only/timeout claims against a **live** dot-ai before scaffolding the Grafana plugin. Record observed results in `design/M0-results.md` (create if missing). Presentation field map, cluster-context source, no-`apply` analysis-only, and timeout strategy must be evidence-backed.

## Files to Touch

| Path | Action |
|------|--------|
| `design/M0-results.md` | **Create** — fill Group A results table from live curls |
| `design/M0-validation-and-test-plan.md` | Read only (commands SSOT) |
| `prd/1-grafana-ai-cluster-intelligence.md` | Read only (contracts / open questions) |
| Plugin repo | **None** this slice |

## Step-by-Step

1. Require env from human (do not invent): `BASE` (dot-ai REST URL), `TOK` (Bearer, **no** `apply`).
2. Run Group A checks from `design/M0-validation-and-test-plan.md` (A1–A8) with real `curl`/`jq`.
3. Write `design/M0-results.md` with: command, exit, key JSON fields, pass/fail per A1–A8, and **decision notes**:
   - query human field = `data.result.summary` (confirmed or not)
   - remediate: `executionChoices` absent with no-apply token
   - auth: `Authorization` and/or `X-Dot-AI-Authorization`
   - latency: measured query vs remediate wall-clock → recommend blocking vs async for M3
4. If any A* fails: stop with exact failure; do not start M1.
5. Hand off: M0 exit criteria met → open M1 scaffold ADW (separate specs file).

## Verification

```bash
# From capture root: revive_labs/.../dot-ai-grafana
test -f design/M0-results.md
grep -E 'A1|A2|A3|A4|A5|A6|A7|A8' design/M0-results.md
# Each A-row must show PASS or FAIL with evidence (not empty stubs)
! grep -qi 'TODO\|TBD\|not run' design/M0-results.md || echo 'WARN: incomplete results'
```

Pass = `M0-results.md` exists and documents all A1–A8 with observed data.

## Notes for Next Agent

- **ADW:** scout→peer-review→plan→peer-review→build→peer-review→test→peer-review before M1.
- Mission: `drafts/omp/AUTONOMOUS-ADW-MISSION.md` (standing approval; no engineer pings for defaults).
- M1 specs: `specs/grafana-prd1-m1-scaffold.md` — fork worktree only for code.
- Upstream product PRD text is additive-only; do not rewrite Viktor’s original for strip-check.
- Phase 2/3 and Kubeshark stay out of this contribution.
- Reference deployment: Grafana **11.4**; `grafanaDependency: >=11.0`.
