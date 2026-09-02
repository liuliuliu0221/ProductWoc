# Security Policy

## Supported versions

ProductWoc is pre-release software. Security fixes currently target the latest
revision only.

## Reporting a vulnerability

Do not publish credentials, private repository content or working exploit details
in a public Issue. Contact the repository owner through a private GitHub security
advisory when that feature is enabled. Until then, request a private reporting
channel without including the sensitive payload.

Include the affected revision, impact, reproduction boundary and a redacted proof
when possible. The maintainer should acknowledge a report before disclosing it or
setting a remediation timeline.

## Security boundary

ProductWoc is local-first and does not provide a remote deployment service. Model
endpoints are user configured. Development agents must not read credentials,
write outside the selected workspace, run arbitrary Shell commands, push Git
changes or perform production writes.
