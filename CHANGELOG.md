# Changelog

All notable Sitepull releases are documented here.

## [0.2.0] - 2026-08-30

### Added

- Bounded page retries for transient navigation failures, including `Retry-After` handling, exponential backoff, and structured attempt evidence in manifests, logs, and AI context
- Capture-wide response-body controls with defaults of 25 MiB per resource, 512 MiB per capture, and three concurrent body reads; failed retry attempts release their provisional byte budget
- Desktop capture-health reporting for page coverage, resource body/HTTP status, extraction bounds, stylesheet access, retry recoveries, failed routes, and bounded URL decisions
- Searchable recent captures plus durable, complete capture recipes and **Capture Again** actions from history and result workspaces
- Main-process capture snapshots and sequence-aware renderer reconciliation on initial load and window focus
- Native packaged-application smoke tests for expected maker artifacts, hardened Electron fuses, embedded WebKit launch, and renderer startup on macOS, Linux, and Windows
- Quality- and metadata-gated tagged distribution with immutable action pins, exact release-asset checksum verification, and GitHub build-provenance attestations for native artifacts and `SHA256SUMS.txt`
- Ubuntu 24.04 DEB dependency metadata plus a pristine-container install and packaged-runtime probe
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

[0.2.0]: https://github.com/isaiahneal/sitepull/releases/tag/v0.2.0
[0.1.0]: https://github.com/isaiahneal/sitepull/releases/tag/v0.1.0
