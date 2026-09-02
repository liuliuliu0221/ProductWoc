# ADR 003: ProductWoc integration boundary

- Status: accepted for P2-00
- Date: 2026-08-27

## Context

ProductWoc is developed in parallel with ProductFac P1-02, but ProductFac remains
the production system of record.

## Decision

- ProductWoc owns contracts, pure domain rules, model ports, renderers, workflow
  logic, evaluations, and adapter interfaces.
- ProductWoc does not own production identity, Workspace/RBAC, Project storage,
  PostgreSQL migrations, Outbox/SSE, Artifact ACL, or community data.
- The local Planning Lab is a fixture runner only and is not a production UI.
- Production adapters and migrations land in ProductFac after Gate G1.

## Consequences

Offline domain development can proceed without creating a competing platform or
a second source of truth.
