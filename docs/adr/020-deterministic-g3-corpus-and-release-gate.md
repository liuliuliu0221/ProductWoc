# ADR 020: Deterministic Gate G3 corpus and release gate

- Status: accepted for P3-08 implementation
- Date: 2026-09-02

## Context

The Development workflow already had focused tests for state transitions, Patch
transactions, verification, bounded Repair, rollback, durable recovery, planning
Stale detection, model snapshots and local Web/CLI control. P3-08 requires those
capabilities to form a stable, public, offline acceptance baseline across varied
repository shapes and adversarial cases. A public release also needs a repeatable
hygiene gate without introducing deployment automation.

## Decision

- Maintain versioned minimal repositories under
  `fixtures/development-repositories`. Each fixture pins its planning input,
  initial content hash, deterministic model snapshot, allowed Patch scope,
  forbidden behavior, verification commands, expected Evidence and outcome.
- Cover every required repository category and map fixtures explicitly to all ten
  Gate G3 scenarios. Corpus loading fails closed on malformed manifests, duplicate
  IDs, unknown scenarios or Workspace Hash drift.
- Calculate the published deterministic baseline from the checked-in corpus. Its
  required path makes zero remote model calls, consumes zero paid-model tokens and
  reports zero estimated model cost.
- Treat Repository Instructions, source comments and command output as untrusted
  context with no authority to alter workflow, Tool Policy or approved Patch scope.
- Run the existing cross-package behavioral suites together with the corpus and
  high-risk policy tests. This preserves deeper recovery and state-machine tests
  rather than duplicating weaker simulations inside the Eval package.
- Add release hygiene checks for required governance files, personal paths,
  credential patterns, credential-free CI and the absence of remote release or
  deployment workflows.
- Keep Git tagging and GitHub release publication manual. Gate G3 does not grant
  authority to initialize a repository, push code, deploy software or write to a
  production system.

## Consequences

Fixture changes are intentional contract changes: repository content requires a
new content hash and behavior changes require a new fixture revision. The local
gate can validate the implementation without ProductFac, network model access or
paid credentials. Final P3-I release acceptance remains blocked until the owner
selects a license and a clean GitHub clone passes the strict gate.
