# ADR 011: Local Eval and context security boundary

- Status: accepted for standalone P2-07
- Date: 2026-08-28

## Context

P2-07 requires a repeatable quality baseline and proof that references, sensitive
data, replayed commands and stale approvals cannot silently change planning
authority. ProductWoc must provide this proof without ProductFac or a remote model.

## Decision

- The deterministic baseline contains 20 versioned fixtures spanning ten request
  categories and Chinese, English and mixed-language input.
- A suite report records decision quality, Schema first-pass rate, repairs, human
  action, traceability coverage, invalidation accuracy, unsupported detection,
  reference override violations, tokens, latency and cost.
- Attachment, Memory and Blueprint summaries are data, never instructions. They are
  bounded, redacted and tagged `untrusted` / `never_follow` before model invocation.
- Common private-key, API credential, secret assignment, email and phone patterns
  are redacted from authoritative inputs. Structured outputs are scanned again and
  fail closed before any document version is materialized.
- Raw candidate artifacts carry `workspace_private` access metadata. This is a
  local contract marker; a future production adapter must enforce real Artifact ACL.
- Completed workflows may be reopened only by an explicit Return command. Recording
  the revision removes effective downstream approvals and the old development start
  while retaining append-only approval and invalidation history.
- Gate G2 is executable through `pnpm eval:gate`; no oral waiver replaces a failed
  check.

## Consequences

The standalone system has deterministic evidence for its supported scope and fails
closed around common context and credential attacks. Regex redaction is defense in
depth, not a complete production DLP system. Real identity, storage ACL, immutable
audit infrastructure, model billing and compliance controls remain adapter-level
requirements for any future production integration.
