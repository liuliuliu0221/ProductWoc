# P3-00 Gate P3-A report

- Date: 2026-08-28
- Milestone: P3-00 — open-source and stage 3 baseline
- Result: passed with one release-blocking owner decision

## Delivered baseline

- Added `development-contracts`, `development-domain`, `development-agent`,
  `development-adapters`, `development-workflow` and `development-evals` packages.
- Added the development Contract Manifest and its definition checksum.
- Added strict baseline schemas for Development/Task Run, input snapshots, Model
  Policy, Patch Set and Verification Evidence.
- Added valid and invalid `DevelopmentInputSnapshot` fixtures.
- Added executable ProductFac isolation, package direction and fixture hygiene
  checks to the root quality gate.
- Added a read-only GitHub CI workflow with no deployment or production-write job.
- Added contribution, security, conduct, ADR index and open-source readiness docs.
- Recorded equal model configuration access and the no-deployment boundary in ADR
  012.

## Gate evidence

| P3-A requirement | Evidence | Result |
|---|---|---|
| New packages build and test independently | Six development packages typechecked; six test tasks passed; full build passed | pass |
| Domain has no file-system, Shell, Git or model SDK dependency | `pnpm architecture:check` | pass |
| No ProductFac runtime dependency | `pnpm isolation:check` | pass |
| Fixtures contain no personal path or credential pattern | `pnpm fixtures:check` | pass |
| CI has no server deployment job | `.github/workflows/ci.yml` runs only install and `pnpm check` | pass |
| Full repository remains healthy | `pnpm check`: 14 lint, 25 typecheck/build prerequisite, 25 test and 14 build tasks passed | pass |
| An unlicensed public release cannot proceed | License choice remains pending and the readiness checklist blocks release | pass; release remains blocked |

The license item does not block P3-01 implementation, but it blocks the first
public GitHub release. Apache-2.0 is recommended; MIT remains a valid simpler
alternative.

## Test count

The repository currently executes 148 tests: 138 existing stage 2 tests and 10 new
P3-00 tests. All passed in the recorded full gate run.

## Known environment deviation

The local gate ran under Node.js 26.7.0 while the repository pins Node.js 24. This
is the previously accepted local Node deviation. The GitHub CI workflow reads
`.node-version` and therefore targets Node.js 24. No failure was waived.

## Scope confirmation

P3-00 does not implement model calls, workspace mutation, Shell command execution,
task scheduling, checkpoint writes or remote deployment. The package baseline
exports these capabilities as disabled until their planned milestones.
