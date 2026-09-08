# Running CI locally

`scripts/ci-local.sh` runs the [CI](../.github/workflows/ci.yml) gate suite on your own machine, so
a full pass can be confirmed before pushing instead of after waiting on GitHub Actions.

```bash
./scripts/ci-local.sh --list           # what would run
./scripts/ci-local.sh                  # fail-fast (default)
./scripts/ci-local.sh --keep-going     # run everything, report at the end
```

`ci.yml` remains the source of truth: the `drift` gate (`scripts/ci-drift-check.sh`) compares the
two in both directions and fails if a CI step has no local gate or a local gate matches no CI step,
so the mirror cannot rot silently.

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
| `docker` | `validator`, `e2e` | a reachable Docker daemon |
| `token` | `sign` | `GRAFANA_ACCESS_POLICY_TOKEN` is set |
| `towncrier` | `changelog` | a towncrier config is present |
| `pyyaml` | `drift` | `python3` with PyYAML |

`validator` (`grafana/plugin-validator-cli`) and `e2e` (the Playwright stack behind
`docker compose`) both need a reachable Docker daemon, detected with `docker info` rather than by
the CLI merely being installed. On a shared development host where your account is not in the
`docker` group there is no daemon socket to talk to, so both gates report `SKIP` with that reason
and the run exits `2`. Everything else — including the Go backend gates and the plugin archive
build — runs without Docker. `sign` skips unless `GRAFANA_ACCESS_POLICY_TOKEN` is set, matching the
conditional on the CI step.
