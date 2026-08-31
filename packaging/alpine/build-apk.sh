#!/bin/sh

set -eu

script_dir="$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)"
repository_root="$(CDPATH='' cd -- "$script_dir/../.." && pwd)"
source_checkout="${SITEPULL_SOURCE_ROOT:-$repository_root}"
output_directory="${1:-${SITEPULL_OUTPUT_ROOT:-/output}}"
expected_pnpm_version='11.24.0'
package_packager='Isaiah Neal <70036686+isaiahneal@users.noreply.github.com>'

# This package intentionally drives Alpine's distro-managed Chromium. Never
# allow Playwright lifecycle scripts to add a glibc browser to the APK payload.
export PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

fail() {
  printf 'Alpine APK build failed: %s\n' "$1" >&2
  exit 1
}

alpine_release="$(cut -d. -f1,2 /etc/alpine-release 2>/dev/null || true)"
[ "$alpine_release" = '3.24' ] || fail 'this package must be built on Alpine 3.24'
[ "$(uname -m)" = 'x86_64' ] || fail 'this package must be built natively on x86_64'
[ "$(id -u)" -eq 0 ] || fail 'the isolated Alpine builder must run as root'
[ -r "$source_checkout/pnpm-lock.yaml" ] && [ -r "$source_checkout/package.json" ] ||
  fail "$source_checkout is not a Sitepull source checkout"

apk add --no-cache abuild nodejs npm openssl tar
npm install --global --ignore-scripts "pnpm@$expected_pnpm_version"

for command in abuild apk node openssl pnpm scanelf sha512sum tar; do
  command -v "$command" >/dev/null 2>&1 || fail "required command is unavailable: $command"
done
[ "$(pnpm --version)" = "$expected_pnpm_version" ] || fail 'pnpm version drifted'
[ "$(node -p 'process.arch')" = 'x64' ] || fail 'Node.js must be the native x64 build'

package_version="$(node -e '
  const fs = require("node:fs");
  process.stdout.write(JSON.parse(fs.readFileSync(process.argv[1], "utf8")).version);
' "$source_checkout/package.json")"
case "$package_version" in
  ''|*[!0-9.]*) fail "unsupported package version: $package_version" ;;
esac
[ "$(printf '%s' "$package_version" | awk -F. '{ print NF }')" -eq 3 ] ||
  fail "unsupported package version: $package_version"

build_root="$(mktemp -d /tmp/sitepull-alpine-build.XXXXXX)"
build_trusted_key=''
cleanup() {
  if [ -n "$build_trusted_key" ] && [ -f "$build_trusted_key" ]; then
    rm -f -- "$build_trusted_key"
  fi
  case "$build_root" in
    /tmp/sitepull-alpine-build.*) rm -rf -- "$build_root" ;;
    *) printf 'Refusing to remove unexpected build path: %s\n' "$build_root" >&2 ;;
  esac
}
trap cleanup EXIT HUP INT TERM

checkout_root="$build_root/checkout"
source_parent="$build_root/source-tree"
source_root="$source_parent/sitepull-cli-$package_version"
package_workspace="$build_root/package"
repository_destination="$build_root/repository"
key_directory="$build_root/keys"

mkdir -p \
  "$checkout_root" \
  "$source_root/payload" \
  "$package_workspace" \
  "$repository_destination" \
  "$key_directory" \
  "$output_directory"

tar \
  --exclude='./.git' \
  --exclude='*/node_modules' \
  --exclude='node_modules' \
  --exclude='*/dist' \
  --exclude='dist' \
  --exclude='*/out' \
  --exclude='out' \
  --exclude='*/output' \
  --exclude='output' \
  --exclude='*/coverage' \
  --exclude='coverage' \
  --exclude='*/.vite' \
  --exclude='.vite' \
  --exclude='*/.playwright-browsers' \
  --exclude='.playwright-browsers' \
  -C "$source_checkout" \
  -cf - . | tar -C "$checkout_root" -xf -

(
  cd "$checkout_root"
  export CI=true
  export pnpm_config_verify_deps_before_run=false
  pnpm install --frozen-lockfile --filter '@sitepull/cli...'
  pnpm build:cli
  pnpm \
    --config.inject-workspace-packages=true \
    --filter @sitepull/cli \
    deploy \
    --prod \
    "$source_root/payload"
)

[ -s "$source_root/payload/dist/bin.js" ] || fail 'deployed CLI entrypoint is missing'
[ -s "$source_root/payload/node_modules/playwright/package.json" ] ||
  fail 'deployed Playwright runtime is missing'

# tar-stream declares Bare-runtime adapters that Node never imports. Remove
# their cross-platform native prebuilds so the musl package contains no hidden
# glibc or foreign-architecture executable payload.
for bare_package in bare-fs bare-path bare-url; do
  rm -rf -- "$source_root/payload/node_modules/$bare_package/prebuilds"
done

embedded_browser_directory="$(
  find "$source_root/payload" -type d \
    \( -name '.local-browsers' -o -name '.playwright-browsers' \) \
    -print -quit
)"
[ -z "$embedded_browser_directory" ] ||
  fail "deployed payload contains an embedded browser: $embedded_browser_directory"

unexpected_elf="$(
  scanelf -R -F '%F' "$source_root/payload" | awk 'NR > 1 { print; exit }'
)"
[ -z "$unexpected_elf" ] || fail "deployed payload contains a native binary: $unexpected_elf"

deployed_identity="$(node "$source_root/payload/dist/bin.js" --version)"
case "$deployed_identity" in
  "sitepull/$package_version linux-x64 node-v"*) ;;
  *) fail "deployed CLI reported an unexpected identity: $deployed_identity" ;;
esac

install -m644 "$checkout_root/LICENSE" "$source_root/payload/LICENSE"
cp "$checkout_root/packaging/alpine/sitepull" "$source_root/sitepull"

source_archive="$package_workspace/sitepull-cli-$package_version.tar.gz"
tar -C "$source_parent" -czf "$source_archive" "sitepull-cli-$package_version"
source_sha512="$(sha512sum "$source_archive" | awk '{ print $1 }')"

cp "$checkout_root/packaging/alpine/APKBUILD" "$package_workspace/APKBUILD"

private_key="$key_directory/sitepull-alpine-v$package_version.rsa"
public_key="$private_key.pub"
openssl genrsa -out "$private_key" 4096 >/dev/null 2>&1
openssl rsa -in "$private_key" -pubout -out "$public_key" >/dev/null 2>&1
chmod 600 "$private_key"
chmod 644 "$public_key"

# abuild verifies packages while regenerating its temporary repository index.
# Trust only this release-specific public key for the duration of the build.
build_trusted_key="/etc/apk/keys/$(basename "$public_key")"
[ ! -e "$build_trusted_key" ] || fail "build key already exists: $build_trusted_key"
install -m644 "$public_key" "$build_trusted_key"

force_root=''
if [ "$(id -u)" -eq 0 ]; then
  force_root='-F'
fi

(
  cd "$package_workspace"
  SITEPULL_VERSION="$package_version" \
    SITEPULL_SOURCE_SHA512="$source_sha512" \
    PACKAGER_PRIVKEY="$private_key" \
    PACKAGER="$package_packager" \
    abuild $force_root \
      -d \
      -P "$repository_destination"
)

apk_name="sitepull-cli-$package_version-r0.apk"
built_apk="$(find "$repository_destination" -type f -name "$apk_name" -print -quit)"
[ -n "$built_apk" ] && [ -s "$built_apk" ] || fail "abuild did not produce $apk_name"

output_apk="$output_directory/$apk_name"
output_public_key="$output_directory/sitepull-alpine-v$package_version.rsa.pub"
install -m644 "$built_apk" "$output_apk"
install -m644 "$public_key" "$output_public_key"

apk verify --keys-dir "$key_directory" "$output_apk"

case "${SITEPULL_OUTPUT_UID:-}:${SITEPULL_OUTPUT_GID:-}" in
  *[!0-9:]*|:|*:*:*) ;;
  ?*:?*)
    chown "${SITEPULL_OUTPUT_UID}:${SITEPULL_OUTPUT_GID}" \
      "$output_apk" \
      "$output_public_key"
    ;;
esac

printf '%s\n' "$output_apk"
printf '%s\n' "$output_public_key"
