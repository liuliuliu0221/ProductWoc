# ADR 022: Standalone operator-managed stage model configuration

- Status: accepted for P4-00
- Date: 2026-09-06
- Supersedes in part: ADR 012, ADR 013 and ADR 019

## Context

ProductWoc is an independent open-source application rather than a ProductFac
module or a hosted commercial service. The v0.1.0 workflow proved stage routing,
snapshots, approvals and local recovery, but Planning Web still used a generic
deterministic provider. Earlier Stage 3 decisions also exposed model-policy
editing to every local web editor.

The desired product boundary is now different: the developer or operator running
ProductWoc configures providers and stage routes once, while web users consume
the configured service without handling endpoints, credentials or model policy.
The existing stage-specific routing and immutable snapshot behavior must remain.

## Decision

- ProductWoc remains buildable, runnable, testable and recoverable without any
  ProductFac package, checkout, service, database, identity, environment variable
  or deployment state.
- GitHub provides source collaboration, CI and releases only. ProductWoc includes
  no ProductFac integration and no built-in remote-deployment workflow.
- The developer/operator who controls the ProductWoc process is the sole model
  configuration authority.
- Model profiles, the application default, stage overrides and fallback policy are
  loaded from server-side configuration before model work begins.
- Credential values are resolved only at the provider-adapter boundary from
  environment variables or an approved local secret store. Configuration stores
  references, never credential values.
- Web users can create requests, answer clarifying questions, review and revise
  documents, approve gates, confirm use of an already configured fallback, and
  inspect sanitized model provenance.
- Web users cannot create, edit, delete or select model profiles and cannot access
  provider endpoints, credential references or credential values.
- Runtime profile types remain `deterministic`, `ollama` and
  `openai_compatible`; `ollama` denotes the Ollama-compatible adapter.
- The supported routing scopes remain:
  `planning.discovery`, `planning.project_spec`,
  `planning.technical_design`, `planning.execution_plan`,
  `development.implementation`, `development.review` and
  `development.repair`.
- New runs resolve a developer-configured stage override first and the
  developer-configured application default second. An active run uses its already
  locked immutable Model Run Snapshot.
- Changing configuration affects future model runs only. Regenerating completed
  planning or development work creates a new run/version and applies the existing
  downstream invalidation rules.
- Provider failure pauses. A web user may confirm an operator-preconfigured
  fallback for the failed run, but cannot choose an arbitrary model.
- Authentication, schema-validation and security-policy failures never trigger
  automatic fallback.
- Deterministic providers remain available for tests, fixtures and explicitly
  labelled demonstrations. Missing real-model configuration must not silently
  produce deterministic template content in normal web use.
- The web service binds to loopback by default. Broader network exposure requires
  a separate identity and transport-security decision.

## Superseded clauses

This ADR changes only configuration authority and UI exposure:

- ADR 012's statement that all users have equal model-configuration capability is
  replaced by operator-only configuration and configuration-free web use.
- ADR 013's statement that every user can configure every precedence layer is
  replaced by operator-managed defaults and stage overrides. Its capability
  negotiation, immutable snapshot, explicit fallback and redaction decisions
  remain active.
- ADR 019's Development Web model-editing surface is replaced by a read-only,
  sanitized model-status and provenance view. Its Checkpoint, concurrency, SSE,
  CLI evidence and no-deployment decisions remain active.

## Consequences

Web users receive a simpler and safer product surface, and secrets never need to
cross the browser boundary. Operators take responsibility for model availability,
cost and configuration correctness. A missing or invalid model configuration
blocks new generation while preserving read-only access to existing local data.
The seven-stage routing model remains reproducible, but every configuration change
is an operational action outside ordinary web-user authority.
