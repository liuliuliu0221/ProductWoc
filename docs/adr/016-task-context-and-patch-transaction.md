# ADR 016: Minimal Task Context and guarded Patch transaction

- Status: accepted for P3-04
- Date: 2026-08-29

## Context

An implementation model needs enough information to change one approved Task,
but repository text, source comments, planning content and `AGENTS.md` are data,
not authorization. Model output can be stale, oversized, malicious, outside the
Task scope or based on a file that the user has changed since generation. A
multi-file change may also fail after some operations have been written.

## Decision

- `development-agent` assembles one immutable `TaskContextSnapshot` from the
  current Execution Task, its referenced Requirement and Acceptance Criteria,
  selected Design Items/modules, global security constraints, direct-dependency
  Evidence, explicitly selected Workspace excerpts, applicable repository
  instructions and explicit project constraints.
- Full chat history, unrelated planning sections, sensitive files, Git history,
  other Workspaces and raw attachments are excluded by contract. Workspace
  excerpts use the raw SHA-256 emitted by the Workspace Adapter, while the whole
  snapshot uses canonical JSON hashing.
- Every context block is `untrusted_reference` with
  `instructionAuthority: none`. Secrets and personal email-like values are
  redacted, and each block has a bounded size. Repository text cannot add an
  allowed write path, a tool, a command or a policy exception.
- Allowed write scopes are supplied outside model output. `AGENTS.md`, `.agents`,
  `.codex`, `.git`, ignored paths and sensitive paths cannot be writable scopes.
- The model receives the structured snapshot and returns only a Change Proposal
  draft. It gets no direct tool handle. Run, Task, Agent, Context and Model
  identities are added and validated by trusted code rather than copied from
  model output.
- `development-adapters` owns Patch validation and application. It verifies the
  canonical Context hash, proposal bindings, requirement/design provenance,
  Workspace policy, allowed scopes, unique paths, file/total size, binary control
  characters, sensitive material and license risk before the first write.
- Dependency changes and dependency manifests require a user confirmation bound
  to the exact Proposal. Deletes and license-risk files require the same exact
  Proposal binding plus complete relative-path coverage.
- Updates and deletes require the raw before Hash from the Workspace read. Create
  requires absence. Any mismatch rejects the entire Patch before writing, so a
  concurrent user edit is retained.
- A deterministic preview records operation, relative path, before/after Hash,
  byte count and Requirement/Design provenance without copying file content into
  the Diff summary.
- The Patch manager holds one Task writer lease. It applies preflighted operations
  serially and rolls back already applied operations in reverse order if a later
  operation fails. A rollback failure has a distinct status and retains recovery
  operations in the Journal.
- Successful idempotency keys are memoized. Replaying one returns the existing
  result without another file write or Journal entry.
- The append-only Patch Journal binds Patch Set, Proposal hash, Diff hash,
  Development/Task/Agent/Context/Model identities, before/after Workspace
  manifests, per-file hashes and reversible operations. Applying a Patch does not
  create Verification Evidence or complete a Task.

## Consequences

P3-04 can generate and apply reviewable local text changes without granting the
model direct file-system or Shell authority. User changes win on conflict, and a
runtime failure cannot silently leave a partially applied Patch. The transaction
is process-local rather than crash-durable; durable Checkpoint recovery remains a
P3-06 concern. Executable verification, bounded repair and user-invoked recovery
remain P3-05 concerns.
