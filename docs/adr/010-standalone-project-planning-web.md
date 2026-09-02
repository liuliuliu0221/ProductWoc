# ADR 010: Standalone Project Planning Web

- Status: accepted for standalone P2-06
- Date: 2026-08-28

## Context

The durable standalone workflow could pause and recover, but it had no human-facing
approval surface. ProductWoc must remain independently runnable and must not depend
on or duplicate ProductFac production identity, navigation, API, or hosting.

## Decision

- `planning-lab` serves a local Project Planning page and JSON/SSE API on loopback.
- A headless controller derives every button, stage, summary, document and final
  envelope state from the persisted server checkpoint.
- The server owns the local Actor and Workspace context. It rejects Viewer writes,
  cross-workspace access and stale Version/Hash bindings, and deduplicates reused
  command keys.
- The durable runner pauses at all approval gates. Approve, revise, return and cancel
  remain explicit domain commands rather than client-side state changes.
- Revision feedback creates a monotonic document version, retains prior versions,
  changes the normalized content hash and exposes a structured JSON Diff.
- SSE broadcasts successful writes, while refresh/query remains authoritative.
- The UI includes three document cards, full Markdown, version history, risks,
  assumptions, timeline, responsive layout, keyboard focus treatment and a local
  social preview asset.
- Checkpoints and Web data remain under `.product-woc`; no remote deployment or
  external write is performed.

## Consequences

ProductWoc now supports an independently testable human approval loop and recovery
path without ProductFac. The local fixed identity and JSON file store are deliberate
development constraints, not production authentication or multi-process storage.
Future ProductFac integration should reuse the headless view model and contracts
while replacing the local identity, HTTP shell and checkpoint adapter.
