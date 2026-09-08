# P4-00 Gate P4-A report

- Date: 2026-09-06
- Milestone: P4-00 — scope correction and contract baseline
- Result: passed
- Next milestone: P4-01 — developer configuration loading and diagnostics

## Delivered baseline

- Accepted ADR 022 as the authority for ProductWoc isolation, operator-managed
  model configuration, configuration-free Web use and seven-stage routing.
- Added strict `ProductWocRuntimeConfigV1` and sanitized
  `ModelAvailabilityView` contracts.
- Added valid and invalid runtime configuration fixtures, including an inline
  credential rejection case.
- Removed Development Web model-policy mutation controls and rejected the legacy
  `stage-model` HTTP action with `404 not_found`.
- Replaced the browser model-policy projection with a read-only, sanitized stage
  availability view.
- Expanded ProductFac isolation checks to package scripts, runtime imports,
  environment dependencies and runtime endpoints.
- Added a P4 browser-boundary check and a credential-safe operator configuration
  example.
- Documented the v0.1 deterministic-provider limitation and the P4 progression to
  real providers.

## Gate evidence

| P4-A requirement | Evidence | Result |
|---|---|---|
| Supersession leaves one model-configuration authority | ADR 022 plus supersession notes in ADR 012, 013 and 019 | pass |
| Runtime configuration contract is strict | Contract tests cover valid input, unknown fields, duplicate and missing profiles, invalid stage values and service-mode deterministic rejection | pass |
| Credential references cannot become inline credentials | Invalid fixture and contract tests reject inline secret fields; release hygiene verifies example references | pass |
| Web has no Model Policy write contract | Browser boundary scan passes; legacy Development HTTP action returns `404 not_found` | pass |
| Browser model data is sanitized and read-only | Application and page tests verify `developer_operator`, `webEditable: false`, sanitized labels and absent refs | pass |
| ProductFac remains outside runtime | Expanded standalone isolation check passes | pass |
| Affected packages remain healthy | Lint and TypeScript builds pass; 32 focused tests pass | pass |

## Verification record

The following direct-equivalent P4-A checks passed:

```text
node scripts/check-standalone-isolation.mjs
node scripts/check-package-boundaries.mjs
node scripts/check-open-source-fixtures.mjs
node scripts/check-release-hygiene.mjs
node scripts/check-p4-boundaries.mjs
eslint development-contracts and development-lab sources/tests
tsc development-contracts
tsc development-lab
vitest: 4 files, 32 tests
git diff --check
```

The HTTP regression test bound only to a disposable `127.0.0.1` test port. No
external provider, credential, ProductFac service or remote deployment was used.

## Environment deviation

The recorded local run used Node.js 26.7.0, while the repository requires Node.js
24. This is the previously accepted Node deviation. Because the pnpm launcher for
the pinned toolchain was not available offline under this runtime, the report
records the equivalent repository scripts and local binaries individually. No
failing implementation check was waived.

## Scope boundary

P4-00 defines and enforces the configuration contract; it does not yet load an
operator configuration file, resolve environment references or connect to a real
provider. Those capabilities belong to P4-01 and P4-02. Until P4-03, Planning
continues to expose explicitly labelled deterministic test output.
