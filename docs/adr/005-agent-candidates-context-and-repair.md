# ADR 005: Agent candidates, minimal context, and bounded repair

- Status: accepted for P2-02
- Date: 2026-08-28

## Context

Discovery and Project Spec generation use probabilistic model output, while workflow
state, document identity, and approvals require deterministic authority.

## Decision

- Models return only `RequirementUnderstanding` or `ProjectSpecContent` candidates.
- Version IDs, version numbers, normalized hashes, source IDs, timestamps, Prompt
  versions, and Model snapshots are attached by application code after validation.
- Generation context contains only the current idea, effective Decision entries,
  authoritative understanding, and explicitly selected reference summaries.
- Reference summaries and previous invalid candidates remain untrusted input.
- Invalid structured output receives at most one repair attempt by default.
- If the repair budget is exhausted, the workflow enters `needs_user_action`; raw
  output is retained only as a restricted candidate Artifact.
- Unsupported and high-risk requests return a reason and safe fallback without
  continuing an open-ended clarification interview.

## Consequences

Model text cannot directly advance state or become an approved document. Prompt,
Schema, Provider, and Model provenance remain observable and evaluation-friendly.
