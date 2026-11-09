#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
KEEP_AWAKE=0
RUN_CHECKS=1

for arg in "$@"; do
  case "$arg" in
    --keep-awake)
      KEEP_AWAKE=1
      ;;
    --no-checks)
      RUN_CHECKS=0
      ;;
    *)
      echo "Unknown argument: $arg" >&2
      echo "Usage: $0 [--keep-awake] [--no-checks]" >&2
      exit 1
      ;;
  esac
done

resolve_adb() {
  if command -v adb >/dev/null 2>&1; then
    command -v adb
    return 0
  fi

  local fallback="${ANDROID_HOME:-${HOME:-}/Library/Android/sdk}/platform-tools/adb"
  if [[ -x "$fallback" ]]; then
    echo "$fallback"
    return 0
  fi

  return 1
}

cd "$REPO_ROOT"

APP_VERSION="$(node -e "const app=require('./app.json'); console.log(app.expo.version);")"
APP_VERSION_CODE="$(node -e "const app=require('./app.json'); console.log(app.expo.android.versionCode);")"
PACKAGE_VERSION="$(node -e "const pkg=require('./package.json'); console.log(pkg.version);")"
GIT_BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo 'unknown')"
GIT_COMMIT="$(git rev-parse --short HEAD 2>/dev/null || echo 'unknown')"

echo "== Session Baseline =="
echo "Repo: $REPO_ROOT"
echo "Timestamp: $(date '+%Y-%m-%d %H:%M:%S %z')"
echo "Branch: $GIT_BRANCH"
echo "Commit: $GIT_COMMIT"
echo "app.json versionName: $APP_VERSION"
echo "app.json versionCode: $APP_VERSION_CODE"
echo "package.json version: $PACKAGE_VERSION"
echo
echo "-- Git status --"
git status --short || true
echo

if [[ "$RUN_CHECKS" -eq 1 ]]; then
  # The desktop app is the shipping product, so the baseline must exercise it. The
  # old baseline ran only TypeScript, HA maths and X32 mapping -- none of which touch
  # the desktop tree -- and a non-compiling desktop tree went unnoticed for hours.
  echo "-- Verification gate --"
  "$SCRIPT_DIR/verify-all.sh"
  echo
fi

if ADB_BIN="$(resolve_adb)"; then
  echo "-- ADB --"
  echo "adb: $ADB_BIN"
  "$ADB_BIN" devices
  echo
  if [[ "$KEEP_AWAKE" -eq 1 ]]; then
    "$ADB_BIN" shell svc power stayon true
    echo "Tablet keep-awake enabled."
    echo
  fi
  if "$ADB_BIN" shell dumpsys package com.usuario.wingcontroller >/tmp/wing-controller-package.txt 2>/dev/null; then
    echo "-- Installed package version --"
    rg "versionName|versionCode" /tmp/wing-controller-package.txt || true
    rm -f /tmp/wing-controller-package.txt
    echo
  else
    echo "Package com.usuario.wingcontroller not found on connected device."
    echo
  fi
else
  echo "-- ADB --"
  echo "adb not found in PATH and fallback path is unavailable."
  echo
fi

echo "Session baseline complete."
