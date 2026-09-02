# ADR 008: Standalone runtime isolation

- Status: accepted
- Date: 2026-08-28

## Context

ProductWoc was designed as an independently testable planning kernel with future
ProductFac adapters, but it did not yet include a complete local runtime. This made
the domain packages testable while leaving the repository unable to demonstrate
the full planning result without additional orchestration.

## Decision

- ProductWoc must run from idea to `DevelopmentStartEnvelope` without ProductFac,
  network access, database access, Temporal, identity services, or external model
  APIs.
- The standalone runtime uses in-memory repositories, a sequence clock, sequential
  IDs, collected events, and a deterministic local planning model.
- The complete smoke-test entry point is named
  `runAutoApprovedStandalonePlanning`; its approvals are explicitly local test
  approvals and must not be presented as production authorization.
- Planning domain, agent, renderer, and workflow packages remain reusable. Future
  integrations provide ports instead of changing domain rules.
- The pinned ProductFac v1 manifest and fixture remain compatibility artifacts only.
  Standalone runtime source must not import ProductFac packages or source paths.
- `pnpm isolation:check` enforces this runtime dependency boundary and is part of
  `pnpm check`.
- In-memory state is process-local and intentionally not a second production fact
  source.

## Consequences

The repository can be installed, checked, and exercised independently. A future
ProductFac integration is optional and replaceable; it cannot become an implicit
prerequisite for local execution. Durable persistence, real user authorization,
and non-deterministic AI providers remain separate adapter concerns.
