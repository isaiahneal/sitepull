# Chromium container sandbox profile

`seccomp_profile.json` is copied verbatim from Playwright v1.62.1's
[`utils/docker/seccomp_profile.json`](https://github.com/microsoft/playwright/blob/v1.62.1/utils/docker/seccomp_profile.json).
It is the Docker default seccomp policy with `clone`, `setns`, and `unshare`
allowed so Chromium can create its sandbox namespaces without disabling the
container's outer seccomp boundary.

Keep this profile pinned to the Playwright runtime version in `pnpm-lock.yaml`.
Playwright is Copyright (c) Microsoft Corporation and licensed under
Apache-2.0; the license is reproduced in `LICENSE.playwright`.
