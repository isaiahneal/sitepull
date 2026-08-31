#!/usr/bin/env bash
set -Eeuo pipefail

fail() {
  echo "Fedora CLI smoke failed: $1" >&2
  exit 1
}

trap 'echo "Fedora CLI smoke failed at line ${LINENO}: ${BASH_COMMAND} (exit $?)." >&2' ERR

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

# `runuser` is test-harness tooling, not a Sitepull runtime dependency.
dnf install --assumeyes util-linux "${rpm_path}"
test "$(rpm -q --queryformat '%{VERSION}' sitepull-cli)" = "${expected_version}"
test "$(rpm -q --queryformat '%{RELEASE}' sitepull-cli)" = 1.fc44
test "$(rpm -q --queryformat '%{ARCH}' sitepull-cli)" = x86_64

requires="$(rpm -q --requires sitepull-cli)"
grep -Eq '^nodejs24 >= 1:24' <<<"${requires}"
grep -Eq '^nodejs24-bin >= 1:24' <<<"${requires}"
grep -Fxq chromium-headless <<<"${requires}"
grep -Fxq ca-certificates <<<"${requires}"
grep -Fxq google-noto-sans-vf-fonts <<<"${requires}"
grep -Fxq google-noto-color-emoji-fonts <<<"${requires}"

sitepull_command="$(command -v sitepull)" || fail 'the global sitepull command is unavailable'
canonical_sitepull_command="$(realpath "${sitepull_command}")" ||
  fail "the global sitepull command cannot be resolved: ${sitepull_command}"
canonical_sitepull_launcher="$(realpath /usr/bin/sitepull)" ||
  fail 'the installed /usr/bin/sitepull launcher cannot be resolved'
[[ "${canonical_sitepull_command}" == "${canonical_sitepull_launcher}" ]] ||
  fail "the global sitepull command resolves to ${canonical_sitepull_command}, not ${canonical_sitepull_launcher}"
test -x /usr/bin/sitepull
test -x /usr/lib64/chromium-browser/headless_shell
test -x /usr/bin/node
test -r /usr/lib/sitepull-cli/dist/bin.js
test -r /usr/lib/sitepull-cli/LICENSE
test ! -d /usr/lib/sitepull-cli/node_modules/playwright-core/.local-browsers
test -z "$(find /usr/lib/sitepull-cli/node_modules -type d -name prebuilds -print -quit)"
# The installed wrapper must contain this literal assignment.
# shellcheck disable=SC2016
grep -Fq 'SITEPULL_SYSTEM_CHROMIUM="${SITEPULL_CHROMIUM}"' /usr/bin/sitepull
grep -Fq 'SITEPULL_HEADLESS_ONLY=1' /usr/bin/sitepull
grep -Fq 'chromiumSandbox: true' /usr/lib/sitepull-cli/node_modules/@sitepull/core/dist/index.js
grep -Fq -- '--disable-software-rasterizer' \
  /usr/lib/sitepull-cli/node_modules/@sitepull/core/dist/index.js
grep -Fq -- '--use-gl=disabled' \
  /usr/lib/sitepull-cli/node_modules/@sitepull/core/dist/index.js
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
if sitepull pull example.com --headed --depth 0 --max-pages 1 --quiet >/tmp/sitepull-headed.stdout 2>/tmp/sitepull-headed.stderr; then
  fail 'the headless-only Fedora package accepted --headed'
fi
grep -Fqi 'headless-only' /tmp/sitepull-headed.stderr

readonly smoke_user=sitepull-smoke
useradd --create-home "${smoke_user}"
install -d -m 0700 -o "${smoke_user}" -g "${smoke_user}" "/tmp/${smoke_user}-runtime"

if ! runuser -u "${smoke_user}" -- env \
    HOME="/home/${smoke_user}" \
    XDG_RUNTIME_DIR="/tmp/${smoke_user}-runtime" \
    SITEPULL_CLI_ROOT=/usr/lib/sitepull-cli \
    SITEPULL_CHROMIUM=/usr/lib64/chromium-browser/headless_shell \
    node /workspace/packaging/chromium/assert-sandbox.mjs; then
  fail 'the installed Chromium sandbox is not fully active for the unprivileged CLI user'
fi

capture_stdout="$(mktemp /tmp/sitepull-fedora-capture-stdout.XXXXXX)"
capture_stderr="$(mktemp /tmp/sitepull-fedora-capture-stderr.XXXXXX)"
cleanup() {
  rm -f -- "${capture_stdout}" "${capture_stderr}"
}
trap cleanup EXIT

if ! runuser -u "${smoke_user}" -- env \
    HOME="/home/${smoke_user}" \
    XDG_RUNTIME_DIR="/tmp/${smoke_user}-runtime" \
    sitepull pull example.com \
      --headless \
      --depth 0 \
      --max-pages 1 \
      --viewports desktop \
      --output "/home/${smoke_user}/captures" \
      --quiet >"${capture_stdout}" 2>"${capture_stderr}"; then
  echo 'Fedora capture stderr:' >&2
  cat "${capture_stderr}" >&2
  while IFS= read -r -d '' log_file; do
    echo "Fedora retained capture log (${log_file}):" >&2
    cat "${log_file}" >&2
  done < <(find "/home/${smoke_user}/captures" -type f -path '*/logs/sitepull.jsonl' -print0 2>/dev/null)
  fail 'the unprivileged system-Chromium capture failed'
fi
capture_path="$(cat "${capture_stdout}")"

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

echo "Fedora CLI smoke passed with an effective Chromium sandbox: ${capture_path}"
