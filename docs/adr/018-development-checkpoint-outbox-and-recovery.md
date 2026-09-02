# ADR 018: Development Checkpoint, Outbox and recovery audit

- Status: accepted for P3-06
- Date: 2026-08-29

## Context

P3-05 could verify, repair and roll back a Task only while one process retained
the Development aggregate and its Artifacts. A crash between a Workspace side
effect and the next state write can leave three materially different situations:
the operation did not run, it completed exactly as prepared, or its result cannot
be proven. Treating all three as an ordinary retry risks duplicate Patch writes,
duplicate completion, or overwriting a user's later edit.

## Decision

- A Development Checkpoint persists the complete Development aggregate, immutable
  input and Execution Plan, Model and Context Snapshots, Patch Journal, Evidence
  Manifests, redacted Verification Artifacts, structured command results, command
  receipts, recovery audits and the current Workspace content-manifest Hash.
- The storage envelope has a fixed Schema version and SHA-256 integrity Hash.
  Loading reparses every strict contract, rebuilds the task graph from the
  Execution Plan, and checks Run, graph, Artifact and entity-key bindings before
  returning state. Invalid JSON, unknown fields, tampering and invalid Artifacts
  fail closed.
- File commits use an exclusive per-Checkpoint writer lock, an expected Revision,
  a newly fsynced temporary file and atomic rename. A stale writer cannot replace
  newer state. Abandoned temporary files are not considered Checkpoints.
- A state transition and its new Outbox Event share one stored record and one
  atomic replacement. Event IDs are unique, sequence numbers are contiguous and
  payload Hashes are checked. Publication is at least once; a successful event is
  marked published in a later revision. A failed publication remains pending.
- Start, Apply, Verify, Repair, Gate, Pause, Resume, Cancel and Recovery use
  durable Request-ID receipts. Repeating a completed or rejected command returns
  the stored receipt without another mutation or event.
- Workspace side effects use a prepared Pending Operation. It records the Request,
  operation class, Task, before Workspace Hash and, for a Patch, the expected
  after Hash and Patch Journal identity before the side effect starts.
- Recovery first reparses the Checkpoint and current planning Envelope, then
  compares the current Workspace content Hash. A pending Patch is finalized only
  when the Workspace exactly equals its prepared after Hash; it is safely
  replayable only when it still equals the before Hash. Any third state requires
  manual review and the Patch is never blindly replayed.
- Interrupted deterministic verification is marked safe to rerun. An interrupted
  Repair provider call requires manual review because a remote or local model may
  have completed without returning a result. Planning changes and unrelated
  Workspace drift block Resume.
- Pause and Resume are accepted only at safe state-machine boundaries. Cancel
  transitions all cancellable active Run entities and is itself idempotent.

## Consequences

Development execution can now survive local process restarts without ProductFac,
Temporal, a database or another remote dependency. The implementation provides
local durability and deterministic recovery evidence, not distributed consensus:
Outbox consumers must deduplicate by Event ID, and an unprovable side effect is
deliberately handed to the user rather than guessed or replayed.
