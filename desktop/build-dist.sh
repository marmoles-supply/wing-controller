#!/usr/bin/env bash
set -euo pipefail
# With `set -e`, a command that returns non-zero ends the build - and until now it ended it silently, so a
# failure could only be guessed at from the last thing that happened to print. This trap names the line and
# the status, which is the difference between diagnosing a build and guessing at one.
trap 'status=$?; echo "build-dist: line ${LINENO} failed with status ${status}" >&2' ERR

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

echo "================================================"
echo "  WING CONTROLLER · macOS Distribution Builder"
echo "================================================"

# 0. Synchronize version across all manifests and client runtime
node "$ROOT_DIR/scripts/sync-version.mjs"

# Extract version from version.json (single source of truth)
APP_VERSION=$(node -p 'require("./version.json").version')
VERSION_TAG="v${APP_VERSION}"
echo "==> Detected build version: ${VERSION_TAG}"
RELEASE_NOTES_FILE="desktop/release-notes/${APP_VERSION}.md"
if [ ! -f "$RELEASE_NOTES_FILE" ]; then
  echo "Error: real release notes for this version are missing: $RELEASE_NOTES_FILE" >&2
  exit 1
fi

# A released version must never be overwritten: bump first with
# `node scripts/sync-version.mjs <new_version>` and add its release notes. The
# check looks for the finished DMG so a build that failed halfway can be retried.
RELEASED_DMG="$ROOT_DIR/dist/${VERSION_TAG}/WING_CONTROLLER_${VERSION_TAG}_AppleSilicon.dmg"
if [ -f "$RELEASED_DMG" ]; then
  echo "Error: ${VERSION_TAG} has already been released (${RELEASED_DMG})." >&2
  echo "       Bump the version before building:" >&2
  echo "         node scripts/sync-version.mjs <new_version>" >&2
  echo "         and create desktop/release-notes/<new_version>.md" >&2
  exit 1
fi
# 0.1. The signing identity must be there before a single line is compiled.
#
# Every build signs with one stable identity, because macOS anchors the microphone grant to the code
# requirement of the build that was granted: an ad-hoc signature's requirement is a per-build `cdhash`, so
# every build is a new identity, the TCC row still says "granted", the grant no longer applies and macOS
# never asks again — the app is told there are zero input devices (measured 2026-10-05; AGENTS.md,
# "Re-signing Ad-Hoc Loses The Microphone Grant"). Checking here, rather than at the signing step, means a
# machine that has never run the script learns it in a second instead of after a full compile; and there is
# deliberately no ad-hoc fallback, because a silent one would recreate exactly that bug while looking fine.
# shellcheck source=scripts/signing-identity.sh
. "$ROOT_DIR/scripts/signing-identity.sh"
if ! SIGNING_CERT_SHA1="$(bash "$ROOT_DIR/scripts/check-signing-identity.sh")"; then
  exit 1
fi
echo "==> Signing identity: ${WING_SIGNING_IDENTITY} (certificate SHA-1 ${SIGNING_CERT_SHA1})"

# 0.2. The compiler records the path of every source file that can panic, and cargo compiles dependencies
# from their absolute paths — so a shipped binary used to carry the build machine's home directory 261 times
# (measured 2026-10-09: 261 strings of the form `/Users/<account>/.cargo/registry/src/…`). `--remap-path-prefix` rewrites those
# prefixes, and the prefixes are read from the environment here so that no machine path is written into this
# repository. `scripts/audit-binary-shield.mjs` fails the build if any survive into the packaged binary.
# shellcheck source=scripts/build-paths.sh
. "$ROOT_DIR/scripts/build-paths.sh"
wing_export_sanitised_build_paths
echo "==> Build paths sanitised (no build-machine path is recorded in the binary)"

TAURI_CLI="$(command -v tauri || true)"
if [ -z "$TAURI_CLI" ] && [ -x "$ROOT_DIR/node_modules/.bin/tauri" ]; then
  TAURI_CLI="$ROOT_DIR/node_modules/.bin/tauri"
fi
if [ -z "$TAURI_CLI" ]; then
  for candidate in "$HOME"/.npm/_npx/*/node_modules/.bin/tauri; do
    if [ -x "$candidate" ]; then
      TAURI_CLI="$candidate"
      break
    fi
  done
fi
if [ -z "$TAURI_CLI" ]; then
  echo "Error: Tauri CLI 2 is not installed and not available in the local cache." >&2
  exit 1
fi

# 1. Regenerate desktop icons if needed from ui/icon.png
cd desktop
# `tauri icon` rewrites every size and the `.icns` from the master, and its output is not
# byte-deterministic (the PNGs carry a timestamp), so running it on every build left the tracked
# `src-tauri/icons/icon.icns` modified in git — a dirty tree for whoever came next. It only runs when it
# has something to do: the master is newer than the `.icns`, or one of the generated files is missing.
ICON_OUTPUTS="src-tauri/icons/icon.icns src-tauri/icons/icon.png src-tauri/icons/32x32.png src-tauri/icons/128x128.png"
ICON_NEEDS_BUILD=0
for icon in $ICON_OUTPUTS; do
  [ -f "$icon" ] || ICON_NEEDS_BUILD=1
done
if [ -f ui/icon.png ] && [ -f src-tauri/icons/icon.icns ] && [ ui/icon.png -nt src-tauri/icons/icon.icns ]; then
  ICON_NEEDS_BUILD=1
fi
if [ "$ICON_NEEDS_BUILD" -eq 1 ]; then
  echo "==> Regenerating the app icons from desktop/ui/icon.png..."
  "$TAURI_CLI" icon ui/icon.png > /dev/null
else
  echo "==> The app icons are up to date (ui/icon.png is not newer than src-tauri/icons/icon.icns)"
fi

# 1.1. The macOS icon must keep pure alpha around the marble W (project rule: never a dark square
# behind it). `tauri icon` regenerates every size from the master, so the master is what is checked,
# together with the generated PNGs, before anything is packaged.
for icon in ui/icon.png src-tauri/icons/icon.png src-tauri/icons/32x32.png src-tauri/icons/128x128.png; do
  if [ -f "$icon" ]; then
    if ! sips -g hasAlpha "$icon" 2>/dev/null | grep -q "hasAlpha: yes"; then
      echo "Error: $icon does not keep alpha transparency (project rule: no background and no box)." >&2
      exit 1
    fi
  fi
done

# 2. Build optimized release binary
echo "==> Building the optimised native binary in Release..."
cd "$ROOT_DIR"
cargo build --release -p wing-controller-desktop

# 3. Package into .app bundle with Tauri
echo "==> Packaging the macOS bundle (.app)..."
cd desktop
"$TAURI_CLI" build --no-sign --bundles app

# 4. Create versioned dist directory
cd "$ROOT_DIR"
BUNDLE_DIR="$ROOT_DIR/dist/${VERSION_TAG}"
mkdir -p "$BUNDLE_DIR"
APP_SOURCE="$ROOT_DIR/target/release/bundle/macos/WING CONTROLLER.app"

if [ ! -d "$APP_SOURCE" ]; then
  echo "Error: $APP_SOURCE was not found"
  exit 1
fi

# The legal/source inventory is required for public binary distribution. Prepare it
# before sealing the app, and retain a copy inside the app as well as beside it.
LEGAL_DIR="$BUNDLE_DIR/Legal"
node "$ROOT_DIR/scripts/prepare-release-legal.mjs" "$LEGAL_DIR"
rm -rf "$APP_SOURCE/Contents/Resources/Legal"
cp -R "$LEGAL_DIR" "$APP_SOURCE/Contents/Resources/Legal"

# 3.1. The binary that is about to be packaged must carry the interface encrypted and no symbol table.
#
# This is a measurement of the artefact, not a review of the source, and it is deliberately here — after the
# bundle is assembled and before anything is signed or packed — because the two defects it hunts are
# invisible in the source and obvious in the binary: Tauri's default asset provider stored all of
# `desktop/ui` brotli-compressed, and the default release profile left **12,254** of this project's own
# symbols in the clear, which `nm` reads back as a function-level map of the application (both measured on
# this tree, 2026-10-08; docs/BINARY_PROTECTION_PLAN_2026-10-09.md). A build that leaks cannot become a DMG.
echo "==> Auditing the shipped binary for leaked interface text and symbols..."
node "$ROOT_DIR/scripts/audit-binary-shield.mjs" "${APP_SOURCE}/Contents/MacOS/wing-controller-desktop"

# 4.1. Sanitize Info.plist (remove obsolete Carbon/Classic keys that cause "can't be opened" on modern Apple Silicon)
echo "==> Sanitising Info.plist for strict compatibility with Apple Silicon and modern macOS..."
INFO_PLIST="${APP_SOURCE}/Contents/Info.plist"
if [ -f "$INFO_PLIST" ]; then
  plutil -remove LSRequiresCarbon "$INFO_PLIST" 2>/dev/null || true
  plutil -remove CSResourcesFileMapped "$INFO_PLIST" 2>/dev/null || true
  plutil -replace LSMinimumSystemVersion -string "11.0" "$INFO_PLIST" 2>/dev/null || true
fi

# 4.2. Ensure executable permissions and clean extended attributes
echo "==> Ensuring executable permissions and clearing extended attributes..."
chmod 755 "${APP_SOURCE}/Contents/MacOS/wing-controller-desktop"
chmod -R a+rX "$APP_SOURCE"
xattr -cr "$APP_SOURCE"

# 4.3. Sign the entire bundle with the project's one stable identity — never ad-hoc.
echo "==> Signing the whole bundle with '${WING_SIGNING_IDENTITY}' (sealed Mach-O signature for Apple Silicon)..."
# The entitlements travel with the signature: this is the only place the application bundle is signed, so a signing
# call without them produces an app that lists audio devices and cannot open one — the hardened runtime checks the
# entitlement, not the declaration in Info.plist (found by measuring the built app, 2026-10-04).
#
# Why not `--sign -` (ad-hoc) any more: an ad-hoc signature's designated requirement is a per-build `cdhash`,
# so the microphone grant macOS recorded for the previous build stops applying to this one while its TCC row
# still says "granted" — and macOS never asks again (measured 2026-10-05, AGENTS.md). The requirement below
# pins the certificate instead, and is byte-identical for every build signed with it.
ENTITLEMENTS_FILE="$ROOT_DIR/desktop/src-tauri/entitlements.plist"
if [ -f "$ENTITLEMENTS_FILE" ]; then
  echo "    [ok] signing with entitlements: $(basename "$ENTITLEMENTS_FILE")"
  codesign --force --deep --sign "$WING_SIGNING_IDENTITY" --keychain "$WING_SIGNING_KEYCHAIN" \
    --entitlements "$ENTITLEMENTS_FILE" "$APP_SOURCE"
else
  echo "    [!] no entitlements file at $ENTITLEMENTS_FILE: the audio input will not be able to record"
  codesign --force --deep --sign "$WING_SIGNING_IDENTITY" --keychain "$WING_SIGNING_KEYCHAIN" "$APP_SOURCE"
fi
codesign --verify --deep --strict "$APP_SOURCE"

# The requirement has to name the certificate rather than a build hash: that is the whole point of the
# identity, and a signature that quietly came out ad-hoc — or from another certificate — would pass every
# check that only asks whether it verifies.
BUILT_REQUIREMENT="$(wing_signing_designated_requirement "$APP_SOURCE")"
if wing_signing_requirement_is_per_build_hash "$BUILT_REQUIREMENT"; then
  echo "Error: the bundle came out ad-hoc: its designated requirement is a per-build hash." >&2
  echo "       ${BUILT_REQUIREMENT}" >&2
  echo "       Every build must carry the same identity so the microphone grant survives an update." >&2
  exit 1
fi
if ! wing_signing_requirement_pins_certificate "$BUILT_REQUIREMENT" "$SIGNING_CERT_SHA1"; then
  echo "Error: the bundle's designated requirement does not name the certificate of '${WING_SIGNING_IDENTITY}'." >&2
  echo "       requirement: ${BUILT_REQUIREMENT:-unreadable}" >&2
  echo "       certificate: ${SIGNING_CERT_SHA1}" >&2
  exit 1
fi
echo "    [ok] designated requirement: ${BUILT_REQUIREMENT}"
# Read the signature once, and say everything if it is not what it should be: a check that reports only
# "it is not the authority" cannot be diagnosed from its own output, and this one cost three builds.
SIGNATURE_INFO="$(codesign -dvv "$APP_SOURCE" 2>&1 || true)"
if printf '%s\n' "$SIGNATURE_INFO" | grep -q '^Authority='"${WING_SIGNING_IDENTITY}"'$'; then
  echo "    [ok] the signature names '${WING_SIGNING_IDENTITY}'"
else
  echo "Error: the bundle's signature does not report '${WING_SIGNING_IDENTITY}' as its authority." >&2
  printf '%s\n' "$SIGNATURE_INFO" | grep -E '^(Authority|Signature|Identifier|CDHash|Executable)=' >&2 || true
  exit 1
fi

# 4.4. Custom icon. macOS 26 puts app icons into its "squircle" and composites a background
# behind the artwork (with the icon appearance set to Dark, a dark box); the `Assets.car` from
# actool does NOT avoid it. The only thing the system does not re-shape is a custom icon, so it is
# applied here, AFTER signing (applied before, the signature would reject it), and it is checked
# that it stuck. See `docs/ICON_MACOS26.md` for the full reasoning.
echo "==> Applying the custom icon (the only thing that avoids the macOS 26 box)..."
if [ -x "scripts/set-custom-icon.sh" ]; then
  (cd "$(pwd)" && ./scripts/set-custom-icon.sh "$APP_SOURCE" > /dev/null 2>&1) || true
  if ./scripts/set-custom-icon.sh --check "$APP_SOURCE" > /dev/null 2>&1; then
    echo "    [ok] custom icon applied"
  else
    echo "    [!] WARNING: the custom icon was not applied to the bundle"
  fi
  # Note: with the icon applied, `codesign --verify --strict` complains about the bundle AND the
  # executable ("resource fork, Finder information, or similar detritus not allowed"): the custom icon
  # lives in com.apple.FinderInfo. The seal made by 4.3 is still intact and the app launches (verified on
  # 0.2.34), but a clean strict verification cannot be promised. It is reported as it is.
  # See docs/ICON_MACOS26.md.
  if codesign --verify --strict "$APP_SOURCE/Contents/MacOS/wing-controller-desktop" > /dev/null 2>&1; then
    echo "    [ok] strict verification of the executable is clean"
  else
    echo "    [i] strict verification flags the icon metadata (expected; the app launches)"
  fi
fi
# The helper travels inside the DMG and the ZIP: it is what makes it possible to re-apply the icon
# after the unblocking (xattr -cr) deletes it, without the user having to look for anything.
ICON_HELPER_SRC="scripts/set-custom-icon.sh"

# 4.5. The identity the unlock helper checks before it unblocks anything. It is read from the bundle that
# was just built and signed, not from version.json, so the helper cannot promise a build the DMG does not
# carry; and a disagreement between the two is a build error rather than a helper that refuses its own app.
APP_SOURCE_INFO_PLIST="${APP_SOURCE}/Contents/Info.plist"
BUILT_BUNDLE_ID="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$APP_SOURCE_INFO_PLIST" 2>/dev/null || true)"
BUILT_BUNDLE_VERSION="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$APP_SOURCE_INFO_PLIST" 2>/dev/null || true)"
if [ -z "$BUILT_BUNDLE_ID" ] || [ -z "$BUILT_BUNDLE_VERSION" ]; then
  echo "Error: $APP_SOURCE_INFO_PLIST does not report a bundle identifier and version," >&2
  echo "       and the unlock helper validates both before it unblocks anything." >&2
  exit 1
fi
if [ "$BUILT_BUNDLE_VERSION" != "$APP_VERSION" ]; then
  echo "Error: the built bundle reports ${BUILT_BUNDLE_VERSION} while this release is ${APP_VERSION}." >&2
  echo "       The unlock helper would refuse to unblock the application it travels with." >&2
  exit 1
fi

# 4.5b. A declared identity is not a signature: a manipulated bundle can copy the identifier and the version out of
# a plist, which is why the helper also compares the CDHash of the candidate's main Mach-O with the one embedded
# below. It is the executable and not the bundle because, after the custom icon of 4.4, only the executable still
# verifies strictly — the icon lives in Finder metadata (see docs/reviews/QUEUE_DESIGN_2026-10-04.md, section 1).
# If the hash cannot be read the build stops: a helper that ships without it would accept anything that copies two
# strings, which is exactly the hole this closes.
BUILT_EXECUTABLE="$APP_SOURCE/Contents/MacOS/wing-controller-desktop"
if [ ! -f "$BUILT_EXECUTABLE" ]; then
  echo "Error: $BUILT_EXECUTABLE is missing, so the unlock helper cannot be given the CDHash it must expect." >&2
  exit 1
fi
if ! codesign --verify "$BUILT_EXECUTABLE" > /dev/null 2>&1; then
  echo "Error: the signature of $BUILT_EXECUTABLE does not verify strictly." >&2
  echo "       The unlock helper refuses any copy whose executable fails that check, its own application included." >&2
  exit 1
fi
BUILT_EXEC_CDHASH="$(codesign -dv --verbose=4 "$BUILT_EXECUTABLE" 2>&1 | awk -F= '/^CDHash=/{print $2; exit}' || true)"
if [ -z "$BUILT_EXEC_CDHASH" ]; then
  echo "Error: the CDHash of $BUILT_EXECUTABLE could not be read, and the unlock helper refuses to" >&2
  echo "       unblock anything without a hash to compare against." >&2
  exit 1
fi
echo "    [ok] the unlock helper will expect the executable CDHash ${BUILT_EXEC_CDHASH}"

# 4.6. The unlock helper, generated once because it ships twice (inside the image and inside the archive),
# and two hand-maintained copies drift. What changed on 2026-10-04 (independent security audit) is *what it
# is allowed to touch*: it used to pick /Applications first and hand whatever it found there — a bundle
# identifier and a version nobody read — to `xattr -cr` and `open`, so a stale or foreign application with
# the same name was unblocked and launched instead of the one that came with the download. Now:
#
#   * the copy beside the helper (the one from this download) is examined first, and **every** candidate is
#     checked before it is touched: the bundle identifier and the version must be this build's, both substituted
#     below from the signed bundle, and the candidate's main executable must verify strictly and report exactly
#     this build's executable CDHash — the one thing a manipulated copy cannot reproduce by editing a plist;
#   * a candidate that is not this build stops everything and prints its exact path; nothing is touched and
#     nothing is opened. That includes a copy with the right identifier and version but another executable: it is
#     indistinguishable from a manipulated build wearing the same number, so the whole run is refused rather than
#     unblocking the copy next door (docs/reviews/QUEUE_DESIGN_2026-10-04.md, section 1);
#   * a copy on a read-only volume (the mounted image) cannot be unblocked at all — measured 2026-10-04:
#     `xattr -cr` there fails with "Read-only file system" and removes nothing — so it is named, skipped, and
#     the installed copy is the one that is unblocked, which is what `README FIRST.txt` asks for;
#   * `chmod -R a+rX` is gone: it rewrote the mode of every file in the bundle, and nothing measured needed it;
#   * every copy that validated is unblocked, and the installed one is the one that is opened: running the
#     application from a mounted image can wedge it (see `README FIRST.txt`), and that is a measured defect of
#     this machine, not a preference.
write_unblock_helper() {
  local destination="$1"
  # Defence in depth next to the checks above: substituting an empty value would leave `EXPECTED_EXEC_CDHASH=""`,
  # which no candidate can match and which would refuse the application this download carries. Generating a helper
  # without the three expectations is a build error, never a helper that ships half a check.
  if [ -z "${BUILT_BUNDLE_ID:-}" ] || [ -z "${BUILT_BUNDLE_VERSION:-}" ] || [ -z "${BUILT_EXEC_CDHASH:-}" ]; then
    echo "Error: the unlock helper needs the bundle identifier, the version and the executable CDHash;" >&2
    echo "       refusing to generate one that carries an empty check." >&2
    exit 1
  fi
  cat << 'HELPER_EOF' > "$destination"
#!/usr/bin/env bash
clear
echo "======================================================="
echo "      WING CONTROLLER · Security Unblock (macOS)       "
echo "======================================================="
echo ""
DIR="$(cd "$(dirname "$0")" && pwd)"
# Substituted by the build from the signed bundle: the app this download carries, and nothing else.
EXPECTED_ID="__WING_BUNDLE_ID__"
EXPECTED_VERSION="__WING_BUNDLE_VERSION__"
# The CDHash of this build's main executable, read from the signed Mach-O. The identifier and the version above
# can be copied into any bundle; this cannot. It is the executable and not the bundle because after the custom
# icon only the executable verifies strictly.
EXPECTED_EXEC_CDHASH="__WING_EXEC_CDHASH__"
APP_NAME="WING CONTROLLER.app"
TARGETS=()
OPEN_THIS=""

# An unreadable Info.plist, a missing executable, a signature that does not verify or another CDHash all fail the
# check rather than passing it: a bundle whose identity cannot be read is not a bundle this command may unblock.
check_is_this_app() {
  local app="$1" identifier version exe found_cdhash
  identifier="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$app/Contents/Info.plist" 2>/dev/null || true)"
  version="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$app/Contents/Info.plist" 2>/dev/null || true)"
  if [ "$identifier" != "$EXPECTED_ID" ]; then
    echo "[!] That is not the application this download carries: $app"
    echo "    Its bundle identifier is '${identifier:-unreadable}' and the expected one is '$EXPECTED_ID'."
    echo "    Nothing has been unblocked and nothing has been opened."
    return 1
  fi
  if [ "$version" != "$EXPECTED_VERSION" ]; then
    echo "[!] That is a different WING CONTROLLER: $app"
    echo "    It is ${version:-a bundle with no version} and this download is $EXPECTED_VERSION."
    echo "    Nothing has been unblocked and nothing has been opened."
    return 1
  fi
  exe="$app/Contents/MacOS/wing-controller-desktop"
  if [ ! -f "$exe" ]; then
    echo "[!] That copy of WING CONTROLLER has no main executable:"
    echo "    $app"
    echo "    Nothing has been unblocked and nothing has been opened."
    return 1
  fi
  if ! /usr/bin/codesign --verify "$exe" > /dev/null 2>&1; then
    echo "[!] The executable signature of this copy does not verify:"
    echo "    $app"
    echo "    Nothing has been unblocked and nothing has been opened."
    return 1
  fi
  found_cdhash="$(/usr/bin/codesign -dv --verbose=4 "$exe" 2>&1 | /usr/bin/awk -F= '/^CDHash=/{print $2; exit}')"
  if [ "$found_cdhash" != "$EXPECTED_EXEC_CDHASH" ]; then
    echo "[!] The installed WING CONTROLLER is not the exact application this download carries:"
    echo "    $app"
    echo "    Expected executable CDHash: $EXPECTED_EXEC_CDHASH"
    echo "    Found executable CDHash:    ${found_cdhash:-unreadable}"
    echo "    Nothing has been unblocked and nothing has been opened."
    echo ""
    echo "    Replace that copy with the application from this download, then run this command again."
    return 1
  fi
  return 0
}

for candidate in "$DIR/$APP_NAME" "/Applications/$APP_NAME" "$HOME/Applications/$APP_NAME"; do
  [ -d "$candidate" ] || continue
  if [ ! -w "$candidate" ]; then
    echo "[-] $candidate is on a read-only volume (a mounted disk image): its quarantine cannot be removed there."
    continue
  fi
  if ! check_is_this_app "$candidate"; then
    echo ""
    echo "    Remove or replace that copy, then run this command again."
    read -p "Press Enter to close..."
    exit 1
  fi
  TARGETS+=("$candidate")
  # The installed copy is what gets opened, when there is one; the copy from the download is the fallback.
  if [ "$candidate" != "$DIR/$APP_NAME" ] && [ -z "$OPEN_THIS" ]; then
    OPEN_THIS="$candidate"
  fi
done

if [ "${#TARGETS[@]}" -eq 0 ]; then
  echo "[!] No 'WING CONTROLLER.app' that can be unblocked was found in this folder or in your Applications folder."
  echo "    A copy on a mounted disk image is read-only and cannot be unblocked from there."
  echo "    Drag 'WING CONTROLLER.app' into your Applications folder and double-click this command again."
  echo ""
  read -p "Press Enter to close..."
  exit 0
fi
if [ -z "$OPEN_THIS" ]; then
  OPEN_THIS="${TARGETS[0]}"
fi

for TARGET in "${TARGETS[@]}"; do
  echo "[-] Found: $TARGET"
  echo "[-] Removing the Gatekeeper quarantine attributes (xattr -cr)..."
  if ! xattr -cr "$TARGET"; then
    echo "[!] Quarantine removal failed for: $TARGET"
    echo "    The application has not been launched. Review its permissions and macOS approval."
    exit 1
  fi
  chmod 755 "$TARGET/Contents/MacOS/wing-controller-desktop" 2>/dev/null || true
  # `xattr -cr` ALSO deletes the custom icon (it lives in com.apple.FinderInfo), so it is re-applied here:
  # this is the only moment at which it is lost. Without this, macOS 26 puts the app back into its box.
  if [ -x "$DIR/set-custom-icon.sh" ]; then
    echo "[-] Restoring the custom icon (macOS 26 replaces it with its box)..."
    "$DIR/set-custom-icon.sh" "$TARGET" > /dev/null 2>&1 || echo "  [!] the custom icon could not be applied to $TARGET (the installed copy is checked by verify-install.sh)"
  fi
done

echo "[✓] WING CONTROLLER has been unblocked successfully!"
echo "[-] Launching the app..."
if ! open "$OPEN_THIS"; then
  echo "[!] macOS refused the launch request. Open the installed application manually after reviewing Privacy & Security."
  exit 1
fi
echo ""
echo "The launch request was accepted by macOS. Check the application window."
echo ""
read -p "Press Enter to close..."
HELPER_EOF
  /usr/bin/sed -i '' \
    -e "s|__WING_BUNDLE_ID__|${BUILT_BUNDLE_ID}|g" \
    -e "s|__WING_BUNDLE_VERSION__|${BUILT_BUNDLE_VERSION}|g" \
    -e "s|__WING_EXEC_CDHASH__|${BUILT_EXEC_CDHASH}|g" \
    "$destination"
  if grep -q '__WING_BUNDLE_ID__\|__WING_BUNDLE_VERSION__\|__WING_EXEC_CDHASH__' "$destination"; then
    echo "Error: the unlock helper still carries an unsubstituted placeholder at $destination" >&2
    exit 1
  fi
  chmod +x "$destination"
}

echo "==> Generating the DMG installer with GUID Partition Table (GPT) and native HFS+..."
DMG_RW="/tmp/wing-rw-$$.dmg"
rm -f "$DMG_RW"
hdiutil create -size 60m -fs HFS+ -volname "WING CONTROLLER" -ov "$DMG_RW" > /dev/null

MOUNT_INFO=$(hdiutil attach "$DMG_RW" -nobrowse)
MOUNT_DEV=$(echo "$MOUNT_INFO" | head -n 1 | awk '{print $1}')
MOUNT_PATH=$(echo "$MOUNT_INFO" | grep "/Volumes/" | sed 's/.*\/Volumes\//\/Volumes\//')

# Release the scratch image even if a later step fails. Without this a failed
# build left the volume mounted and /tmp/wing-rw-$$.dmg behind.
cleanup_dmg() {
  if [ -n "${MOUNT_DEV:-}" ]; then
    hdiutil detach "$MOUNT_DEV" > /dev/null 2>&1 \
      || hdiutil detach -force "$MOUNT_DEV" > /dev/null 2>&1 \
      || true
  fi
  rm -f "$DMG_RW"
}
trap cleanup_dmg EXIT

cp -R "$APP_SOURCE" "$MOUNT_PATH/"
cp "$ICON_HELPER_SRC" "$MOUNT_PATH/set-custom-icon.sh" 2>/dev/null || true
ln -s /Applications "$MOUNT_PATH/Applications"

# `cp -R` onto an HFS+ image puts an (empty) `com.apple.FinderInfo` back on the bundle, and
# `codesign --verify --strict` refuses it: "resource fork, Finder information, or similar detritus not
# allowed". The app sealed at the source (`xattr -cr` above) was clean, so the copy is cleaned too, and
# whoever installs from this image gets a bundle whose signature verifies without a manual step.
xattr -cr "$MOUNT_PATH/WING CONTROLLER.app" 2>/dev/null || true
# The custom icon lives in `Icon\r`'s resource fork plus the kHasCustomIcon bit, and `cp -R` onto an HFS+
# image copied the bit but not the fork. Measured on 0.2.67: the copy inside the DMG had an `Icon` file, the
# flag, and no picture, so running the app from the image showed macOS 26's dark tile while the installed
# copy looked right (owner's report, 2026-10-02). This re-applies both halves and fails the build if the
# picture is not there: an image that ships a tile-iconed application is a defect, not a warning.
if [ -f "$MOUNT_PATH/WING CONTROLLER.app/Contents/Resources/icon.icns" ]; then
  python3 "$ROOT_DIR/scripts/write-custom-icon.py" "$MOUNT_PATH/WING CONTROLLER.app" \
    "$MOUNT_PATH/WING CONTROLLER.app/Contents/Resources/icon.icns" > /dev/null \
    || { echo "  [!] could not write the custom icon into the disk image's copy"; exit 1; }
fi
python3 "$ROOT_DIR/scripts/write-custom-icon.py" --check "$MOUNT_PATH/WING CONTROLLER.app" > /dev/null \
  || { echo "  [!] the copy inside the disk image has no custom icon image"; exit 1; }

# The changelog travels with the image: the operator asked for the version's changelog inside the DMG.
cp "$ROOT_DIR/CHANGELOG.md" "$MOUNT_PATH/CHANGELOG.md"
cp -R "$LEGAL_DIR" "$MOUNT_PATH/Legal"
cp "$RELEASE_NOTES_FILE" "$MOUNT_PATH/RELEASE NOTES ${APP_VERSION}.md" 2>/dev/null || true

write_unblock_helper "$MOUNT_PATH/Unblock WING CONTROLLER.command"

sed "s/__WING_VERSION__/${APP_VERSION}/g" "$ROOT_DIR/desktop/INSTALLATION.txt" > "$MOUNT_PATH/README FIRST.txt"

# The happy-path detach needs the same resilience as `cleanup_dmg`: with ten of our own DMGs already
# mounted, macOS mounts the new one as "WING CONTROLLER 10" and a busy volume (Spotlight, Finder) made
# this detach fail, which aborted the build with `set -e` and left no artifacts at all.
hdiutil detach "$MOUNT_DEV" > /dev/null 2>&1 \
  || hdiutil detach "$MOUNT_DEV" > /dev/null 2>&1 \
  || hdiutil detach -force "$MOUNT_DEV" > /dev/null 2>&1 \
  || echo "  [!] WARNING: could not detach $MOUNT_DEV; a volume may be left mounted" \
  || true

DMG_RELEASE="${BUNDLE_DIR}/WING_CONTROLLER_${VERSION_TAG}_AppleSilicon.dmg"
rm -f "$DMG_RELEASE"
hdiutil convert "$DMG_RW" -format UDZO -ov -o "$DMG_RELEASE" > /dev/null
rm -f "$DMG_RW"
# The image is signed with the same identity as the application it carries: one identity per build, not two.
if ! codesign --force --sign "$WING_SIGNING_IDENTITY" --keychain "$WING_SIGNING_KEYCHAIN" "$DMG_RELEASE" > /dev/null 2>&1; then
  echo "Error: $DMG_RELEASE could not be signed with '${WING_SIGNING_IDENTITY}'." >&2
  exit 1
fi
codesign --verify "$DMG_RELEASE" || {
  echo "Error: the signature of $DMG_RELEASE does not verify." >&2
  exit 1
}

echo "==> Generating the compressed ZIP archive with the README and the clickable command..."
ZIP_RELEASE="${BUNDLE_DIR}/WING_CONTROLLER_${VERSION_TAG}_AppleSilicon.zip"
rm -f "$ZIP_RELEASE"

ZIP_STAGING="/tmp/wing-zip-staging-$$"
rm -rf "$ZIP_STAGING"
mkdir -p "$ZIP_STAGING/WING_CONTROLLER_${VERSION_TAG}_AppleSilicon"
cp -R "$APP_SOURCE" "$ZIP_STAGING/WING_CONTROLLER_${VERSION_TAG}_AppleSilicon/"
cp "$ICON_HELPER_SRC" "$ZIP_STAGING/WING_CONTROLLER_${VERSION_TAG}_AppleSilicon/" 2>/dev/null || true
# The application inside the ZIP gets the same treatment as the one inside the image, for the same reason.
if [ -f "$ZIP_STAGING/WING_CONTROLLER_${VERSION_TAG}_AppleSilicon/WING CONTROLLER.app/Contents/Resources/icon.icns" ]; then
  python3 "$ROOT_DIR/scripts/write-custom-icon.py" \
    "$ZIP_STAGING/WING_CONTROLLER_${VERSION_TAG}_AppleSilicon/WING CONTROLLER.app" \
    "$ZIP_STAGING/WING_CONTROLLER_${VERSION_TAG}_AppleSilicon/WING CONTROLLER.app/Contents/Resources/icon.icns" \
    > /dev/null || { echo "  [!] could not write the custom icon into the ZIP's copy"; exit 1; }
fi
python3 "$ROOT_DIR/scripts/write-custom-icon.py" --check \
  "$ZIP_STAGING/WING_CONTROLLER_${VERSION_TAG}_AppleSilicon/WING CONTROLLER.app" > /dev/null \
  || { echo "  [!] the copy inside the ZIP has no custom icon image"; exit 1; }
cp "$ROOT_DIR/CHANGELOG.md" "$ZIP_STAGING/WING_CONTROLLER_${VERSION_TAG}_AppleSilicon/CHANGELOG.md"
cp -R "$LEGAL_DIR" "$ZIP_STAGING/WING_CONTROLLER_${VERSION_TAG}_AppleSilicon/Legal"
cp "$RELEASE_NOTES_FILE" "$ZIP_STAGING/WING_CONTROLLER_${VERSION_TAG}_AppleSilicon/RELEASE NOTES ${APP_VERSION}.md" 2>/dev/null || true
write_unblock_helper "$ZIP_STAGING/WING_CONTROLLER_${VERSION_TAG}_AppleSilicon/Unblock WING CONTROLLER.command"

sed "s/__WING_VERSION__/${APP_VERSION}/g" "$ROOT_DIR/desktop/INSTALLATION.txt" > "$ZIP_STAGING/WING_CONTROLLER_${VERSION_TAG}_AppleSilicon/README FIRST.txt"

cd "$ZIP_STAGING"
ditto -c -k --sequesterRsrc "WING_CONTROLLER_${VERSION_TAG}_AppleSilicon" "$ZIP_RELEASE"
cd "$ROOT_DIR"
rm -rf "$ZIP_STAGING"

# Also update latest root links in dist/
cp "$DMG_RELEASE" "$ROOT_DIR/dist/WING_CONTROLLER_${VERSION_TAG}_AppleSilicon.dmg"
cp "$ZIP_RELEASE" "$ROOT_DIR/dist/WING_CONTROLLER_${VERSION_TAG}_AppleSilicon.zip"

# A release carries its own reviewed notes, not a recycled generic changelog.
cp "$RELEASE_NOTES_FILE" "${BUNDLE_DIR}/CHANGELOG.md"

echo ""
echo "================================================"
echo "  PACKAGES READY IN /dist/${VERSION_TAG}:"
echo "================================================"
ls -lh "$BUNDLE_DIR"
echo ""
echo "Done! Packages and CHANGELOG generated for ${VERSION_TAG}."
