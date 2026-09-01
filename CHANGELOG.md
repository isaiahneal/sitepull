# Changelog

All notable Sitepull releases are documented here.

## [0.5.0] - 2026-08-31

### Added

- First-class HTTP and HTTPS upstream proxy routing in both the headless CLI and desktop app, including ordered proxy pools, random selection, and bounded connection jitter
- Repeatable `--proxy` flags with secret-safe environment-variable authentication, plus matching desktop proxy rows whose credentials exist only for the current capture/retry session
- A `--user-agent` CLI override and desktop User-Agent preset/custom picker, persisted with the effective capture recipe for exact **Capture Again** behavior

### Security

- Sitepull keeps its validated loopback policy proxy in front of every configured upstream: destinations are still resolved locally, private or mixed address sets are rejected, and only pinned numeric destinations are sent through the selected proxy
- Explicit source-map downloads use the same selected upstream path, preventing a proxy-enabled capture from leaking that secondary traffic over a direct connection
- Proxy authentication is added only to the outer proxy hop and is excluded from capture recipes, recents, manifests, logs, events, errors, AI context, and exported archives
- Upstream failures are fail-closed and never fall back to the machine's direct connection; proxy failures also cannot trigger the inferred HTTPS-to-HTTP retry

### Changed

- Capture metadata and manifests now identify schema version 2 while the v0.5 parser continues to accept version 1 captures
- Proxy rotation is defined per new outbound connection. Round-robin guarantees ordered selection; random mode may select the same proxy consecutively, and jitter is abortable and bounded from 0 to 30 seconds
- A User-Agent override changes the HTTP header and `navigator.userAgent`; it is not presented as full browser fingerprint emulation because Chromium User-Agent Client Hints remain a separate identity surface

### Compatibility

- Proxy endpoints support explicit `http://` and `https://` forward proxies with optional Basic authentication. Embedded credentials, PAC/system proxy discovery, SOCKS, remote target DNS, paths, queries, and fragments are rejected
- The existing macOS, Ubuntu, Debian, Windows, Fedora, and Alpine release matrix remains unchanged

## [0.4.1] - 2026-08-31

### Added

- First-party macOS/Linux shell and Windows PowerShell installers that detect the supported operating system and architecture, select the matching GitHub Release package, and verify it against `SHA256SUMS.txt` before installation
- Dry-run and explicit-version modes for reviewing or automating the exact package selection without downloading or changing the machine

### Changed

- GitHub setup now starts with two short, copyable quick-install commands instead of requiring users to identify and install release assets manually
- The release gate now checks, hashes, provenance-attests, uploads, and remotely verifies the two installer entry points alongside the fourteen native artifacts

### Fixed

- macOS packaging now removes AppleDouble sidecars before the final ad-hoc seal, then mounts and strictly verifies the finished DMG so a maker cannot omit a sealed sidecar and leave the distributed app with an invalid resource envelope
- The macOS quick installer verifies the in-image and staged application seals before replacement and restores the previous app after a failed or interrupted cutover

### Compatibility

- The installer covers macOS 15+ on Apple silicon and Intel, Ubuntu 24.04 x64, Debian 12/13 x64, Fedora 44 x64, Alpine 3.24 x64, and Windows x64; unsupported operating-system versions and architectures fail with an explicit compatibility message

## [0.4.0] - 2026-08-31

### Added

- Native Fedora 44 x64 RPM and Alpine 3.24 x64 APK packages for the headless CLI, each installing the global `/usr/bin/sitepull` command and using the distribution-maintained Chromium headless shell
- A controlled system-Chromium runtime path with an absolute executable check, Chromium-only and headless-only package policy, and OS browser sandbox enforcement
- Clean-install Fedora and Alpine gates that verify native package identity, Node/Chromium dependencies, global command resolution, the renderer's added seccomp filter and PID/network/user namespace isolation, and a real one-page Sitepull capture
- A release-specific Alpine APK signing key published and attested beside the signed package

### Changed

- The tagged release gate now requires an exact fourteen-file native/package asset manifest before generating checksums, provenance attestations, or the public release
- New commits and tags use the `isaiahneal` GitHub noreply identity; the public repository, remotes, Actions, metadata, and release links remain under `isaiahneal/sitepull`

### Fixed

- Per-user global CLI deployments are now physically copied out of pnpm's workspace deployment, kept immutable by version, and selected through an atomic command cutover, so a later source build or failed upgrade cannot alter or strand an installed version
- Oversized Playwright and browser-process diagnostics are now bounded only when serialized into capture evidence, preserving useful head-and-tail context without allowing a schema error to hide the original capture failure
- Fedora and Alpine now use their distro-maintained Chromium headless shells, keeping Alpine's full-browser GPU sandbox-policy mismatch out of the capture path without disabling the GPU or seccomp sandboxes
- Headless system-Chromium captures now avoid the unstable and lower-security SwiftShader 3D software-rendering path while retaining sandboxed DOM, CSS, Canvas 2D, and screenshot capture on Fedora and Alpine

### Compatibility

- Packaged support now covers macOS 15+ on Apple silicon and Intel, Ubuntu 24.04 x64, Debian 12/13 x64, Fedora 44 x64, Alpine 3.24 x64, and Windows x64
- Fedora and Alpine receive native headless-only CLI packages with Chromium rather than desktop/WebKit packages: Alpine's musl ABI cannot run official Electron or Playwright WebKit binaries, and Fedora 44 does not match Playwright's Ubuntu WebKit library ABI

## [0.3.1] - 2026-08-31

### Fixed

- Linux release filenames are now canonicalized before checksum generation and attestation, so GitHub's asset-name normalization cannot make `SHA256SUMS.txt` reference a different basename from the file users download
- Distribution-specific DEBs retain their precise internal `1~ubuntu24.04`, `1~debian12`, and `1~debian13` package revisions while using GitHub-safe dotted release asset names

## [0.3.0] - 2026-08-31

### Added

- Native macOS 15 Intel x64 DMG and ZIP artifacts alongside the existing Apple-silicon build
- Distribution-matched Debian 12 and Debian 13 x64 DEBs with their own embedded Playwright WebKit runtimes and dependency closures
- Clean-install Debian gates that audit package identity, Electron and GTK/WPE WebKit dependencies, the root-owned setuid sandbox helper, and a full unprivileged packaged runtime smoke test
- Native architecture verification for packaged macOS Electron and WebKit binaries

### Changed

- Ubuntu, Debian 12, and Debian 13 packages now carry distinct Debian revisions so their release filenames and ABI requirements cannot be confused
- The release workflow requires an exact eleven-file native asset manifest before producing checksums, provenance attestations, or the GitHub release
- macOS DMGs now include the application version and architecture in their filenames

### Compatibility

- Packaged desktop support now covers macOS 15+ on Apple silicon and Intel, Ubuntu 24.04 x64, Debian 12/13 x64, and Windows x64
- Generic Linux archives, RPMs, Alpine/musl packages, and universal macOS bundles remain intentionally excluded because they cannot preserve Sitepull's tested browser ABI and sandbox guarantees

## [0.2.0] - 2026-08-30

### Added

- Bounded page retries for transient navigation failures, including `Retry-After` handling, exponential backoff, and structured attempt evidence in manifests, logs, and AI context
- Capture-wide response-body controls with defaults of 25 MiB per resource, 512 MiB per capture, and three concurrent body reads; failed retry attempts release their provisional byte budget
- Desktop capture-health reporting for page coverage, resource body/HTTP status, extraction bounds, stylesheet access, retry recoveries, failed routes, and bounded URL decisions
- Searchable recent captures plus durable, complete capture recipes and **Capture Again** actions from history and result workspaces
- Main-process capture snapshots and sequence-aware renderer reconciliation on initial load and window focus
- Native packaged-application smoke tests for expected maker artifacts, hardened Electron fuses, embedded WebKit launch, and renderer startup on macOS, Linux, and Windows
- Quality- and metadata-gated tagged distribution with immutable action pins, exact release-asset checksum verification, and GitHub build-provenance attestations for native artifacts and `SHA256SUMS.txt`
- Ubuntu 24.04 DEB dependency metadata, a native installed-package runtime smoke test, and an independent pristine-container install and layout audit
- A durable versioned per-user CLI deployment behind the global `sitepull` command instead of a checkout-bound link

### Changed

- `AI_CONTEXT.md` now surfaces explicit capture coverage near the top and records resource-budget settings, failed routes, unavailable resources, retry recovery, and per-page attempt counts
- The desktop new-capture screen restores the last effective recipe, while each new recent entry retains the normalized URL behavior, output parent, crawl configuration, limits, and viewports used
- The shared runtime version is centralized so CLI output and generated capture metadata report `0.2.0` consistently
- Linux desktop distribution is limited to the Ubuntu 24.04 DEB so installation can preserve Electron's root-owned setuid sandbox helper; an unsafe generic archive is not published

### Fixed

- Preserve valid negative CSS margins as signed spacing evidence while retaining nonnegative validation for radii and non-margin spacing domains
- Prevent transient failed attempts from committing partial page resources or permanently consuming the capture-wide byte budget
- Keep HTTP 4xx documents out of design evidence, clean partial screenshots after terminal page failure, and retain structured route status evidence
- Validate every explicit source-map redirect, stream it through the same capture budget, and block bracketed or IPv4-mapped private IPv6 literals
- Pin validated DNS results into browser and source-map sockets, and disable non-proxied WebRTC/WebTransport paths, including WebKit workers

### Compatibility

- Existing `v0.1.0` capture manifests and recent-history files remain readable; missing retry evidence and capture recipes are represented as legacy omissions rather than synthesized data

## [0.1.0] - 2026-08-30

### Added

- Shared, Electron-independent Playwright capture engine with WebKit as the default renderer
- Bounded hydrated-route crawling, public-network enforcement, lazy-content stabilization, and cancellation
- Rendered DOM, computed visual evidence, deduplicated resources, responsive screenshots, and structured logs
- Deterministic design-system analysis and repeated component candidate detection
- Evidence-based `AI_CONTEXT.md`, compact AI Pack ZIP, and Full Capture ZIP exports
- Hardened cross-platform Electron workspace with typed Zod IPC, sandboxed renderer, recents, bounded file/screenshot previews, and native file-browser actions
- Native macOS DMG/ZIP, Linux DEB/RPM/ZIP, and Windows Squirrel/ZIP packaging with embedded platform WebKit runtimes
- First-class global `sitepull` CLI with an explicit `--headless` mode, polished progress, script-friendly quiet mode, and stable exit codes
- Bare-host input with HTTPS-first resolution and a guarded HTTP fallback only for protocol-inferred URLs
- PNG dimension and decoded-pixel enforcement at capture time and again before desktop rendering
- Deterministic fixture site plus unit, integration, packaging, and real-browser acceptance coverage

[0.5.0]: https://github.com/isaiahneal/sitepull/releases/tag/v0.5.0
[0.4.1]: https://github.com/isaiahneal/sitepull/releases/tag/v0.4.1
[0.4.0]: https://github.com/isaiahneal/sitepull/releases/tag/v0.4.0
[0.3.1]: https://github.com/isaiahneal/sitepull/releases/tag/v0.3.1
[0.3.0]: https://github.com/isaiahneal/sitepull/releases/tag/v0.3.0
[0.2.0]: https://github.com/isaiahneal/sitepull/releases/tag/v0.2.0
[0.1.0]: https://github.com/isaiahneal/sitepull/releases/tag/v0.1.0
