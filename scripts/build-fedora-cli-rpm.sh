#!/usr/bin/env bash
set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
readonly repository_root
readonly output_root="${repository_root}/dist/fedora"
readonly fedora_image='fedora:44@sha256:43b29f65a41eb9c35e1cd5323e3bdf3b655c2357a9f4f1ff2f9c2798e5045d80'
readonly node_image='node:24.20.0-bookworm@sha256:be23f54a88d34e8824c741b19b91064094f92c1c97b194144bfc8b50d67258e2'

if ! command -v docker >/dev/null 2>&1; then
  echo 'Fedora builder: Docker is required.' >&2
  exit 1
fi
if [[ "$(uname -m)" != x86_64 ]]; then
  echo 'Fedora builder: local RPM construction requires a native x86_64 host; use the native GitHub distribution workflow from Apple silicon.' >&2
  exit 1
fi
source_date_epoch="$(git -C "${repository_root}" log -1 --format=%ct)"
if [[ ! "${source_date_epoch}" =~ ^[0-9]+$ ]]; then
  echo 'Fedora builder: could not determine the source commit timestamp.' >&2
  exit 1
fi
readonly source_date_epoch

build_root="$(mktemp -d /tmp/sitepull-fedora-wrapper.XXXXXX)"
cleanup() {
  if [[ "${build_root}" == /tmp/sitepull-fedora-wrapper.* && -d "${build_root}" ]]; then
    rm -rf -- "${build_root}"
  fi
}
trap cleanup EXIT

source_snapshot="${build_root}/source"
payload_root="${build_root}/payload"
mkdir -p "${source_snapshot}"
tar \
  --exclude='./.git' \
  --exclude='*/node_modules' \
  --exclude='node_modules' \
  --exclude='*/dist' \
  --exclude='dist' \
  --exclude='*/out' \
  --exclude='out' \
  --exclude='*/coverage' \
  --exclude='coverage' \
  -C "${repository_root}" \
  -cf - . | tar -C "${source_snapshot}" -xf -

docker run --rm \
  --platform linux/amd64 \
  --user "$(id -u):$(id -g)" \
  --volume "${build_root}:/build" \
  --env HOME=/tmp/sitepull-home \
  "${node_image}" \
  bash -euo pipefail -c '
    mkdir -p "${HOME}" /tmp/sitepull-pnpm
    export npm_config_prefix=/tmp/sitepull-pnpm
    export PATH="/tmp/sitepull-pnpm/bin:${PATH}"
    npm install --global --ignore-scripts pnpm@11.24.0
    SITEPULL_SOURCE_ROOT=/build/source /build/source/packaging/fedora/build-payload.sh /build/payload
  '

mkdir -p "${output_root}"
docker run --rm \
  --platform linux/amd64 \
  --volume "${source_snapshot}:/workspace:ro" \
  --volume "${payload_root}:/payload:ro" \
  --volume "${output_root}:/output" \
  --env SITEPULL_PAYLOAD_ROOT=/payload \
  --env "SITEPULL_SOURCE_DATE_EPOCH=${source_date_epoch}" \
  --env "SITEPULL_OUTPUT_UID=$(id -u)" \
  --env "SITEPULL_OUTPUT_GID=$(id -g)" \
  "${fedora_image}" \
  bash /workspace/packaging/fedora/build-rpm.sh
