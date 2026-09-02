# ADR 009: Local checkpoints and transactional Outbox

- Status: accepted for standalone P2-05
- Date: 2026-08-28

## Context

The standalone P2-04 pipeline completed in one process. Independent operation also
requires recoverability after a pause or process failure without introducing
ProductFac, Temporal, PostgreSQL, or another remote service.

## Decision

- The durable runner commits one complete planning checkpoint after every status
  transition or accepted document/approval command.
- A checkpoint contains the validated workflow input, pure planning aggregate,
  generated documents, Discovery result, effective approvals, invalidation history,
  and DevelopmentStartEnvelope when complete.
- Checkpoint state and new events are stored in one JSON record. File persistence
  writes a new temporary record and atomically renames it over the previous record.
- Every commit uses an expected checkpoint revision. A stale writer receives
  `CheckpointConflictError` instead of silently replacing newer state.
- Events remain in the local Outbox until publication succeeds. Restart publishes
  pending events before continuing the workflow. Delivery is at least once, so a
  future event consumer must use `eventId` idempotently.
- Reopening a completed checkpoint returns its existing documents, approvals, and
  DevelopmentStartEnvelope without generating new versions.
- The deterministic workflow still performs no external I/O directly; clocks,
  IDs, model calls, persistence, and event publication remain injected ports.

## Consequences

ProductWoc can demonstrate pause, restart, replay, failure recovery, and idempotent
completion entirely locally. JSON files are suitable for development and acceptance
testing only; production-scale locking, authorization, backup, and query behavior
remain responsibilities of a separately selected durable adapter.
