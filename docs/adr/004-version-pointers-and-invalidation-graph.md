# ADR 004: Current version pointers and deterministic invalidation

- Status: accepted for P2-01
- Date: 2026-08-27

## Context

Planning documents are immutable, but the workflow needs one effective version of
each document. Changing an upstream document must prevent stale downstream content
or approvals from producing a development start.

## Decision

- Document versions are append-only; the aggregate stores only the current pointer
  while repositories retain every historical version.
- A pointer contains version ID, monotonic version number, normalized content hash,
  and validity.
- Recording a changed Project Spec invalidates its approval plus all Technical
  Design and Execution Plan pointers, approvals, context, evidence, and development
  start eligibility.
- Recording a changed Technical Design applies the same rule to itself and the
  Execution Plan. Execution Plan changes invalidate its own approval and start.
- Invalidated versions and approvals remain in history; only effective bindings are
  removed.
- The state change, pointer switch, invalidation records, audit, and eventual Outbox
  events must be persisted in one ProductFac transaction.
- A command request ID stores its deterministic first result. Replaying it cannot
  create another version, approval, invalidation, or DevelopmentStartEnvelope.
- `ready_for_development` is a stable start boundary, not an immutable terminal
  tombstone. An explicit reviewed Return command may reopen a document stage; the
  next version then invalidates the prior start and all affected downstream authority.

## Consequences

The pure aggregate can be tested before PostgreSQL integration. ProductFac adapters
must persist the returned state transition atomically after Gate G1.
