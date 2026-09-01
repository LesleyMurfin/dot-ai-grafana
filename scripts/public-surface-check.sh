#!/usr/bin/env bash
# public-surface-check.sh — fail CI if tracked sources leak internal/PII/secret markers.
#
# Deny list (word-boundary / literal, case-insensitive; this file is excluded from the scan):
#   Product/internal: orca | riley | revive | featherduster
#   Infra markers:    MOP- | mtl-02 | leaseweb | svc_orca | revive_ai | ADW | .factory-memory
#   Secret banners:   BEGIN OPENSSH | BEGIN RSA PRIVATE | AWS_SECRET | xoxb- | ghp_
# Note: bare "factory" is NOT denied (Go SDK / generic wording). Use .factory-memory / svc_* markers.
#
# Allow: grafana, dot-ai, Viktor, Headlamp, normal plugin code.
# Scope: git ls-files only (no node_modules / playwright-report / untracked junk).
# Skips binary files. Prints file:line:match and exits 1 on any hit.
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT"

# Self-path (never scan this file — deny tokens appear in the header comment).
SELF_PATH="scripts/public-surface-check.sh"

# Assembled so maintainers can read the header; runtime pattern is one ERE.
# revive_ai / featherduster / word-ish tokens use non-alnum boundaries (not [[:space:]] only).
PATTERN='(^|[^A-Za-z0-9_])(orca|riley|revive|featherduster|revive_ai|ADW)([^A-Za-z0-9_]|$)|MOP-|mtl-02|leaseweb|svc_orca|\.factory-memory|BEGIN OPENSSH|BEGIN RSA PRIVATE|AWS_SECRET|xoxb-|ghp_'

# Simple leaked-assignment shapes (not full gitleaks). Requires quoted value length >= 12.
SECRET_ASSIGN='(^|[^A-Za-z0-9_])(api[_-]?key|secret[_-]?key|passwd|password|private[_-]?key)[[:space:]]*[=:][[:space:]]*["'"'"'][^"'"'"']{12,}["'"'"']'

hits=0

is_probably_binary() {
  local f="$1"
  case "$f" in
    *.png|*.jpg|*.jpeg|*.gif|*.webp|*.ico|*.pdf|*.zip|*.gz|*.tgz|*.woff|*.woff2|*.ttf|*.eot|*.bin|*.exe|*.dll|*.so|*.dylib)
      return 0
      ;;
  esac
  if head -c 8192 "$f" 2>/dev/null | grep -q $'\0'; then
    return 0
  fi
  return 1
}

while IFS= read -r -d '' f; do
  [[ -f "$f" ]] || continue
  [[ "$f" == "$SELF_PATH" ]] && continue
  if is_probably_binary "$f"; then
    continue
  fi

  if grep -n -E -i -- "$PATTERN" "$f" 2>/dev/null; then
    hits=1
  fi
  if grep -n -E -i -- "$SECRET_ASSIGN" "$f" 2>/dev/null; then
    hits=1
  fi
done < <(git ls-files -z)

if [[ "$hits" -ne 0 ]]; then
  echo "public-surface-check: forbidden public-surface string or secret marker found (see lines above)" >&2
  exit 1
fi

echo "public-surface-check: ok"
exit 0
