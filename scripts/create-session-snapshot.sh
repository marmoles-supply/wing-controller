#!/usr/bin/env bash

set -euo pipefail

if [[ $# -lt 1 || $# -gt 2 ]]; then
  echo "Usage: $0 <session-slug> [source-release-dir]" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
SESSION_SLUG="$1"

cd "$REPO_ROOT"

if [[ $# -eq 2 ]]; then
  SOURCE_DIR="$2"
else
  SOURCE_DIR="$(find releases -mindepth 1 -maxdepth 1 -type d | sort | tail -n 1)"
fi

if [[ -z "${SOURCE_DIR:-}" || ! -d "$SOURCE_DIR" ]]; then
  echo "Could not resolve source release directory." >&2
  exit 1
fi

SNAPSHOT_DIR="releases/$(date '+%Y-%m-%d')-session-${SESSION_SLUG}-pre"
mkdir -p "$SNAPSHOT_DIR"

APP_VERSION="$(node -e "const app=require('./app.json'); console.log(app.expo.version);")"
APP_VERSION_CODE="$(node -e "const app=require('./app.json'); console.log(app.expo.android.versionCode);")"
GIT_BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo 'unknown')"
GIT_COMMIT="$(git rev-parse --short HEAD 2>/dev/null || echo 'unknown')"
GIT_STATUS="$(git status --short || true)"

if compgen -G "${SOURCE_DIR}/*.apk" >/dev/null; then
  cp "${SOURCE_DIR}"/*.apk "$SNAPSHOT_DIR"/
fi

if [[ -f "${SOURCE_DIR}/BUILD_MANIFEST.md" ]]; then
  cp "${SOURCE_DIR}/BUILD_MANIFEST.md" "${SNAPSHOT_DIR}/SOURCE_BUILD_MANIFEST.md"
fi

if compgen -G "${SNAPSHOT_DIR}/*.apk" >/dev/null; then
  shasum -a 256 "${SNAPSHOT_DIR}"/*.apk > "${SNAPSHOT_DIR}/SHA256SUMS.txt"
fi

INCLUDED_FILES=""
for file in "${SNAPSHOT_DIR}"/*; do
  if [[ -f "$file" ]]; then
    INCLUDED_FILES="${INCLUDED_FILES}- $(basename "$file")"$'\n'
  fi
done

cat > "${SNAPSHOT_DIR}/BUILD_MANIFEST.md" <<EOF
# WING Controller - Session Snapshot

- Date: $(date '+%Y-%m-%d')
- Time: $(date '+%H:%M:%S %z')
- Session slug: ${SESSION_SLUG}
- Source release directory: ${SOURCE_DIR}
- App version at snapshot time: ${APP_VERSION}
- Android versionCode at snapshot time: ${APP_VERSION_CODE}
- Git branch: ${GIT_BRANCH}
- Git commit: ${GIT_COMMIT}

## Snapshot Purpose

Rollback/reference point before a risky implementation session.

## Included Files

${INCLUDED_FILES}

## Git Status At Snapshot Time

\`\`\`text
${GIT_STATUS}
\`\`\`
EOF

echo "Created session snapshot:"
echo "  ${SNAPSHOT_DIR}"
