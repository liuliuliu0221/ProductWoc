# P3-06 Gate P3-G report

- Date: 2026-08-29
- Milestone: P3-06 — Durable orchestration and recovery
- Result: passed

## Delivered behavior

- Added strict Development control command, command receipt, command kind, safe
  boundary, Pending Operation, Outbox Event and Recovery Audit contracts.
- Added a complete durable Development Checkpoint containing the aggregate,
  Execution Plan, Model/Context Snapshots, Patch Journal, Evidence Manifests,
  redacted Verification Artifacts, structured command results, receipts and
  recovery history.
- Checkpoint loading reparses all persisted contracts, rebuilds the Task graph and
  rejects unknown fields, invalid entity keys, cross-Run Artifacts, invalid JSON
  and integrity-Hash mismatches before returning state.
- Added in-memory and atomic file stores with per-Checkpoint exclusive writer
  locks, Expected Revision conflicts, fsynced temporary writes and atomic rename.
  Abandoned partial temporary files are ignored.
- State changes and new Outbox Events are committed in one integrity-protected
  record. Event IDs must be unique, sequence numbers contiguous and payload Hashes
  valid.
- Added at-least-once Outbox publication. A publisher failure leaves the Event
  pending; each successful published marker is another optimistic atomic revision.
- Added durable Request-ID receipts for Start, Apply, Verify, Repair, Gate, Pause,
  Resume, Cancel and Recovery. Replays return the stored outcome without another
  mutation, Workspace write, completion or Event.
- Added two-step side-effect boundaries. A Pending Patch stores its before/expected
  after Workspace Hashes and full prepared Patch Journal before any write.
- Recovery reparses the current planning Envelope and checks the live Workspace
  content Hash. Planning changes and unrelated Workspace drift block Resume.
- A Patch is finalized without replay only when the Workspace exactly equals the
  prepared after Hash. An unchanged before Hash is safely replayable; any third
  state enters manual review and preserves the Workspace.
- Interrupted deterministic verification is marked safe to rerun. An interrupted
  Repair provider call enters manual review because its completion cannot be
  proven.
- Added idempotent Pause/Resume/Cancel lifecycle controls and deterministic storage
  of rejected, out-of-order Gate commands.

## Gate evidence

| P3-G requirement | Evidence | Result |
|---|---|---|
| Safe boundaries survive process restart | File Checkpoint is loaded through a new Store instance with all Run and Artifact data intact | pass |
| State and Event commit together | One stored record contains the new Checkpoint value and contiguous Outbox Event | pass |
| Stale writers cannot overwrite | Sequential and lifecycle tests assert deterministic Expected Revision conflicts | pass |
| Corrupt or tampered Checkpoints fail closed | Invalid JSON/content and integrity-Hash tampering are rejected before state is returned | pass |
| Partial writes do not replace current state | An abandoned temporary partial file is ignored while the last atomic target restores | pass |
| Patch-written/result-not-committed is recoverable | Exact prepared after Hash finalizes the Task into verification and commits the prepared Journal without replay | pass |
| Uncertain Patch is never replayed | A Workspace Hash matching neither prepared before nor after enters `manual_review` with Task unchanged | pass |
| Interrupted verification has a safe continuation | Fixed deterministic verification retains its Pending Operation and returns `resume_verification` | pass |
| Interrupted Repair is not guessed | Repair provider interruption returns `manual_review` | pass |
| Planning or Workspace drift blocks Resume | Current Envelope and live Workspace Hash mismatches produce explicit blocked audits | pass |
| Duplicate commands have no duplicate side effect | Resume and rejected Gate Request IDs replay without another revision or Event | pass |
| Outbox failure is retried | Failed publication remains pending; a later publisher delivers and marks the same Event | pass |
| Pause, Resume and Cancel remain controlled | Domain and durable lifecycle tests assert allowed transitions, cascading Cancel and idempotency | pass |

## Focused Gate P3-G

`pnpm p3:g:gate` passed:

- ProductFac isolation, package-boundary and open-source fixture-hygiene checks
  passed;
- Development Contracts, Domain, Agent, Adapters, Workflow and Evals
  lint/typecheck passed;
- 17 Contract, 22 Domain, 23 Agent, 63 Adapter, 13 Workflow and 2 Eval tests
  passed — 140 focused tests total.

## Full quality gate

`pnpm p3:gate` passed from the repository root:

- ProductFac isolation, package-boundary and fixture-hygiene checks passed;
- 14 package lint tasks passed;
- 25 typecheck/build-prerequisite tasks passed;
- 278 tests passed, including 140 Stage 3 tests;
- 14 package builds passed.

## Verification boundary

All durability and recovery tests use disposable local directories or in-memory
stores. Fault injection covers corrupted targets, abandoned partial writes, Patch
completion before result commit, unpublished Events, interrupted Verification and
Repair, user Workspace drift, planning invalidation, duplicate Resume and
out-of-order Gate. Tests make no network call, deploy nothing, push nothing to
GitHub and access no production credential.

The local environment remains Node.js 26.7.0 while the repository and GitHub CI
pin Node.js 24. This is the previously accepted local deviation; no failed check
was waived.
