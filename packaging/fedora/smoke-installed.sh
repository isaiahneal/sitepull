#!/usr/bin/env bash
set -euo pipefail

readonly rpm_path="${1:-/package/sitepull-cli.rpm}"
readonly expected_fedora_version=44
readonly expected_arch=x86_64

# shellcheck disable=SC1091
source /etc/os-release
if [[ "${ID:-}" != fedora || "${VERSION_ID:-}" != "${expected_fedora_version}" ]]; then
  echo "Fedora smoke: expected Fedora ${expected_fedora_version}, found ${PRETTY_NAME:-unknown}." >&2
  exit 1
fi
if [[ "$(uname -m)" != "${expected_arch}" ]]; then
  echo "Fedora smoke: expected ${expected_arch}, found $(uname -m)." >&2
  exit 1
fi
if [[ ! -f "${rpm_path}" ]]; then
  echo "Fedora smoke: RPM not found at ${rpm_path}." >&2
  exit 1
fi

test "$(rpm -qp --queryformat '%{NAME}' "${rpm_path}")" = sitepull-cli
test "$(rpm -qp --queryformat '%{RELEASE}' "${rpm_path}")" = 1.fc44
test "$(rpm -qp --queryformat '%{ARCH}' "${rpm_path}")" = x86_64
expected_version="$(rpm -qp --queryformat '%{VERSION}' "${rpm_path}")"

dnf install --assumeyes "${rpm_path}"
test "$(rpm -q --queryformat '%{VERSION}' sitepull-cli)" = "${expected_version}"
test "$(rpm -q --queryformat '%{RELEASE}' sitepull-cli)" = 1.fc44
test "$(rpm -q --queryformat '%{ARCH}' sitepull-cli)" = x86_64

requires="$(rpm -q --requires sitepull-cli)"
grep -Eq '^nodejs24 >= 1:24' <<<"${requires}"
grep -Eq '^nodejs24-bin >= 1:24' <<<"${requires}"
grep -Fxq chromium <<<"${requires}"
grep -Fxq ca-certificates <<<"${requires}"
grep -Fxq google-noto-sans-vf-fonts <<<"${requires}"
grep -Fxq google-noto-color-emoji-fonts <<<"${requires}"

test "$(command -v sitepull)" = /usr/bin/sitepull
test -x /usr/bin/sitepull
test -x /usr/bin/chromium-browser
test -x /usr/bin/node
test -r /usr/lib/sitepull-cli/dist/bin.js
test -r /usr/lib/sitepull-cli/LICENSE
test ! -d /usr/lib/sitepull-cli/node_modules/playwright-core/.local-browsers
test -z "$(find /usr/lib/sitepull-cli/node_modules -type d -name prebuilds -print -quit)"
# The installed wrapper must contain this literal assignment.
# shellcheck disable=SC2016
grep -Fq 'SITEPULL_SYSTEM_CHROMIUM="${SITEPULL_CHROMIUM}"' /usr/bin/sitepull
grep -Fq 'chromiumSandbox: true' /usr/lib/sitepull-cli/node_modules/@sitepull/core/dist/index.js
rpm --verify sitepull-cli

version_output="$(sitepull --version)"
if [[ "${version_output}" != "sitepull/${expected_version} linux-x64 node-v"* ]]; then
  echo "Fedora smoke: installed CLI reported an unexpected identity: ${version_output}." >&2
  exit 1
fi
if sitepull pull example.com --engine webkit --depth 0 --max-pages 1 --quiet >/tmp/sitepull-wrong-engine.stdout 2>/tmp/sitepull-wrong-engine.stderr; then
  echo 'Fedora smoke: the Chromium-only package accepted WebKit.' >&2
  exit 1
fi
grep -Fqi 'supports chromium only' /tmp/sitepull-wrong-engine.stderr

readonly smoke_user=sitepull-smoke
useradd --create-home "${smoke_user}"
install -d -m 0700 -o "${smoke_user}" -g "${smoke_user}" "/tmp/${smoke_user}-runtime"
capture_path="$(
  runuser -u "${smoke_user}" -- env \
    HOME="/home/${smoke_user}" \
    XDG_RUNTIME_DIR="/tmp/${smoke_user}-runtime" \
    sitepull pull example.com \
      --headless \
      --depth 0 \
      --max-pages 1 \
      --viewports desktop \
      --output "/home/${smoke_user}/captures" \
      --quiet
)"

test -d "${capture_path}"
test -r "${capture_path}/manifest.json"
# The JavaScript template literals are evaluated by Node.
# shellcheck disable=SC2016
runuser -u "${smoke_user}" -- \
  node -e '
    const fs = require("node:fs");
    const manifest = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    if (manifest.status !== "completed") throw new Error(`status=${manifest.status}`);
    if (manifest.config?.engine !== "chromium") throw new Error(`engine=${manifest.config?.engine}`);
    if (manifest.summary?.counts?.pages !== 1) {
      throw new Error(`pages=${manifest.summary?.counts?.pages}`);
    }
    if (manifest.source?.normalizedUrl !== "https://example.com/") {
      throw new Error(`url=${manifest.source?.normalizedUrl}`);
    }
  ' "${capture_path}/manifest.json"

echo "Fedora CLI smoke passed: ${capture_path}"
