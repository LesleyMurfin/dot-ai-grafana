#!/usr/bin/env bash
# ci-local.sh — run the CI gate suite from .github/workflows/ci.yml on this machine.
#
# .github/workflows/ci.yml stays the source of truth. This script is a mirror of
# it, and the `drift` gate (scripts/ci-drift-check.sh) fails the moment the two
# diverge in either direction, so "green locally" keeps meaning "green upstream".
#
# Exit codes (the contract — do not soften it):
#   0   every selected gate PASSED
#   1   at least one gate FAILED
#   2   nothing failed, but at least one gate was SKIPPED (unmet requirement)
#   64  bad usage
# A SKIP is never a pass: gates that cannot run here (no Docker daemon, no
# signing token) exit 2 so a partial run can never be mistaken for a full one.
# --allow-skip collapses 2 -> 0 when you knowingly accept the skips.
#
# GATE REGISTRY --------------------------------------------------------------
# One declarative record per gate, `~`-separated (never use `~` inside a field).
# The runner, --list, --only/--skip/--from, --dump-registry and the drift guard
# are all driven from this one list; nothing about a gate lives anywhere else.
#
#   id ~ human name ~ requirement ~ ci-match ~ implementation function
#
#   requirement  none | docker | token | towncrier | pyyaml
#                An unmet requirement is a loud SKIP with a concrete reason.
#   ci-match     ERE matched against the step commands extracted from ci.yml,
#                or LOCAL_ONLY:<reason> for a gate that deliberately has no CI
#                counterpart. Consumed by scripts/ci-drift-check.sh.
#
# shellcheck disable=SC2317  # gates are invoked indirectly ("$fn"); shellcheck reads them as unreachable
# shellcheck disable=SC2016  # the literal '$1' inside a ${2:-...} message and python3 -c 'import yaml' are deliberate
set -euo pipefail

SELF="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SELF/.." && pwd)"   # repo root from the script's own location, never $PWD
ARTIFACT_DIR="$ROOT/.ci-local"

GATES=(
  "deps~Install dependencies (npm ci)~none~^npm ci$~gate_deps"
  "typecheck~Check types~none~npm run typecheck~gate_typecheck"
  "lint~Lint frontend~none~npm run lint~gate_lint"
  "unit~Unit tests~none~npm run test:ci~gate_unit"
  "build~Build frontend~none~npm run build~gate_build"
  "go-lint~Lint backend (golangci-lint)~none~uses:golangci/golangci-lint-action~gate_go_lint"
  "go-build~Build backend (mage buildAll)~none~uses:magefile/mage-action args=buildAll~gate_go_build"
  "go-test~Test backend (mage test)~none~uses:magefile/mage-action args=test~gate_go_test"
  "changelog~Validate changelog fragments~towncrier~towncrier~gate_changelog"
  "sign~Sign plugin~token~npm run sign~gate_sign"
  "package~Package plugin archive~none~^(mv dist|zip )~gate_package"
  "validator~Validate plugin.json (plugin-validator-cli)~docker~plugin-validator-cli~gate_validator"
  "e2e~Playwright end-to-end tests~docker~(docker compose|npm run e2e)~gate_e2e"
  "drift~CI drift guard~pyyaml~LOCAL_ONLY:the guard checks ci.yml itself, so it has no step inside ci.yml to mirror~gate_drift"
)

# --- PATH bootstrap ---------------------------------------------------------
# Probe for toolchains that a developer shell may not export. Candidates are
# APPENDED, so a GHA runner (where everything is already on PATH and none of
# these directories exist) is unaffected. Nothing is hardcoded-only.
bootstrap_path() {
  local d candidates=()
  candidates+=("${HOME:-/nonexistent}/.local/bin")
  candidates+=("${HOME:-/nonexistent}/go/bin")
  candidates+=("/usr/local/go/bin")
  candidates+=("/data/tmp/go/bin")
  if [[ -n ${CI_LOCAL_EXTRA_PATH:-} ]]; then
    local IFS=:
    for d in $CI_LOCAL_EXTRA_PATH; do candidates+=("$d"); done
  fi
  for d in "${candidates[@]}"; do
    if [[ -n $d && -d $d ]]; then
      case ":$PATH:" in *":$d:"*) ;; *) PATH="$PATH:$d" ;; esac
    fi
  done
  # GOPATH/bin (where `go install` drops mage) is only knowable once `go` runs.
  if command -v go >/dev/null 2>&1; then
    local gobin
    gobin="$(go env GOPATH 2>/dev/null || true)/bin"
    if [[ -d $gobin ]]; then
      case ":$PATH:" in *":$gobin:"*) ;; *) PATH="$PATH:$gobin" ;; esac
    fi
  fi
  export PATH
}

# --- presentation -----------------------------------------------------------
if [[ -t 1 ]]; then
  C_RESET=$'\033[0m'; C_DIM=$'\033[2m'; C_BOLD=$'\033[1m'
  C_RED=$'\033[31m'; C_GREEN=$'\033[32m'; C_YELLOW=$'\033[33m'; C_BLUE=$'\033[34m'
else
  C_RESET=''; C_DIM=''; C_BOLD=''; C_RED=''; C_GREEN=''; C_YELLOW=''; C_BLUE=''
fi

status_colour() {
  case "$1" in
    PASS) printf '%s' "$C_GREEN" ;;
    FAIL) printf '%s' "$C_RED" ;;
    SKIP) printf '%s' "$C_YELLOW" ;;
    RUN)  printf '%s' "$C_BLUE" ;;
    *)    printf '%s' "$C_DIM" ;;
  esac
}

announce() { # status, id, trailing text
  printf '%s%-4s%s %-14s %s\n' "$(status_colour "$1")" "$1" "$C_RESET" "$2" "${3:-}"
}

# --- gate plumbing ----------------------------------------------------------
SKIP_FILE=""   # gates run in a subshell; a skip reason travels through this file

# Called from inside a gate: record why it cannot run and return the skip code.
skip_gate() { printf '%s\n' "$1" >"$SKIP_FILE"; return 77; }

require_tool() {
  command -v "$1" >/dev/null 2>&1 || skip_gate "required tool '$1' not found on PATH (after PATH bootstrap)"
}

require_file() {
  [[ -e $1 ]] || skip_gate "${2:-required path '$1' is missing}"
}

towncrier_config_present() {
  grep -q '^\[tool\.towncrier\]' "$ROOT/pyproject.toml" 2>/dev/null && return 0
  [[ -f $ROOT/towncrier.toml ]]
}

# Same identifiers CI derives via jq in its "Get plugin metadata" step.
plugin_archive_path() {
  local id version
  id="$(jq -r .id "$ROOT/dist/plugin.json")"
  version="$(jq -r .info.version "$ROOT/dist/plugin.json")"
  printf '%s/%s-%s.zip\n' "$ARTIFACT_DIR" "$id" "$version"
}

# --- gates (CI order) -------------------------------------------------------
gate_deps()           { require_tool npm && npm ci; }
gate_typecheck()      { require_tool npm && npm run typecheck; }
gate_lint()           { require_tool npm && npm run lint; }
gate_unit()           { require_tool npm && npm run test:ci; }
gate_build()          { require_tool npm && npm run build; }

# CI guards the backend gates on `steps.check-for-backend` (Magefile.go present).
gate_go_lint() {
  require_file Magefile.go "no Magefile.go: CI skips the backend gates too"
  require_tool go
  require_tool golangci-lint
  golangci-lint run ./...
}

gate_go_build() {
  require_file Magefile.go "no Magefile.go: CI skips the backend gates too"
  require_tool go
  require_tool mage
  mage -v buildAll
}

gate_go_test() {
  require_file Magefile.go "no Magefile.go: CI skips the backend gates too"
  require_tool go
  require_tool mage
  mage -v test
}

gate_changelog() {
  require_tool towncrier
  towncrier build --draft --version 0.0.0
}

gate_sign() { require_tool npm && npm run sign; }

gate_package() {
  require_tool jq
  require_tool zip
  require_file dist/plugin.json "dist/plugin.json is missing (run the 'build' gate first)"
  local archive stage id
  archive="$(plugin_archive_path)"
  id="$(jq -r .id "$ROOT/dist/plugin.json")"
  stage="$ARTIFACT_DIR/stage"
  rm -rf "$stage"
  mkdir -p "$stage"
  # CI does `mv dist ${PLUGIN_ID}`; locally we copy, so dist/ survives for the
  # validator and e2e gates and the working tree is left as the build left it.
  cp -r dist "$stage/$id"
  rm -f "$archive"
  (cd "$stage" && zip -q -r "$archive" "$id")
  rm -rf "$stage"
  printf 'packaged %s\n' "$archive"
}

gate_validator() {
  local archive
  require_tool jq
  require_file dist/plugin.json "dist/plugin.json is missing (run the 'build' gate first)"
  archive="$(plugin_archive_path)"
  require_file "$archive" "archive $archive is missing (run the 'package' gate first)"
  docker run --pull=always \
    -v "$archive:/archive.zip" \
    grafana/plugin-validator-cli -analyzer=metadatavalid /archive.zip
}

gate_e2e() {
  require_tool npm
  require_tool curl
  require_file docker-compose.yaml "no docker-compose.yaml: the e2e stack cannot be started"
  local rc=0 waited=0
  docker compose pull
  ANONYMOUS_AUTH_ENABLED=false DEVELOPMENT=false docker compose up -d
  until curl -fsS -o /dev/null http://localhost:3000/login; do
    if (( waited >= 120 )); then
      echo "grafana did not answer on :3000 within 120s" >&2
      rc=1
      break
    fi
    sleep 3
    waited=$(( waited + 3 ))
  done
  if (( rc == 0 )); then
    npm run e2e || rc=$?
  fi
  docker compose down || true
  return "$rc"
}

gate_drift() { bash scripts/ci-drift-check.sh; }

# --- requirements -----------------------------------------------------------
requirement_met() { # writes the reason to $SKIP_FILE when unmet
  case "$1" in
    none) return 0 ;;
    docker)
      command -v docker >/dev/null 2>&1 ||
        { printf 'docker CLI not installed\n' >"$SKIP_FILE"; return 1; }
      # The CLI being installed proves nothing; the daemon socket is what matters.
      docker info >/dev/null 2>&1 ||
        { printf 'Docker daemon unreachable (`docker info` failed) - no daemon access for this user\n' >"$SKIP_FILE"; return 1; }
      ;;
    token)
      [[ -n ${GRAFANA_ACCESS_POLICY_TOKEN:-} ]] ||
        { printf 'GRAFANA_ACCESS_POLICY_TOKEN is not set (CI runs this step only when the secret exists)\n' >"$SKIP_FILE"; return 1; }
      ;;
    towncrier)
      towncrier_config_present ||
        { printf 'no towncrier config ([tool.towncrier] in pyproject.toml or towncrier.toml) at the repo root\n' >"$SKIP_FILE"; return 1; }
      ;;
    pyyaml)
      python3 -c 'import yaml' >/dev/null 2>&1 ||
        { printf 'python3 with PyYAML is unavailable; the drift guard needs a real YAML reader\n' >"$SKIP_FILE"; return 1; }
      ;;
    *)
      printf 'unknown requirement %s\n' "$1" >"$SKIP_FILE"; return 1 ;;
  esac
}

# --- registry helpers -------------------------------------------------------
gate_field() { # record, field index (1..5)
  local IFS='~'
  local -a parts=()
  read -r -a parts <<<"$1"
  printf '%s\n' "${parts[$(($2 - 1))]-}"
}

gate_ids() {
  local g
  for g in "${GATES[@]}"; do gate_field "$g" 1; done
}

known_gate() {
  local id
  while IFS= read -r id; do [[ $id == "$1" ]] && return 0; done < <(gate_ids)
  return 1
}

usage() {
  cat <<'EOF'
ci-local.sh — run the .github/workflows/ci.yml gate suite locally.

Usage: scripts/ci-local.sh [options]

  --list              print the gate table and exit without running anything
  --only  <id>[,...]  run just these gates
  --skip  <id>[,...]  run everything except these gates
  --from  <id>        resume: run from this gate to the end
  --keep-going        run every selected gate, report at the end (default is fail-fast)
  --allow-skip        treat "skipped but nothing failed" as success (exit 0 instead of 2)
  --dump-registry     print `id~requirement~ci-match` records (used by the drift guard)
  --help              this text

Exit codes: 0 all passed | 1 something failed | 2 skips but no failures | 64 bad usage
EOF
}

# --- argument parsing -------------------------------------------------------
OPT_LIST=0 OPT_KEEP_GOING=0 OPT_ALLOW_SKIP=0 OPT_DUMP=0
OPT_ONLY="" OPT_SKIP="" OPT_FROM=""

while (($#)); do
  case "$1" in
    --list) OPT_LIST=1 ;;
    --only) OPT_ONLY="${2:-}"; shift ;;
    --only=*) OPT_ONLY="${1#*=}" ;;
    --skip) OPT_SKIP="${2:-}"; shift ;;
    --skip=*) OPT_SKIP="${1#*=}" ;;
    --from) OPT_FROM="${2:-}"; shift ;;
    --from=*) OPT_FROM="${1#*=}" ;;
    --keep-going) OPT_KEEP_GOING=1 ;;
    --allow-skip) OPT_ALLOW_SKIP=1 ;;
    --dump-registry) OPT_DUMP=1 ;;
    -h|--help) usage; exit 0 ;;
    *) printf 'ci-local: unknown argument %s\n\n' "$1" >&2; usage >&2; exit 64 ;;
  esac
  shift
done

if ((OPT_DUMP)); then
  for g in "${GATES[@]}"; do
    printf '%s~%s~%s\n' "$(gate_field "$g" 1)" "$(gate_field "$g" 3)" "$(gate_field "$g" 4)"
  done
  exit 0
fi

cd "$ROOT"
bootstrap_path

# Validate ids before doing any work.
for spec in "$OPT_ONLY" "$OPT_SKIP" "$OPT_FROM"; do
  [[ -z $spec ]] && continue
  IFS=',' read -r -a _ids <<<"$spec"
  for id in "${_ids[@]}"; do
    known_gate "$id" || { printf 'ci-local: no such gate: %s\n' "$id" >&2; exit 64; }
  done
done

selected=()
started=0
for g in "${GATES[@]}"; do
  id="$(gate_field "$g" 1)"
  if [[ -n $OPT_FROM ]]; then
    [[ $id == "$OPT_FROM" ]] && started=1
    ((started)) || continue
  fi
  if [[ -n $OPT_ONLY ]] && ! [[ ",$OPT_ONLY," == *",$id,"* ]]; then continue; fi
  if [[ -n $OPT_SKIP ]] && [[ ",$OPT_SKIP," == *",$id,"* ]]; then continue; fi
  selected+=("$g")
done

if ((${#selected[@]} == 0)); then
  echo 'ci-local: gate selection is empty' >&2
  exit 64
fi

if ((OPT_LIST)); then
  printf '%sgate suite mirrored from .github/workflows/ci.yml%s\n\n' "$C_BOLD" "$C_RESET"
  printf '%-15s %-12s %s\n' 'ID' 'REQUIRES' 'GATE'
  for g in "${selected[@]}"; do
    printf '%-15s %-12s %s\n' "$(gate_field "$g" 1)" "$(gate_field "$g" 3)" "$(gate_field "$g" 2)"
  done
  printf '\n%d gate(s). Requirements: none=always runnable, docker=needs a reachable\n' "${#selected[@]}"
  printf 'Docker daemon, token=needs GRAFANA_ACCESS_POLICY_TOKEN, towncrier=needs a\n'
  printf 'towncrier config, pyyaml=needs python3 + PyYAML.\n'
  exit 0
fi

# --- run --------------------------------------------------------------------
SKIP_FILE="$(mktemp)"
trap 'rm -f "$SKIP_FILE"' EXIT
mkdir -p "$ARTIFACT_DIR"

results=()   # "id status seconds reason"
failed=0 skipped=0 passed=0

for g in "${selected[@]}"; do
  id="$(gate_field "$g" 1)"
  name="$(gate_field "$g" 2)"
  req="$(gate_field "$g" 3)"
  fn="$(gate_field "$g" 5)"

  : >"$SKIP_FILE"
  if ! requirement_met "$req"; then
    reason="$(cat "$SKIP_FILE")"
    announce SKIP "$id" "$name ${C_DIM}- ${reason}${C_RESET}"
    results+=("$id SKIP 0 $reason")
    skipped=$((skipped + 1))
    continue
  fi

  announce RUN "$id" "$name"
  start=$SECONDS
  set +e
  (set -e; cd "$ROOT"; "$fn")   # subshell keeps `set -e` live inside the gate
  rc=$?
  set -e
  elapsed=$((SECONDS - start))

  if ((rc == 77)); then
    reason="$(cat "$SKIP_FILE")"
    announce SKIP "$id" "${elapsed}s ${C_DIM}- ${reason}${C_RESET}"
    results+=("$id SKIP $elapsed $reason")
    skipped=$((skipped + 1))
  elif ((rc == 0)); then
    announce PASS "$id" "${elapsed}s"
    results+=("$id PASS $elapsed -")
    passed=$((passed + 1))
  else
    announce FAIL "$id" "${elapsed}s ${C_DIM}- exit ${rc}${C_RESET}"
    results+=("$id FAIL $elapsed exit $rc")
    failed=$((failed + 1))
    if ((! OPT_KEEP_GOING)); then
      break
    fi
  fi
done

# --- summary ----------------------------------------------------------------
printf '\n%s%s%s\n' "$C_BOLD" 'summary' "$C_RESET"
printf '%-15s %-6s %7s  %s\n' 'GATE' 'STATUS' 'SECONDS' 'NOTE'
for r in "${results[@]}"; do
  rid="${r%% *}"; rest="${r#* }"
  rstatus="${rest%% *}"; rest="${rest#* }"
  rsecs="${rest%% *}"; rnote="${rest#* }"
  printf '%-15s %s%-6s%s %7s  %s\n' \
    "$rid" "$(status_colour "$rstatus")" "$rstatus" "$C_RESET" "$rsecs" "$rnote"
done

printf '\n%d passed, %d failed, %d skipped' "$passed" "$failed" "$skipped"
if ((${#results[@]} != ${#selected[@]})); then
  printf ' (%d gate(s) not reached: fail-fast)' "$((${#selected[@]} - ${#results[@]}))"
fi
printf '\n'

if ((failed > 0)); then
  printf '%sVERDICT: FAIL%s - %d gate(s) failed; upstream CI would be red.\n' "$C_RED" "$C_RESET" "$failed"
  exit 1
fi
if ((skipped > 0)); then
  if ((OPT_ALLOW_SKIP)); then
    printf '%sVERDICT: PASS (skips accepted)%s - %d gate(s) never ran; this is NOT a full CI run.\n' \
      "$C_YELLOW" "$C_RESET" "$skipped"
    exit 0
  fi
  printf '%sVERDICT: INCOMPLETE%s - nothing failed, but %d gate(s) were skipped, so this run does not prove CI is green. Re-run with --allow-skip to accept.\n' \
    "$C_YELLOW" "$C_RESET" "$skipped"
  exit 2
fi
printf '%sVERDICT: PASS%s - every selected gate ran and passed.\n' "$C_GREEN" "$C_RESET"
exit 0
