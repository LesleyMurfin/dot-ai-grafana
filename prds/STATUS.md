# Status (this fork only — not vfarcic#3)

Live checkboxes: https://github.com/LesleyMurfin/dot-ai-grafana/issues/24

```
PRD #1  v1 0.1.0   vfarcic#3 @ 179a7df   analysis-only pack
PRD #2  GitOps     issue #13 / PR #18
PRD #3  M7 0.2.x   issue #23 / PR #22
nits    take-or-leave code             PR #26 (open → feat/upstream-plugin)
```

Viktor’s only #3 comment:
https://github.com/vfarcic/dot-ai-grafana/pull/3#pullrequestreview-5092068595

## His merge-blockers — done on #3 @ `179a7df`

| # | Ask | Done |
|---|---|---|
| 1 | `npm run typecheck` / no `Promise.withResolvers` | [x] |
| 2 | `go test` / `TestAskLogFile` `debugLog:true` | [x] |
| 3 | `parsePodNamespace` — his 5 strings, no invented pods | [x] |
| 4 | Packed `{intent}` ≤ 1000 chars | [x] |
| — | CLAUDE.md RBAC honesty | [x] |
| — | PRD M6: Cancel + Retry shipped | [x] |

## Take-or-leave + checklist — in [PR #26](https://github.com/LesleyMurfin/dot-ai-grafana/pull/26) (not merged yet)

| Ask | In #26 |
|---|---|
| Original Phase-1 checklist ticked; floor `>=11.0` | [x] |
| Timeout: 120s **per hop** (up to 3) | [x] |
| `Promise.all` Grafana DS get + query | [x] |
| `hop` = current, `hops` = planned cap | [x] |
| Test connection Admin-only (saved URL too) | [x] |
| Query allowlist = `intent` only | [x] |
| Dropped `public-surface-check.sh` | [x] |
| e2e Save path (`127.0.0.1:3456`) | [x] |
| Skill YAML frontmatter | [x] |
| App without extra `Routes` | [x] |
| `go 1.26.5` kept | [x] CI golangci-lint fails on `go 1.26` / `1.26.0` |
| GitHub Actions on *his* `main` | [ ] **needs Viktor** |

## New work after he reviewed — parked, not in vfarcic#3

| Feature | PRD | Issue | PR |
|---|---|---|---|
| Explore / Drilldown Map links | [prds/3](3-m7-grafana-map.md) | [#23](https://github.com/LesleyMurfin/dot-ai-grafana/issues/23) | [#22](https://github.com/LesleyMurfin/dot-ai-grafana/pull/22) |
| show-me skip POST | same | #23 | #22 |
| firing-alert `dashboardUid` → `/d/<uid>` | same | #23 | #22 |
| markdown Answer / collapse Current | same | #23 | #22 |
| GitOps PR execute | [prds/2](2-gitops-pr-remediate.md) | [#13](https://github.com/LesleyMurfin/dot-ai-grafana/issues/13) | [#18](https://github.com/LesleyMurfin/dot-ai-grafana/pull/18) |

v1 on Viktor stays **0.1.0**. M7 is **0.2.x**.
