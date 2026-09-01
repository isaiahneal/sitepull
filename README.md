# Sitepull

[![Quality](https://github.com/isaiahneal/sitepull/actions/workflows/quality.yml/badge.svg)](https://github.com/isaiahneal/sitepull/actions/workflows/quality.yml)
[![Distribution](https://github.com/isaiahneal/sitepull/actions/workflows/distribution.yml/badge.svg)](https://github.com/isaiahneal/sitepull/actions/workflows/distribution.yml)
[![Release](https://img.shields.io/github/v/release/isaiahneal/sitepull)](https://github.com/isaiahneal/sitepull/releases/latest)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

**Pull the web apart.** Sitepull is a desktop utility and headless CLI for macOS, Linux, and Windows. Give it a public website, and it uses a real browser to render the delivered implementation, crawl permitted routes, capture visual evidence, infer the design system, and produce an inspectable reference project for people and coding agents.

The output combines rendered HTML, semantic DOM summaries, delivered resources, responsive screenshots, computed design tokens, repeated component candidates, and a concise `AI_CONTEXT.md`. Export a compact AI Pack for ChatGPT, Codex, Claude, or another coding agent, or retain the Full Capture for deeper inspection.

> Sitepull captures and analyzes content delivered to a browser. It does not magically recover a website's private/original source repository.

![Sitepull desktop interface](docs/sitepull-desktop.png)

## Quick install

The release installer detects the supported operating system, version, and CPU architecture; selects the matching GitHub Release package; and verifies the package against the release's `SHA256SUMS.txt` before installing it.

macOS or Linux:

```bash
curl -fsSLo /tmp/sitepull-install.sh \
  https://github.com/isaiahneal/sitepull/releases/latest/download/sitepull-install.sh
sh /tmp/sitepull-install.sh
```

Minimal Alpine installations can use `wget` when `curl` is not installed:

```sh
wget -qO /tmp/sitepull-install.sh \
  https://github.com/isaiahneal/sitepull/releases/latest/download/sitepull-install.sh
sh /tmp/sitepull-install.sh
```

Windows PowerShell:

```powershell
irm https://github.com/isaiahneal/sitepull/releases/latest/download/sitepull-install.ps1 `
  -OutFile "$env:TEMP\sitepull-install.ps1"
powershell -NoProfile -ExecutionPolicy Bypass `
  -File "$env:TEMP\sitepull-install.ps1"
```

`ExecutionPolicy Bypass` applies only to that installer process; it does not change the machine's PowerShell policy. The quick installer installs the desktop application on macOS, Ubuntu, Debian, and Windows. On Fedora and Alpine it installs the native headless-only CLI globally as `sitepull`. Use `--dry-run` (PowerShell: `-DryRun`) to preview the exact selection without network or filesystem changes, or `--version 0.5.0` (PowerShell: `-Version 0.5.0`) to pin a release.

Prefer to install by hand? Every package, checksum, and provenance record remains available on the [GitHub Releases page](https://github.com/isaiahneal/sitepull/releases/latest). These are community builds without Apple Developer ID or Microsoft Authenticode signing; review [Distribution trust](#distribution-trust) for the operating-system prompts and verification options.

## Highlights

- Hydrated, rendered HTML and visible semantic elements with reconstruction-focused computed styles
- Bounded breadth-first route crawling from the rendered DOM, with same-origin enforcement and recorded skip reasons
- Up to three attempts for retryable navigation failures, with bounded backoff and per-attempt evidence in page manifests and logs
- Desktop and mobile viewport/full-page screenshots, plus an optional tablet preset
- Browser-delivered HTML, CSS, JavaScript, images, SVG, fonts, JSON, manifests, and icons
- Resource-body safety budgets of 25 MiB per response, 512 MiB per capture, and three concurrent body reads by default
- SHA-256 asset deduplication with source URLs, status, size, local path, and referencing pages
- Evidence-backed color, typography, spacing, radius, shadow, breakpoint, and CSS-variable analysis, including valid signed margins
- Deterministic repeated DOM/style signatures surfaced as inferred component candidates
- Capture-coverage reporting in both `AI_CONTEXT.md` and the desktop Overview, including failed pages, unavailable resources, and retry recoveries
- AI Pack and Full Capture ZIP exports from both the desktop app and the shared core engine
- A native desktop inspector with searchable history, saved capture recipes, **Capture Again**, and Overview, Pages, Design, Components, Assets, Files, and Logs workspaces
- A first-class, script-friendly CLI that is headless by default
- Single- or multi-proxy outbound routing with ordered or random selection, bounded jitter, and ephemeral Basic credentials
- A reproducible User-Agent string override through `--user-agent` or the desktop preset/custom picker

WebKit is the default and bundled desktop rendering engine. Chromium and Firefox are optional for CLI/source-development captures when their Playwright browser packages are installed. The Fedora and Alpine native CLI packages instead use each distribution's maintained Chromium headless shell; those packages are headless-only and support the Chromium engine only.

## Packages and platform support

Release packages are published on the [GitHub Releases page](https://github.com/isaiahneal/sitepull/releases):

- macOS 15+ Apple silicon (arm64): DMG and ZIP
- macOS 15+ Intel (x64): DMG and ZIP
- Ubuntu 24.04 x64: distribution-matched DEB
- Debian 12 and Debian 13 x64: distribution-matched DEBs
- Windows x64: Squirrel Setup executable and ZIP
- Fedora 44 x64: native headless CLI RPM
- Alpine 3.24 x64: native headless CLI APK and release signing key

Each desktop package contains its own Playwright WebKit runtime. Fedora and Alpine install `sitepull` globally at `/usr/bin/sitepull` and use the distribution's native Chromium headless-shell package, avoiding an unsupported Ubuntu/glibc browser transplant. Release artifacts are built and clean-install tested against their named operating system.

The community `v0.5.0` artifacts are not backed by Apple Developer ID, Microsoft Authenticode, or a persistent Linux repository key. See [Distribution trust](#distribution-trust) before installing a release artifact.

## Requirements

Packaged desktop builds include Node/Electron and the matching Playwright WebKit runtime. Source development requires:

- Node.js `24.20.0` (current LTS line used by this release)
- pnpm `11.24.0`
- macOS 15+, Windows x64, Ubuntu 24.04 x64, Debian 12 x64, or Debian 13 x64 for a packaged desktop build
- Fedora 44 x64 or Alpine 3.24 x64 for a native Chromium headless-shell CLI package
- Xcode Command Line Tools for local macOS DMG creation
- `fakeroot` for local Ubuntu or Debian DEB creation

Chromium and Firefox are optional CLI/development engines and require their corresponding Playwright browser packages.

### Native Fedora and Alpine CLI

On Fedora 44, download the RPM from the current release and install it with DNF:

```bash
sudo dnf install ./sitepull-cli-0.5.0-1.fc44.x86_64.rpm
sitepull pull example.com --headless --ai-pack --zip
```

On Alpine 3.24, download both the APK and its release-specific public key. From a root shell (for example, `su -`, or `doas` when configured), install the attested key before the signed package:

```bash
install -m 0644 sitepull-alpine-v0.5.0.rsa.pub /etc/apk/keys/
apk add ./sitepull-cli-0.5.0-r0.apk
```

Then run Sitepull as your regular user:

```bash
sitepull pull example.com --headless --ai-pack --zip
```

Both packages install Node.js 24 and the distribution-maintained Chromium headless shell through the native package manager, then place `sitepull` on the system `PATH`. They intentionally permit only `--engine chromium` and reject `--headed`; Playwright WebKit and Electron are not native to Alpine/musl, and Playwright's current WebKit build does not match Fedora 44's browser-library ABI.

The clean-install gates launch the shell as an unprivileged user and require the actual renderer process to add its own seccomp filter beyond the outer build container, enable the no-new-privileges boundary, and enter isolated PID, network, and user namespaces before attempting a live capture. They also require the GPU process to add its own seccomp filter, disable Chromium's GL implementation and 3D software rasterizer, and filter Playwright's unsafe SwiftShader opt-in. Alpine currently installs `chromium-swiftshader` as a dependency of its headless shell, but Sitepull does not select it at runtime and the native gate rejects any SwiftShader/ANGLE process argument. DOM, CSS, Canvas 2D, and normal screenshots remain available, but WebGL content is not rendered by these GPU-less native CLI packages. This keeps arbitrary captured pages away from Chromium's lower-security SwiftShader path without weakening the browser sandbox.

## Development from source

Sitepull development uses Node.js 24 LTS and pnpm 11:

```bash
git clone https://github.com/isaiahneal/sitepull.git
cd sitepull
corepack enable
pnpm install
pnpm install:browsers
```

Launch the desktop app:

```bash
pnpm dev
```

Build and install the global CLI command:

```bash
pnpm install:cli-global
sitepull --version
```

The installer first creates a complete, immutable versioned production CLI deployment in the operating system's per-user application-data directory and physically isolates it from pnpm's workspace and content store. On macOS and Linux it atomically points an idempotent `~/.local/bin/sitepull` link at that stable deployment; on Windows it atomically replaces a managed `sitepull.cmd` launcher in `%LOCALAPPDATA%\Microsoft\WindowsApps`, which is normally already on the per-user `PATH`. The command therefore survives moving or deleting the source checkout, rebuilding the checkout cannot mutate an installed version, and a failed cutover leaves the previous command intact. The installer refuses to overwrite unrelated commands and reports if the selected directory is missing from `PATH`; `SITEPULL_BIN_DIR` can select another command directory. Once that directory is on the shell path, `sitepull` is available in macOS Terminal, Ghostty, PowerShell, Windows Terminal, and other new shells without a repository-relative path.

## Intelligent URL input

You can enter or pass a bare host:

```bash
sitepull pull example.com
```

For a bare host, Sitepull infers HTTPS and tests it first. It retries over HTTP only when that inferred HTTPS transport fails. An explicitly supplied `https://` URL is never silently downgraded. The final resolved URL is recorded in capture metadata.

The desktop input follows the same rule.

## CLI

Typical capture:

```bash
sitepull pull example.com --ai-pack --zip
```

Explicit headless automation:

```bash
sitepull pull example.com \
  --headless \
  --output ./reference \
  --depth 2 \
  --max-pages 25 \
  --engine webkit \
  --viewports desktop,mobile \
  --ai-pack \
  --zip
```

Proxy pool with ordered rotation and bounded connection jitter:

```bash
sitepull pull example.com \
  --headless \
  --proxy http://proxy-a.example:8080 \
  --proxy https://proxy-b.example:8443 \
  --proxy-selection round-robin \
  --proxy-jitter 250:1250
```

Repeat `--proxy` to build a pool. Use `--proxy-selection random` for random selection; random mode may choose the same endpoint consecutively, while round-robin guarantees alternation. Selection and jitter apply to each new outbound connection, so browser keep-alive can carry multiple resources over one selected connection. Jitter is expressed as `minimum:maximum` milliseconds, defaults to `0:0`, and is bounded to 30 seconds.

Proxy URLs must be explicit `http://` or `https://` authority-only URLs. Sitepull rejects embedded credentials, paths, queries, fragments, SOCKS, PAC files, and implicit system proxy discovery. A configured pool is fail-closed: if its selected endpoint fails, Sitepull does not leak the request over the machine's direct connection.

For Basic authentication, keep secrets out of command arguments and literal shell-history entries. Number environment variables by the order of the repeated flags. This Bash/Zsh example reads one pair interactively without echoing the password:

```bash
printf 'Proxy 1 username: '
IFS= read -r SITEPULL_PROXY_1_USERNAME
printf 'Proxy 1 password: '
IFS= read -rs SITEPULL_PROXY_1_PASSWORD
printf '\n'
export SITEPULL_PROXY_1_USERNAME SITEPULL_PROXY_1_PASSWORD

sitepull pull example.com --proxy https://proxy-a.example:8443

unset SITEPULL_PROXY_1_USERNAME SITEPULL_PROXY_1_PASSWORD
```

Repeat the numbered pair for additional authenticated proxies. For one proxy, `SITEPULL_PROXY_USERNAME` and `SITEPULL_PROXY_PASSWORD` are aliases for the first pair. Both values are required together. Sitepull captures and removes the credential variables from its own process environment before launching the browser, and it never writes them to recipes, recents, manifests, logs, events, AI context, errors, or exports. The parent shell retains exported variables, so unset them after the command as shown.

Basic authentication is only Base64-encoded. Use an `https://` proxy endpoint whenever credentials are configured so the client-to-proxy hop is encrypted; an `http://` proxy exposes its Basic authorization header to observers on that network path.

Override the User-Agent string manually when a capture requires one:

```bash
sitepull pull example.com --user-agent 'Sitepull-Compatible-Browser/1.0'
```

This changes the request header and `navigator.userAgent`. It is not full browser fingerprint emulation: Chromium User-Agent Client Hints and other engine/platform surfaces remain separate.

Headless is the default. Use `--headed` when you intentionally want to watch the Playwright browser; `--headless` and `--headed` are mutually exclusive. The Fedora and Alpine native CLI packages are intentionally headless-only and reject `--headed`.

Available options:

| Option                     | Purpose                                               |
| -------------------------- | ----------------------------------------------------- |
| `-o, --output <directory>` | Output parent; defaults to `~/Sitepull`               |
| `-d, --depth <number>`     | Maximum route depth; defaults to `2`                  |
| `-p, --max-pages <number>` | Maximum pages; defaults to `25`                       |
| `--engine <engine>`        | `webkit`, `chromium`, or `firefox`                    |
| `--viewports <presets>`    | Comma-separated `desktop,mobile,tablet` presets       |
| `--include-subdomains`     | Permit subdomains of the source host                  |
| `--headless`               | Explicitly run without a visible browser; the default |
| `--headed`                 | Show the Playwright browser                           |
| `--timeout <seconds>`      | Per-page timeout; defaults to `30`                    |
| `--proxy <url>`            | HTTP(S) upstream proxy; repeat to create a pool       |
| `--proxy-selection <mode>` | `round-robin` or `random`; defaults to `round-robin`  |
| `--proxy-jitter <min:max>` | Per-connection delay range in milliseconds            |
| `--user-agent <value>`     | Override the browser User-Agent string                |
| `--zip`                    | Export a ZIP after capture                            |
| `--ai-pack`                | With `--zip`, export the compact AI Pack              |
| `--quiet`                  | Emit only the final artifact path                     |

Run `sitepull --help` for the complete command reference. Progress and summaries go to stderr while the final artifact path goes to stdout, making quiet mode suitable for scripts. Exit codes are `0` for success, `1` for capture failure, `2` for invalid usage, and `130` for cancellation.

## Desktop workflow

Run `pnpm dev`, enter a host or URL, adjust Advanced Settings if needed, and choose **Pull Site**. Sitepull reports real stage and counter events from the core engine rather than a simulated percentage. Cancellation stops the crawl and closes Playwright resources.

Sitepull saves the complete effective recipe for each new capture: normalized URL behavior, output parent, crawl settings, resource limits, viewport list, User-Agent string, and the non-secret proxy routing configuration. Recent captures are searchable by host or URL, and **Capture Again** preloads the exact saved recipe for review before starting a fresh timestamped capture. Proxy usernames and passwords are never saved and must be re-entered. The last-used recipe is restored on the new-capture screen; legacy `v0.1.0` history remains readable but has no invented recipe.

While the application process remains open, the renderer reconciles capture state with a bounded main-process event snapshot on load and when the window regains focus. Replayed and live events are merged by capture ID and sequence, closing UI delivery races without claiming that an interrupted capture can resume after the application quits.

The default desktop output parent is the platform Documents directory under `Sitepull`. A native folder picker can authorize another parent. Completed captures can be inspected across:

- **Overview** — capture health, retry recovery, HTTP/body resource gaps, element bounds, stylesheet access, screenshots, palette, typography, routes, candidates, and export estimates
- **Pages** — route browser with desktop/mobile and viewport/full-page toggles
- **Design** — colors, type, spacing, radii, shadows, and CSS variables
- **Components** — inferred repeated patterns with confidence and evidence
- **Assets** — categorized and filterable delivered resources
- **Files** — bounded, read-only project tree and text preview
- **Logs** — structured capture events and persisted logs

Recents are stored in the operating system's application-support directory. Missing or externally deleted captures degrade gracefully.

## Architecture

```text
sitepull/
├── apps/
│   ├── desktop/       Electron Forge + React/Vite desktop application
│   └── cli/           CAC-based `sitepull` command
├── packages/
│   ├── core/          Browser crawl, capture, analysis, project, and ZIP engine
│   └── contracts/     Shared strict Zod schemas and TypeScript contracts
├── fixtures/          Deterministic hydrated fixture website
└── tests/integration/ End-to-end browser crawl assertions
```

Both frontends invoke the same `@sitepull/core` engine. The core package has no Electron or React dependency. The Electron main process owns captures and filesystem access; the sandboxed renderer communicates through a narrow, contract-validated preload bridge.

## Capture output

Successful runs finalize atomically into a timestamped directory:

```text
example.com-2026-08-30T20-56-54Z-357710/
├── README.md
├── AI_CONTEXT.md
├── sitepull.json
├── manifest.json
├── pages/
│   └── home/
│       ├── rendered.html
│       ├── document.json
│       ├── elements.json
│       ├── links.json
│       ├── network.json
│       └── screenshots/
├── design/
├── assets/
├── raw/
└── logs/
```

Downloaded compiled JavaScript remains under `raw/javascript`; Sitepull never presents it as an original framework source tree. Explicitly referenced source maps may be captured. Sitepull does not guess hidden `.map` paths.

## AI Pack and Full Capture

**AI Pack** is a deliberately compact evidence set containing `AI_CONTEXT.md`, manifests, design analysis, rendered HTML, useful DOM summaries, screenshots, and selected visual assets. It excludes minified bundles, raw fonts, duplicate binaries, and verbose network logs. Near the top, `AI_CONTEXT.md` reports capture coverage: attempted and captured pages, retry recoveries, failed routes, captured and unavailable resources, and representative resource gaps. This makes partial evidence explicit before a coding agent treats the pack as complete.

**Full Capture** preserves every successfully captured project file, including raw delivered resources and structured logs. The AI Pack uses an explicit file allowlist; both modes estimate compressed size before export and create ZIPs without following links outside the capture root.

## Security model

Crawled websites are hostile input.

- Only the isolated Playwright browser executes target-site JavaScript. Captured code is never loaded into Sitepull's renderer.
- Electron uses `nodeIntegration: false`, context isolation, a sandboxed renderer, web security, restrictive CSP, disabled permissions, and denied webviews/navigation.
- The preload bridge exposes only typed Sitepull operations. Every IPC request/result is parsed with shared Zod contracts, and each sender is matched to the trusted main frame.
- The renderer cannot select arbitrary paths or invoke shell commands. Output parents are the default directory or explicitly authorized through a native picker.
- Canonical path containment rejects traversal and symbolic-link escapes. Text previews, project trees, and screenshot delivery are size-bounded.
- PNG screenshots are checked for valid dimensions and decoded-pixel limits both after capture and before renderer delivery.
- Browser HTTP(S)/WebSocket traffic and native source-map downloads resolve through Sitepull, reject non-public address sets, and pin the validated addresses into the actual upstream sockets. When a user proxy pool is configured, Sitepull sends only validated numeric destinations through the selected upstream and never falls back to direct egress. WebRTC and WebTransport are disabled; WebKit page workers are also disabled because their network transports do not obey an HTTP proxy.
- Crawling is same-origin by default. Subdomains require opt-in; authentication, CAPTCHA, paywall, and access-control bypasses are intentionally out of scope.

See [SECURITY.md](SECURITY.md) for vulnerability reporting.

## Development and quality gates

The repository pins Node `24.20.0` and pnpm `11.24.0` in `.node-version` and `package.json`; `pnpm-lock.yaml` freezes the resolved application and tool dependency graph.

```bash
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test
pnpm test:integration
pnpm build:cli
pnpm build:desktop
```

The deterministic fixture exercises hydrated SPA routes, lazy content, query bounding, origin enforcement, repeated cards, responsive CSS, signed margins, variables, local fonts, SVG and duplicate raster resources, source maps, screenshots, retry recovery and evidence, resource budgeting, project generation, AI coverage, HTTP fallback, and cancellation cleanup.

## Packaging

Install the workspace dependencies first. Packaging downloads an app-local WebKit bundle and embeds it in the desktop artifact.

```bash
# Unpacked application for the current platform
pnpm package:desktop

# Native distributables
pnpm make:mac
pnpm make:linux:ubuntu24
pnpm make:linux:debian12
pnpm make:linux:debian13
pnpm make:windows

# Native headless Linux CLI packages
scripts/build-fedora-cli-rpm.sh
scripts/smoke-fedora-cli-rpm.sh
scripts/build-alpine-cli-apk.sh
scripts/smoke-alpine-cli-apk.sh
```

The Fedora RPM and Alpine APK headless CLI builders use their target-specific scripts under `packaging/`. Fedora's production-only CLI closure is compiled on pinned Linux x64 Node/pnpm, proven free of native executables and embedded browsers inside Fedora 44, then assembled into the RPM there. Alpine builds its closure and signed APK inside Alpine 3.24. Both packages provide the global `/usr/bin/sitepull` launcher and use their distribution-maintained Chromium headless shell. Their effective-sandbox smoke scripts require a native x86_64 Docker engine because CPU emulation cannot validate Chromium's inner seccomp and namespace layers; Apple-silicon maintainers use the native x64 GitHub distribution job for release proof.

`pnpm make:linux` remains an alias for the Ubuntu 24.04 target. Run each Linux command on its named distribution: the build downloads that distribution's Playwright WebKit ABI and writes a uniquely revised DEB. Platform-specific unpacked build intermediates are also available through `pnpm package:mac`, `pnpm package:linux`, and `pnpm package:windows`. Forge writes output below `apps/desktop/out/`. Installing a Linux DEB safely establishes Electron's sandbox-helper ownership and permissions.

Build every desktop target on its native operating system and architecture. The repository's distribution workflow does exactly that on Apple-silicon and Intel macOS 15 runners, Ubuntu 24.04, Debian 12, Debian 13, and Windows. Distribution waits for the reusable quality workflow and verifies that a release tag exactly matches `package.json` plus a nonempty versioned release-notes file before any native build begins. External workflow actions and Linux build images are pinned to immutable identities. Each desktop runner verifies exact maker outputs, Electron fuse state, the packaged app's own Playwright module resolution, embedded WebKit launch, preload/IPC bridge, and renderer startup. macOS additionally verifies the bundle's internal ad-hoc signature consistency and the native architecture of both Electron and WebKit. The DEBs are clean-installed on their matching distributions, audited, and smoke-tested as unprivileged users. Fedora 44 and Alpine 3.24 independently assemble and clean-install their native CLI packages, verify global command and package identity, prove the live renderer's added seccomp filter plus PID/network/user namespace isolation, then complete a real one-page Sitepull capture through the sandboxed distro Chromium headless shell as an unprivileged user. Fedora additionally executes and audits its portable native-binary-free closure with Fedora Node before RPM construction. The release gate rejects a missing or extra package or installer before checksums, attestations, or publication.

## Distribution trust

Electron fuses harden every package. Local macOS packages are stripped of AppleDouble sidecars, re-signed ad hoc after fuse mutation, and verified for internal signature consistency both before and after DMG creation. The quick installer verifies that seal again before replacing an existing app. Ad-hoc signing is not an Apple Developer ID signature and cannot be notarized. The community artifacts do not claim hardened runtime, and Sitepull does not weaken the bundle with the disable-library-validation entitlement. A hardened-runtime, notarized macOS distribution requires an Apple Developer identity and notarization credentials.

Windows packages likewise require an Authenticode certificate for publisher trust, and Linux packages require a persistent repository/package-signing workflow for durable publisher trust. Those private credentials are intentionally absent from this public repository and its `v0.5.0` community builds. The Alpine APK is signed by a release-specific key published beside it; verify the key's checksum and GitHub provenance before installing it. That key authenticates the matching release artifact, but it is not a long-lived Alpine repository identity.

For tagged releases produced by the current workflow, GitHub Actions requires exactly fourteen native packages plus the two quick installers, generates `SHA256SUMS.txt`, verifies that it covers and matches all sixteen payloads before publication, and records Sigstore-backed SLSA provenance attestations for every release asset and for the checksum manifest itself. After downloading an asset, verify its provenance with GitHub CLI:

```bash
gh attestation verify ./Sitepull-0.5.0-arm64.dmg \
  --repo isaiahneal/sitepull \
  --signer-workflow isaiahneal/sitepull/.github/workflows/distribution.yml
```

An attestation proves which repository and workflow produced the exact bytes; it does not replace operating-system publisher signing or establish that the software is vulnerability-free.

## Known limitations

- Sitepull reconstructs public browser output; it cannot recover private repositories, server templates, unshipped assets, build configuration, or backend code.
- Cross-origin stylesheet rules can be opaque to in-page CSS inspection, although delivered stylesheets may still be captured as resources.
- Content behind login, anti-bot controls, CAPTCHAs, paywalls, or private-network hosts is currently intentionally unsupported.
- Proxy pools provide explicit egress routing and pacing, not challenge solving or access-control bypass. HTTP 403 responses remain terminal instead of causing automatic identity cycling.
- A custom User-Agent changes the string header and `navigator.userAgent`; it does not synchronize Chromium User-Agent Client Hints or create a complete browser/device fingerprint.
- Playwright WebKit is useful for Safari-adjacent behavior, but it is not the Safari application.
- Packaged desktop builds intentionally embed only WebKit; Chromium and Firefox remain optional CLI/source-development engines.
- Packaged Linux desktops are targeted and clean-install tested on Ubuntu 24.04, Debian 12, and Debian 13 x64. Use the DEB named for the installed distribution; their WebKit ABIs and package dependencies are intentionally distinct. A generic Linux desktop ZIP is not published because an archive cannot safely install Electron's root-owned setuid sandbox helper.
- Fedora 44 and Alpine 3.24 are supported by native x64 headless-only CLI packages backed by their maintained Chromium headless shells. They reject `--headed`, do not include the Electron desktop inspector, and do not claim WebKit/Safari fidelity or WebGL capture. Alpine's musl ABI cannot run the official Electron or Playwright WebKit binaries, while Fedora 44's ICU, JPEG, and media-library ABIs do not match Playwright's Ubuntu WebKit build.
- WebKit page workers are disabled during capture so worker-only WebTransport cannot bypass the validated HTTP proxy. Sites that require dedicated/shared workers for rendering may lose that worker-driven behavior; Chromium and Firefox instead use engine-level non-proxied transport restrictions.
- Node's system destination-DNS lookup has no hard cancellation API. Sitepull abandons an aborted request before opening a connection, but a stalled operating-system resolver call can delay final cleanup until that lookup returns.
- Resource-body capture defaults to 25 MiB per response, 512 MiB across the capture, and three concurrent body reads. Responses without a trustworthy content length still require one complete in-memory Playwright buffer before their actual size can be enforced.
- Responsive screenshots reuse one stabilized page and resize it through the configured viewports. DOM/computed-style evidence is extracted at the first configured viewport, so JavaScript or server behavior selected only during an initial viewport-specific load requires a separate capture.
- Component names and semantic design roles are deterministic inferences. Raw measurements, frequencies, routes, and signatures remain available for downstream judgment.
- Official publisher signing, macOS hardened runtime, and notarization are not configured for the public `v0.5.0` artifacts. GitHub attestations establish workflow provenance, not publisher identity.

## License

[MIT](LICENSE) © Isaiah Neal
