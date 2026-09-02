# P2-07 standalone Gate G2 report

- Date: 2026-08-28
- Mode: deterministic offline / standalone
- Command: `pnpm eval:gate`
- ProductFac, network and remote model usage: none

## Eval baseline

| Metric | Result |
|---|---:|
| Fixed fixtures | 20 |
| Languages | zh, en, mixed |
| Request categories exercised | 10 |
| Mean deterministic score | 1.00 |
| First-pass Schema rate | 1.00 |
| Repair rate | 0.00 |
| Human-action rate | 0.30 |
| Invalidation accuracy | 1.00 |
| Unsupported/high-risk detection | 1.00 |
| Reference override violations | 0 |
| Tokens / latency / model cost | 0 / 0 ms / USD 0 |

The zero-cost figures describe the local deterministic provider, not a production
model estimate.

## Security evidence

- Viewer writes, cross-workspace access and stale Version/Hash bindings are rejected.
- Duplicate command keys return their first deterministic result.
- Out-of-order approvals and non-monotonic document versions are rejected.
- Attachment, Memory and Blueprint instructions remain untrusted reference data.
- Credential, private-key, email and phone patterns are redacted before model input.
- Sensitive structured candidates cannot be materialized or rendered as Markdown.
- Candidate artifacts are marked Workspace Private; invalidation reasons and prior
  approval history remain traceable without mutating earlier aggregate values.

## Gate G2 scenarios

1. Five distinct product requests completed Discovery, Project Spec, Technical
   Design, Execution Plan and all three approvals.
2. Every project exposed three non-empty decision summaries and one unique
   DevelopmentStartEnvelope.
3. A completed project's approved Project Spec was reopened and revised.
4. The old Technical Design, Execution Plan, effective approvals and old envelope
   were invalidated before the new version could proceed.
5. Re-approval produced one new envelope; replaying the final approval did not
   create another start.

## Result

Standalone Gate G2: passed. Production ProductFac/Neon/Temporal/Auth/Artifact ACL
integration remains outside this independent gate.
