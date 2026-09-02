# Contributing to ProductWoc

ProductWoc is a local-first project. Contributions must preserve its ability to
build, test and demonstrate the deterministic path without ProductFac, a hosted
service or a paid model.

## Development setup

Requirements:

- Node.js 24;
- pnpm 11.23.0.

Run:

```sh
pnpm install
pnpm check
```

## Change requirements

- Keep domain packages free of file-system, Shell, Git and model SDK concerns.
- Do not add deployment, production-write or implicit Git Push behavior.
- Never commit credentials, personal paths or private fixture data.
- Add tests and update contracts or ADRs when behavior or boundaries change.
- Keep model configuration capabilities equal for all users.
- Use deterministic providers and fixtures for required CI coverage.

Before opening a pull request, describe the affected milestone, security impact,
test evidence and any contract compatibility consideration.

## License

By contributing, you agree that your contributions are licensed under the
repository's MIT License. Do not submit code or assets that you do not have the
right to contribute under those terms.
