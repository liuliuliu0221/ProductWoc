# ADR 023: Versioned runtime configuration loading and diagnostics

- Status: accepted for P4-01
- Date: 2026-09-08
- Extends: ADR 022

## Context

ADR 022 made the developer/operator the sole model-configuration authority and
removed model-policy writes from Web users. ProductWoc still needed one shared,
versioned way for Planning and Development to discover configuration, validate
provider requirements, resolve environment references and expose a sanitized
availability view.

Configuration loading must fail closed without making historical Checkpoints
unreadable. Credential values and internal reference names must not cross ordinary
Web, Checkpoint, Evidence, export or startup-log boundaries.

## Decision

- The shared `@product-woc/runtime-config` package owns file discovery, atomic
  reading, validation, hashing, operator diagnostics and sanitized availability.
- Configuration path precedence is explicit CLI path, then
  `PRODUCT_WOC_CONFIG_PATH`, then `<working-directory>/productwoc.config.json`.
- The loader opens one file descriptor, rejects non-files and files larger than
  256 KiB, reads once and validates the complete JSON value against schema
  version `1`.
- Version `1` resolves `endpointRef` and `credentialRef` only from
  `env:UPPER_CASE_NAME`. Credential values exist only in the explicit
  adapter-boundary resolver return value.
- Ollama and OpenAI-compatible profiles require an Endpoint reference.
  OpenAI-compatible profiles also require a Credential reference. Resolved
  endpoints must be HTTP(S) URLs without embedded credentials.
- A stable SHA-256 hash is calculated over canonical configuration JSON. The
  in-memory operator snapshot is deeply frozen and omits Endpoint and Credential
  references and values.
- Planning and Development expose the same seven-entry
  `ModelAvailabilityView`. It contains only stage, provider type, model label,
  inheritance source and availability status; `webEditable` is always `false`.
- Missing or invalid configuration blocks new generation with a generic Web
  message. Existing Checkpoints remain readable, but generation controls are
  disabled where the controller can determine that configuration is unavailable.
- Startup stderr contains only diagnostic codes and schema paths. Developers use
  `config validate` for detailed operator hints.
- `models test` in P4-01 checks configuration and environment resolution only.
  Network connection probes are introduced with real Provider adapters in P4-02.
- Deterministic configuration is created only through an explicit in-memory test
  state or a runtime file whose mode is `test` or `demo`.

## Consequences

Planning and Development now agree on one developer-owned configuration snapshot
without importing a model SDK. Browser users cannot supply a Key or mutate stage
routes. Operators receive actionable validation before service use, while
provider connectivity remains a separate milestone and failure domain.

The legacy project Model Policy store remains readable for old Development
Checkpoints, but a loaded runtime configuration takes precedence and no Web route
can mutate the legacy store. A later migration may remove that compatibility
reader after historical checkpoint support is versioned.
