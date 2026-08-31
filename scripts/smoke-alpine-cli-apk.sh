#!/usr/bin/env bash

set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
readonly repository_root
readonly alpine_image='alpine:3.24@sha256:28bd5fe8b56d1bd048e5babf5b10710ebe0bae67db86916198a6eec434943f8b'

if ! command -v docker >/dev/null 2>&1; then
  echo 'Alpine smoke: Docker is required.' >&2
  exit 1
fi
docker_architecture="$(docker info --format '{{.Architecture}}')"
if [[ "${docker_architecture}" != amd64 && "${docker_architecture}" != x86_64 ]]; then
  echo "Alpine smoke: a native x86_64 Docker engine is required to verify Chromium's inner sandbox; found ${docker_architecture}." >&2
  exit 1
fi
if [[ $# -gt 2 ]]; then
  echo 'Usage: scripts/smoke-alpine-cli-apk.sh [path-to-apk [path-to-public-key]]' >&2
  exit 2
fi

if [[ $# -ge 1 ]]; then
  apk_path="$1"
else
  shopt -s nullglob
  candidates=("${repository_root}"/dist/alpine/sitepull-cli-*-r0.apk)
  shopt -u nullglob
  if [[ "${#candidates[@]}" -ne 1 ]]; then
    echo 'Alpine smoke: expected exactly one APK under dist/alpine; pass an explicit path.' >&2
    exit 1
  fi
  apk_path="${candidates[0]}"
fi
if [[ ! -f "${apk_path}" ]]; then
  echo "Alpine smoke: APK not found at ${apk_path}." >&2
  exit 1
fi

apk_directory="$(cd "$(dirname "${apk_path}")" && pwd -P)"
apk_name="$(basename "${apk_path}")"
readonly apk_directory apk_name
if [[ ! "${apk_name}" =~ ^sitepull-cli-([0-9]+\.[0-9]+\.[0-9]+)-r0\.apk$ ]]; then
  echo "Alpine smoke: unexpected APK name ${apk_name}." >&2
  exit 1
fi
package_version="${BASH_REMATCH[1]}"
readonly package_version

if [[ $# -eq 2 ]]; then
  public_key_path="$2"
else
  public_key_path="${apk_directory}/sitepull-alpine-v${package_version}.rsa.pub"
fi
if [[ ! -f "${public_key_path}" ]]; then
  echo "Alpine smoke: public key not found at ${public_key_path}." >&2
  exit 1
fi

key_directory="$(cd "$(dirname "${public_key_path}")" && pwd -P)"
key_name="$(basename "${public_key_path}")"
readonly key_directory key_name
if [[ "${key_name}" != "sitepull-alpine-v${package_version}.rsa.pub" ]]; then
  echo "Alpine smoke: unexpected public-key name ${key_name}." >&2
  exit 1
fi

docker run --rm \
  --init \
  --platform linux/amd64 \
  --security-opt "seccomp=${repository_root}/packaging/chromium/seccomp_profile.json" \
  --shm-size=1g \
  --volume "${repository_root}:/workspace:ro" \
  --volume "${apk_directory}/${apk_name}:/package/${apk_name}:ro" \
  --volume "${key_directory}/${key_name}:/package/${key_name}:ro" \
  "${alpine_image}" \
  sh /workspace/packaging/alpine/audit-apk.sh \
    "/package/${apk_name}" \
    "/package/${key_name}" \
    "${package_version}"
