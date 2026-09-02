# P3-01 Gate P3-B report

- Date: 2026-08-28
- Milestone: P3-01 — model configuration and routing
- Result: passed

## Delivered behavior

- Added application default, project default, stage override and Run override
  precedence.
- Added strict Model Profile, capability requirement, Model Policy,
  `ModelRunSnapshot` and `ModelFallbackEvent` contracts.
- Added Structured Output, Tool Calling, Vision, `localOnly` and Context Window
  capability negotiation before Provider invocation.
- Added deterministic configuration hashes and deeply frozen Run snapshots.
- Added a routing service that returns `blocked`, `paused` or `completed` without
  mutating Development Run state.
- Added explicit, user-confirmed fallback with a new Agent Run and audit event.
- Added Deterministic, Ollama-compatible and OpenAI-compatible Provider adapters.
- Added injected HTTP transport and Endpoint/Credential Ref resolution, with no
  vendor SDK dependency.
- Added connection tests and redacted provider failure summaries.

## Gate evidence

| P3-B requirement | Evidence | Result |
|---|---|---|
| Three Providers satisfy one contract | Deterministic, Ollama-compatible and OpenAI-compatible adapter contract tests | pass |
| Default, stage and Run precedence | `development-agent/test/model-router.test.ts` | pass |
| Run Snapshot remains immutable | Profile mutation after routing does not alter the frozen snapshot | pass |
| Capability shortage blocks before invocation | Unsupported Tool Calling test records zero Provider calls | pass |
| No user tier or hidden capability | Strict Model Policy rejects `userTier` | pass |
| No silent fallback | Configured fallback is not called without confirmation | pass |
| Confirmed fallback is auditable | New Agent Run snapshot and `ModelFallbackEvent` test | pass |
| Credential values stay outside snapshots and errors | Credential Ref contract and adapter redaction tests | pass |
| Deterministic route works offline | Cross-package Gate P3-B Eval | pass |
| Provider errors do not advance state | Router returns a recoverable `paused` outcome | pass |
| Adapter or resolver exceptions fail closed | Unstructured exceptions become static recoverable failures | pass |

## Full quality gate

`pnpm p3:gate` passed:

- ProductFac isolation, package-boundary and fixture-hygiene checks passed;
- 14 package Lint tasks passed;
- 25 Typecheck/build-prerequisite tasks passed;
- 165 tests passed, including 27 stage 3 tests;
- 14 package builds passed.

The first run stopped on two adapter Lint findings. Both were corrected and the
complete gate was rerun from the beginning with no waiver.

## Verification boundary

No real model endpoint or credential was used. HTTP-compatible Providers were
verified through injected deterministic transports. A live connection test is an
explicit local user action and is not required by CI.

The local environment remains Node.js 26.7.0 while the project and GitHub CI pin
Node.js 24. This is the previously accepted local deviation.
