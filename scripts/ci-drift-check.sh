#!/usr/bin/env bash
# ci-drift-check.sh — assert scripts/ci-local.sh still mirrors .github/workflows/ci.yml.
#
# The known failure mode of a hand-written local CI runner is silent drift:
# ci.yml gains a step, the runner does not, and "green locally" quietly stops
# meaning "green upstream". This guard runs in BOTH directions:
#
#   forward   every step in ci.yml is either owned by a gate in the ci-local.sh
#             registry, or explicitly allowlisted below with a reason.
#   reverse   every gate in the registry matches at least one step in ci.yml,
#             unless the gate declares LOCAL_ONLY:<reason>.
#
# The gate registry is read from `ci-local.sh --dump-registry`, so there is one
# source of truth for gates and one for CI steps, and this file owns neither.
#
# ci.yml is parsed by python3 + PyYAML — a real YAML reader, so `run: |` block
# scalars, quoting and indentation are handled by the parser rather than by
# regex. Inside a run block, backslash continuations are joined, comments and
# blank lines dropped, whitespace squeezed; each remaining line is one step
# command. `uses:` steps are emitted as `uses:<action-without-ref> args=<with.args>`
# because ci.yml runs several real gates (golangci-lint, mage) through actions
# rather than through `run:`.
#
# Usage: ci-drift-check.sh [--workflow <path>]
#   --workflow points the guard at an alternative ci.yml; this is how the
#   negative control verifies that the guard actually bites.
set -euo pipefail

SELF="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SELF/.." && pwd)"
WORKFLOW="$ROOT/.github/workflows/ci.yml"

while (($#)); do
  case "$1" in
    --workflow) WORKFLOW="${2:-}"; shift ;;
    --workflow=*) WORKFLOW="${1#*=}" ;;
    -h|--help) sed -n '2,27p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) printf 'ci-drift-check: unknown argument %s\n' "$1" >&2; exit 64 ;;
  esac
  shift
done

[[ -f $WORKFLOW ]] || { printf 'ci-drift-check: workflow not found: %s\n' "$WORKFLOW" >&2; exit 1; }

# ALLOWLIST — CI steps that legitimately have no local equivalent.
# `pattern~reason`. Every entry carries its reason; if a step needs a reason you
# cannot write down, it is drift, not an exception.
ALLOWLIST=(
  "^uses:actions/~GitHub-runner provisioning (checkout, setup-node, setup-go, artifacts); a local checkout already has the sources and toolchains"
  "^uses:grafana/plugin-actions/~runner-only helpers (e2e image matrix, wait-for-grafana); the local e2e gate polls Grafana itself"
  "GITHUB_OUTPUT~GHA step-output plumbing; the local runner passes values between gates in-process"
  "^export GRAFANA_PLUGIN_~shell variables that only exist to feed GITHUB_OUTPUT; the package gate reads dist/plugin.json directly"
  "^if \\[ -f ~feature detection that toggles GHA job conditionals; local gates test for the same files themselves"
  "^(then|else|elif|fi|do|done|esac|;;|\\{|\\})$~shell control keywords produced by splitting a 'run: |' block into lines"
  "^sudo apt-get install jq~runner package provisioning; jq is a documented local prerequisite and there is no sudo in a dev shell"
  "^chmod \\+x \\./dist/gpx_~restores the exec bit that upload/download-artifact drops; a local build never loses it"
  "^npm exec playwright install~browser provisioning; local runs use the cached browser download"
  "^docker logs ~post-failure log capture on the runner; locally the compose logs are already on the machine"
)

STEPS_FILE="$(mktemp)"
REG_FILE="$(mktemp)"
trap 'rm -f "$STEPS_FILE" "$REG_FILE"' EXIT

python3 - "$WORKFLOW" >"$STEPS_FILE" <<'PY'
import sys

import yaml

with open(sys.argv[1], encoding="utf-8") as fh:
    doc = yaml.safe_load(fh)

rows = []
for job_id, job in (doc.get("jobs") or {}).items():
    for step in (job or {}).get("steps") or []:
        name = step.get("name") or step.get("uses") or "(unnamed)"
        if "run" in step:
            body = str(step["run"]).replace("\\\n", " ")
            for line in body.splitlines():
                line = " ".join(line.split())
                if not line or line.startswith("#"):
                    continue
                rows.append((job_id, name, "run", line))
        elif "uses" in step:
            action = str(step["uses"]).split("@")[0]
            args = ((step.get("with") or {}).get("args"))
            cmd = "uses:" + action
            if args:
                cmd += " args=" + " ".join(str(args).split())
            rows.append((job_id, name, "uses", cmd))

for row in rows:
    print("\t".join(row))
PY

bash "$SELF/ci-local.sh" --dump-registry >"$REG_FILE"

declare -A gate_hits=()
declare -A gate_match=()
declare -a gate_order=()
while IFS='~' read -r gid _greq gmatch; do
  [[ -z $gid ]] && continue
  gate_order+=("$gid")
  gate_match["$gid"]="$gmatch"
  gate_hits["$gid"]=0
done <"$REG_FILE"

unmatched=()
matched_count=0
allowed_count=0

while IFS=$'\t' read -r job step kind cmd; do
  [[ -z ${cmd:-} ]] && continue
  owner=""
  for gid in "${gate_order[@]}"; do
    pattern="${gate_match[$gid]}"
    [[ $pattern == LOCAL_ONLY:* ]] && continue
    if printf '%s\n' "$cmd" | grep -Eq -- "$pattern"; then
      owner="$gid"
      gate_hits["$gid"]=$((gate_hits["$gid"] + 1))
      break
    fi
  done
  if [[ -n $owner ]]; then
    matched_count=$((matched_count + 1))
    continue
  fi
  for entry in "${ALLOWLIST[@]}"; do
    apat="${entry%%~*}"
    if printf '%s\n' "$cmd" | grep -Eq -- "$apat"; then
      owner="allowlist"
      break
    fi
  done
  if [[ -n $owner ]]; then
    allowed_count=$((allowed_count + 1))
    continue
  fi
  unmatched+=("$job / $step [$kind] -> $cmd")
done <"$STEPS_FILE"

orphans=()
local_only=0
for gid in "${gate_order[@]}"; do
  if [[ ${gate_match[$gid]} == LOCAL_ONLY:* ]]; then
    local_only=$((local_only + 1))
    continue
  fi
  if ((gate_hits[$gid] == 0)); then
    orphans+=("$gid (ci-match: ${gate_match[$gid]})")
  fi
done

printf 'ci-drift-check: workflow %s\n' "${WORKFLOW#"$ROOT"/}"
printf 'ci-drift-check: %d CI step(s) owned by a gate, %d allowlisted, %d gate(s) declared local-only\n' \
  "$matched_count" "$allowed_count" "$local_only"

rc=0
if ((${#unmatched[@]} > 0)); then
  rc=1
  printf '\nci-drift-check: DRIFT (forward) - %d ci.yml step(s) are not represented in the ci-local.sh gate registry:\n' \
    "${#unmatched[@]}" >&2
  for u in "${unmatched[@]}"; do printf '  - %s\n' "$u" >&2; done
  printf 'Add a gate to GATES in scripts/ci-local.sh, or an allowlist entry (with a reason) in scripts/ci-drift-check.sh.\n' >&2
fi

if ((${#orphans[@]} > 0)); then
  rc=1
  printf '\nci-drift-check: DRIFT (reverse) - %d gate(s) match no step in ci.yml:\n' "${#orphans[@]}" >&2
  for o in "${orphans[@]}"; do printf '  - %s\n' "$o" >&2; done
  printf 'The step was removed from CI, the ci-match pattern is stale, or the gate should declare LOCAL_ONLY:<reason>.\n' >&2
fi

if ((rc == 0)); then
  echo 'ci-drift-check: ok - ci-local.sh and ci.yml agree in both directions'
fi
exit "$rc"
