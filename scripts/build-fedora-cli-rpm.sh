#!/usr/bin/env bash
set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
readonly repository_root
readonly output_root="${repository_root}/dist/fedora"
readonly fedora_image='fedora:44@sha256:43b29f65a41eb9c35e1cd5323e3bdf3b655c2357a9f4f1ff2f9c2798e5045d80'

if ! command -v docker >/dev/null 2>&1; then
  echo 'Fedora builder: Docker is required.' >&2
  exit 1
fi
source_date_epoch="$(git -C "${repository_root}" log -1 --format=%ct)"
if [[ ! "${source_date_epoch}" =~ ^[0-9]+$ ]]; then
  echo 'Fedora builder: could not determine the source commit timestamp.' >&2
  exit 1
fi
readonly source_date_epoch

mkdir -p "${output_root}"
docker run --rm \
  --platform linux/amd64 \
  --volume "${repository_root}:/workspace:ro" \
  --volume "${output_root}:/output" \
  --env "SITEPULL_SOURCE_DATE_EPOCH=${source_date_epoch}" \
  --env "SITEPULL_OUTPUT_UID=$(id -u)" \
  --env "SITEPULL_OUTPUT_GID=$(id -g)" \
  "${fedora_image}" \
  bash /workspace/packaging/fedora/build-rpm.sh
