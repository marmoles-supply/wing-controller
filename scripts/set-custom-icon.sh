#!/usr/bin/env bash
# Give a copied/installed WING CONTROLLER.app its icon as a *custom icon*.
#
# WHY THIS EXISTS
# ---------------
# macOS 26 (Tahoe) forces every app-bundle icon into the system "squircle": a
# rounded-rectangle tile with a system-chosen background. An app that ships only
# a legacy `.icns`/`Assets.car` icon gets that tile composited behind its
# artwork, which is why the transparent marble W appeared on a dark rounded
# square in the Dock even though every PNG and every frame of `icon.icns`
# measures pure alpha (see `scripts/test-desktop-icon-assets.mjs`, which verifies
# the files but cannot verify what the window server draws).
#
# Measured on macOS 26.6.2 (25G83), icon appearance "Dark"
# (`defaults read -g AppleIconAppearanceTheme` -> RegularDark):
#   * legacy .icns only            -> dark square, W on top
#   * actool Assets.car + CFBundleIconName (Icon Composer `.icon`) -> dark square
#   * same, with `"fill": "none"` or an authored fully transparent fill -> dark square
#   * icon appearance Default/Dark/Tinted/Clear -> the square stays, only recolours
#   * icon set as a CUSTOM icon    -> artwork drawn as-is, no square
#
# The one thing macOS 26 does not re-shape is a *custom* icon, i.e. the Finder
# "Get Info -> paste an icon" mechanism: an `Icon\r` file at the root of the
# bundle plus the kHasCustomIcon bit (0x0400) in the bundle's
# `com.apple.FinderInfo` extended attribute. This script applies exactly that,
# using the ObjC bridge in JXA (`osascript -l JavaScript`) so it needs no Xcode,
# no `Rez` and no `SetFile`.
#
# IMPORTANT: `xattr -cr` (used by the "Desbloquear WING CONTROLLER.command"
# shipped in the DMG) deletes `com.apple.FinderInfo` and the resource fork, so
# it removes the custom icon. Run this script AFTER unlocking, never before.
#
# The custom icon survives `cp -R`, `hdiutil` DMG creation and extraction from
# the mounted volume (verified), so it can be applied either here on the
# installed copy or to the .app before packaging.
#
# Usage:
#   ./scripts/set-custom-icon.sh                       # /Applications/WING CONTROLLER.app
#   ./scripts/set-custom-icon.sh "/path/to/WING CONTROLLER.app"
#   ./scripts/set-custom-icon.sh --check "/path/to/App.app"

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEFAULT_APP="/Applications/WING CONTROLLER.app"
APP_NAME="WING CONTROLLER"
ICON_FILE_NAME=$'Icon\r'
CUSTOM_ICON_FLAG=$((0x0400)) # Carbon kHasCustomIcon

CHECK_ONLY=0
APP_PATH=""

usage() {
  sed -n '2,50p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
}

for arg in "$@"; do
  case "$arg" in
    --check) CHECK_ONLY=1 ;;
    -h|--help) usage; exit 0 ;;
    *) APP_PATH="$arg" ;;
  esac
done
APP_PATH="${APP_PATH:-$DEFAULT_APP}"

if [ ! -d "$APP_PATH" ]; then
  echo "Error: no such bundle: $APP_PATH" >&2
  echo "       Drag 'WING CONTROLLER.app' into /Applications or pass the path as an argument." >&2
  exit 1
fi

# Which artwork to use: the bundle's own icon.icns has every size already, so it
# is the natural source. Fall back to the repo master (a PNG) when present.
ICON_SOURCE=""
for candidate in \
  "$APP_PATH/Contents/Resources/icon.icns" \
  "$APP_PATH/Contents/Resources/AppIcon.icns" \
  "$ROOT_DIR/desktop/ui/icon.png"
do
  if [ -f "$candidate" ]; then ICON_SOURCE="$candidate"; break; fi
done

if [ -z "$ICON_SOURCE" ] && [ "$CHECK_ONLY" -eq 0 ]; then
  echo "Error: no source icon was found (neither Contents/Resources/icon.icns nor desktop/ui/icon.png)." >&2
  exit 1
fi

# Read the finderFlags word (offset 8, big-endian) of com.apple.FinderInfo.
finder_flags() {
  local hex
  hex="$(xattr -px com.apple.FinderInfo "$1" 2>/dev/null | tr -d ' \n')" || return 1
  [ -n "$hex" ] || return 1
  # bytes 8..9 -> hex characters 17..20
  local pair="${hex:16:4}"
  [ "${#pair}" -eq 4 ] || return 1
  printf '%d\n' "0x${pair}"
}

has_custom_icon() {
  local flags
  flags="$(finder_flags "$1")" || return 1
  [ $((flags & CUSTOM_ICON_FLAG)) -ne 0 ]
}

report_state() {
  # The flag and the marker file are not enough: on this machine `setIcon:forFile:options:` sets the flag
  # and creates `Icon\r` while leaving the **image** out of the resource fork, and Finder then falls back
  # to the bundle's icon.icns with macOS 26's dark tile behind it — while this check happily said "[ok]
  # custom icon present". Measured on macOS 26.6.2 (25G83). The image is what is checked now.
  local icon_file=$'Icon\r'
  if has_custom_icon "$1" && [ -f "$1/$icon_file" ] && python3 "$ROOT_DIR/scripts/write-custom-icon.py" --check "$1" >/dev/null 2>&1; then
    echo "[ok] custom icon present, with its image"
    return 0
  fi
  echo "[--] no custom icon with an image (macOS 26 will draw the tile)"
  return 1
}

if [ "$CHECK_ONLY" -eq 1 ]; then
  echo "==> $APP_PATH"
  report_state "$APP_PATH" && exit 0 || exit 1
fi

# A read-only volume (an app still inside a mounted DMG) cannot hold the
# extended attribute or the Icon file.
if [ ! -w "$APP_PATH" ]; then
  echo "Error: $APP_PATH is not writable (is it inside a mounted DMG?)." >&2
  echo "       Copy the app to /Applications and run this script again." >&2
  exit 1
fi
# A running copy is a reason to say so and carry on, not to refuse.
#
# The icon is written to the bundle on disk, and the window server reads it when the application starts, so
# patching a running copy is safe — it just does not change the icon of the instance already on screen. This
# used to exit 1, and the cost was real: the release verification applies the icon to the installed copy while
# the operator may well be running the application he is testing, the install swallowed the failure with
# `|| true`, and the check afterwards reported "installed icon FAIL" on a release that was fine (2026-10-02).
# The pattern is still anchored to the full path: without the `^`, `pgrep -f` matches ANY running copy of the
# app, including one in a mounted disk image.
RUNNING_COPY=0
if pgrep -f -- "^${APP_PATH}/Contents/MacOS/" >/dev/null 2>&1; then
  RUNNING_COPY=1
  echo "    [!] a copy of WING CONTROLLER is running: the icon is applied to the bundle, but that window"
  echo "        keeps the old one until you quit and open it again."
fi

echo "==> Applying the custom icon to: $APP_PATH"
echo "    artwork source: $ICON_SOURCE"

# NSWorkspace -setIcon:forFile:options: via the ObjC bridge. This is the same
# API the Finder uses for "Get Info -> paste icon"; it writes the `Icon\r` file
# (with the 'icns' resource fork the window server reads) and sets kHasCustomIcon.
osascript -l JavaScript - "$ICON_SOURCE" "$APP_PATH" <<'JXA'
ObjC.import('AppKit');
function run(argv) {
  const source = argv[0];
  const target = argv[1];
  const image = $.NSImage.alloc.initWithContentsOfFile(source);
  if (!image || image.isNil()) {
    return 'Error: NSImage could not load ' + source;
  }
  const ok = $.NSWorkspace.sharedWorkspace.setIconForFileOptions(image, target, 0);
  return ok ? 'OK' : 'Error: setIcon:forFile:options: returned false';
}
JXA
echo

if ! report_state "$APP_PATH"; then
  # The marker is there but the image is not, which is what this macOS leaves behind: write the resource
  # fork ourselves (`scripts/write-custom-icon.py`), then check again.
  echo "==> The image is missing from the resource fork; writing it directly..."
  if [ -n "$ICON_SOURCE" ] && python3 "$ROOT_DIR/scripts/write-custom-icon.py" "$APP_PATH" "$ICON_SOURCE"; then
    if ! report_state "$APP_PATH"; then
      echo "Error: the custom icon was not applied correctly to $APP_PATH" >&2
      exit 1
    fi
  else
    echo "Error: the custom icon was not applied correctly to $APP_PATH" >&2
    exit 1
  fi
fi

# The Dock and LaunchServices cache icons per bundle path, and neither re-reads them just because the
# bundle changed: the owner's icon stayed black until he ran the DMG's unblock command, which re-applies
# the icon and then *opens* the application (2026-10-02). So the caches are invalidated here, as part of
# applying the icon: LaunchServices is told the bundle changed, and the Dock and Finder are restarted.
LSREGISTER="/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister"
if [ -x "$LSREGISTER" ]; then
  echo "==> Telling LaunchServices the bundle changed..."
  "$LSREGISTER" -f "$APP_PATH" >/dev/null 2>&1 || true
fi
echo "==> Restarting the Dock and Finder so that they pick up the new icon..."
killall Dock 2>/dev/null || true
killall Finder 2>/dev/null || true
cat <<'NOTE'

If the icon still looks like the system's tile, the application was running when it was applied: quit it
completely and open it again (the window server reads the icon at launch). A logout clears any remaining
appearance cache.
NOTE

cat <<MSG

Done. Open WING CONTROLLER and the Dock will show the marble W with no tile.

Notes:
  * Do not run 'xattr -cr' over the app again: it deletes com.apple.FinderInfo
    and the resource fork, and with them the custom icon. If you already did,
    run this script again.
  * Copying the app to another folder (dragging it in the Finder) keeps the
    icon; so does copying it with 'cp -R'.
  * To check the state: $0 --check "$APP_PATH"
MSG
