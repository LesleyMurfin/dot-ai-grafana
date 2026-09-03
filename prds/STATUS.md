# Status (this fork only — not vfarcic#3)

Live checkboxes: https://github.com/LesleyMurfin/dot-ai-grafana/issues/24

```
PRD #1  v1 0.1.0   vfarcic#3   analysis-only pack
PRD #2  GitOps     issue #13 / PR #18
PRD #3  M7 0.2.x   issue #23 / PR #22
```

Viktor’s review (the only comment on #3):
https://github.com/vfarcic/dot-ai-grafana/pull/3#pullrequestreview-5092068595  
Head we addressed: `179a7df`.

## His merge-blockers — done

| # | Ask | Done |
|---|---|---|
| 1 | `npm run typecheck` / no `Promise.withResolvers` | [x] |
| 2 | `go test` / `TestAskLogFile` `debugLog:true` | [x] |
| 3 | `parsePodNamespace` — his 5 strings, no invented pods | [x] |
| 4 | Packed `{intent}` ≤ 1000 chars | [x] |
| — | CLAUDE.md RBAC honesty | [x] |
| — | PRD M6: Cancel + Retry shipped | [x] |

## His record item — still open

| Ask | Done |
|---|---|
| Original Phase-1 checklist still all `[ ]` and still says Grafana 10.x | [ ] |

## Take-or-leave — not done (he said optional)

Timeout “per hop” wording · `Promise.all` DS reads · `hop`≡`hops` · non-Admin Test-connection on saved URL · query denylist vs remediate allowlist · drop `public-surface-check.sh` · appConfig e2e Save path in CI · skill frontmatter / `go 1.26.5` / extra `Routes` · Actions on *his* `main` (needs him)

## New work we built after he reviewed — parked, tracked here

Not in vfarcic#3. Not lost.

| Feature | PRD | Issue | PR |
|---|---|---|---|
| Explore / Drilldown Map links | [prds/3](3-m7-grafana-map.md) | [#23](https://github.com/LesleyMurfin/dot-ai-grafana/issues/23) | [#22](https://github.com/LesleyMurfin/dot-ai-grafana/pull/22) |
| show-me skip POST | same | #23 | #22 |
| firing-alert `dashboardUid` → `/d/<uid>` | same | #23 | #22 |
| markdown Answer / collapse Current | same | #23 | #22 |
| GitOps PR execute | [prds/2](2-gitops-pr-remediate.md) | [#13](https://github.com/LesleyMurfin/dot-ai-grafana/issues/13) | [#18](https://github.com/LesleyMurfin/dot-ai-grafana/pull/18) |

v1 on Viktor stays **0.1.0**. M7 is **0.2.x**.
