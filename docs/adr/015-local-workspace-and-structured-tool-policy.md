# ADR 015: Local Workspace and structured tool policy

- Status: accepted for P3-03
- Date: 2026-08-29

## Context

The Development workflow needs to inspect and eventually change a user-owned
local project. Repository content, model output and project instructions are not
trusted authorization sources. A path string, symbolic link, command argument or
stale file hash must not let an Agent leave the Workspace, read credentials,
overwrite concurrent user changes or execute deployment and production actions.

## Decision

- File-system and process capabilities live in `development-adapters`; the
  Development domain remains independent from Node file-system, Git and process
  APIs.
- Workspace roots are canonicalized with `realpath`. Every requested path first
  passes a portable lexical policy that recognizes POSIX, drive-letter, UNC and
  backslash paths. Absolute paths, `..`, colon-based alternate streams, ignored
  segments and case-insensitive sensitive paths fail closed.
- `.env*`, SSH, cloud CLI, Kubernetes, GnuPG, credential, secret, PEM and key
  paths are denied. `.git`, package caches and generated-output directories are
  ignored. Symbolic links are never followed by Stage 3 tools.
- A Workspace Baseline records canonical root identity, safe file paths, sizes,
  content hashes, applicable `AGENTS.md` instruction hashes, policy settings and
  read-only Git Commit/Branch/Dirty paths. Sensitive or ignored Dirty paths are
  filtered again at the adapter boundary.
- Existing dirty files remain part of the user's pre-existing state. An update or
  delete needs the content hash returned by a prior read; a mismatch rejects the
  operation without writing. Delete also needs explicit confirmation. Writing
  `AGENTS.md`, `.agents`, `.codex` or `.git` policy locations is denied.
- Commands are selected only by registered template ID. Templates contain a fixed
  executable and fixed argv tokens. Requests cannot supply an executable, argv or
  Shell string, and the process always starts with `shell: false`.
- Lint, Typecheck, Test, Build and Format templates may run automatically.
  Dependency installation, delete/bulk operations and Git Commit/Tag/Push require
  an exact user confirmation. Token inspection enforces this even if a template
  is mislabeled.
- Network, deployment, publish/release, production write and credential actions
  are permanently denied. Destructive Git reset/clean/checkout/restore/rebase is
  denied regardless of the declared template kind or confirmation.
- Every operation emits a Tool Event containing policy version/decision identity,
  a redacted argument class and a bounded redacted result summary. Personal roots
  and credential-like values are rejected by the Tool Event contract itself.

## Consequences

P3-03 can inventory, read, search and conflict-check local text changes without
granting a model an arbitrary Shell or path capability. User edits are observable
and preserved when hashes diverge. Full atomic multi-file Patch Journal,
transaction rollback and recovery points remain P3-04/P3-05 concerns.
