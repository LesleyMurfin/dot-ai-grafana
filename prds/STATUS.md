# Status (this fork only — not vfarcic#3)

Checkbox tracker (closed 2026-09-03): https://github.com/LesleyMurfin/dot-ai-grafana/issues/24

```
PRD #1  v1 0.1.0   vfarcic#3 @ ac627d4   analysis-only pack
PRD #2  GitOps     issue #13 / PR #18
PRD #3  M7 0.2.x   issue #23 / PR #22
PRD #4  Evidence-grounded change safety   issue #31 / PR #33
PRD #5  Plugin usability                 issue #32 / PR #34
nits    take-or-leave code             PR #26 (merged → feat/upstream-plugin)
```

Viktor’s only #3 comment:
https://github.com/vfarcic/dot-ai-grafana/pull/3#pullrequestreview-5092068595

## His merge-blockers — done on #3 @ `ac627d4`

| # | Ask | Done |
|---|---|---|
| 1 | `npm run typecheck` / no `Promise.withResolvers` | [x] |
| 2 | `go test` / `TestAskLogFile` `debugLog:true` | [x] |
| 3 | `parsePodNamespace` — his 5 strings, no invented pods | [x] |
| 4 | Packed `{intent}` ≤ 1000 chars | [x] |
| — | CLAUDE.md RBAC honesty | [x] |
| — | PRD M6: Cancel + Retry shipped | [x] |

## Take-or-leave + checklist — in [PR #26](https://github.com/LesleyMurfin/dot-ai-grafana/pull/26) (merged 2026-09-03 → feat/upstream-plugin)

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

**On the last row — "needs Viktor":** *Viktor* is [@vfarcic](https://github.com/vfarcic), owner and
sole maintainer of the upstream repo, and *his* `main` is `vfarcic/dot-ai-grafana@main`. His #3
review recorded GitHub Actions as **"never ran"** — `.github/workflows/ci.yml` arrived *with* PR #3
while upstream `main` had no workflows, so no checks could gate the merge. The action needed was
his alone: land the workflows on upstream `main` (or give the branch a home in his repo) so CI
becomes a real gate. Nothing in this fork can tick that box. **Resolved by his merge of #3** as
[`ac627d4`](https://github.com/vfarcic/dot-ai-grafana/commit/ac627d4) (2026-09-03), the first commit
carrying `ci.yml` on upstream `main`; upstream Actions have run since (release workflow
[#27](https://github.com/vfarcic/dot-ai-grafana/pull/27), dependency bumps #16/#17/#33–#37). The
row is left unticked because it was never ours to tick.

## New work after he reviewed — parked, not in vfarcic#3

| Feature | PRD | Issue | PR |
|---|---|---|---|
| Explore / Drilldown Map links | prds/3-m7-grafana-map.md (not on this branch) | [#23](https://github.com/LesleyMurfin/dot-ai-grafana/issues/23) | [#22](https://github.com/LesleyMurfin/dot-ai-grafana/pull/22) |
| show-me skip POST | same | #23 | #22 |
| firing-alert `dashboardUid` → `/d/<uid>` | same | #23 | #22 |
| markdown Answer / collapse Current | same | #23 | #22 |
| GitOps PR execute | prds/2-gitops-pr-remediate.md (not on this branch) | [#13](https://github.com/LesleyMurfin/dot-ai-grafana/issues/13) | [#18](https://github.com/LesleyMurfin/dot-ai-grafana/pull/18) |

v1 on Viktor stays **0.1.0**. M7 is **0.2.x**.

## Superseded upstream (2026-09-03)

All four fork PRD trackers — #13, #23, #31, #32 — were closed as superseded upstream. Future
work on these workstreams lives upstream, not in this fork:

| Fork PRD | Fork tracker | Superseded by |
|---|---|---|
| PRD #2 | issue #13 | [vfarcic/dot-ai-grafana#5](https://github.com/vfarcic/dot-ai-grafana/issues/5) |
| PRD #3 | issue #23 | [vfarcic/dot-ai-grafana#6](https://github.com/vfarcic/dot-ai-grafana/issues/6) |
| PRD #4 | issue #31 | [vfarcic/dot-ai-grafana#7](https://github.com/vfarcic/dot-ai-grafana/issues/7) |
| PRD #5 | issue #32 | [vfarcic/dot-ai-grafana#8](https://github.com/vfarcic/dot-ai-grafana/issues/8) |

## Other decisions

- Image rendering (grafana/grafana-image-renderer) evaluated 2026-09-05 and **not adopted** — the
  plugin needs no server-side rendering. The full evaluation record is held privately in the
  `revive_labs` repo at `dot-ai-grafana/design/image-rendering-evaluation.md`.

## Notes on prds/2 and prds/3 files

Both `prds/2-gitops-pr-remediate.md` and `prds/3-m7-grafana-map.md` were created on fork feature branches (`origin/feat/prd2-gitops-execute`, `origin/feat/prd3-m7-grafana-map`; PRs #18, #22) that remain closed and unmerged. They do not live on this branch (main or the current rebase branch). Decision: defer rehoming these specs upstream under vfarcic#5 / vfarcic#6 until the fork feature branches are formally closed or merged upstream.
