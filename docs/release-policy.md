# Release policy

ProductWoc is released from reviewed commits after the deterministic local gate
passes. The project does not publish or deploy automatically.

## Versioning

- Before `1.0.0`, minor versions may contain contract changes documented in the changelog.
- Patch versions contain compatible fixes and documentation corrections.
- Every release records the supported Node and pnpm versions, known limitations,
  contract migrations and security-relevant changes.

## Release checklist

1. Confirm the selected license and update package metadata.
2. Run `pnpm install --frozen-lockfile` in a clean clone.
3. Run `pnpm p3:i:gate` without a paid model key or ProductFac checkout.
4. Review the changelog, known limitations and generated Gate G3 evidence.
5. Scan tracked files for credentials, private data and personal paths.
6. Create the Git tag and GitHub release manually after review.

GitHub Actions performs read-only CI only. It has no publish, deployment,
production-write, Git tag or Git Push step.
