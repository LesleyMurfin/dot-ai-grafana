#!/usr/bin/env bash
# ci-drift-check.sh — assert the scripts/ci-local.sh gate REGISTRY still matches
# the step list in .github/workflows/ci.yml.
#
# The known failure mode of a hand-written local CI runner is silent drift:
# ci.yml gains a step, the registry does not, and "green locally" quietly stops
# meaning "green upstream". This guard runs in BOTH directions:
#
#   forward   every step in ci.yml is either owned by a gate in the ci-local.sh
#             registry, or explicitly allowlisted below with a reason.
#   reverse   every gate in the registry matches at least one step in ci.yml,
#             unless the gate declares LOCAL_ONLY:<reason>.
#
# WHAT THIS PROVES, AND WHAT IT DOES NOT. The contract is between the registry
# and ci.yml's step definitions: a step cannot be added to, removed from, or have
# its command edited in ci.yml without either a gate claiming it or an allowlist
# entry excusing it. It does NOT prove that a gate's implementation runs the same
# command as the CI step it claims. `ci-match` ties a gate to the existence of a
# CI step, not to the gate's behaviour; keeping gate_lint actually running the
# lint is code review's job, not this guard's.
#
# The gate registry is read from `ci-local.sh --dump-registry`, so there is one
# source of truth for gates and one for CI steps, and this file owns neither.
#
# ci.yml is parsed by yq-go (mikefarah/yq) — a real YAML reader, so `run: |` block
# scalars, quoting and indentation are handled by the parser rather than by
# regex. It is one static binary, pinned in devbox.json like every other tool
# here, so the guard needs no interpreter and no language-level package. Inside a
# run block, backslash continuations are joined, comments and blank lines
# dropped, whitespace squeezed; each remaining line is one step command. `uses:`
# steps are emitted as `uses:<action-without-ref> args=<with.args>` because
# ci.yml runs several real gates (golangci-lint, mage) through actions rather
# than through `run:`.
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
    -h|--help) sed -n '2,37p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) printf 'ci-drift-check: unknown argument %s\n' "$1" >&2; exit 64 ;;
  esac
  shift
done

[[ -f $WORKFLOW ]] || { printf 'ci-drift-check: workflow not found: %s\n' "$WORKFLOW" >&2; exit 1; }

# The parser is a hard prerequisite, never a skip: if the YAML reader is missing
# the registry was not checked, and "not checked" must never exit 0. Two names
# share the `yq` binary — yq-go (mikefarah/yq, a YAML processor) and python-yq
# (a jq wrapper) — with incompatible expression languages, so identify the one
# on PATH rather than trusting the name.
if ! command -v yq >/dev/null 2>&1; then
  printf 'ci-drift-check: needs yq-go (mikefarah/yq) to read %s, and yq is not on PATH.\n' "${WORKFLOW#"$ROOT"/}" >&2
  printf 'ci-drift-check: install it - devbox.json declares yq-go - or see https://github.com/mikefarah/yq\n' >&2
  printf 'ci-drift-check: this is a FAILURE, not a skip - an unverified registry must never pass.\n' >&2
  exit 1
fi
YQ_VERSION="$(yq --version 2>&1 | tr '\n' ' ')"
case "$YQ_VERSION" in
  *mikefarah/yq*) ;;
  *)
    printf 'ci-drift-check: the yq on PATH is not yq-go: %s\n' "$YQ_VERSION" >&2
    printf 'ci-drift-check: python-yq shares the binary name but not the expression language; install yq-go (mikefarah/yq).\n' >&2
    printf 'ci-drift-check: this is a FAILURE, not a skip - an unverified registry must never pass.\n' >&2
    exit 1 ;;
esac

# ALLOWLIST — CI steps that legitimately have no local equivalent.
# `pattern~reason`. Every entry carries its reason; if a step needs a reason you
# cannot write down, it is drift, not an exception.
#
# Patterns are single-quoted (no shell expansion wanted) and anchored; a literal
# dollar is written `[$]` so neither the shell nor shellcheck sees a variable.
# Actions are allowlisted by their exact path, never by org prefix: `^uses:actions/`
# would have swallowed a genuinely new gate-worthy action (actions/cache, a new
# grafana/plugin-actions helper) as "runner provisioning". A new action under an
# already-excused org is now drift until someone writes down why it is not.
ALLOWLIST=(
  # runner provisioning: the local checkout already has the sources and toolchains
  '^uses:actions/checkout$~GHA-only source checkout; a local run is already in the working tree'
  '^uses:actions/setup-node$~GHA-only Node provisioning; a dev shell brings its own node/npm'
  '^uses:actions/setup-go$~GHA-only Go provisioning; the local go gates use the go on PATH'
  '^uses:actions/setup-python$~GHA-only Python provisioning; the changelog gate uses the local python/towncrier'
  '^uses:actions/upload-artifact$~GHA artifact storage, to hand the build to the e2e job; nothing to upload locally'
  '^uses:actions/download-artifact$~GHA artifact retrieval in the e2e job; the local build output never left the tree'
  '^uses:grafana/plugin-actions/e2e-version$~resolves the Grafana image matrix for the e2e job, which is out of scope (see docs/ci-local.md)'
  '^uses:grafana/plugin-actions/wait-for-grafana$~readiness poll for the e2e job, which is out of scope (see docs/ci-local.md)'
  # GHA plumbing
  '>> [$]GITHUB_OUTPUT$~GHA step-output plumbing; the local runner passes values between gates in-process'
  '^export GRAFANA_PLUGIN_~shell variables that only exist to feed GITHUB_OUTPUT; local gates read dist/plugin.json directly'
  '^if \[ -f ~feature detection that toggles GHA job conditionals; local gates test for the same files themselves'
  '^(then|else|elif|fi|do|done|esac|;;|\{|\})$~shell control keywords produced by splitting a "run: |" block into lines'
  '^sudo apt-get install jq$~runner package provisioning; jq is a documented local prerequisite and there is no sudo in a dev shell'
  '^pip install towncrier==24\.8\.0$~runner provisioning of towncrier itself; locally it is a declared prerequisite (devbox.json)'
  '^chmod \+x \./dist/gpx_\*$~restores the exec bit that upload/download-artifact drops; a local build never loses it'
  # out of scope for the cheap local suite — see docs/ci-local.md#scope
  '^mv dist [$]\{PLUGIN_ID\}$~packaging is out of scope; it only exists to shape the GHA upload artifact'
  '^zip [$]\{ARCHIVE\} [$]\{PLUGIN_ID\} -r$~packaging is out of scope; it only exists to shape the GHA upload artifact'
  '^docker run --pull=always -v [$]PWD/[$]\{ARCHIVE\}:/archive\.zip grafana/plugin-validator-cli ~plugin-validator runs in a container against the packaged archive; both are out of scope'
  '^docker compose (pull|down)$~the Playwright e2e stack is out of scope; it needs a Docker daemon'
  '^ANONYMOUS_AUTH_ENABLED=false DEVELOPMENT=false .* docker compose up -d$~the Playwright e2e stack is out of scope; it needs a Docker daemon'
  '^npm exec playwright install chromium --with-deps$~browser provisioning for the e2e job, which is out of scope'
  '^npm run e2e$~the Playwright e2e suite is out of scope; run it directly with npm run e2e'
  '^docker logs devopstoolkit-dotai-app >& grafana-server\.log$~post-failure log capture in the e2e job, which is out of scope'
)

STEPS_FILE="$(mktemp)"
REG_FILE="$(mktemp)"
trap 'rm -f "$STEPS_FILE" "$REG_FILE"' EXIT

# One tab-separated row per CI step command: job id, step name, kind, command.
# Each step contributes to exactly one of the two arrays below (a step with both
# `run` and `uses` counts as a `run` step, as GitHub Actions itself would), and
# the arrays are concatenated so rows stay in ci.yml document order.
STEP_QUERY=$(cat <<'YQ'
(.jobs // {}) | to_entries[] | .key as $job
| (.value.steps // [])[]
| (.name // .uses // "(unnamed)") as $name
| (.run // "") as $run
| (.uses // "") as $uses
| (.with.args // "") as $args
| (
    [$run]
    | map(select(. != ""))
    | map(split("\\\n") | join(" ") | split("\n"))
    | flatten
    | map(sub("\s+"; " ") | sub("^ "; "") | sub(" $"; ""))
    | map(select(. != "" and (test("^#") | not)))
    | map([$job, $name, "run", .] | join("\t"))
  )
  +
  (
    [$uses]
    | map(select(. != "" and $run == ""))
    | map(split("@") | .[0])
    | map("uses:" + . + ([$args] | map(select(. != "") | " args=" + (sub("\s+"; " ") | sub("^ "; "") | sub(" $"; ""))) | join("")))
    | map([$job, $name, "uses", .] | join("\t"))
  )
| .[]
YQ
)

yq -r "$STEP_QUERY" "$WORKFLOW" >"$STEPS_FILE"

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
