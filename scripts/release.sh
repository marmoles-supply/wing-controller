#!/usr/bin/env bash
# Build a release and verify it, in one step, so the two cannot come apart.
#
#   ./scripts/release.sh 0.2.67              build, checksums, verify the artefacts
#   ./scripts/release.sh 0.2.67 --install    …and install it, verifying the installed copy too
#
# What it refuses to skip:
#   * the version has to be free (`build-dist.sh` aborts on an already-issued one);
#   * `SHA256SUMS.txt` is written here, because `build-dist.sh` deliberately does not write it;
#   * `verify-install.sh` runs at the end — the check that caught three stale mounted volumes, a lost
#     custom icon and a release note whose build number had drifted (test-suite audit, S10/S18).
set -uo pipefail
cd "$(dirname "$0")/.."

VERSION="${1:-}"
if [ -z "$VERSION" ]; then
  echo "usage: $0 <version> [--install]" >&2
  exit 2
fi
VERSION="${VERSION#v}"
INSTALL_FLAG=""
for arg in "${@:2}"; do
  case "$arg" in
    --install) INSTALL_FLAG="--install" ;;
    *) echo "unknown argument: $arg" >&2; exit 2 ;;
  esac
done

echo "=== release ${VERSION}: notes and changelog must already be in place"
[ -f "desktop/release-notes/${VERSION}.md" ] || {
  echo "Error: desktop/release-notes/${VERSION}.md does not exist; write the notes before releasing." >&2
  exit 1
}

echo "=== build"
bash desktop/build-dist.sh || exit 1

echo "=== checksums"
[ -d "dist/v${VERSION}" ] || { echo "Error: dist/v${VERSION} is missing after the build." >&2; exit 1; }
(
  cd "dist/v${VERSION}" || exit 1
  rm -f SHA256SUMS.txt
  shasum -a 256 WING_CONTROLLER_v"${VERSION}"_AppleSilicon.dmg WING_CONTROLLER_v"${VERSION}"_AppleSilicon.zip > SHA256SUMS.txt || exit 1
  cat SHA256SUMS.txt
)

echo "=== verify the release${INSTALL_FLAG:+ and install it}"
./scripts/verify-install.sh "${VERSION}" ${INSTALL_FLAG}
