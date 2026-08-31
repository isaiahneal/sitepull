#!/bin/sh

set -eu

program_name='sitepull-install'
github_repository='isaiahneal/sitepull'
github_web_root="https://github.com/$github_repository"
github_api_root="https://api.github.com/repos/$github_repository"

dry_run=0
requested_version=''
version_argument_seen=0
work_directory=''
temporary_root=''
mount_directory=''
dmg_is_mounted=0
mac_staged_application=''
mac_target_application=''
mac_backup_application=''
mac_restore_required=0

usage() {
  cat <<'EOF'
Install a verified Sitepull release using the operating system's native format.

Usage:
  sitepull-install.sh [--version VERSION] [--dry-run]

Options:
  --version VERSION  Install an exact release such as 0.4.1 or v0.4.1.
                     Without this option, install GitHub's latest release.
  --dry-run          Print the selected platform, asset, and install method.
                     This performs no network requests or filesystem changes.
  -h, --help         Show this help.

For an exact offline plan, combine --dry-run with --version. An offline dry-run
without --version shows the asset pattern whose version would be resolved from
GitHub during a real installation.
EOF
}

fail() {
  printf '%s: %s\n' "$program_name" "$1" >&2
  exit 1
}

warn() {
  printf '%s: warning: %s\n' "$program_name" "$1" >&2
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --dry-run)
      dry_run=1
      shift
      ;;
    --version)
      [ "$version_argument_seen" -eq 0 ] || fail '--version was provided more than once'
      [ "$#" -ge 2 ] || fail '--version requires a value'
      requested_version=$2
      version_argument_seen=1
      shift 2
      ;;
    --version=*)
      [ "$version_argument_seen" -eq 0 ] || fail '--version was provided more than once'
      requested_version=${1#--version=}
      version_argument_seen=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      fail "unknown argument: $1"
      ;;
  esac
done

normalize_version() {
  normalize_version_candidate=$1
  case "$normalize_version_candidate" in
    v*) normalize_version_candidate=${normalize_version_candidate#v} ;;
  esac
  if ! printf '%s\n' "$normalize_version_candidate" |
    LC_ALL=C grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$'; then
    return 1
  fi
  printf '%s\n' "$normalize_version_candidate"
}

if [ "$version_argument_seen" -eq 1 ]; then
  if ! requested_version=$(normalize_version "$requested_version"); then
    fail 'release versions must have the form 1.2.3 or v1.2.3'
  fi
fi

test_mode=${SITEPULL_INSTALLER_TEST_MODE:-0}
case "$test_mode" in
  0|1) ;;
  *) fail 'SITEPULL_INSTALLER_TEST_MODE must be 0 or 1' ;;
esac

test_override_present=0
if [ -n "${SITEPULL_INSTALLER_TEST_OS:-}" ] ||
  [ -n "${SITEPULL_INSTALLER_TEST_ARCH:-}" ] ||
  [ -n "${SITEPULL_INSTALLER_TEST_OS_RELEASE:-}" ] ||
  [ -n "${SITEPULL_INSTALLER_TEST_MACOS_VERSION:-}" ]; then
  test_override_present=1
fi
if [ "$test_override_present" -eq 1 ] && [ "$test_mode" -ne 1 ]; then
  fail 'platform test overrides require SITEPULL_INSTALLER_TEST_MODE=1'
fi
if [ "$test_mode" -eq 1 ] && [ "$dry_run" -ne 1 ]; then
  fail 'platform test overrides are restricted to --dry-run'
fi

detected_os=$(uname -s) || fail 'could not determine the operating system'
detected_arch=$(uname -m) || fail 'could not determine the machine architecture'
if [ "$test_mode" -eq 1 ]; then
  if [ -n "${SITEPULL_INSTALLER_TEST_OS:-}" ]; then
    detected_os=$SITEPULL_INSTALLER_TEST_OS
  fi
  if [ -n "${SITEPULL_INSTALLER_TEST_ARCH:-}" ]; then
    detected_arch=$SITEPULL_INSTALLER_TEST_ARCH
  fi
fi

case "$detected_arch" in
  arm64|aarch64) normalized_arch='arm64' ;;
  x86_64|amd64) normalized_arch='x64' ;;
  *) fail "unsupported architecture: $detected_arch" ;;
esac

read_os_release_value() {
  os_release_key=$1
  os_release_path=$2
  LC_ALL=C awk -v wanted="$os_release_key" '
    {
      separator = index($0, "=")
      if (separator == 0) next
      key = substr($0, 1, separator - 1)
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", key)
      if (key != wanted) next
      count++
      value = substr($0, separator + 1)
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", value)
      first = substr(value, 1, 1)
      last = substr(value, length(value), 1)
      single_quote = sprintf("%c", 39)
      if ((first == "\"" && last == "\"") ||
          (first == single_quote && last == single_quote)) {
        value = substr(value, 2, length(value) - 2)
      }
    }
    END {
      if (count != 1) exit 1
      print value
    }
  ' "$os_release_path"
}

platform_key=''
platform_label=''
linux_distribution=''
linux_version=''
macos_product_version=''
mac_app_directory=''

case "$detected_os" in
  Darwin)
    case "$normalized_arch" in
      arm64|x64) ;;
      *) fail "unsupported macOS architecture: $detected_arch" ;;
    esac
    if [ "$test_mode" -eq 1 ] && [ -n "${SITEPULL_INSTALLER_TEST_MACOS_VERSION:-}" ]; then
      macos_product_version=$SITEPULL_INSTALLER_TEST_MACOS_VERSION
    else
      command -v sw_vers >/dev/null 2>&1 || fail 'sw_vers is required on macOS'
      macos_product_version=$(sw_vers -productVersion) ||
        fail 'could not determine the macOS version'
    fi
    if ! printf '%s\n' "$macos_product_version" |
      LC_ALL=C grep -Eq '^[0-9]+(\.[0-9]+){0,2}$'; then
      fail "unrecognized macOS version: $macos_product_version"
    fi
    macos_major=${macos_product_version%%.*}
    [ "$macos_major" -ge 15 ] ||
      fail "macOS 15 or newer is required; found $macos_product_version"
    [ -n "${HOME:-}" ] || fail 'HOME is required to select the macOS application directory'
    case "$HOME" in
      /*) ;;
      *) fail "HOME must be an absolute path on macOS: $HOME" ;;
    esac
    mac_app_directory="$HOME/Applications"
    platform_key="darwin-$normalized_arch"
    platform_label="macOS $macos_product_version $normalized_arch"
    ;;
  Linux)
    [ "$normalized_arch" = x64 ] ||
      fail "Linux release packages currently require x86_64; found $detected_arch"
    if [ "$test_mode" -eq 1 ] && [ -n "${SITEPULL_INSTALLER_TEST_OS_RELEASE:-}" ]; then
      os_release_file=$SITEPULL_INSTALLER_TEST_OS_RELEASE
    elif [ -r /etc/os-release ]; then
      os_release_file=/etc/os-release
    elif [ -r /usr/lib/os-release ]; then
      os_release_file=/usr/lib/os-release
    else
      fail 'Linux distribution metadata is unavailable (/etc/os-release)'
    fi
    [ -r "$os_release_file" ] || fail "cannot read Linux distribution metadata: $os_release_file"
    if ! linux_distribution=$(read_os_release_value ID "$os_release_file"); then
      fail "Linux distribution metadata has no unique ID: $os_release_file"
    fi
    if ! linux_version=$(read_os_release_value VERSION_ID "$os_release_file"); then
      fail "Linux distribution metadata has no unique VERSION_ID: $os_release_file"
    fi
    linux_distribution=$(printf '%s' "$linux_distribution" | LC_ALL=C tr '[:upper:]' '[:lower:]')
    case "$linux_distribution:$linux_version" in
      ubuntu:24.04)
        platform_key='ubuntu24.04'
        platform_label='Ubuntu 24.04 x64'
        ;;
      debian:12)
        platform_key='debian12'
        platform_label='Debian 12 x64'
        ;;
      debian:13)
        platform_key='debian13'
        platform_label='Debian 13 x64'
        ;;
      fedora:44)
        platform_key='fedora44'
        platform_label='Fedora 44 x64'
        ;;
      alpine:3.24|alpine:3.24.*)
        platform_key='alpine3.24'
        platform_label="Alpine $linux_version x64"
        ;;
      *)
        fail "unsupported Linux distribution: $linux_distribution $linux_version"
        ;;
    esac
    ;;
  *)
    fail "unsupported operating system: $detected_os"
    ;;
esac

asset_name=''
key_asset_name=''
install_method=''

select_assets() {
  select_assets_version=$1
  key_asset_name=''
  case "$platform_key" in
    darwin-arm64)
      asset_name="Sitepull-$select_assets_version-arm64.dmg"
      install_method="mount DMG and atomically install Sitepull.app in $mac_app_directory"
      ;;
    darwin-x64)
      asset_name="Sitepull-$select_assets_version-x64.dmg"
      install_method="mount DMG and atomically install Sitepull.app in $mac_app_directory"
      ;;
    ubuntu24.04)
      asset_name="sitepull_${select_assets_version}-1.ubuntu24.04_amd64.deb"
      install_method='apt-get install the Ubuntu 24.04 DEB'
      ;;
    debian12)
      asset_name="sitepull_${select_assets_version}-1.debian12_amd64.deb"
      install_method='apt-get install the Debian 12 DEB'
      ;;
    debian13)
      asset_name="sitepull_${select_assets_version}-1.debian13_amd64.deb"
      install_method='apt-get install the Debian 13 DEB'
      ;;
    fedora44)
      asset_name="sitepull-cli-${select_assets_version}-1.fc44.x86_64.rpm"
      install_method='dnf install the Fedora 44 RPM'
      ;;
    alpine3.24)
      asset_name="sitepull-cli-${select_assets_version}-r0.apk"
      key_asset_name="sitepull-alpine-v${select_assets_version}.rsa.pub"
      install_method='trust the release-specific key, then apk add the Alpine 3.24 APK'
      ;;
    *) fail "internal error: no asset mapping for $platform_key" ;;
  esac
}

print_plan() {
  printf '%s\n' 'Sitepull installation plan'
  printf '  Platform: %s\n' "$platform_label"
  if [ "$version_argument_seen" -eq 1 ] || [ "$dry_run" -ne 1 ]; then
    printf '  Version: %s\n' "$resolved_version"
    printf '  Asset: %s\n' "$asset_name"
  else
    printf '%s\n' '  Version: latest (resolution deferred; dry-run performs no network request)'
    printf '  Asset pattern: %s\n' "$asset_name"
  fi
  if [ -n "$key_asset_name" ]; then
    if [ "$version_argument_seen" -eq 1 ] || [ "$dry_run" -ne 1 ]; then
      printf '  Signing key: %s\n' "$key_asset_name"
    else
      printf '  Signing-key pattern: %s\n' "$key_asset_name"
    fi
  fi
  printf '  Install method: %s\n' "$install_method"
}

if [ "$dry_run" -eq 1 ]; then
  if [ "$version_argument_seen" -eq 1 ]; then
    resolved_version=$requested_version
  else
    resolved_version='<resolved-version>'
  fi
  select_assets "$resolved_version"
  print_plan
  exit 0
fi

downloader=''
if command -v curl >/dev/null 2>&1; then
  downloader='curl'
elif command -v wget >/dev/null 2>&1; then
  downloader='wget'
else
  fail 'curl or wget is required to download GitHub release assets'
fi

hash_tool=''
if command -v sha256sum >/dev/null 2>&1; then
  hash_tool='sha256sum'
elif command -v shasum >/dev/null 2>&1; then
  hash_tool='shasum'
elif command -v openssl >/dev/null 2>&1; then
  hash_tool='openssl'
else
  fail 'sha256sum, shasum, or openssl is required for SHA-256 verification'
fi

case "$platform_key" in
  darwin-*)
    command -v hdiutil >/dev/null 2>&1 || fail 'hdiutil is required to install the macOS DMG'
    command -v ditto >/dev/null 2>&1 || fail 'ditto is required to install the macOS application'
    [ -x /usr/bin/codesign ] || fail 'codesign is required to verify the macOS application'
    ;;
  ubuntu24.04|debian12|debian13)
    command -v apt-get >/dev/null 2>&1 || fail 'apt-get is required to install this DEB'
    command -v dpkg-query >/dev/null 2>&1 || fail 'dpkg-query is required to verify the DEB installation'
    ;;
  fedora44)
    command -v dnf >/dev/null 2>&1 || fail 'dnf is required to install the Fedora RPM'
    command -v rpm >/dev/null 2>&1 || fail 'rpm is required to verify the Fedora installation'
    ;;
  alpine3.24)
    command -v apk >/dev/null 2>&1 || fail 'apk is required to install the Alpine package'
    command -v cmp >/dev/null 2>&1 || fail 'cmp is required to protect an existing Alpine signing key'
    command -v install >/dev/null 2>&1 || fail 'install is required to place the Alpine signing key'
    ;;
esac

elevation_method='direct'
if [ "$platform_key" != darwin-arm64 ] && [ "$platform_key" != darwin-x64 ] &&
  [ "$(id -u)" -ne 0 ]; then
  if [ "$platform_key" = alpine3.24 ]; then
    if command -v doas >/dev/null 2>&1; then
      elevation_method='doas'
    elif command -v sudo >/dev/null 2>&1; then
      elevation_method='sudo'
    else
      fail 'run as root or install doas/sudo to use the native package manager'
    fi
  elif command -v sudo >/dev/null 2>&1; then
    elevation_method='sudo'
  elif command -v doas >/dev/null 2>&1; then
    elevation_method='doas'
  else
    fail 'run as root or install sudo/doas to use the native package manager'
  fi
fi

as_root() {
  case "$elevation_method" in
    direct) "$@" ;;
    doas) doas "$@" ;;
    sudo) sudo "$@" ;;
    *) fail "internal error: unknown elevation method $elevation_method" ;;
  esac
}

restore_macos_application() {
  [ "$mac_restore_required" -eq 1 ] || return 0
  if [ -z "$mac_backup_application" ] ||
    { [ ! -e "$mac_backup_application" ] && [ ! -L "$mac_backup_application" ]; }; then
    if [ -n "$mac_target_application" ] &&
      { [ -e "$mac_target_application" ] || [ -L "$mac_target_application" ]; }; then
      mac_restore_required=0
      return 0
    fi
    warn 'the previous macOS application backup is unavailable for rollback'
    return 1
  fi
  if [ -e "$mac_target_application" ] || [ -L "$mac_target_application" ]; then
    if ! rm -rf -- "$mac_target_application"; then
      warn "could not remove the interrupted installation at $mac_target_application"
      return 1
    fi
  fi
  if ! mv "$mac_backup_application" "$mac_target_application"; then
    warn "could not restore the previous application from $mac_backup_application"
    return 1
  fi
  mac_restore_required=0
  warn "restored the previous application at $mac_target_application"
}

remove_macos_staging() {
  [ -n "$mac_staged_application" ] || return 0
  if [ ! -e "$mac_staged_application" ] && [ ! -L "$mac_staged_application" ]; then
    return 0
  fi
  case "$mac_staged_application" in
    "$mac_app_directory"/.Sitepull.app.sitepull-install.*)
      rm -rf -- "$mac_staged_application" ||
        warn "could not remove macOS staging path $mac_staged_application"
      ;;
    *) warn "refusing to remove unexpected macOS staging path: $mac_staged_application" ;;
  esac
}

cleanup() {
  cleanup_status=$?
  restore_macos_application || true
  remove_macos_staging
  if [ "$dmg_is_mounted" -eq 1 ] && [ -n "$mount_directory" ]; then
    hdiutil detach -quiet "$mount_directory" >/dev/null 2>&1 ||
      warn "could not detach DMG mount at $mount_directory"
  fi
  if [ -n "$work_directory" ]; then
    case "$work_directory" in
      "$temporary_root"/sitepull-install.*) rm -rf -- "$work_directory" ;;
      *) warn "refusing to remove unexpected temporary path: $work_directory" ;;
    esac
  fi
  return "$cleanup_status"
}

trap cleanup 0
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

temporary_root=${TMPDIR:-/tmp}
temporary_root=${temporary_root%/}
case "$temporary_root" in
  /*) ;;
  *) fail "TMPDIR must be an absolute path: $temporary_root" ;;
esac
work_directory=$(mktemp -d "$temporary_root/sitepull-install.XXXXXX") ||
  fail "could not create a temporary directory under $temporary_root"
chmod 700 "$work_directory"

download_file() {
  download_url=$1
  download_destination=$2
  download_partial="$download_destination.part"
  if [ -e "$download_destination" ] || [ -e "$download_partial" ]; then
    fail "refusing to overwrite a download path: $download_destination"
  fi
  case "$download_url" in
    https://*) ;;
    *) fail "refusing a non-HTTPS download URL: $download_url" ;;
  esac
  if [ "$downloader" = curl ]; then
    if ! curl -q --fail --location --proto '=https' --proto-redir '=https' \
      --silent --show-error --retry 3 --connect-timeout 20 \
      --output "$download_partial" -- "$download_url"; then
      rm -f -- "$download_partial"
      fail "download failed: $download_url"
    fi
  else
    if ! WGETRC=/dev/null wget -q -t 3 -T 30 -O "$download_partial" "$download_url"; then
      rm -f -- "$download_partial"
      fail "download failed: $download_url"
    fi
  fi
  [ -s "$download_partial" ] || fail "download was empty: $download_url"
  mv "$download_partial" "$download_destination"
}

if [ "$version_argument_seen" -eq 1 ]; then
  resolved_version=$requested_version
else
  latest_release_json="$work_directory/latest-release.json"
  download_file "$github_api_root/releases/latest" "$latest_release_json"
  latest_release_tag=$(
    sed -n 's/^[[:space:]]*"tag_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*$/\1/p' \
      "$latest_release_json" | sed -n '1p'
  )
  case "$latest_release_tag" in
    v*) ;;
    *) fail 'GitHub latest-release metadata did not contain an expected v-prefixed tag' ;;
  esac
  if ! resolved_version=$(normalize_version "$latest_release_tag"); then
    fail "GitHub returned an invalid latest release tag: $latest_release_tag"
  fi
fi

select_assets "$resolved_version"
print_plan

checksum_manifest="$work_directory/SHA256SUMS.txt"
release_download_root="$github_web_root/releases/download/v$resolved_version"
download_file "$release_download_root/SHA256SUMS.txt" "$checksum_manifest"

manifest_sha256() {
  manifest_asset=$1
  LC_ALL=C awk -v wanted="$manifest_asset" '
    $2 == wanted {
      count++
      if (length($1) != 64 || $1 ~ /[^0-9A-Fa-f]/) invalid = 1
      digest = tolower($1)
    }
    END {
      if (count != 1 || invalid) exit 1
      print digest
    }
  ' "$checksum_manifest"
}

compute_sha256() {
  compute_path=$1
  case "$hash_tool" in
    sha256sum) sha256sum "$compute_path" | awk '{ print tolower($1) }' ;;
    shasum) shasum -a 256 "$compute_path" | awk '{ print tolower($1) }' ;;
    openssl) openssl dgst -sha256 "$compute_path" | awk '{ print tolower($NF) }' ;;
    *) return 1 ;;
  esac
}

verify_download() {
  verify_asset=$1
  verify_path=$2
  if ! expected_sha256=$(manifest_sha256 "$verify_asset"); then
    fail "SHA256SUMS.txt does not contain exactly one valid entry for $verify_asset"
  fi
  if ! actual_sha256=$(compute_sha256 "$verify_path"); then
    fail "could not compute SHA-256 for $verify_asset"
  fi
  if ! printf '%s\n' "$actual_sha256" | LC_ALL=C grep -Eq '^[0-9a-f]{64}$'; then
    fail "the SHA-256 tool returned an invalid digest for $verify_asset"
  fi
  [ "$actual_sha256" = "$expected_sha256" ] ||
    fail "SHA-256 mismatch for $verify_asset (expected $expected_sha256, received $actual_sha256)"
  printf 'Verified SHA-256: %s\n' "$verify_asset"
}

if ! manifest_sha256 "$asset_name" >/dev/null; then
  fail "SHA256SUMS.txt does not authorize the selected asset: $asset_name"
fi
if [ -n "$key_asset_name" ] && ! manifest_sha256 "$key_asset_name" >/dev/null; then
  fail "SHA256SUMS.txt does not authorize the selected signing key: $key_asset_name"
fi

asset_path="$work_directory/$asset_name"
download_file "$release_download_root/$asset_name" "$asset_path"
verify_download "$asset_name" "$asset_path"

key_asset_path=''
if [ -n "$key_asset_name" ]; then
  key_asset_path="$work_directory/$key_asset_name"
  download_file "$release_download_root/$key_asset_name" "$key_asset_path"
  verify_download "$key_asset_name" "$key_asset_path"
fi

# Package-manager helpers may deliberately drop privileges while reading a
# local package. The directory remains owned and non-writable by other users.
chmod 755 "$work_directory"
chmod 644 "$checksum_manifest" "$asset_path"
if [ -n "$key_asset_path" ]; then
  chmod 644 "$key_asset_path"
fi

install_macos() {
  mkdir -p "$mac_app_directory"
  mount_directory="$work_directory/dmg"
  mkdir "$mount_directory"
  hdiutil_error="$work_directory/hdiutil-attach.stderr"
  if ! hdiutil attach -readonly -nobrowse -noautoopen \
    -mountpoint "$mount_directory" "$asset_path" >/dev/null 2>"$hdiutil_error"; then
    sed -n '1,20p' "$hdiutil_error" >&2
    fail "could not mount $asset_name"
  fi
  dmg_is_mounted=1
  source_application="$mount_directory/Sitepull.app"
  [ -d "$source_application" ] || fail 'the verified DMG does not contain Sitepull.app'
  [ -x "$source_application/Contents/MacOS/Sitepull" ] ||
    fail 'the verified DMG does not contain the Sitepull executable'
  if ! /usr/bin/codesign --verify --deep --strict "$source_application" >/dev/null 2>&1; then
    fail 'the verified DMG contains an invalid Sitepull.app code-signature seal'
  fi

  mac_target_application="$mac_app_directory/Sitepull.app"
  mac_staged_application="$mac_app_directory/.Sitepull.app.sitepull-install.$$"
  mac_backup_application="$mac_app_directory/.Sitepull.app.sitepull-backup.$$"
  if [ -e "$mac_staged_application" ] || [ -L "$mac_staged_application" ] ||
    [ -e "$mac_backup_application" ] || [ -L "$mac_backup_application" ]; then
    fail 'a conflicting Sitepull installation staging path already exists'
  fi
  if ! ditto "$source_application" "$mac_staged_application"; then
    rm -rf -- "$mac_staged_application"
    fail 'could not stage Sitepull.app'
  fi
  if [ ! -x "$mac_staged_application/Contents/MacOS/Sitepull" ]; then
    rm -rf -- "$mac_staged_application"
    fail 'the staged macOS application is incomplete'
  fi
  if ! /usr/bin/codesign --verify --deep --strict "$mac_staged_application" >/dev/null 2>&1; then
    rm -rf -- "$mac_staged_application"
    fail 'the staged macOS application failed code-signature verification'
  fi

  if [ -e "$mac_target_application" ] || [ -L "$mac_target_application" ]; then
    mac_restore_required=1
    if ! mv "$mac_target_application" "$mac_backup_application"; then
      mac_restore_required=0
      rm -rf -- "$mac_staged_application"
      fail "could not move the existing application out of $mac_target_application"
    fi
  fi
  if ! mv "$mac_staged_application" "$mac_target_application"; then
    if [ "$mac_restore_required" -eq 1 ]; then
      restore_macos_application ||
        fail "installation failed and the previous app remains at $mac_backup_application"
    fi
    fail "could not install Sitepull.app in $mac_app_directory"
  fi
  if [ ! -x "$mac_target_application/Contents/MacOS/Sitepull" ]; then
    rm -rf -- "$mac_target_application"
    if [ "$mac_restore_required" -eq 1 ]; then
      restore_macos_application ||
        fail "the new app was invalid and the previous app remains at $mac_backup_application"
    fi
    fail 'the installed macOS application executable is unavailable'
  fi
  mac_restore_required=0
  if [ -e "$mac_backup_application" ] || [ -L "$mac_backup_application" ]; then
    if ! rm -rf -- "$mac_backup_application"; then
      warn "the previous app backup remains at $mac_backup_application"
    fi
  fi
}

install_deb() {
  as_root env DEBIAN_FRONTEND=noninteractive apt-get update
  as_root env DEBIAN_FRONTEND=noninteractive \
    apt-get install --yes --allow-downgrades "$asset_path"
  # Keep the dpkg-query format string literal for dpkg rather than the shell.
  # shellcheck disable=SC2016
  installed_deb_version=$(dpkg-query --show --showformat='${Version}' sitepull) ||
    fail 'the sitepull DEB is not installed'
  expected_deb_version="$resolved_version-1~$platform_key"
  [ "$installed_deb_version" = "$expected_deb_version" ] ||
    fail "installed DEB version is $installed_deb_version, expected $expected_deb_version"
}

install_fedora() {
  as_root dnf install --assumeyes "$asset_path"
  installed_rpm_identity=$(rpm -q --queryformat '%{VERSION}-%{RELEASE}.%{ARCH}' sitepull-cli) ||
    fail 'the sitepull-cli RPM is not installed'
  expected_rpm_identity="$resolved_version-1.fc44.x86_64"
  [ "$installed_rpm_identity" = "$expected_rpm_identity" ] ||
    fail "installed RPM is $installed_rpm_identity, expected $expected_rpm_identity"
}

install_alpine() {
  alpine_key_destination="/etc/apk/keys/$key_asset_name"
  alpine_key_added=0
  if [ -e "$alpine_key_destination" ] || [ -L "$alpine_key_destination" ]; then
    cmp -s "$key_asset_path" "$alpine_key_destination" ||
      fail "refusing to replace a different Alpine key at $alpine_key_destination"
  else
    as_root install -m 0644 "$key_asset_path" "$alpine_key_destination"
    alpine_key_added=1
  fi
  if ! as_root apk add --no-cache "$asset_path"; then
    if [ "$alpine_key_added" -eq 1 ]; then
      as_root rm -f -- "$alpine_key_destination" ||
        warn "could not remove the unused key at $alpine_key_destination"
    fi
    fail 'apk rejected or could not install the verified Sitepull package'
  fi
  installed_apk_version=$(
    apk query --from installed --fields version sitepull-cli |
      awk -F': ' '$1 == "Version" { print $2 }'
  )
  expected_apk_version="$resolved_version-r0"
  [ "$installed_apk_version" = "$expected_apk_version" ] ||
    fail "installed APK is $installed_apk_version, expected $expected_apk_version"
}

case "$platform_key" in
  darwin-arm64|darwin-x64) install_macos ;;
  ubuntu24.04|debian12|debian13) install_deb ;;
  fedora44) install_fedora ;;
  alpine3.24) install_alpine ;;
  *) fail "internal error: no installer for $platform_key" ;;
esac

printf 'Installed Sitepull %s for %s.\n' "$resolved_version" "$platform_label"
