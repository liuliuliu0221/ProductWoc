# Stage 3 ADR index

| ADR | Status | Stage 3 concern |
|---|---|---|
| [ADR 008](adr/008-standalone-runtime-isolation.md) | accepted | ProductFac-independent runtime |
| [ADR 009](adr/009-local-checkpoints-and-outbox.md) | accepted | Local durability baseline |
| [ADR 011](adr/011-local-eval-and-context-security.md) | accepted | Deterministic Eval and context security |
| [ADR 012](adr/012-stage-3-open-source-and-model-access-boundary.md) | accepted for P3-00 | Open source, no deployment and equal model access |
| [ADR 013](adr/013-model-routing-snapshots-and-explicit-fallback.md) | accepted for P3-01 | Model precedence, immutable snapshots and explicit fallback |
| [ADR 014](adr/014-development-domain-state-evidence-and-invalidation.md) | accepted for P3-02 | State machines, deterministic DAG, Evidence, Gate and invalidation |
| [ADR 015](adr/015-local-workspace-and-structured-tool-policy.md) | accepted for P3-03 | Workspace boundary, Baseline, structured commands and fail-closed policy |
| [ADR 016](adr/016-task-context-and-patch-transaction.md) | accepted for P3-04 | Minimal untrusted Task Context, Change Proposal, Patch transaction and Journal |
| [ADR 017](adr/017-evidence-repair-and-guarded-rollback.md) | accepted for P3-05 | Evidence-controlled verification, bounded Repair and guarded rollback |
| [ADR 018](adr/018-development-checkpoint-outbox-and-recovery.md) | accepted for P3-06 | Atomic Development Checkpoint, transactional Outbox and recovery audit |
| [ADR 019](adr/019-development-web-cli-and-local-model-policy.md) | accepted for P3-07 | Checkpoint-projected Web/CLI, Planning handoff and local stage model policy |
| [ADR 020](adr/020-deterministic-g3-corpus-and-release-gate.md) | accepted for P3-08 implementation | Versioned offline repository corpus, adversarial Eval and release hygiene |
| [ADR 021](adr/021-mit-license-and-release-governance.md) | accepted for P3-08 | MIT licensing, contribution terms and manual release governance |

The following decisions remain scheduled for later P3 milestones:

1. Local credential storage integration;
2. Repository-owner release approval after the clean-clone Gate.
