# ADR 013: Model routing snapshots and explicit fallback

- Status: accepted for P3-01
- Date: 2026-08-28

## Context

ProductWoc lets every user choose one project model and optionally override models
for individual planning or development stages. The result must stay reproducible
when a Profile changes, and provider outages must not silently change the model
that authored a planning document or code proposal.

## Decision

- Model selection uses this precedence: Run override, project stage override,
  project default, then application default.
- Every user can configure every layer. The contracts contain no user tier,
  subscription or hidden-capability field.
- Routing validates structured output, tool calling, vision, local-only policy and
  context-window requirements before invoking a Provider.
- Each Agent Run stores an immutable `ModelRunSnapshot` containing the resolved
  Profile, selection source, policy/profile/configuration hashes, Prompt version,
  Tool Policy version and Context hash.
- A Profile stores only `endpointRef` and `credentialRef`. Endpoint and credential
  values are resolved at the adapter boundary and do not enter the snapshot.
- Provider failure pauses the caller. Fallback is attempted only when the policy
  preconfigures a distinct fallback Profile and a user supplies an explicit
  confirmation.
- Confirmed fallback creates a new Agent Run snapshot and an append-only
  `ModelFallbackEvent` recording both Profiles, both Agent Runs, reason and actor.
- Authentication or invalid-response failures never trigger automatic fallback.
- Deterministic, Ollama-compatible and OpenAI-compatible Providers implement one
  port. Compatible HTTP adapters use no vendor SDK and accept an injected
  transport for deterministic tests.
- Provider error summaries redact resolved endpoint and credential values before
  returning to workflow code.

## Consequences

Model choices are reproducible and outages cannot silently alter authorship.
Changing a Profile affects future Agent Runs only. The workflow layer will later
persist snapshots and fallback events; P3-01 returns them without advancing any
Development Run state. Live Endpoint verification remains an explicit local user
action because CI does not require network access or credentials.
