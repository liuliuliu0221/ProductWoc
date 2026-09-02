# ADR 014: Development domain state, evidence and invalidation

- Status: accepted for P3-02
- Date: 2026-08-29

## Context

Stage 3 receives three approved and version-bound planning documents. Development
must not infer readiness from model prose, silently accept stale inputs, reorder
dependent tasks, or treat generated output as proof of completion. Changing an
approved planning version or the model snapshot used for a completed task must
also make prior execution qualifications explicit and auditable.

## Decision

- A Development aggregate owns `DevelopmentRun`, `PhaseRun`, `TaskRun` and
  `AgentRun` state machines. Ordinary transitions are closed allowlists enforced
  by pure functions.
- Aggregate creation reparses the Envelope, all three documents, current Planning
  pointers and three effective approvals. It recomputes canonical content hashes,
  validates upstream bindings and creates a deeply frozen
  `DevelopmentInputSnapshot`.
- Phase and Task dependencies are validated as directed acyclic graphs. Duplicate,
  missing, orphaned, self-dependent and impossible cross-phase relationships are
  rejected. Stable input order breaks ties, making scheduling deterministic.
- The scheduler exposes one ready Task at a time. A Task Definition Hash binds
  execution and Evidence to the exact approved task definition.
- Required verification steps need passing, non-invalidated Evidence with the
  same Run, Task Definition Hash and Model Snapshot. A model cannot directly
  transition a Task to completed.
- User Gates require a user actor and the Gate's required Evidence types. Gate
  decisions are append-only.
- Every command carries a request ID. Replaying a request returns its recorded
  result without adding transitions, Evidence, Gate decisions or completion
  records.
- Project Spec revision invalidates every Task and marks the Run stale. Technical
  Design and Execution Plan revisions invalidate only declared roots and their
  downstream dependents, while still marking the aggregate input stale.
- Rerunning with a different Model Snapshot resets the selected Task and all
  downstream Task/Phase qualifications, invalidates their Evidence and Gate
  decisions, and creates a new Agent Run. Old records remain append-only.
- Explicit invalidation resets are recorded as transitions but are separate from
  ordinary forward state-machine commands.

## Consequences

State advancement is deterministic and does not depend on model judgment. Every
completion and user checkpoint has inspectable evidence, and historical facts are
retained after revision or rerun. P3-02 remains free of file-system, Shell, Git,
network and concrete model-provider behavior; those adapters enter only in later
milestones.
