#!/usr/bin/env bash
set -euo pipefail

script_directory="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
readonly script_directory
repository_root="${SITEPULL_SOURCE_ROOT:-$(cd "${script_directory}/../.." && pwd -P)}"
readonly repository_root
readonly output_root="${1:-}"
readonly expected_node_version=24.20.0
readonly expected_pnpm_version=11.24.0

fail() {
  echo "Fedora payload builder: $1" >&2
  exit 1
}

[[ -n "${output_root}" ]] || fail 'usage: build-payload.sh <empty-output-directory>'
[[ "${output_root}" == /* ]] || fail 'the output directory must be an absolute path'
[[ "$(uname -s)" == Linux && "$(uname -m)" == x86_64 ]] ||
  fail 'the production payload must be built on Linux x86_64'
[[ "$(node --version)" == "v${expected_node_version}" ]] ||
  fail "Node ${expected_node_version} is required; found $(node --version)"
[[ "$(pnpm --version)" == "${expected_pnpm_version}" ]] ||
  fail "pnpm ${expected_pnpm_version} is required; found $(pnpm --version)"
[[ -r "${repository_root}/pnpm-lock.yaml" && -r "${repository_root}/package.json" ]] ||
  fail "${repository_root} is not a Sitepull source checkout"

if [[ -e "${output_root}" ]]; then
  [[ -d "${output_root}" ]] || fail "the output path is not a directory: ${output_root}"
  [[ -z "$(find "${output_root}" -mindepth 1 -print -quit)" ]] ||
    fail "the output directory is not empty: ${output_root}"
else
  mkdir -p "${output_root}"
fi

cd "${repository_root}"
export CI=true
export PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
export pnpm_config_verify_deps_before_run=false

pnpm install --frozen-lockfile --filter '@sitepull/cli...'
pnpm build:cli
pnpm \
  --config.inject-workspace-packages=true \
  --config.package-import-method=copy \
  --filter @sitepull/cli \
  deploy \
  --prod \
  "${output_root}"

install -m 0644 LICENSE "${output_root}/LICENSE"
test -x "${output_root}/dist/bin.js"
test -r "${output_root}/node_modules/playwright/package.json"

embedded_browser_directory="$({
  find "${output_root}" -type d \
    \( -name '.local-browsers' -o -name '.playwright-browsers' \) \
    -print -quit
} 2>/dev/null)"
[[ -z "${embedded_browser_directory}" ]] ||
  fail "the production payload contains an embedded browser: ${embedded_browser_directory}"

root_version="$(node -e 'const fs = require("node:fs"); process.stdout.write(JSON.parse(fs.readFileSync(process.argv[1], "utf8")).version);' "${repository_root}/package.json")"
cli_version="$(node -e 'const fs = require("node:fs"); process.stdout.write(JSON.parse(fs.readFileSync(process.argv[1], "utf8")).version);' "${repository_root}/apps/cli/package.json")"
payload_version="$(node -e 'const fs = require("node:fs"); process.stdout.write(JSON.parse(fs.readFileSync(process.argv[1], "utf8")).version);' "${output_root}/package.json")"
[[ "${root_version}" == "${cli_version}" && "${root_version}" == "${payload_version}" ]] ||
  fail "version mismatch: root=${root_version}, cli=${cli_version}, payload=${payload_version}"

actual_identity="$(node "${output_root}/dist/bin.js" --version)"
[[ "${actual_identity}" == "sitepull/${root_version} linux-x64 node-v${expected_node_version}" ]] ||
  fail "the deployed CLI reported an unexpected identity: ${actual_identity}"

echo "Fedora production payload ready: ${output_root}"
