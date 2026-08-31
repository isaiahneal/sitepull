#!/usr/bin/env bash

set -euo pipefail

package_name="sitepull"
package_root="/usr/lib/sitepull"

if [[ "$(dpkg-query --show --showformat='${db:Status-Abbrev}' "${package_name}")" != "ii " ]]; then
  echo "${package_name} is not fully installed." >&2
  exit 1
fi

if [[ -n "${SITEPULL_EXPECTED_DEB_VERSION:-}" ]]; then
  installed_version="$(dpkg-query --show --showformat='${Version}' "${package_name}")"
  if [[ "${installed_version}" != "${SITEPULL_EXPECTED_DEB_VERSION}" ]]; then
    echo "Expected ${SITEPULL_EXPECTED_DEB_VERSION}, installed ${installed_version}." >&2
    exit 1
  fi
fi

executable="$(readlink -f "$(command -v sitepull)")"
if [[ "${executable}" != "${package_root}/Sitepull" || ! -x "${executable}" ]]; then
  echo "Unexpected Sitepull executable: ${executable}" >&2
  exit 1
fi

sandbox="${package_root}/chrome-sandbox"
if [[ "$(stat --format='%u:%g:%a' "${sandbox}")" != "0:0:4755" ]]; then
  echo "Electron sandbox helper is not root-owned mode 4755." >&2
  exit 1
fi

browser_root="${package_root}/resources/.playwright-browsers"
mapfile -d '' -t webkit_launchers < <(
  find "${browser_root}" -mindepth 2 -maxdepth 2 -type f -name pw_run.sh -print0
)
if [[ "${#webkit_launchers[@]}" -ne 1 || ! -x "${webkit_launchers[0]}" ]]; then
  echo "Expected exactly one executable packaged WebKit launcher." >&2
  exit 1
fi

electron_dependencies="$(ldd "${executable}")"
printf '%s\n' "${electron_dependencies}"
if grep -Fq 'not found' <<< "${electron_dependencies}"; then
  exit 1
fi

audit_webkit_flavor() {
  local flavor_root="$1"
  shift
  local dependencies relative target

  [[ -x "${flavor_root}/MiniBrowser" ]]
  for relative in "$@"; do
    target="${flavor_root}/${relative}"
    [[ -x "${target}" ]]
    if ! dependencies="$(
      LD_LIBRARY_PATH="${flavor_root}/lib:${flavor_root}/sys/lib" ldd "${target}" 2>&1
    )"; then
      printf 'ldd failed for %s\n%s\n' "${target}" "${dependencies}" >&2
      return 1
    fi
    if [[ "${dependencies}" == *'not found'* ]]; then
      printf 'Unresolved dependency for %s\n%s\n' "${target}" "${dependencies}" >&2
      return 1
    fi
  done
}

webkit_root="$(dirname "${webkit_launchers[0]}")"
audit_webkit_flavor "${webkit_root}/minibrowser-gtk" \
  bin/MiniBrowser bin/WebKitWebProcess bin/WebKitGPUProcess \
  bin/WebKitNetworkProcess lib/libwebkitgtkinjectedbundle.so
audit_webkit_flavor "${webkit_root}/minibrowser-wpe" \
  bin/MiniBrowser bin/WPEWebProcess bin/WPEGPUProcess \
  bin/WPENetworkProcess lib/libWPEInjectedBundle.so

echo "Audited the installed Electron, sandbox, and packaged GTK/WPE WebKit closures."
