# ADR 019: Development Web, CLI and local model policy

- Status: accepted for P3-07
- Date: 2026-09-02

## Context

P3-06 established the durable Development Checkpoint but offered no complete
local interaction surface. Planning Web and the durable Planning CLI also used
different default directories, so a visual Planning completion could not become
an authoritative Development input. Model routing supported stage overrides in
contracts, but the Development page exposed only a disabled placeholder.

## Decision

- Planning Web and the durable Planning CLI share `.product-woc/checkpoints` by
  default. A ready Planning page links to the local Development service with only
  the project identifier; the Development service reloads and validates the
  authoritative Envelope before creating the Run.
- Development Web and CLI use the same durable Checkpoint store. The browser
  receives server-generated View Models and never reconstructs domain state from
  earlier responses. SSE is advisory; each event causes a fresh GET.
- Every Run mutation carries an Idempotency Key, Checkpoint Revision and Workspace
  Hash. Conflicts, Stale planning, Workspace Drift and manual recovery are
  explicit responses and visible blocker cards.
- Project Model Profiles and stage overrides are local configuration rather than
  mutable Agent Run snapshots. They are stored atomically in a separate
  permission-restricted JSON file with their own revision and idempotency
  receipts. No credential value is stored, only references.
- All local editors have identical stage-override capability. The UI requires an
  explicit impact acknowledgement and states that an active Agent Run and its
  immutable Model Snapshot do not hot-switch. A later Agent Run uses the new
  policy; rerunning completed work requires Evidence and downstream review.
- Three offline-safe profiles are exposed initially: deterministic local,
  user-configured Ollama and user-configured OpenAI-compatible. Only the
  deterministic profile is reported immediately available.
- The CLI exposes `develop`, `status`, `resume`, `verify`, `rollback`, `models`
  and `export-evidence`. Evidence export uses mode `0600` and contains redacted
  Artifacts and hashes rather than credentials.
- Web and CLI intentionally contain no remote deployment, publish or production
  write action.

## Consequences

ProductWoc now has a complete local Planning-to-Development handoff and two
consistent control surfaces without ProductFac or hosted infrastructure. Model
configuration can evolve independently from immutable Run snapshots, but future
Agent execution work must read the selected project policy when creating each new
Model Snapshot. The fixed local ports are a development convention and may later
be made discoverable without changing the Checkpoint contract.
