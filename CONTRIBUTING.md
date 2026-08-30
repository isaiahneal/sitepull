# Contributing to Sitepull

Thanks for helping improve Sitepull. Bug reports, focused fixes, platform-packaging improvements, fixture cases, and evidence-based extraction enhancements are welcome.

## Development setup

Sitepull pins Node.js and pnpm versions in the repository. From the project root:

```bash
corepack enable
pnpm install
pnpm install:browsers
pnpm dev
```

## Before submitting a change

Run the relevant focused tests while iterating, then run the complete quality gate:

```bash
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test
pnpm test:integration
pnpm build:cli
pnpm build:desktop
```

Desktop distribution changes should also be exercised on the target operating system. Do not cross-package a release with a browser runtime downloaded for a different OS.

## Project boundaries

- Keep `packages/core` independent of Electron and React.
- Treat every crawled site, downloaded resource, manifest field, and persisted capture as untrusted input.
- Keep private-network access, authentication bypasses, CAPTCHAs, paywalls, and hidden-endpoint enumeration out of scope.
- Preserve deterministic evidence separately from inferred design/component labels.
- Add meaningful tests for behavior changes; avoid placeholder assertions.
- Do not present compiled browser output as a recovered original source repository.

For security-sensitive reports, use the private process described in [SECURITY.md](SECURITY.md), not a public issue.
