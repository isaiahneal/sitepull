#!/bin/sh

set -eu

fail() {
  printf 'Alpine APK audit failed: %s\n' "$1" >&2
  exit 1
}

[ "$#" -eq 3 ] || fail 'usage: audit-apk.sh <apk> <public-key> <version>'
[ "$(id -u)" -eq 0 ] || fail 'the clean-install audit must run as root'

apk_path="$(realpath "$1")"
public_key_path="$(realpath "$2")"
expected_version="$3"
expected_apk_name="sitepull-cli-$expected_version-r0.apk"
expected_key_name="sitepull-alpine-v$expected_version.rsa.pub"
expected_packager='Isaiah Neal <70036686+isaiahneal@users.noreply.github.com>'

[ "$(basename "$apk_path")" = "$expected_apk_name" ] ||
  fail "unexpected APK name: $(basename "$apk_path")"
[ "$(basename "$public_key_path")" = "$expected_key_name" ] ||
  fail "unexpected public-key name: $(basename "$public_key_path")"
[ -s "$apk_path" ] || fail 'APK is missing or empty'
[ -s "$public_key_path" ] || fail 'public key is missing or empty'
actual_packager="$(
  tar -xOf "$apk_path" .PKGINFO 2>/dev/null |
    awk -F' = ' '$1 == "packager" { print $2 }'
)"
[ "$actual_packager" = "$expected_packager" ] ||
  fail "unexpected APK packager: $actual_packager"
tar -xOf "$apk_path" .PKGINFO 2>/dev/null |
  grep -Fxq 'depend = chromium-headless-shell' ||
  fail 'APK metadata does not require the Alpine Chromium headless shell'

alpine_release="$(cut -d. -f1,2 /etc/alpine-release 2>/dev/null || true)"
[ "$alpine_release" = '3.24' ] || fail 'this audit must run on Alpine 3.24'
[ "$(uname -m)" = 'x86_64' ] || fail 'this audit must run natively on x86_64'

trusted_key="/etc/apk/keys/$expected_key_name"
install -m644 "$public_key_path" "$trusted_key"
apk verify "$apk_path"
apk add --no-cache "$apk_path"

apk info --exists sitepull-cli
installed_version="$(
  apk query --from installed --fields version sitepull-cli |
    awk -F': ' '$1 == "Version" { print $2 }'
)"
[ "$installed_version" = "$expected_version-r0" ] ||
  fail "expected package version $expected_version-r0, installed $installed_version"

sitepull_command="$(command -v sitepull)" || fail 'the global sitepull command is unavailable'
canonical_sitepull_command="$(realpath "$sitepull_command")" ||
  fail "the global sitepull command cannot be resolved: $sitepull_command"
canonical_sitepull_launcher="$(realpath /usr/bin/sitepull)" ||
  fail 'the installed /usr/bin/sitepull launcher cannot be resolved'
[ "$canonical_sitepull_command" = "$canonical_sitepull_launcher" ] ||
  fail "the global sitepull command resolves to $canonical_sitepull_command, not $canonical_sitepull_launcher"
[ "$(stat -c '%u:%g:%a' /usr/bin/sitepull)" = '0:0:755' ] ||
  fail 'global launcher must be root-owned mode 755'
grep -Fqx 'export SITEPULL_SYSTEM_CHROMIUM=/usr/bin/chromium-headless-shell' /usr/bin/sitepull ||
  fail 'global launcher does not select the Alpine Chromium headless shell'
grep -Fqx 'export SITEPULL_HEADLESS_ONLY=1' /usr/bin/sitepull ||
  fail 'global launcher does not enforce headless-only operation'
[ -x /usr/bin/chromium-headless-shell ] || fail 'Alpine Chromium headless shell is unavailable'
apk info --exists chromium-headless-shell || fail 'Alpine Chromium headless shell package is unavailable'
[ -r /usr/lib/sitepull-cli/node_modules/@sitepull/core/dist/index.js ] ||
  fail 'deployed Sitepull core is unavailable'
grep -Fq 'chromiumSandbox: true' \
  /usr/lib/sitepull-cli/node_modules/@sitepull/core/dist/index.js ||
  fail 'deployed Chromium launch policy does not require its sandbox'
grep -Fq -- '--disable-software-rasterizer' \
  /usr/lib/sitepull-cli/node_modules/@sitepull/core/dist/index.js ||
  fail 'deployed Chromium launch policy does not disable unsafe 3D software rendering'
grep -Fq -- '--use-gl=disabled' \
  /usr/lib/sitepull-cli/node_modules/@sitepull/core/dist/index.js ||
  fail 'deployed Chromium launch policy does not disable its GL implementation'
embedded_browser_directory="$(
  find /usr/lib/sitepull-cli -type d \
    \( -name '.local-browsers' -o -name '.playwright-browsers' \) \
    -print -quit
)"
[ -z "$embedded_browser_directory" ] ||
  fail "installed payload contains an embedded browser: $embedded_browser_directory"

node_major="$(node -p "process.versions.node.split('.')[0]")"
[ "$node_major" -ge 24 ] || fail "Node.js 24 or newer is required, found $(node --version)"
sitepull_version="$(sitepull --version)"
case "$sitepull_version" in
  "sitepull/$expected_version linux-x64 node-v"*) ;;
  *) fail "unexpected CLI version output: $sitepull_version" ;;
esac

smoke_user='sitepull-smoke'
smoke_home="/home/$smoke_user"
runtime_dir="/tmp/$smoke_user-runtime"
capture_root="$(mktemp -d /tmp/sitepull-alpine-capture.XXXXXX)"
cleanup() {
  rm -rf -- "$capture_root"
}
trap cleanup EXIT HUP INT TERM

adduser -D -h "$smoke_home" "$smoke_user"
install -d -m700 -o "$smoke_user" -g "$smoke_user" "$runtime_dir"
chown "$smoke_user:$smoke_user" "$capture_root"

if ! su "$smoke_user" -s /bin/sh -c \
  "HOME='$smoke_home' XDG_RUNTIME_DIR='$runtime_dir' SITEPULL_CLI_ROOT=/usr/lib/sitepull-cli SITEPULL_CHROMIUM=/usr/bin/chromium-headless-shell node /workspace/packaging/chromium/assert-sandbox.mjs"; then
  fail 'the installed Chromium sandbox is not fully active for the unprivileged CLI user'
fi

if su "$smoke_user" -s /bin/sh -c \
  "HOME='$smoke_home' XDG_RUNTIME_DIR='$runtime_dir' sitepull pull example.com --engine webkit --depth 0 --max-pages 1 --output '$capture_root' --quiet" \
  >"$capture_root/wrong-engine.stdout" 2>"$capture_root/wrong-engine.stderr"; then
  fail 'the Chromium-only Alpine package accepted WebKit'
fi
grep -Fqi 'supports chromium only' "$capture_root/wrong-engine.stderr" ||
  fail 'the unsupported-engine error was not actionable'

if su "$smoke_user" -s /bin/sh -c \
  "HOME='$smoke_home' XDG_RUNTIME_DIR='$runtime_dir' sitepull pull example.com --headed --depth 0 --max-pages 1 --output '$capture_root' --quiet" \
  >"$capture_root/headed.stdout" 2>"$capture_root/headed.stderr"; then
  fail 'the headless-only Alpine package accepted --headed'
fi
grep -Fqi 'headless-only' "$capture_root/headed.stderr" ||
  fail 'the unsupported-headed error was not actionable'

capture_stdout="$capture_root/capture.stdout"
capture_stderr="$capture_root/capture.stderr"
if ! su "$smoke_user" -s /bin/sh -c \
  "HOME='$smoke_home' XDG_RUNTIME_DIR='$runtime_dir' sitepull pull example.com --headless --depth 0 --max-pages 1 --viewports desktop --output '$capture_root' --quiet" \
  >"$capture_stdout" 2>"$capture_stderr"; then
  printf '%s\n' 'Alpine capture stderr:' >&2
  cat "$capture_stderr" >&2
  for log_file in "$capture_root"/*/logs/sitepull.jsonl; do
    [ -f "$log_file" ] || continue
    printf 'Alpine retained capture log (%s):\n' "$log_file" >&2
    cat "$log_file" >&2
  done
  fail 'the unprivileged system-Chromium capture failed'
fi
capture_path="$(cat "$capture_stdout")"

case "$capture_path" in
  "$capture_root"/*) ;;
  *) fail "capture escaped its authorized output root: $capture_path" ;;
esac
[ -s "$capture_path/manifest.json" ] || fail 'capture manifest is missing'
[ -s "$capture_path/AI_CONTEXT.md" ] || fail 'capture AI context is missing'

# The JavaScript template literals are intentionally single-quoted for the shell.
# shellcheck disable=SC2016
node -e '
  const fs = require("node:fs");
  const manifest = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  if (manifest.status !== "completed") throw new Error(`capture status: ${manifest.status}`);
  if (manifest.summary.status !== "completed") {
    throw new Error(`capture summary status: ${manifest.summary.status}`);
  }
  if (manifest.config.engine !== "chromium") throw new Error(`engine: ${manifest.config.engine}`);
  if (manifest.summary.counts.pages !== 1) {
    throw new Error(`captured pages: ${manifest.summary.counts.pages}`);
  }
  if (manifest.source.normalizedUrl !== "https://example.com/") {
    throw new Error(`normalized URL: ${manifest.source.normalizedUrl}`);
  }
' "$capture_path/manifest.json"

printf 'Alpine package, trusted signature, global CLI, effective Chromium sandbox, and one-page capture verified.\n'
