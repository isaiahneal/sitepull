#!/usr/bin/env bash
set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
readonly repository_root
readonly fedora_image='fedora:44@sha256:43b29f65a41eb9c35e1cd5323e3bdf3b655c2357a9f4f1ff2f9c2798e5045d80'

if ! command -v docker >/dev/null 2>&1; then
  echo 'Fedora smoke: Docker is required.' >&2
  exit 1
fi

if [[ $# -gt 1 ]]; then
  echo 'Usage: scripts/smoke-fedora-cli-rpm.sh [path-to-rpm]' >&2
  exit 2
fi
if [[ $# -eq 1 ]]; then
  rpm_path="$1"
else
  shopt -s nullglob
  candidates=("${repository_root}"/dist/fedora/sitepull-cli-*.rpm)
  shopt -u nullglob
  if [[ "${#candidates[@]}" -ne 1 ]]; then
    echo 'Fedora smoke: expected exactly one RPM under dist/fedora; pass an explicit path.' >&2
    exit 1
  fi
  rpm_path="${candidates[0]}"
fi
if [[ ! -f "${rpm_path}" ]]; then
  echo "Fedora smoke: RPM not found at ${rpm_path}." >&2
  exit 1
fi
rpm_directory="$(cd "$(dirname "${rpm_path}")" && pwd -P)"
readonly rpm_directory
rpm_name="$(basename "${rpm_path}")"
readonly rpm_name
readonly canonical_rpm="${rpm_directory}/${rpm_name}"

docker run --rm \
  --platform linux/amd64 \
  --security-opt seccomp=unconfined \
  --volume "${repository_root}:/workspace:ro" \
  --volume "${canonical_rpm}:/package/sitepull-cli.rpm:ro" \
  "${fedora_image}" \
  bash /workspace/packaging/fedora/smoke-installed.sh /package/sitepull-cli.rpm
