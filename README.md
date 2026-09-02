# ProductWoc

[GitHub repository](https://github.com/liuliuliu0221/ProductWoc) · MIT licensed

ProductWoc is a standalone planning application and reusable planning kernel. It
turns an idea into immutable Project Spec, Technical Design, Execution Plan, and
DevelopmentStartEnvelope versions without requiring ProductFac, a database,
Temporal, network access, or an external model provider.

The repository still contains a pinned ProductFac v1 compatibility fixture for a
possible future integration. That compatibility data is not imported by the
standalone runtime and is guarded by an isolation check.

## Requirements

- Node.js 24
- pnpm 11.23.0

## Commands

```sh
pnpm install
pnpm check
pnpm standalone -- "构建一个本地客户反馈管理工具"
pnpm standalone:durable -- "构建一个可恢复的本地客户反馈管理工具"
pnpm web
pnpm development:web
pnpm product-woc -- develop
pnpm product-woc -- status
pnpm eval:gate
pnpm p3:gate
pnpm p3:i:gate
```

`pnpm standalone` runs the complete local path:

```text
idea
→ discovery
→ Project Spec
→ Technical Design
→ Execution Plan
→ ready_for_development
→ DevelopmentStartEnvelope
```

The command uses in-memory repositories and a deterministic offline model. It
performs three explicit local smoke-test approvals under `local-user`; this mode is
for independent development and verification, not production authorization.

`pnpm standalone:durable` uses the same offline pipeline but atomically stores each
status checkpoint and Outbox event under `.product-woc/checkpoints`. Running the
same project request again resumes or returns the already completed result without
creating another document or approval. Set `PRODUCT_WOC_PROJECT_ID` to start a
different local project and `PRODUCT_WOC_DATA_DIR` to choose another data folder.

`pnpm web` builds the workspace and starts the standalone Project Planning UI at
`http://127.0.0.1:4173`. The browser flow pauses at all three approval gates,
persists under `.product-woc/checkpoints`, restores after refresh, and exposes
document summaries, full Markdown, version history, structured Diff, revision,
return, cancellation, and the final DevelopmentStartEnvelope. Its local identity
is `local-user` in `local-workspace`; it does not provide production authentication.

`pnpm development:web` starts the local Development UI at
`http://127.0.0.1:4273`. A completed Planning page links to that address with the
project ID; the Development service validates the current Envelope, creates or
resumes the durable Run, and projects DAG, Patch, Evidence, logs, recovery
blockers, model policy and controls from server View Models. Run Checkpoints live
under `.product-woc/development-checkpoints`; project Model Profile overrides live
under `.product-woc/model-policies` and contain credential references only.

`pnpm product-woc -- <command>` exposes `develop`, `status`, `resume`, `verify`,
`rollback`, `models`, and `export-evidence`. Web and CLI use the same local
Checkpoint. Neither surface has a deploy, publish or production-write command.

`pnpm eval:gate` runs the P2-07 deterministic Eval baseline and standalone Gate G2
acceptance suite. The baseline contains 20 multilingual fixtures, including vague,
unsupported, high-risk, sensitive, attachment, Memory and Blueprint injection cases.

`pnpm p3:gate` runs the full current Stage 3 quality gate: ProductFac isolation,
package dependency direction, open-source fixture hygiene, lint, typecheck, all
tests and all builds. `pnpm p3:e:gate` runs the focused P3-04 Task Context and
Patch Transaction gate. `pnpm p3:f:gate` runs the focused P3-05 Verification,
Repair and Rollback gate. `pnpm p3:g:gate` runs the focused P3-06 atomic
Checkpoint, Outbox and process-recovery gate.
`pnpm p3:h:gate` runs the focused P3-07 Development Web/CLI, model-setting,
Planning handoff, HTTP/SSE and accessibility gate.
`pnpm p3:i:gate` runs the complete P3-08 Gate G3 corpus, adversarial security
regression, strict MIT release-hygiene check, lint, typecheck, tests and builds.

The Stage 3 corpus lives under `fixtures/development-repositories`. Its fourteen
small repositories cover the twelve required repository and risk categories.
Every manifest pins its Envelope/document revisions, initial content hash,
deterministic model snapshot, permitted patch scope, forbidden behaviors,
verification commands, expected Evidence and G3 scenario mapping. Required CI
uses no model key, network model request or usage cost.

See `CHANGELOG.md`, `docs/release-policy.md`, `docs/known-limitations.md`, and
`examples/model-policy.example.json` before preparing a public release.

## Isolation boundary

- Runtime source imports only packages in this workspace and ordinary npm
  dependencies.
- No ProductFac package, source path, service, database, identity, Temporal worker,
  or environment variable is required.
- `pnpm isolation:check` rejects ProductFac package/path dependencies in runtime
  manifests and source imports.
- In-memory adapters remain available for tests. Planning and Development durable
  modes use integrity-checked atomic local Checkpoints; production databases or
  real AI models can be added later only through the existing ports.
- The durable local mode uses atomic JSON checkpoint replacement and an at-least-once
  Outbox. It remains a local development implementation, not a production database.

The stage documents and standalone ADRs are the design references. Where the
original stage 2 integration direction conflicts with them, ADR 008 and the stage
3 documents define the current standalone, open-source direction:

- `stage-2-planning-workflow-technical-architecture.md`
- `stage-2-planning-workflow-phased-development-plan.md`
- `stage-3-development-workflow-technical-architecture.md`
- `stage-3-development-workflow-phased-development-plan.md`
- `docs/adr/008-standalone-runtime-isolation.md`
- `docs/adr/009-local-checkpoints-and-outbox.md`
- `docs/adr/010-standalone-project-planning-web.md`
- `docs/adr/011-local-eval-and-context-security.md`
- `docs/adr/012-stage-3-open-source-and-model-access-boundary.md`
- `docs/adr/013-model-routing-snapshots-and-explicit-fallback.md`
- `docs/adr/014-development-domain-state-evidence-and-invalidation.md`
- `docs/adr/015-local-workspace-and-structured-tool-policy.md`
- `docs/adr/016-task-context-and-patch-transaction.md`
- `docs/adr/017-evidence-repair-and-guarded-rollback.md`
- `docs/adr/018-development-checkpoint-outbox-and-recovery.md`
- `docs/adr/019-development-web-cli-and-local-model-policy.md`
- `docs/adr/020-deterministic-g3-corpus-and-release-gate.md`
- `docs/adr/021-mit-license-and-release-governance.md`
- `docs/p2-07-gate-g2-report.md`
- `docs/p3-adr-index.md`
- `docs/p3-open-source-readiness.md`
- `docs/p3-00-gate-p3-a-report.md`
- `docs/p3-01-gate-p3-b-report.md`
- `docs/p3-02-gate-p3-c-report.md`
- `docs/p3-03-gate-p3-d-report.md`
- `docs/p3-04-gate-p3-e-report.md`
- `docs/p3-05-gate-p3-f-report.md`
- `docs/p3-06-gate-p3-g-report.md`
- `docs/p3-07-gate-p3-h-report.md`
- `docs/p3-08-gate-g3-report.md`
- `docs/github-publication-report.md`
