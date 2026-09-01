# Security

## Supported versions

Security fixes are applied to the latest Sitepull release.

## Reporting a vulnerability

Please do not open a public issue for a suspected vulnerability. Use GitHub's private vulnerability reporting flow for this repository and include the affected version, reproduction steps, impact, and any suggested mitigation.

Sitepull treats crawled websites as hostile input. Reports involving renderer isolation, IPC authorization, path containment, network-boundary bypasses, archive traversal, or execution of captured code are especially important.

Sitepull intentionally does not implement authentication, CAPTCHA, paywall, private-network, or access-control bypasses. Requests to add those capabilities are out of scope rather than security defects.

Configured proxy pools are an explicit egress-routing and pacing feature. They do not weaken destination validation, retry HTTP 403 responses with a different identity, solve challenges, or claim to evade a site's access controls.

Proxy Basic authentication is Base64-encoded and is confidential in transit only when the proxy endpoint uses `https://`. Authenticated `http://` proxy connections expose their authorization header to observers on the client-to-proxy network path.
