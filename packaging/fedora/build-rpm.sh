#!/usr/bin/env bash
set -euo pipefail

readonly source_root="${SITEPULL_SOURCE_ROOT:-/workspace}"
readonly payload_root="${SITEPULL_PAYLOAD_ROOT:-/payload}"
readonly output_root="${SITEPULL_OUTPUT_ROOT:-/output}"
readonly expected_fedora_version=44
readonly expected_arch=x86_64

if [[ ! -r /etc/os-release ]]; then
  echo 'Fedora builder: /etc/os-release is missing.' >&2
  exit 1
fi
# shellcheck disable=SC1091
source /etc/os-release
if [[ "${ID:-}" != fedora || "${VERSION_ID:-}" != "${expected_fedora_version}" ]]; then
  echo "Fedora builder: expected Fedora ${expected_fedora_version}, found ${PRETTY_NAME:-unknown}." >&2
  exit 1
fi
if [[ "$(uname -m)" != "${expected_arch}" ]]; then
  echo "Fedora builder: expected ${expected_arch}, found $(uname -m)." >&2
  exit 1
fi
if [[ ! -r "${source_root}/pnpm-lock.yaml" || ! -r "${source_root}/package.json" || ! -r "${source_root}/apps/cli/package.json" ]]; then
  echo "Fedora builder: ${source_root} is not a Sitepull source checkout." >&2
  exit 1
fi
if [[ ! -r "${payload_root}/package.json" || ! -x "${payload_root}/dist/bin.js" ]]; then
  echo "Fedora builder: ${payload_root} is not a prebuilt Sitepull CLI payload." >&2
  exit 1
fi

dnf install --assumeyes --setopt=install_weak_deps=False \
  ca-certificates \
  coreutils \
  file \
  findutils \
  gzip \
  nodejs24 \
  nodejs24-bin \
  rpm-build \
  sed \
  tar

work_root="$(mktemp -d /tmp/sitepull-fedora-build.XXXXXX)"
cleanup() {
  if [[ "${work_root}" == /tmp/sitepull-fedora-build.* && -d "${work_root}" ]]; then
    rm -rf -- "${work_root}"
  fi
}
trap cleanup EXIT

if ! version="$(node -e '
  const fs = require("node:fs");
  const [rootPath, cliPath, payloadPath] = process.argv.slice(1);
  const root = JSON.parse(fs.readFileSync(rootPath, "utf8"));
  const cli = JSON.parse(fs.readFileSync(cliPath, "utf8"));
  const payload = JSON.parse(fs.readFileSync(payloadPath, "utf8"));
  if (root.version !== cli.version || root.version !== payload.version || payload.name !== "@sitepull/cli") process.exit(2);
  process.stdout.write(root.version);
' "${source_root}/package.json" "${source_root}/apps/cli/package.json" "${payload_root}/package.json")"; then
  echo 'Fedora builder: source, CLI, and payload package identities do not agree.' >&2
  exit 1
fi
if [[ ! "${version}" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Fedora builder: RPM releases require a numeric SemVer version; found ${version}." >&2
  exit 1
fi

deployment_root="${work_root}/deployment"
mkdir -p "${deployment_root}"
cp -a "${payload_root}/." "${deployment_root}/"

test -x "${deployment_root}/dist/bin.js"

# tar-stream declares Bare-runtime adapters that Node never imports. Remove
# their cross-platform native prebuilds so RPM dependency generation cannot
# mistake Android, macOS, Windows, or foreign-architecture binaries for Fedora
# runtime requirements.
for bare_package in bare-fs bare-path bare-url; do
  rm -rf -- "${deployment_root}/node_modules/${bare_package}/prebuilds"
done
unexpected_prebuild="$({ find "${deployment_root}/node_modules" -type d -name prebuilds -print -quit; } 2>/dev/null)"
if [[ -n "${unexpected_prebuild}" ]]; then
  echo "Fedora builder: deployed payload contains an unexpected prebuild directory: ${unexpected_prebuild}." >&2
  exit 1
fi
embedded_browser_directory="$({
  find "${deployment_root}" -type d \
    \( -name '.local-browsers' -o -name '.playwright-browsers' \) \
    -print -quit
} 2>/dev/null)"
if [[ -n "${embedded_browser_directory}" ]]; then
  echo "Fedora builder: deployed payload contains an embedded browser: ${embedded_browser_directory}." >&2
  exit 1
fi
unexpected_native="$({ find "${deployment_root}" -type f -exec file -- {} +; } | awk -F: '
  $2 ~ /(ELF|Mach-O|PE32|MS-DOS executable)/ && first == "" { first = $1 }
  END { if (first != "") print first }
')"
if [[ -n "${unexpected_native}" ]]; then
  echo "Fedora builder: deployed payload contains an unexpected native binary: ${unexpected_native}." >&2
  exit 1
fi
actual_version="$(node "${deployment_root}/dist/bin.js" --version)"
if [[ "${actual_version}" != "sitepull/${version} linux-x64 node-v"* ]]; then
  echo "Fedora builder: deployed CLI reported an unexpected identity: ${actual_version}." >&2
  exit 1
fi
install -m 0644 "${source_root}/LICENSE" "${deployment_root}/LICENSE"
for deployed_path in LICENSE dist node_modules package.json pnpm-lock.yaml pnpm-workspace.yaml; do
  test -e "${deployment_root}/${deployed_path}"
done

source_date_epoch="${SITEPULL_SOURCE_DATE_EPOCH:-}"
if [[ ! "${source_date_epoch}" =~ ^[0-9]+$ || "${source_date_epoch}" -le 0 ]]; then
  echo 'Fedora builder: SITEPULL_SOURCE_DATE_EPOCH must be a positive Unix timestamp.' >&2
  exit 1
fi

rpm_topdir="${work_root}/rpmbuild"
mkdir -p \
  "${rpm_topdir}/BUILD" \
  "${rpm_topdir}/BUILDROOT" \
  "${rpm_topdir}/RPMS" \
  "${rpm_topdir}/SOURCES" \
  "${rpm_topdir}/SPECS" \
  "${rpm_topdir}/SRPMS"

source_tree="${work_root}/sitepull-cli-${version}"
mkdir -p "${source_tree}/deployment"
cp -a "${deployment_root}/." "${source_tree}/deployment/"
find "${source_tree}" -type l -exec touch -h --date="@${source_date_epoch}" {} +
find "${source_tree}" ! -type l -exec touch --date="@${source_date_epoch}" {} +

tar \
  --hard-dereference \
  --sort=name \
  --mtime="@${source_date_epoch}" \
  --owner=0 \
  --group=0 \
  --numeric-owner \
  -C "${work_root}" \
  -cf "${rpm_topdir}/SOURCES/sitepull-cli-${version}.tar" \
  "sitepull-cli-${version}"
gzip --no-name "${rpm_topdir}/SOURCES/sitepull-cli-${version}.tar"
install -m 0755 "${source_root}/packaging/fedora/sitepull" "${rpm_topdir}/SOURCES/sitepull"
touch --date="@${source_date_epoch}" "${rpm_topdir}/SOURCES/sitepull"
sed "s/@SITEPULL_VERSION@/${version}/g" \
  "${source_root}/packaging/fedora/sitepull-cli.spec.in" >"${rpm_topdir}/SPECS/sitepull-cli.spec"
touch --date="@${source_date_epoch}" "${rpm_topdir}/SPECS/sitepull-cli.spec"

rpmbuild \
  --define "_topdir ${rpm_topdir}" \
  --define '_buildhost sitepull-fedora44-builder' \
  --define "_source_date_epoch ${source_date_epoch}" \
  --define 'clamp_mtime_to_source_date_epoch 1' \
  --define 'use_source_date_epoch_as_buildtime 1' \
  -bb "${rpm_topdir}/SPECS/sitepull-cli.spec"

readonly artifact_name="sitepull-cli-${version}-1.fc44.x86_64.rpm"
artifact_path="$(find "${rpm_topdir}/RPMS" -type f -name "${artifact_name}" -print -quit)"
if [[ -z "${artifact_path}" || ! -f "${artifact_path}" ]]; then
  echo "Fedora builder: expected ${artifact_name}, but rpmbuild did not produce it." >&2
  exit 1
fi

test "$(rpm -qp --queryformat '%{NAME}' "${artifact_path}")" = sitepull-cli
test "$(rpm -qp --queryformat '%{VERSION}' "${artifact_path}")" = "${version}"
test "$(rpm -qp --queryformat '%{RELEASE}' "${artifact_path}")" = 1.fc44
test "$(rpm -qp --queryformat '%{ARCH}' "${artifact_path}")" = x86_64

mkdir -p "${output_root}"
install -m 0644 "${artifact_path}" "${output_root}/${artifact_name}"
if [[ "${SITEPULL_OUTPUT_UID:-}" =~ ^[0-9]+$ && "${SITEPULL_OUTPUT_GID:-}" =~ ^[0-9]+$ ]]; then
  chown "${SITEPULL_OUTPUT_UID}:${SITEPULL_OUTPUT_GID}" "${output_root}/${artifact_name}"
fi

sha256sum "${output_root}/${artifact_name}"
