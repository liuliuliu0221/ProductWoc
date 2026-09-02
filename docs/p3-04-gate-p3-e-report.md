# P3-04 Gate P3-E report

- Date: 2026-08-29
- Milestone: P3-04 — Implementation Agent and Patch transaction
- Result: passed

## Delivered behavior

- Added strict Task Context Snapshot, untrusted context block, source record,
  Change Proposal, dependency change, Patch Preview, rollback operation, Patch
  Journal and Patch Transaction result contracts.
- Added a minimal Task Context Assembler that selects the current Task, referenced
  Requirement/Acceptance Criteria/Design Items and modules, direct-dependency
  Evidence, security constraints and explicitly selected Workspace inputs.
- Added raw Workspace excerpt Hash validation, upstream planning Version/Hash
  binding, secret redaction, bounded blocks, canonical Context Hash and deep
  immutability.
- Marked planning text, repository instructions and source code as untrusted data
  with no instruction authority. Protected policy locations cannot become writable
  scopes.
- Added structured Implementation model invocation with no tool handles. Trusted
  code binds Development Run, Task Run, Agent Run, Context and Model Snapshot
  identities around the returned Proposal draft.
- Added deterministic content-free Patch previews with proposal, Diff, before and
  after file Hashes, byte counts and Requirement/Design provenance.
- Added fail-closed path/scope, duplicate path, provenance, size, binary control,
  sensitive material, license and dependency validation.
- Added exact Proposal-bound user confirmation for dependencies, dependency
  manifests, deletes and license-risk content.
- Added complete preflight, raw before-Hash conflict detection, one-Task writer
  leases, sequential application, reverse-order automatic rollback and a distinct
  rollback-failure state with retained recovery operations.
- Added successful Idempotency Key replay without repeated writes or Journal
  records.
- Added an append-only Patch Journal binding Patch Set, Proposal, Diff,
  Development/Task/Agent/Context/Model identities, Workspace manifests, file
  hashes and rollback operations.

## Gate evidence

| P3-E requirement | Evidence | Result |
|---|---|---|
| At least five Fixture Tasks generate and apply valid Patches | Checked-in five-task Patch fixture applied to isolated temporary Workspaces | pass |
| Minimal context excludes unrelated material | Unrelated Requirement, Acceptance Criterion and non-direct Evidence assertions | pass |
| Repository/source injection cannot expand authority | Every block remains untrusted/no-authority; `AGENTS.md` write is denied | pass |
| Sensitive context is not exposed | Raw excerpt Hash validation plus credential/token redaction assertions | pass |
| Patch boundary and content policy fail closed | Outside/protected paths, ambiguous format, oversize, binary and sensitive content tests | pass |
| User changes are preserved | Stale before Hash rejects the whole Patch and retains the user-edited file | pass |
| Application is idempotent | Replayed successful Idempotency Key creates no second write or Journal entry | pass |
| Partial writes are recovered | A later missing-parent failure reverses the earlier create and records `rolled_back` | pass |
| Risky changes pause for the user | Dependency, delete and license changes require exact Proposal-bound confirmation | pass |
| Patch source is reconstructable | Journal asserts Task/Agent/Context/Model, Diff, Requirement/Design and file Hash bindings | pass |
| Patch alone cannot complete a Task | Domain completion without bound Verification Evidence remains `verifying` with `evidence_missing` | pass |

## Focused Gate P3-E

`pnpm p3:e:gate` passed:

- ProductFac isolation, package-boundary and open-source fixture-hygiene checks
  passed;
- Development Contracts, Agent and Adapters lint/typecheck passed;
- 13 Contract, 19 Domain, 15 Agent and 54 Adapter tests passed — 101 focused
  tests total.

## Full quality gate

`pnpm p3:gate` passed from the repository root:

- ProductFac isolation, package-boundary and fixture-hygiene checks passed;
- 14 package lint tasks passed;
- 25 typecheck/build-prerequisite tasks passed;
- 242 tests passed, including 104 Stage 3 tests;
- 14 package builds passed.

## Verification boundary

All Patch tests use disposable local directories and an offline deterministic
model stub. No project source is changed by a Patch test, no dependency is
installed, no Shell command or network call is made, and no deployment, Git Push,
production write or credential access occurs. Patch rollback is process-local;
crash-durable recovery remains scheduled for P3-06.

The local environment remains Node.js 26.7.0 while the repository and GitHub CI
pin Node.js 24. This is the previously accepted local deviation; no failed check
was waived.
