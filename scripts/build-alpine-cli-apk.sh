#!/usr/bin/env bash

set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
readonly repository_root
readonly alpine_image='alpine:3.24@sha256:28bd5fe8b56d1bd048e5babf5b10710ebe0bae67db86916198a6eec434943f8b'

if ! command -v docker >/dev/null 2>&1; then
  echo 'Alpine builder: Docker is required.' >&2
  exit 1
fi
if [[ $# -gt 1 ]]; then
  echo 'Usage: scripts/build-alpine-cli-apk.sh [output-directory]' >&2
  exit 2
fi

output_root="${1:-${repository_root}/dist/alpine}"
mkdir -p "${output_root}"
output_root="$(cd "${output_root}" && pwd -P)"
readonly output_root

docker run --rm \
  --platform linux/amd64 \
  --volume "${repository_root}:/workspace:ro" \
  --volume "${output_root}:/output" \
  --env SITEPULL_SOURCE_ROOT=/workspace \
  --env "SITEPULL_OUTPUT_UID=$(id -u)" \
  --env "SITEPULL_OUTPUT_GID=$(id -g)" \
  "${alpine_image}" \
  sh /workspace/packaging/alpine/build-apk.sh /output
