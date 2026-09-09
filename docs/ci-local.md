# Running CI locally

`scripts/ci-local.sh` runs the cheap [CI](../.github/workflows/ci.yml) gates on your own machine, so
a pass can be confirmed before pushing instead of after waiting on GitHub Actions.

```bash
./scripts/ci-local.sh --list           # what would run
./scripts/ci-local.sh                  # fail-fast (default)
./scripts/ci-local.sh --keep-going     # run everything, report at the end
```

## Gates

| Gate | Mirrors the CI step | Requires |
|---|---|---|
| `drift` | — (guards `ci.yml` itself; runs first) | — |
| `deps` | `npm ci` | — |
| `typecheck` | `npm run typecheck` | — |
| `lint` | `npm run lint` | — |
| `unit` | `npm run test:ci` | — |
| `build` | `npm run build` | — |
| `go-lint` | `golangci/golangci-lint-action` with `./...` | — |
| `go-build` | `magefile/mage-action` with `buildAll` | — |
| `go-test` | `magefile/mage-action` with `test` | — |
| `changelog` | `towncrier build --draft --version 0.0.0` | a towncrier config |
| `sign` | `npm run sign` | `GRAFANA_ACCESS_POLICY_TOKEN` |

`drift` runs **first**, not last. The default is fail-fast, so a drift guard at the end of the list
would be the gate least likely to actually run — precisely backwards.

## Scope

The runner covers the cheap gates only. Three `ci.yml` steps are deliberately **not** mirrored:

- **packaging** (`mv dist ${PLUGIN_ID}` / `zip`) — exists only to shape the artifact that the GHA
  e2e job downloads; it proves nothing a local build does not already prove.
- **`grafana/plugin-validator-cli`** — runs in a container against that packaged archive.
- **Playwright e2e** (`docker compose` + `npm run e2e`) — needs a Docker daemon, a Grafana image
  matrix and a downloaded build artifact. Run it directly with `npm run e2e` when you need it.

Each of those steps carries an explicit allowlist entry, with its reason, in
`scripts/ci-drift-check.sh` — they are excused, not ignored, and the guard still notices if their
commands change.

Two further CI checks are outside **both** the runner and the guard, because they live in their own
workflow files rather than in `ci.yml`: **compare** (`.github/workflows/bundle-stats.yml`) and
**compatibilitycheck** (`.github/workflows/is-compatible.yml`). Nothing here mirrors them and the
drift guard will not notice if they change; they can drift freely.

## What the drift guard proves

The `drift` gate (`scripts/ci-drift-check.sh`) compares the gate **registry** in `ci-local.sh`
against the **step list** in `ci.yml`, in both directions:

- **forward** — every step in `ci.yml` is either claimed by a gate or allowlisted with a reason, so
  a new CI step cannot appear without someone deciding what to do about it;
- **reverse** — every gate matches at least one step in `ci.yml`, unless it declares
  `LOCAL_ONLY:<reason>`, so a gate cannot outlive the step it mirrors.

Every `ci-match` pattern is fully anchored (`^...$`), so editing a step's arguments upstream —
`npm run typecheck` becoming `npm run typecheck -- --strict`, or the golangci-lint `args` changing
from `./...` — is drift, not a substring that quietly still matches.

The guard's contract is therefore between the registry and `ci.yml`'s step definitions: **the
registry cannot drift from `ci.yml`.** It does *not* prove that a gate's implementation runs the
same command as the step it claims. `ci-match` ties a gate to the *existence* of a CI step, not to
the gate's behaviour — keeping `gate_lint` actually running the lint is code review's job.

The guard also only runs when someone runs it. Nothing in `ci.yml` — or any other workflow —
invokes `ci-local.sh` or `ci-drift-check.sh`, so drift is caught on the next local suite run, not on
the pull request that introduced it. The guard does not make the runner and `ci.yml` *unable* to
diverge; it makes a divergence visible, and loud, to whoever runs the suite next.

`ci.yml` is read with [yq-go](https://github.com/mikefarah/yq) — a real YAML parser, not a regex
pass over the file, so `run: |` block scalars, quoting and indentation are the parser's problem.
It is one static binary, pinned in `devbox.json` like every other tool here.

`drift` cannot be skipped. It declares no requirement and never reports a skip, so a missing (or
wrong-flavour, i.e. python-yq) `yq` is a hard **failure**: `--allow-skip` can never turn "the
registry was never checked" into a green run.

## Exit codes

| Code | Meaning |
|---|---|
| `0` | every selected gate ran and passed |
| `1` | at least one gate failed — upstream CI would be red |
| `2` | nothing failed, but a gate was **skipped**, so the run does not prove CI is green |
| `64` | bad usage (unknown flag or gate id) |

A skip is never a pass. Exit `2` exists so a partial run cannot be mistaken for a full one; add
`--allow-skip` to collapse `2` to `0` once you have read the reasons and accepted them.

## Flags

| Flag | Effect |
|---|---|
| `--list` | print the gate table and exit without running anything |
| `--only <id>[,...]` | run just these gates |
| `--skip <id>[,...]` | run everything except these gates |
| `--from <id>` | resume from this gate to the end |
| `--keep-going` | run every selected gate instead of stopping at the first failure |
| `--allow-skip` | treat "skipped but nothing failed" as success |
| `--dump-registry` | print the gate registry (consumed by the drift guard) |
| `--help` | usage |

## Why a gate skips

Each gate declares a requirement, printed in the `REQUIRES` column of `--list`:

| Requirement | Gates | Skips unless |
|---|---|---|
| `none` | everything else | always runnable |
| `token` | `sign` | `GRAFANA_ACCESS_POLICY_TOKEN` is set |
| `towncrier` | `changelog` | a towncrier config is present |

`sign` skips unless `GRAFANA_ACCESS_POLICY_TOKEN` is set, matching the conditional on the CI step.
A gate also skips, with a reason, when a tool it needs is missing from `PATH` after the PATH
bootstrap — `go`, `mage` and `golangci-lint` are the usual candidates. Point
`CI_LOCAL_EXTRA_PATH=/dir1:/dir2` at them if they live somewhere unusual.

None of the remaining gates need Docker.
