# P4-01 Gate P4-B report

- Date: 2026-09-08
- Milestone: P4-01 — developer configuration loading and diagnostics
- Result: passed
- Next milestone: P4-02 — real providers and unified adapter layer

## Delivered capability

- Added the shared `@product-woc/runtime-config` package for Planning and
  Development.
- Implemented configuration discovery in this order: explicit path,
  `PRODUCT_WOC_CONFIG_PATH`, then `productwoc.config.json` in the working
  directory.
- Implemented one-descriptor reads, regular-file checks, a 256 KiB limit, strict
  versioned Schema validation and stable canonical SHA-256 hashing.
- Implemented Provider-specific reference validation and `env:` resolution at an
  explicit adapter boundary. No Credential value is retained in load results.
- Added a deeply frozen operator snapshot that omits Endpoint and Credential
  references and values.
- Added seven-stage `configured`, `test_mode`, `unavailable` and `degraded`
  availability projection shared by both Web services.
- Added `config validate`, `models list` and `models test` developer commands.
  P4-01 `models test` verifies configuration and environment resolution only.
- Added `/api/models` read endpoints to Planning and Development. They return only
  the sanitized, non-editable availability contract.
- Missing or invalid configuration blocks new Web generation with a generic 503
  response. Existing Planning and Development Checkpoints remain readable.
- Bound new Development runs to the runtime configuration Hash instead of a
  browser-managed policy identifier.
- Ignored the local `productwoc.config.json` while keeping a credential-free
  example under version control.

## Gate evidence

| P4-B requirement | Evidence | Result |
|---|---|---|
| Default model and seven stage overrides need no source edit | Version 1 fixture, loader tests and `models test` show all seven resolved routes | pass |
| Planning and Development use one server-side loader | Both app manifests depend on `@product-woc/runtime-config`; package boundary check passes | pass |
| Web users cannot modify model configuration | Existing P4 boundary scan passes; model endpoints are GET-only and legacy writes return 404 | pass |
| Missing or invalid configuration fails closed | Loader, controller and HTTP tests verify unavailable views, disabled planning mutations and generic 503 responses | pass |
| Historical state remains readable | Planning controller test reads an existing Checkpoint after replacing runtime state with unavailable configuration | pass |
| Credential values and refs stay outside Web and persisted evidence | API/application/page tests scan sanitized views; Development snapshots store only configuration Hash identifiers | pass |
| Operators receive actionable diagnostics | CLI validation reports source, issue code, schema path and operator hints without Credential values | pass |
| ProductFac remains absent | Expanded standalone isolation and package boundary checks pass | pass |

## Verification record

The recorded P4-B run passed:

```text
54 formal test files, 325 tests
16 TypeScript projects typechecked
all app and package source/test files linted
development-contracts, runtime-config, planning-lab and development-lab built
config validate CLI smoke test
models test CLI smoke test
ProductFac isolation check
package direction check
fixture hygiene check
release hygiene check
P4 Web boundary check
git diff --check
```

HTTP tests used disposable loopback ports only. No model Endpoint, ProductFac
service, deployment or production write was contacted.

## Environment deviation

The local run used Node.js 26.7.0 instead of the repository's required Node.js 24.
Under Node 26, pnpm's dependency-status hook attempted an automatic reinstall when
invoked through Turbo. The complete gate was therefore executed with the installed
local ESLint, TypeScript and Vitest binaries. No implementation failure was waived.

## Scope boundary

P4-01 validates model configuration and environment readiness but does not send a
network request. Ollama/OpenAI-compatible transports, connection probes, timeout,
retry and Provider error classification belong to P4-02. Planning continues to use
explicitly labelled deterministic test generation until P4-03 replaces that path.
