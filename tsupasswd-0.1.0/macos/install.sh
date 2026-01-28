#!/usr/bin/env bash
set -euo pipefail

# Simple installer for tsupasswd Chrome extension native helper (Linux + Chrome)
# Usage:
#   sudo ./install.sh <chrome-extension-id>
# Example:
#   sudo ./install.sh abcdefghijklmnopqrstuvwxyz012345

if [ "${EUID}" -ne 0 ]; then
  echo "[ERROR] Please run this script with sudo or as root." >&2
  exit 1
fi

if [ $# -lt 1 ]; then
  echo "Usage: sudo $0 <chrome-extension-id>" >&2
  exit 1
fi

EXT_ID="$1"

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BIN_DIR="/usr/local/bin"

OS_NAME="$(uname -s)"

get_user_home() {
  local user="$1"

  if command -v getent >/dev/null 2>&1; then
    getent passwd "${user}" | cut -d: -f6
    return 0
  fi

  if [ "${OS_NAME}" = "Darwin" ]; then
    dscl . -read "/Users/${user}" NFSHomeDirectory 2>/dev/null | awk '{print $2}'
    return 0
  fi

  eval echo "~${user}"
}

make_tmpfile() {
  if [ "${OS_NAME}" = "Darwin" ]; then
    mktemp -t tsupasswd
  else
    mktemp
  fi
}

# When run via sudo, HOME will be /root, but the NativeMessaging host must be
# installed for the invoking user (SUDO_USER). Detect that and target their
# home directory instead.
TARGET_USER="${SUDO_USER:-${USER}}"
TARGET_HOME="$(get_user_home "${TARGET_USER}")"

if [ -z "${TARGET_HOME}" ]; then
  echo "[ERROR] Failed to detect home directory for user: ${TARGET_USER}" >&2
  exit 1
fi

if [ "${OS_NAME}" = "Darwin" ]; then
  CHROME_NATIVE_DIR="${TARGET_HOME}/Library/Application Support/Google/Chrome/NativeMessagingHosts"
else
  CHROME_NATIVE_DIR="${TARGET_HOME}/.config/google-chrome/NativeMessagingHosts"
fi

HOST_BINARY_SRC="${REPO_DIR}/tsupasswd-host"
CLI_BINARY_SRC="${REPO_DIR}/tsupasswd"
HOST_MANIFEST_SRC="${REPO_DIR}/dev.happyfactory.tsupasswd.json"

HOST_BINARY_DST="${BIN_DIR}/tsupasswd-host"
CLI_BINARY_DST="${BIN_DIR}/tsupasswd"
HOST_MANIFEST_DST="${CHROME_NATIVE_DIR}/dev.happyfactory.tsupasswd.json"

# 1. Install binaries
mkdir -p "${BIN_DIR}"

if [ ! -f "${HOST_BINARY_SRC}" ]; then
  echo "[ERROR] Host binary not found: ${HOST_BINARY_SRC}" >&2
  exit 1
fi

if [ ! -f "${CLI_BINARY_SRC}" ]; then
  echo "[ERROR] CLI binary not found: ${CLI_BINARY_SRC}" >&2
  exit 1
fi

cp "${HOST_BINARY_SRC}" "${HOST_BINARY_DST}"
cp "${CLI_BINARY_SRC}" "${CLI_BINARY_DST}"
chmod +x "${HOST_BINARY_DST}" "${CLI_BINARY_DST}"

echo "[INFO] Installed binaries to ${BIN_DIR}" 

# 2. Prepare NativeMessaging host manifest
if [ ! -f "${HOST_MANIFEST_SRC}" ]; then
  echo "[ERROR] Host manifest not found: ${HOST_MANIFEST_SRC}" >&2
  exit 1
fi

mkdir -p "${CHROME_NATIVE_DIR}"

# Replace extension ID in manifest and write to destination
# Assumes manifest contains a single allowed_origins entry we can safely replace.
TMP_MANIFEST="$(make_tmpfile)"
sed "s#chrome-extension://.\{32\}/#chrome-extension://${EXT_ID}/#" "${HOST_MANIFEST_SRC}" > "${TMP_MANIFEST}"

cp "${TMP_MANIFEST}" "${HOST_MANIFEST_DST}"
rm -f "${TMP_MANIFEST}"

echo "[INFO] Installed NativeMessaging host manifest to ${HOST_MANIFEST_DST}" 

cat <<EOF
[DONE]

Installation finished.
- Binaries installed to: ${BIN_DIR}
- NativeMessaging host manifest: ${HOST_MANIFEST_DST}

Next steps:
1. Make sure the Chrome extension with ID ${EXT_ID} is installed.
2. Completely restart Chrome (all windows closed) and try the extension.
EOF
