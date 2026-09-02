# ADR 007: Execution Plan graph, coverage, and development start

- Status: accepted for P2-04
- Date: 2026-08-28

## Context

An approved Execution Plan is the last planning artifact before development. It
must be executable in a deterministic order, cover the approved product behavior,
make verification and rollback explicit, and prevent stale or unapproved planning
state from starting implementation.

## Decision

- Phases and tasks form explicit dependency graphs. Cycles, unknown dependencies,
  orphaned tasks, cross-phase impossible ordering, and unreachable tasks fail
  validation.
- Every approved Requirement and Acceptance Criterion is covered by at least one
  task. A coverage waiver is valid only for a known target and a confirmed
  Decision ID.
- Tasks identify their inputs, outputs, Design Items, completion criteria,
  verification steps, evidence types, risk level, and rollback strategy.
- Blocked external operations cannot be executable tasks. Operations requiring
  confirmation enter `needs_user_action`. An approved operation must reference
  both a valid user gate and a confirmed Decision ID.
- An Execution Plan version binds the exact Project Spec and Technical Design
  version IDs and normalized hashes. The aggregate rejects stale bindings before
  changing its pointer.
- `DevelopmentStartEnvelope` is valid only when all three current document
  pointers are valid, all three ordered approval bindings remain effective, and
  workflow definition and validation policy metadata match the aggregate.
- The envelope ID is derived deterministically from the workflow run and all three
  document version IDs. Any upstream revision invalidates downstream state and the
  previous envelope.

## Consequences

Development receives one immutable, auditable starting boundary rather than a
collection of mutable drafts. Deterministic validation can block incomplete plans,
route risky actions to the user, and detect stale approvals without relying on
model judgment or ProductFac integration.
