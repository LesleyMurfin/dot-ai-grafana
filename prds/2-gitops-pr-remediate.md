# PRD: GitOps PR path for remediate execute (post v1)

**Issue**: https://github.com/LesleyMurfin/dot-ai-grafana/issues/13
**Priority**: High (follows PRD #1 ship)  
**Status**: Draft  
**Updated**: 2026-09-02

## Problem

PRD #1 ships analysis-only remediate. Users get diagnosis text but cannot turn a proposed fix into a change from Grafana. In-cluster apply from the plugin is the wrong default: no review trail, bypasses GitOps, and collides with no-apply tokens.

Viktor (vfarcic/dot-ai-grafana PR #2): keep v1 analysis-only; open a **separate** PRD for execute as a **GitOps-PR** path — on the roadmap now, not parked inside PRD #1 Phase 2.

## Solution

After PRD #1 is live, Grafana UI keeps proposing remediation analysis; an explicit execute path creates a **pull request against the GitOps repo** (manifest/values diff). Cluster mutation happens only via the existing GitOps reconcile after human review/merge. The plugin never kubectl-applies.

## Scope

- Post–PRD #1 only (depends on analysis-only Query/Remediate UI + backend proxy).
- UI: from an analysis result, propose → open/link a GitOps PR (title, body, file diffs).
- Backend/integration: create PR via SCM API (or hand off to a controlled automation) using credentials distinct from the no-apply analysis token.
- Document **no-apply vs apply** (or PR-bot) token split; analysis path stays no-apply forever.
- RBAC/approval: who may trigger PR creation; optional second approver before open.
- e2e against a real or fixture GitOps repo proving proposal → PR without direct cluster write.

## Related PRDs (do not mix)

```
  PRD #1  vfarcic#3 / fork #21 / 0.1.0     analysis-only pack   — not this file
  PRD #2  this file / issue #13 / PR #18   GitOps PR execute
  PRD #3  issue #23 / PR #22 / 0.2.x       Map / Explore / show-me — not this file
```

Do **not** dump M7 Map/Explore/show-me/markdown into this PRD. That is [issue #23](https://github.com/LesleyMurfin/dot-ai-grafana/issues/23) / [PR #22](https://github.com/LesleyMurfin/dot-ai-grafana/pull/22).

## Out of scope

- In-cluster `kubectl apply` / live mutate from the Grafana plugin.
- Any change to PRD #1 v1 analysis-only product surface ([vfarcic#3](https://github.com/vfarcic/dot-ai-grafana/pull/3) / [fork #21](https://github.com/LesleyMurfin/dot-ai-grafana/pull/21)).
- M7 Map `/d/<uid>`, Explore/Drilldown, show-me skip POST, markdown Answer — [PRD #3](https://github.com/LesleyMurfin/dot-ai-grafana/issues/23).
- operate/recommend multi-tool expansion (separate work if needed).
- Marketplace publishing, rich visualization of diffs beyond reviewable PR content.

## Success criteria

- Operator can go from remediate analysis in Grafana to a **reviewable GitOps PR** without the plugin writing the cluster.
- Analysis continues to work with no-apply credentials when execute/PR credentials are absent or denied.
- Audit trail is the PR (and GitOps history), not an opaque plugin action.

## Milestones

- [x] PRD GitHub issue filed on `LesleyMurfin/dot-ai-grafana`
- [ ] no-apply vs apply (or PR-create) token split documented
- [ ] UI proposal → GitOps PR flow
- [ ] RBAC / approval gates for PR creation
- [ ] e2e against a GitOps repo (no direct cluster mutate from plugin)

## Decisions

| date | decision | rationale |
|------|----------|-----------|
| 2026-09-01 | Execute = GitOps PR only; no in-plugin cluster apply | Viktor PR #2; keeps GitOps SoT and review; RULE-027 separate from PRD #1 |
| 2026-09-01 | PRD #1 remains analysis-only; this PRD owns execute | Avoid double scope and Phase-2 parking inside PRD #1 |
| 2026-09-02 | M7 Map/Explore/show-me is **not** this PRD | [issue #23](https://github.com/LesleyMurfin/dot-ai-grafana/issues/23) / [PR #22](https://github.com/LesleyMurfin/dot-ai-grafana/pull/22) |

## Work Log

### 2026-09-01 — PRD opened from Viktor PR #2

- **Issue**: Execute path must be roadmap-real without expanding PRD #1.
- **Action**: Draft PRD #2 (problem, scope, out, milestones). PRD #1 OQ6 points here.
- **Prompt**: Finish Viktor PR #2 comments — separate GitOps-PR remediate PRD.

### 2026-09-02 — Point at PRD #3; keep GitOps-only

- **Issue**: Parked M7 extras must not land in this PRD.
- **Action**: Related-PRDs table + out-of-scope pointer to issue #23 / PR #22. No Map/Explore/show-me content added.
