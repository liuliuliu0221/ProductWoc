# ADR 021: MIT license and release governance

- Status: accepted for P3-08
- Date: 2026-09-02

## Context

ProductWoc is intended to be a standalone open-source developer tool. Source
availability alone does not grant reuse rights, so the first public repository
requires an explicit OSI-approved license and consistent contribution terms.
The project also intentionally excludes automatic remote deployment and release
publication.

## Decision

- License ProductWoc under the MIT License, with copyright attributed to
  ProductWoc Contributors.
- Use `MIT` in root package metadata and require contributions to be provided
  under the same terms.
- Keep releases maintainer-reviewed and manually initiated. GitHub Actions may
  perform read-only CI but must not publish packages, create tags, push changes,
  deploy services or write to production systems.
- Require the strict release-hygiene check as part of `pnpm check` and Gate P3-I.
- Document security reporting, limitations and release changes alongside each
  public release.

## Consequences

Users may use, copy, modify and redistribute the project under the MIT terms.
Unlike Apache-2.0, MIT does not contain an explicit patent grant; that trade-off
was accepted by the repository owner. Public release still requires a successful
clean-clone Gate and repository-level security settings after GitHub creation.
