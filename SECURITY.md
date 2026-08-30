# Security

## Supported versions

Security fixes are applied to the latest Sitepull release.

## Reporting a vulnerability

Please do not open a public issue for a suspected vulnerability. Use GitHub's private vulnerability reporting flow for this repository and include the affected version, reproduction steps, impact, and any suggested mitigation.

Sitepull treats crawled websites as hostile input. Reports involving renderer isolation, IPC authorization, path containment, network-boundary bypasses, archive traversal, or execution of captured code are especially important.

Sitepull intentionally does not implement authentication, CAPTCHA, paywall, private-network, or access-control bypasses. Requests to add those capabilities are out of scope rather than security defects.
