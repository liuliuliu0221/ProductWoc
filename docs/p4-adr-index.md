# Stage 4 ADR index

| ADR | Status | Stage 4 concern |
|---|---|---|
| [ADR 022](adr/022-standalone-operator-managed-stage-model-configuration.md) | accepted for P4-00 | ProductFac isolation, operator-only model configuration, seven stage routes and configuration-free Web use |
| [ADR 023](adr/023-versioned-runtime-configuration-loading-and-diagnostics.md) | accepted for P4-01 | versioned file loading, environment references, configuration Hash, operator diagnostics and sanitized availability |

ADR 022 partially supersedes the model-configuration authority described by ADR
012, ADR 013 and ADR 019. Their open-source, snapshot, capability negotiation,
Checkpoint, fallback-safety and no-deployment decisions remain active unless ADR
022 explicitly replaces them.

Later P4 milestones may add ADRs for:

1. shared Planning/Development provider transport boundaries;
2. real-model generation recovery and candidate retention;
3. local Web identity and any future non-loopback exposure.
