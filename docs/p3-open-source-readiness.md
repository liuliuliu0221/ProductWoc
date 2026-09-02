# P3 open-source readiness checklist

## Current P3-08 baseline

- [x] ProductFac runtime isolation is executable through `pnpm isolation:check`.
- [x] Stage 3 package dependency direction is executable through
  `pnpm architecture:check`.
- [x] Fixture personal-path and credential patterns are checked through
  `pnpm fixtures:check`.
- [x] GitHub CI runs the same `pnpm check` command used locally.
- [x] Contribution, security and conduct documents exist.
- [x] CI has read-only repository permissions and no deployment job.
- [x] Deterministic tests do not require a paid model.
- [x] Repository owner selected MIT and the repository includes `LICENSE`.
- [x] Issue and pull-request templates are ready.
- [x] Release policy and first public changelog are ready.
- [x] Known limitations and a credential-reference-only model example are ready.
- [x] Fourteen pinned repository fixtures cover all twelve required Eval categories.
- [x] Gate G3 security regressions block path, command, credential and deployment risks.
- [ ] GitHub private vulnerability reporting is enabled.
- [ ] A clean GitHub clone has passed `pnpm p3:i:gate` on Node.js 24.

## License decision

The repository owner selected the MIT License on 2026-09-02. The root package
metadata and contribution terms use the same identifier.

| Option | Advantages | Trade-off |
|---|---|---|
| MIT | Selected; short, familiar and permissive | No explicit patent grant |
| Apache-2.0 | Not selected | Explicit patent grant with longer notice obligations |

## Release-blocking checks

Before the first public release:

1. scan tracked files for credentials, private data and personal paths;
2. run `pnpm install --frozen-lockfile` and `pnpm check` in a clean clone;
3. verify that ProductFac, paid models and deployment services are not required;
4. publish supported platforms, known limitations and the security contact path.
