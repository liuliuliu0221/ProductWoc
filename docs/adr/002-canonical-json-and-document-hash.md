# ADR 002: Canonical JSON and document hashes

- Status: accepted for P2-01 foundation
- Date: 2026-08-27

## Context

Approvals must bind to immutable planning content. Markdown, timestamps, UI state,
and object insertion order must not accidentally invalidate an approval.

## Decision

- Authoritative document content is JSON validated by a versioned schema.
- Canonicalization sorts object keys recursively and preserves array order.
- Negative zero is normalized to zero; non-finite numbers are rejected.
- SHA-256 of UTF-8 canonical JSON is the normalized content hash.
- Markdown and decision summaries are derived views and are excluded from the hash.
- Approval bindings include subject version ID, content hash, workflow run, stage
  run, project, and approval-policy version.

## Consequences

Equivalent object key ordering yields the same hash. Arrays remain semantically
ordered until a schema explicitly defines a different normalization policy.
