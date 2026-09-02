# ADR 012: Stage 3 open-source and model-access boundary

- Status: accepted for P3-00
- Date: 2026-08-28

## Context

ProductWoc will be published as an independent GitHub project rather than a hosted
commercial service. Stage 3 introduces local development automation, which could
otherwise drift toward ProductFac coupling, remote deployment or paid feature
tiers. The model configuration surface also needs a stable rule before provider
adapters are implemented.

## Decision

- ProductWoc remains independently buildable and testable without ProductFac.
- GitHub hosts source collaboration, CI and releases; ProductWoc does not provide a
  remote deployment or production-write workflow.
- All users have the same model configuration capabilities. There are no normal,
  advanced, paid or hidden model tiers.
- A project selects one default Model Profile. Any user may optionally override it
  for a planning or development stage.
- Progressive disclosure controls interface complexity only; it does not control
  authorization or feature access.
- Deterministic offline fixtures remain sufficient for required CI gates.
- Provider credentials are references supplied by the local user and must never be
  committed, logged or embedded in checkpoints.
- The repository owner must select an OSI-approved license before public release.

## Consequences

Stage 3 can evolve model routing without turning configuration into a commercial
entitlement system. The repository carries less deployment and credential risk,
but contributors must provide their own model endpoint for non-deterministic use.
No public release is considered ready until a license is explicitly added.
