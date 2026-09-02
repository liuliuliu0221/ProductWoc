# ADR 006: Technical Design policy and requirement traceability

- Status: accepted for P2-03
- Date: 2026-08-28

## Context

Technical Design candidates must remain implementable on ProductFac, cover the
approved Project Spec, and avoid claiming unfinished platform capabilities exist.

## Decision

- Every design records an explicit decision for each golden-stack capability:
  Next.js 16, Node.js 24, TypeScript, PostgreSQL/Neon, Drizzle, Better Auth,
  Temporal, E2B, GitHub App, Netlify, and R2.
- Core stack omissions and mismatched compliant selections fail validation.
- Proposed deviations enter `needs_user_action`. An exception becomes valid only
  when a revised design references a confirmed Decision ID.
- Every approved Requirement ID has exactly one traceability disposition. Designed
  requirements reference existing Design Items; exclusions require a rationale.
- Design Items reference existing modules and approved Requirement IDs.
- Platform capabilities are structured as available, planned, or blocked. An
  `available` claim is accepted only when present in the supplied verified-capability
  context.
- Secret-like material is rejected before version materialization.
- A Technical Design version binds the exact Project Spec version ID and normalized
  hash. The domain aggregate rejects stale bindings before changing its pointer.

## Consequences

Architecture review is deterministic and independently testable. Real capability
evidence and approved exception Decisions will be supplied by ProductFac adapters
after Gate G1.
