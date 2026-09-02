# P3-08 Gate G3 report

- Date: 2026-09-02
- Milestone: P3-08 — Eval, security and open-source release preparation
- Implementation result: passed
- Local P3-I result: passed
- GitHub publication result: passed

## Delivered baseline

- Added fourteen versioned minimal repository fixtures covering all twelve required
  repository, language, recovery and adversarial categories.
- Every fixture pins its revision, Envelope/document identities, initial Workspace
  Hash, deterministic Model Snapshot, expected Patch paths, forbidden behavior,
  verification commands, Evidence types and expected outcome.
- Added fail-closed corpus loading and deterministic quality metrics. The required
  baseline makes zero remote model calls, uses zero paid-model tokens and has zero
  estimated model cost.
- Added a real two-Phase, three-Task closure that applies three Patch transactions
  to a disposable workspace, records Patch Journal entries and verification
  Evidence, and completes both phases.
- Added an acceptance test that creates and starts five local Development Runs
  from five distinct immutable Execution Plan versions.
- Added adversarial path, command-template, deployment, production-write,
  dependency confirmation, Secret/PII redaction and Repository Instruction tests.
- Added changelog, known limitations, release policy, no-key model example,
  cross-platform text policy, Dependabot configuration and Issue/PR templates.
- Added a release hygiene scanner. It checks required governance files, personal
  paths, credential patterns, paid-model CI variables and forbidden deployment or
  release workflow actions.

## Gate G3 evidence

| Requirement | Deterministic evidence | Result |
|---|---|---|
| 1. Start five different Execution Plans | `gate-g3-runs.test.ts` creates five distinct Plan versions and starts five Runs | pass |
| 2. Two Phases, three Tasks, real code modification | `gate-g3-closure.test.ts` applies three file Patches, journals and verifies all Tasks | pass |
| 3. Patch, verification and trace Evidence per completed Task | Closure test plus Patch transaction and verification suites | pass |
| 4. Interrupt and recover | Durable Checkpoint suite covers safe-boundary recovery and uncertain Apply recovery | pass |
| 5. Failed test, bounded Repair and budget exhaustion | Development Agent and Domain Repair suites | pass |
| 6. Manual same-file edit causes Hash conflict | Patch transaction and Workspace baseline suites | pass |
| 7. Approved Project Spec revision makes Run stale | Development aggregate planning-revision suite | pass |
| 8. Stage model switch creates a new snapshot and invalidates downstream Evidence | Model routing, rerun and local policy suites | pass |
| 9. Secret/PII, path, command and deployment attempts are blocked | `security-g3.test.ts` plus Adapter security suites | pass; high-risk leaks 0 |
| 10. Fresh GitHub clone passes without a paid model | GitHub Actions run `33665165575` checked out commit `1909323`, installed dependencies and passed `pnpm check` on Node.js 24 | pass |

## Verification performed

The focused Development Eval suite currently passes 18 tests across six files.
The P3-H cross-package regression passes with 178 focused tests after adding the
new G3 cases. The full pre-license quality gate passes:

- ProductFac isolation, package-boundary, fixture and pre-license release-hygiene checks;
- 15 lint tasks;
- 26 typecheck/build-prerequisite tasks;
- 308 tests;
- 15 builds.

The HTTP/SSE test suite requires binding a disposable `127.0.0.1` port. Its first
sandboxed run was denied with `EPERM`; the same gate passed outside that network
namespace. No external endpoint or remote model was contacted.

## License decision

The repository owner selected MIT on 2026-09-02. The root `LICENSE`, package
metadata, contribution terms and ADR 021 now record that decision.

After the license was added, `pnpm p3:i:gate` passed the strict release-hygiene
check, 15 lint tasks, 26 typecheck/build-prerequisite tasks, 308 tests and 15
builds. ProductFac and paid-model access were not present.

## Publication evidence

- Public repository: `https://github.com/liuliuliu0221/ProductWoc`
- Default branch: `main`
- Initial commit: `99044c78d811c9a0d9c460e788fd1772e201af60`
- Clean-clone CI: `https://github.com/liuliuliu0221/ProductWoc/actions/runs/33665165575`
- Private vulnerability reporting: enabled through the GitHub repository API.

The initial CI passed all required checks. Its runner reported that the previous
Action versions used a deprecated Node.js 20 action runtime; the workflow was
subsequently migrated to official Node.js 24-based Action versions while keeping
the project runtime pinned to Node.js 24.

No Git repository was initialized, no GitHub push occurred and no deployment
workflow was added during this milestone.
