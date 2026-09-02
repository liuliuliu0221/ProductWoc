# ADR 017: Evidence-controlled verification, bounded Repair and guarded rollback

- Status: accepted for P3-05
- Date: 2026-08-29

## Context

A model statement such as “the task is complete” cannot prove that code builds or
meets an approved verification step. Local commands may fail because assertions
failed, an executable is missing, the process timed out, policy denied execution
or infrastructure failed. Only the first class is normally repairable by changing
code. Repair can also loop indefinitely, while rollback can overwrite a user edit
or a later Task if it is not bound to exact file hashes.

## Decision

- Execution Plan Verification Steps are the only source of required checks. Test,
  Typecheck, Lint and Build steps map to fixed, policy-approved command templates;
  the model cannot supply an executable, argv or Shell string.
- The process runner classifies `verification_failed`, `command_not_found`,
  `timeout`, `policy_denied` and `infrastructure_failure` separately. Timed-out
  processes receive `SIGTERM` followed by bounded `SIGKILL` escalation.
- Every command creates a bounded full-log Artifact after Workspace-root, secret,
  token and email redaction. Evidence binds Development/Task/Model identities,
  Verification Step, Artifact Hash, command-result Hash, Exit Code, error class,
  Patch Journal and current Workspace content-manifest Hash.
- An Evidence Manifest contains the complete Evidence IDs, required and passing
  Step IDs, Patch Journal, Workspace Hash and a deterministic Manifest Hash.
  Recording revalidates all Artifact/Evidence/Manifest relationships.
- A passing runner Evidence requires Exit Code zero and error class `none`; failed
  Evidence requires a non-zero Exit Code and classified failure. Manual Evidence
  requires an exact user confirmation. Missing manual Evidence remains
  `requires_review`.
- Task completion continues through the pure Development domain. Required Evidence
  must be passing, match the Task Definition and current Model Snapshot, and share
  one Patch Journal and Workspace Hash. Agent prose cannot enter this path.
- Repair defaults to two attempts and can be configured from zero to ten. Only an
  ordinary verification failure is automatically repairable. Repeated failure
  fingerprints, policy failures, missing commands, timeouts and infrastructure
  failures stop without another model call.
- Each Repair Attempt has unique Agent Run, Model Snapshot and Patch Set IDs. The
  Development aggregate stores the attempt and creates a `purpose: repair` Agent
  Run. Attempt state moves from proposed to Patch applied and then verified or
  verification failed. Replays remain idempotent.
- Repair Context references the original immutable Task Context and includes only
  the failed Evidence identity, Artifact Hash, classified and redacted summary,
  previous Repair IDs and original allowed write paths.
- Exhausted/repeated/non-repairable sessions move the Development Run to
  `needs_user_action`; the current Task state and full attempt history remain
  available for manual repair, planning changes, retry, rollback or cancellation.
- User rollback requires a confirmation bound to the exact Patch Set and complete
  path list. It preflights every current file against the Patch Journal after Hash
  before writing, then applies stored inverse operations in reverse order.
  Conflicts preserve the user's files and move the Run to `needs_user_action`.

## Consequences

P3-05 makes local command results—not model confidence—the completion authority.
Failure handling is deterministic and bounded, successful repairs remain
auditable as separate Agent/Patch histories, and rollback cannot silently erase a
new user or Task modification. Artifacts, Evidence and Repair state are currently
process-local; atomic durable storage and interrupted-process recovery remain
P3-06 work.
