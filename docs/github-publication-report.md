# GitHub publication report

- Date: 2026-09-03
- Repository: `https://github.com/liuliuliu0221/ProductWoc`
- Visibility: public
- Default branch: `main`
- License: MIT
- Initial commit: `99044c78d811c9a0d9c460e788fd1772e201af60`
- Verified publication commit: `1909323659d7009269b3218d8b61ae1626f94174`
- Clean-clone CI: `https://github.com/liuliuliu0221/ProductWoc/actions/runs/33665165575`

## Completed controls

- Published only reviewed source, tests, fixtures and governance documents.
- Excluded dependencies, build output, caches, local checkpoints, environment
  files and logs through `.gitignore`.
- Passed release-hygiene, ProductFac-isolation and fixture scans immediately
  before the initial commit.
- Enabled GitHub private vulnerability reporting.
- Added the private advisory URL to the security policy and Issue contact menu.
- Ran the checked-in CI from a clean checkout with Node.js 24 and pnpm 11.23.0.
- Kept Actions permissions read-only and added no deployment, package publication,
  production-write or Git Push job.
- Migrated CI to `actions/checkout@v7` and `pnpm/setup@v2`, whose official Action
  manifests use the Node.js 24 action runtime.

No Git tag or GitHub Release was created as part of repository publication.
