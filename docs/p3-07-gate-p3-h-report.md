# P3-07 Gate P3-H report

- Date: 2026-09-02
- Milestone: P3-07 — Development Web and CLI
- Result: passed

## Delivered behavior

- Added a local Development application that projects Envelope validation,
  Phase/Task DAG, current task traceability, Context summaries, Patch Journal,
  Diff risk, Verification logs and Evidence, Repair history, Model Snapshots,
  blockers and permissions from the durable Checkpoint.
- Added Pause, Resume, Retry, Verify, Rollback, Cancel and Phase Gate Web actions.
  Every Run mutation binds an Idempotency Key, Checkpoint Revision and Workspace
  Hash; stale writes return conflicts rather than overwriting current state.
- Added an SSE endpoint for advisory refresh. The browser reacts to a notification
  by loading a fresh server View Model instead of treating the event as state.
- Unified Planning Web and durable Planning CLI on `.product-woc/checkpoints`.
  A completed Planning page exposes an `进入 Development` link containing the
  project ID, and the Development service validates the current Envelope before
  creating and starting the Run.
- Added project Model Profile configuration with deterministic, Ollama and
  OpenAI-compatible choices. Stage overrides are available to every local editor,
  use an independent optimistic revision and idempotency receipt, store only local
  credential references, and require an explicit model-switch impact acknowledgement.
- Preserved immutable Agent Run Model Snapshots. A policy change affects a later
  Agent Run and does not hot-switch the current one or silently validate existing
  Patch/Evidence.
- Added the CLI commands `develop`, `status`, `resume`, `verify`, `rollback`,
  `models` and `export-evidence`. The root `pnpm product-woc -- <command>` path was
  smoke-tested, including pnpm's `--` separator.
- Added environment-variable directory overrides consistently to CLI and Web.
- Kept all deployment, publish and production-write controls out of both surfaces.

## Gate evidence

| P3-H requirement | Evidence | Result |
|---|---|---|
| Web and CLI show the same Checkpoint | Application projection/export test plus real `develop`, `status`, `models` and `export-evidence` CLI smoke run | pass |
| Planning enters Development | Shared Planning store, bootstrap integration test and browser-confirmed link to `127.0.0.1:4273/?projectId=...` | pass |
| Page state is server-authoritative | Browser renders the Checkpoint View Model; SSE only causes a fresh GET | pass |
| Writes bind concurrency state | HTTP and application tests cover Idempotency Key, Checkpoint Revision, Workspace Hash and 409 conflicts | pass |
| DAG, Patch, logs, Evidence and models remain inspectable | Rich Checkpoint projection and HTML semantic tests cover each required section | pass |
| Stage model override is available to all users | Editor permission is role-based rather than tier-based; browser persisted `development.review → ollama-local` as policy revision 1 | pass |
| Model change impact is explicit | UI confirmation and server `impactAcknowledged` validation prevent silent policy changes | pass |
| Pause, recovery and drift have clear paths | Browser pause succeeded; recovery against a deliberately changed test Workspace produced an explicit Workspace Drift blocker | pass |
| Keyboard and narrow-screen behavior works | Real Chromium made the skip link the first Tab target with visible focus; 390 px viewport had one column and no horizontal overflow | pass |
| No deployment/production write exists | HTML, action lists, CLI command parser and browser DOM contain no deployment, publish or production action | pass |

## Focused Gate P3-H

`pnpm p3:h:gate` passed:

- ProductFac isolation, package-boundary and open-source fixture-hygiene checks
  passed;
- Development Contracts, Domain, Agent, Adapters, Workflow and Evals retained
  their 140 P3-G tests;
- Planning Lab passed 9 tests and Development Lab passed 13 tests across View
  Models, model policy, bootstrap, HTTP, SSE, HTML/JavaScript and CLI parsing;
- 162 focused tests passed in total;
- Planning Lab and Development Lab lint/typecheck passed, and Development Lab
  built successfully.

## Full quality gate

`pnpm p3:gate` passed from the repository root after the final CLI fix:

- ProductFac isolation, package-boundary and fixture-hygiene checks passed;
- 15 package lint tasks passed;
- 26 typecheck/build-prerequisite tasks passed;
- 292 tests passed;
- 15 package builds passed.

## Browser and CLI verification

A disposable local Planning Checkpoint was generated without a remote model. The
Development CLI created a Running Run and returned consistent status, models and
redacted Evidence export. Real Chromium verified desktop and 390 px layouts,
semantic navigation, first-focus skip link, Model Profile selection, policy
persistence, Pause and Workspace Drift handling. Browser QA found and led to fixes
for two issues before the Gate: ignored explicit Web data-directory environment
variables and a narrow-screen navigation min-content overflow.

All HTTP servers listened only on `127.0.0.1`, used disposable local data and were
stopped after verification. No network model, ProductFac service, deployment,
production credential, GitHub push or production write was used.

The local environment remains Node.js 26.7.0 while the repository requires and CI
pins Node.js 24. This is the previously accepted local deviation; no failed check
was waived.
