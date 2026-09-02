# P3-03 Gate P3-D report

- Date: 2026-08-29
- Milestone: P3-03 — local Workspace and tool policy
- Result: passed

## Delivered behavior

- Added strict Workspace Policy, Baseline, Git state, instruction, structured
  Read/List/Search/Patch/Command, user confirmation, decision and Tool Event
  contracts.
- Added portable path normalization for POSIX, macOS-style case bypasses, Windows
  drive/UNC/backslash paths and traversal attempts.
- Added canonical-root containment checks and fail-closed symbolic-link handling.
- Added sensitive and ignored path policies, maximum file size and maximum file
  count limits.
- Added safe Workspace inventory with content hashes, `AGENTS.md` discovery and
  read-only Git Commit/Branch/Dirty Worktree inspection.
- Added hash-conflict protection that preserves user changes, explicit delete
  confirmation and protected policy-file write rejection.
- Added fixed-argv command templates and a `shell: false` process executor.
- Added automatic verification commands, confirmation-gated dependency/Git/risky
  commands and permanent deployment/production/credential/network denial.
- Added bounded output redaction and Tool Events that never store raw paths,
  command argv, credential-like values or personal Workspace roots.

## Gate evidence

| P3-D requirement | Evidence | Result |
|---|---|---|
| Outside paths fail closed | POSIX absolute, drive-letter, UNC and traversal fixtures | pass |
| Symbolic links cannot escape | Read and command-CWD symlink escape tests | pass |
| Sensitive files are denied | Case-insensitive `.env`, SSH, AWS, secret, PEM/key tests | pass |
| Cross-platform paths are reproducible | Checked-in macOS/Linux/Windows path fixture | pass |
| Dirty Worktree is preserved | Real temporary Git repository modification remains unchanged after Baseline | pass |
| Concurrent user edits are preserved | Before-Hash mismatch rejects Patch and retains user content | pass |
| Shell injection cannot alter argv | Command request has no argv field; control characters fail template Schema | pass |
| Dependency install requires approval | Declared and disguised install templates both pause without user confirmation | pass |
| Deployment is permanently denied | Declared and disguised deployment never reach the executor | pass |
| Destructive Git cleanup is absent | Mislabeled `git clean` template is denied | pass |
| Tool Event is redacted | Contract and adapter tests reject secrets/personal roots and store placeholder arguments | pass |

## Focused Gate P3-D

`pnpm p3:d:gate` passed:

- ProductFac isolation, package-boundary and fixture-hygiene checks passed;
- Development Contracts and Adapters lint/typecheck passed;
- 11 contract tests and 43 adapter tests passed.

## Full quality gate

`pnpm p3:gate` passed from the repository root:

- 14 package lint tasks passed;
- 25 typecheck/build-prerequisite tasks passed;
- 223 tests passed, including 85 Stage 3 tests;
- 14 package builds passed.

## Verification boundary

Tests use temporary local directories, an ephemeral Git repository and injected
process executors. No project source file is mutated by the Workspace Adapter
tests, no dependency is installed, no network is used, and no deployment,
production write, Git push or credential access occurs.

The local environment remains Node.js 26.7.0 while the repository and GitHub CI
pin Node.js 24. This is the previously accepted local deviation; no failed check
was waived.
