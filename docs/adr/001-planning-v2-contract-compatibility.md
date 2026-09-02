# ADR 001: Planning v2 contract compatibility

- Status: accepted for P2-00
- Date: 2026-08-27

## Context

ProductFac currently exposes a PRD-only Planning v1 contract. ProductWoc needs a
four-stage planning workflow without changing the meaning of active v1 runs.

## Decision

- Introduce explicit Planning v2 schemas under `@product-woc/planning-contracts`.
- Keep v1 input parsing and conversion in the `./v1-compat` subpath.
- Require adapter context for fields that do not exist in v1; never infer tenant,
  request, workflow, or approval-policy identity from actor input.
- Pin the ProductFac source contract hash in the Contract Manifest and compatibility
  module. A mismatch fails the contract test.
- Treat breaking Schema, Workflow, or Approval Policy changes as major versions.
- Keep already-running v1 workflows on their original definition.

## Consequences

ProductWoc can evolve independently while contract drift is visible. Production
activation still depends on ProductFac P1-02 and Gate G1.
