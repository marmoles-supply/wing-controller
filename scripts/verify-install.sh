#!/usr/bin/env bash
# Verifies a build the way the release procedure has always done it by hand: the artefacts and their
# hashes, the application inside the DMG (version and signature), that the image is detached
# afterwards, and — with --install — the installed copy and its single instance.
#
# Since 2026-10-05 it also verifies the *identity* every copy is signed with, and that the designated
# requirement is the same on all of them and names the certificate rather than a per-build hash. That is
# the property the microphone grant depends on: macOS stores the grant against the code requirement of the
# build that was granted, so a per-build requirement (what an ad-hoc signature produces) means the grant
# stops applying to the next build while its TCC row still says "granted" (AGENTS.md, "Re-signing Ad-Hoc
# Loses The Microphone Grant").
#
# Written for the readiness audit (docs/SHOW_READINESS_RESULTS_2026-09-30.md, A7): the steps existed
# only as a list in the project's head, so a release could be declared verified without anyone able to
# say which checks ran. Every line prints PASS or FAIL and the script exits non-zero on the first FAIL.
#
# Usage: ./scripts/verify-install.sh <version> [--install] [--no-mount]
#   <version>   the version under dist/, with or without the leading v (e.g. 0.2.61)
#   --install   copy the app into /Applications over whatever is there (a state change: off by default)
#   --no-mount  skip the DMG mount check (for a machine that cannot mount images)

set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

VERSION="${1:-}"
if [ -z "$VERSION" ]; then
  echo "usage: $0 <version> [--install] [--no-mount]" >&2
  exit 2
fi
VERSION="${VERSION#v}"
INSTALL=0
MOUNT_CHECK=1
# A machine with nothing installed used to skip four checks (icon, version, signature, single instance) and
# still print "ALL CHECKS PASSED": the release verification could pass having verified nothing (audit
# 2026-10-02, S10). The skip has to be asked for.
ALLOW_MISSING_INSTALL=0
for arg in "${@:2}"; do
  case "$arg" in
    --install) INSTALL=1 ;;
    --no-mount) MOUNT_CHECK=0 ;;
    --allow-missing-install) ALLOW_MISSING_INSTALL=1 ;;
    *) echo "unknown argument: $arg" >&2; exit 2 ;;
  esac
done

FAILED=0
pass() { printf '%-58s%s\n' "$1" "PASS"; }
fail() { printf '%-58s%s\n' "$1" "FAIL: $2"; FAILED=1; }

# ---------------------------------------------------------------------------
# The signing identity, and the designated requirement of every copy.
#
# The build signs with one stable identity (`scripts/create-signing-identity.sh` mints it once per machine;
# `desktop/build-dist.sh` refuses to build without it). This measures that the property survived into the
# artefacts: every copy names that identity, none of them is ad-hoc, and every requirement is anchored to
# the same certificate — `identifier "…" and certificate leaf = H"…"` — rather than to a per-build cdhash.
# A requirement that changes per build is exactly what broke the microphone grant (AGENTS.md).
#
# The keychain is NOT required for this: the certificate and the requirement are embedded in the signature,
# so the artefacts can be verified on a machine that never had the identity. When the identity is present
# its certificate digest is an extra cross-check; the name is the contract either way.
# ---------------------------------------------------------------------------
# shellcheck source=scripts/signing-identity.sh
. "$ROOT_DIR/scripts/signing-identity.sh"
EXPECTED_CERT_SHA1="$(wing_signing_certificate_sha1)"
STABLE_REQUIREMENTS=()

check_stable_signature() { # $1 label, $2 path of a bundle or a Mach-O
  local label="$1" path="$2" info requirement authorities
  info="$(codesign -dvv "$path" 2>&1)"
  if printf '%s\n' "$info" | grep -q '^Signature=adhoc'; then
    fail "${label} signature" "it is ad-hoc: a new code identity on every build, which is what loses the microphone grant"
    return 1
  fi
  if ! printf '%s\n' "$info" | grep -qF "Authority=${WING_SIGNING_IDENTITY}"; then
    authorities="$(printf '%s\n' "$info" | awk -F= '/^Authority=/{ print $2 }' | tr '\n' ',' | sed 's/,$//')"
    fail "${label} signature" "not signed with '${WING_SIGNING_IDENTITY}' (Authority: ${authorities:-none})"
    return 1
  fi
  requirement="$(wing_signing_designated_requirement "$path")"
  if wing_signing_requirement_is_per_build_hash "$requirement"; then
    fail "${label} requirement" "it pins a per-build hash, so the next build would be a new identity: ${requirement}"
    return 1
  fi
  if [ -n "$EXPECTED_CERT_SHA1" ]; then
    if ! wing_signing_requirement_pins_certificate "$requirement" "$EXPECTED_CERT_SHA1"; then
      fail "${label} requirement" "it does not name the certificate of '${WING_SIGNING_IDENTITY}' (${EXPECTED_CERT_SHA1}): ${requirement:-unreadable}"
      return 1
    fi
  elif ! printf '%s' "$requirement" | grep -qi 'certificate leaf'; then
    fail "${label} requirement" "it is not anchored to a certificate: ${requirement:-unreadable}"
    return 1
  fi
  local architecture
  architecture="$(lipo -archs "$path/Contents/MacOS/wing-controller-desktop" 2>/dev/null || lipo -archs "$path" 2>/dev/null || true)"
  if [ "$architecture" != "arm64" ]; then
    fail "${label} architecture" "expected arm64, found ${architecture:-unreadable}"
    return 1
  fi
  pass "${label} is arm64 and signed with ${WING_SIGNING_IDENTITY}"
  STABLE_REQUIREMENTS+=("${label}|${requirement}")
  return 0
}

if [ -n "$EXPECTED_CERT_SHA1" ]; then
  pass "the signing identity is in the keychain"
else
  echo "note: '${WING_SIGNING_IDENTITY}' is not in ${WING_SIGNING_KEYCHAIN}: the signatures and their"
  echo "      requirements are checked against the identity name every copy must carry, and for stability"
  echo "      across the copies; run ./scripts/create-signing-identity.sh to mint it on this machine"
fi

# The unlock helper has to prove what it is about to touch *before* it touches it (independent security audit,
# 2026-10-04: it used to take whatever `/Applications/WING CONTROLLER.app` was and unblock and launch it without
# reading anything about it). A text search for the check would pass on a comment, so this is measured: the
# helper exactly as it ships is **run**, in a sandbox, over bundles that are and are not this build.
#
#   * its `/Applications` search root is rewritten into the sandbox — the only edit made to the shipped text —
#     and `open` is shadowed there, so a helper that got as far as launching something is caught instead of
#     launching it;
#   * a bundle with another identifier, and one with this identifier and another version, must both be refused,
#     with their exact path printed and with nothing touched: quarantine, modes and nothing opened;
#   * a bundle with the right identifier and version but an unsigned executable, one with no main executable at
#     all, and one with another *signed* executable, must all three be refused: the declared identity is not a
#     signature, and the helper verifies the main Mach-O and compares its CDHash
#     (docs/reviews/QUEUE_DESIGN_2026-10-04.md, section 1);
#   * a valid copy beside the helper and an installed copy with the right identity but another executable is a
#     fatal refusal for the whole run: nothing is touched, not even the candidate that validated;
#   * an empty sandbox must produce no invented target at all;
#   * a sandbox holding this build must unblock it, and open the installed copy rather than the one beside the
#     helper, which is the rule `README FIRST.txt` teaches (running from a mounted image can wedge the app).
#
# The signed binary the cases need is a two-line Mach-O compiled and ad-hoc signed *in the sandbox*: a shell
# script has no signature to verify, so a check against one would only measure the helper's text. Nothing of the
# application is compiled or built here, and the test helper is then given the CDHash of that very binary, which
# is what lets the happy path be measured without a build.
SANDBOX_SIGNED_EXEC=""
SANDBOX_OTHER_EXEC=""

unlock_sandbox_signed_exe() { # $1 output path, $2 C statement (default: return 0); prints the CDHash it reads back
  local out="$1" body="${2:-return 0;}"
  printf 'int main(void) { %s }\n' "$body" > "${out}.c" || return 1
  cc "${out}.c" -o "$out" || return 1
  codesign --force --sign - "$out" > /dev/null 2>&1 || return 1
  codesign -dv --verbose=4 "$out" 2>&1 | awk -F= '/^CDHash=/{print $2; exit}'
}

unlock_sandbox_bundle() { # $1 app path, $2 bundle identifier, $3 version, $4 signed|other|missing|unsigned (default signed)
  local app="$1" signing="${4:-signed}" exe
  mkdir -p "$app/Contents/MacOS"
  cat > "$app/Contents/Info.plist" <<PLIST_EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>$2</string>
<key>CFBundleShortVersionString</key><string>$3</string>
</dict></plist>
PLIST_EOF
  exe="$app/Contents/MacOS/wing-controller-desktop"
  case "$signing" in
    signed) cp "$SANDBOX_SIGNED_EXEC" "$exe" ;;
    other) cp "$SANDBOX_OTHER_EXEC" "$exe" ;;
    missing) rm -f "$exe" ;;
    *) printf '#!/bin/sh\nexit 0\n' > "$exe" ;;
  esac
  # 644, not the executable's own mode: what the helper is supposed to chmod to 755 on the copies it accepts is
  # measured from here, and a signature does not cover the file mode (measured on macOS 26, 2026-10-04).
  [ -f "$exe" ] && chmod 644 "$exe"
  # What the helper is supposed to remove, and what it must leave alone when it refuses: both halves are set,
  # so "it touched nothing" is a measurement rather than an assumption.
  xattr -w com.apple.quarantine "0081;wing-verify-install;check;" "$app" 2>/dev/null || true
  xattr -w com.apple.quarantine "0081;wing-verify-install;check;" "$exe" 2>/dev/null || true
}

unlock_sandbox_quarantine() { xattr -p com.apple.quarantine "$1" 2>/dev/null || true; }

check_unlock_helper() { # $1 the helper as it ships, $2 this release's bundle identifier, $3 this release's version
  local helper="$1" expected_id="$2" expected_version="$3"
  local sandbox case_dir status

  sandbox="$(mktemp -d "${TMPDIR:-/tmp}/wing-unlock-check.XXXXXX")" \
    || { fail "unlock helper" "a sandbox could not be created"; return 1; }
  # TMPDIR can end in a slash and the helper prints the paths it resolved itself: normalise once, compare that.
  sandbox="$(cd "$sandbox" && pwd)"
  mkdir -p "$sandbox/bin" "$sandbox/apps" "$sandbox/home/Applications"
  # `open` is the one command that must never reach this machine: it records what it was asked to open.
  printf '#!/bin/sh\n[ "${WING_TEST_OPEN_FAIL:-0}" = 1 ] && exit 1\nprintf "%%s\\n" "$@" >> "%s/opened.txt"\nexit 0\n' "$sandbox" > "$sandbox/bin/open"
  chmod +x "$sandbox/bin/open"
  printf '#!/bin/sh\n[ "${WING_TEST_XATTR_FAIL:-0}" = 1 ] && [ "$1" = -cr ] && exit 1\nexec /usr/bin/xattr "$@"\n' > "$sandbox/bin/xattr"
  chmod +x "$sandbox/bin/xattr"

  # Two tiny Mach-O files, compiled and ad-hoc signed here: the helper verifies the signature and the CDHash of the
  # candidate's main executable, and a shell script has no signature to verify. Nothing of the application is built
  # — and the test helper below is given the CDHash of the first binary, so the happy path needs no real build.
  SANDBOX_SIGNED_EXEC="$sandbox/expected-exec"
  SANDBOX_OTHER_EXEC="$sandbox/other-signed-exec"
  local expected_exec_cdhash other_exec_cdhash
  expected_exec_cdhash="$(unlock_sandbox_signed_exe "$SANDBOX_SIGNED_EXEC" 'return 0;')"
  other_exec_cdhash="$(unlock_sandbox_signed_exe "$SANDBOX_OTHER_EXEC" 'return 1;')"
  if [ -z "$expected_exec_cdhash" ] || [ -z "$other_exec_cdhash" ] || [ "$expected_exec_cdhash" = "$other_exec_cdhash" ]; then
    fail "unlock helper" "a tiny signed Mach-O could not be built in the sandbox (is cc installed?), so the signature and CDHash checks could not be measured"
    rm -rf "$sandbox"
    return 1
  fi

  # The shipped text with two edits: its `/Applications` search root inside the sandbox, and the CDHash it expects.
  # The first has to have landed before anything is run — otherwise the helper would be run against this machine's
  # own /Applications, and a check about a sandbox would be a check about the operator's desk. Both ways of writing
  # that root are rewritten, so the check can be run against an earlier helper too and still keep to the sandbox.
  # The second replaces the value the build injected with the sandbox binary's: what the shipped helper carries was
  # already compared, by grep, with the executable inside the ZIP and the image.
  local redirected="$sandbox/redirected-helper.command"
  /usr/bin/sed -e "s|\"/Applications/\$APP_NAME\"|\"${sandbox}/apps/\$APP_NAME\"|" \
                -e "s|\"/Applications/WING CONTROLLER.app\"|\"${sandbox}/apps/WING CONTROLLER.app\"|" \
                -e "s|^EXPECTED_EXEC_CDHASH=\".*\"\$|EXPECTED_EXEC_CDHASH=\"${expected_exec_cdhash}\"|" \
    "$helper" > "$redirected"
  if grep -qE '"/Applications/' "$redirected"; then
    fail "unlock helper" "its /Applications search root could not be redirected into the sandbox, so running it would have touched this machine"
    rm -rf "$sandbox"
    return 1
  fi
  if ! grep -q "${sandbox}/apps/" "$redirected"; then
    fail "unlock helper" "it does not search /Applications at all, so there is nothing to check here"
    rm -rf "$sandbox"
    return 1
  fi
  # A helper that carries the expectation must carry the sandbox's after the edit. One that carries none (an older
  # helper) is still run: its failures are then measured instead of assumed.
  if grep -q 'EXPECTED_EXEC_CDHASH=' "$helper" \
     && ! grep -qF "EXPECTED_EXEC_CDHASH=\"${expected_exec_cdhash}\"" "$redirected"; then
    fail "unlock helper" "its EXPECTED_EXEC_CDHASH could not be replaced with the sandbox binary's, so the runs below would not measure the CDHash comparison"
    rm -rf "$sandbox"
    return 1
  fi

  # Runs the redirected shipped text once from $1. A newline is fed to its final "Press Enter" so that a helper
  # which refused and a helper which worked are told apart by their exit status as well as by what they printed.
  unlock_helper_run() {
    local dir="$1"
    rm -f "$sandbox/opened.txt"
    cp "$redirected" "$dir/Unblock WING CONTROLLER.command"
    chmod +x "$dir/Unblock WING CONTROLLER.command"
    ( cd "$dir" && printf '\n' | PATH="$sandbox/bin:$PATH" HOME="$sandbox/home" WING_TEST_XATTR_FAIL="${2:-0}" WING_TEST_OPEN_FAIL="${3:-0}" \
        bash "$dir/Unblock WING CONTROLLER.command" > "$dir/out.txt" 2>&1 )
    echo $? > "$dir/status"
  }

  # 1. Another application wearing the same name: refused, its path printed, nothing touched.
  case_dir="$sandbox/case-wrong-identifier"; mkdir -p "$case_dir"
  unlock_sandbox_bundle "$case_dir/WING CONTROLLER.app" "com.example.not-wing-controller" "$expected_version"
  unlock_helper_run "$case_dir"
  status="$(cat "$case_dir/status")"
  if [ "$status" -ne 0 ] && grep -qF "$case_dir/WING CONTROLLER.app" "$case_dir/out.txt" \
     && grep -q "Nothing has been unblocked" "$case_dir/out.txt"; then
    pass "unlock helper refuses a bundle with another identifier"
  else
    fail "unlock helper (identifier)" "exit ${status}: $(tail -n 3 "$case_dir/out.txt" | tr '\n' ' ')"
  fi
  if [ -n "$(unlock_sandbox_quarantine "$case_dir/WING CONTROLLER.app")" ] \
     && [ "$(stat -f '%Lp' "$case_dir/WING CONTROLLER.app/Contents/MacOS/wing-controller-desktop")" = "644" ] \
     && [ ! -f "$sandbox/opened.txt" ]; then
    pass "unlock helper leaves it quarantined and unopened"
  else
    fail "unlock helper (identifier)" "it touched or opened the bundle it had just refused"
  fi

  # 2. This identifier, another version.
  case_dir="$sandbox/case-wrong-version"; mkdir -p "$case_dir"
  unlock_sandbox_bundle "$case_dir/WING CONTROLLER.app" "$expected_id" "0.0.1"
  unlock_helper_run "$case_dir"
  status="$(cat "$case_dir/status")"
  if [ "$status" -ne 0 ] && grep -qF "$case_dir/WING CONTROLLER.app" "$case_dir/out.txt" \
     && [ -n "$(unlock_sandbox_quarantine "$case_dir/WING CONTROLLER.app")" ] \
     && [ ! -f "$sandbox/opened.txt" ]; then
    pass "unlock helper refuses a bundle of another version"
  else
    fail "unlock helper (version)" "exit ${status}: $(tail -n 3 "$case_dir/out.txt" | tr '\n' ' ')"
  fi

  # 3. This identifier and this version, but its main executable carries no signature at all: a bundle that copied
  # the two strings from a plist. Refused by `codesign --verify`, before anything is touched.
  case_dir="$sandbox/case-unsigned"; mkdir -p "$case_dir"
  unlock_sandbox_bundle "$case_dir/WING CONTROLLER.app" "$expected_id" "$expected_version" unsigned
  unlock_helper_run "$case_dir"
  status="$(cat "$case_dir/status")"
  if [ "$status" -ne 0 ] && grep -qF "$case_dir/WING CONTROLLER.app" "$case_dir/out.txt" \
     && grep -q "executable signature of this copy does not verify" "$case_dir/out.txt"; then
    pass "unlock helper refuses an unsigned executable"
  else
    fail "unlock helper (unsigned executable)" "exit ${status}: $(tail -n 3 "$case_dir/out.txt" | tr '\n' ' ')"
  fi
  if [ -n "$(unlock_sandbox_quarantine "$case_dir/WING CONTROLLER.app")" ] \
     && [ "$(stat -f '%Lp' "$case_dir/WING CONTROLLER.app/Contents/MacOS/wing-controller-desktop")" = "644" ] \
     && [ ! -f "$sandbox/opened.txt" ]; then
    pass "unlock helper leaves the unsigned bundle quarantined and unopened"
  else
    fail "unlock helper (unsigned executable)" "it touched or opened the bundle it had just refused"
  fi

  # 4. This identifier and this version, but no main executable at all: a truncated copy. There is nothing to
  # verify nor to unblock, and the helper says so instead of passing the candidate through.
  case_dir="$sandbox/case-no-executable"; mkdir -p "$case_dir"
  unlock_sandbox_bundle "$case_dir/WING CONTROLLER.app" "$expected_id" "$expected_version" missing
  unlock_helper_run "$case_dir"
  status="$(cat "$case_dir/status")"
  if [ "$status" -ne 0 ] && grep -qF "$case_dir/WING CONTROLLER.app" "$case_dir/out.txt" \
     && grep -q "has no main executable" "$case_dir/out.txt"; then
    pass "unlock helper refuses a bundle with no main executable"
  else
    fail "unlock helper (no main executable)" "exit ${status}: $(tail -n 3 "$case_dir/out.txt" | tr '\n' ' ')"
  fi
  if [ -n "$(unlock_sandbox_quarantine "$case_dir/WING CONTROLLER.app")" ] \
     && [ ! -f "$sandbox/opened.txt" ]; then
    pass "unlock helper leaves the executable-less bundle quarantined and unopened"
  else
    fail "unlock helper (no main executable)" "it touched or opened the bundle it had just refused"
  fi

  # 5. This identifier and this version, and a valid signature — but not the signature this download carries: the
  # executable was replaced or rebuilt. The identifier and the version can be copied; the CDHash cannot, and both
  # hashes have to be the ones printed, or this check would pass on a helper that refuses everything.
  case_dir="$sandbox/case-other-executable"; mkdir -p "$case_dir"
  unlock_sandbox_bundle "$case_dir/WING CONTROLLER.app" "$expected_id" "$expected_version" other
  unlock_helper_run "$case_dir"
  status="$(cat "$case_dir/status")"
  if [ "$status" -ne 0 ] && grep -qF "$case_dir/WING CONTROLLER.app" "$case_dir/out.txt" \
     && grep -qF "$expected_exec_cdhash" "$case_dir/out.txt" \
     && grep -qF "$other_exec_cdhash" "$case_dir/out.txt"; then
    pass "unlock helper refuses an executable with another CDHash"
  else
    fail "unlock helper (another CDHash)" "exit ${status}: $(tail -n 4 "$case_dir/out.txt" | tr '\n' ' ')"
  fi
  if [ -n "$(unlock_sandbox_quarantine "$case_dir/WING CONTROLLER.app")" ] \
     && [ "$(stat -f '%Lp' "$case_dir/WING CONTROLLER.app/Contents/MacOS/wing-controller-desktop")" = "644" ] \
     && [ ! -f "$sandbox/opened.txt" ]; then
    pass "unlock helper leaves the other-CDHash bundle quarantined and unopened"
  else
    fail "unlock helper (another CDHash)" "it touched or opened the bundle it had just refused"
  fi

  # 6. A valid copy beside the helper and an installed copy with the right identity but another executable. The
  # design (docs/reviews/QUEUE_DESIGN_2026-10-04.md, section 1) makes this fatal for the whole run instead of
  # unblocking the copy next door: an installed copy wearing this identity with a different signature is
  # indistinguishable from a manipulated build. Nothing is touched, not even the candidate that validated.
  case_dir="$sandbox/case-installed-other"; mkdir -p "$case_dir"
  unlock_sandbox_bundle "$case_dir/WING CONTROLLER.app" "$expected_id" "$expected_version" signed
  unlock_sandbox_bundle "$sandbox/home/Applications/WING CONTROLLER.app" "$expected_id" "$expected_version" other
  unlock_helper_run "$case_dir"
  status="$(cat "$case_dir/status")"
  if [ "$status" -ne 0 ] && grep -qF "$sandbox/home/Applications/WING CONTROLLER.app" "$case_dir/out.txt" \
     && grep -q "not the exact application this download carries" "$case_dir/out.txt"; then
    pass "unlock helper refuses the run when the installed copy is another binary"
  else
    fail "unlock helper (installed copy, other executable)" "exit ${status}: $(tail -n 4 "$case_dir/out.txt" | tr '\n' ' ')"
  fi
  if [ -n "$(unlock_sandbox_quarantine "$case_dir/WING CONTROLLER.app")" ] \
     && [ -n "$(unlock_sandbox_quarantine "$sandbox/home/Applications/WING CONTROLLER.app")" ] \
     && [ "$(stat -f '%Lp' "$case_dir/WING CONTROLLER.app/Contents/MacOS/wing-controller-desktop")" = "644" ] \
     && [ "$(stat -f '%Lp' "$sandbox/home/Applications/WING CONTROLLER.app/Contents/MacOS/wing-controller-desktop")" = "644" ] \
     && [ ! -f "$sandbox/opened.txt" ]; then
    pass "unlock helper leaves both copies untouched when the installed one is another binary"
  else
    fail "unlock helper (installed copy, other executable)" "it touched or opened a copy although one candidate did not validate"
  fi
  rm -rf "$sandbox/home/Applications/WING CONTROLLER.app"

  # 7. Nothing of this build anywhere: no invented target.
  case_dir="$sandbox/case-nothing"; mkdir -p "$case_dir"
  unlock_helper_run "$case_dir"
  if [ ! -f "$sandbox/opened.txt" ] && [ "$(ls -A "$case_dir" | wc -l | tr -d ' ')" = "3" ]; then
    pass "unlock helper invents no target with nothing to unblock"
  else
    fail "unlock helper (nothing to unblock)" "opened: $(cat "$sandbox/opened.txt" 2>/dev/null); files: $(ls -A "$case_dir" | tr '\n' ' ')"
  fi

  # 8. This build, beside the helper and installed: both unblocked, the installed one opened. This is the happy path
  # of the CDHash check as well: both synthetic executables carry the hash the test helper was given.
  case_dir="$sandbox/case-ours"; mkdir -p "$case_dir"
  unlock_sandbox_bundle "$case_dir/WING CONTROLLER.app" "$expected_id" "$expected_version"
  unlock_sandbox_bundle "$sandbox/home/Applications/WING CONTROLLER.app" "$expected_id" "$expected_version"
  unlock_helper_run "$case_dir"
  if grep -q "unblocked successfully" "$case_dir/out.txt" \
     && [ -z "$(unlock_sandbox_quarantine "$case_dir/WING CONTROLLER.app")" ] \
     && [ -z "$(unlock_sandbox_quarantine "$sandbox/home/Applications/WING CONTROLLER.app")" ] \
     && [ "$(stat -f '%Lp' "$case_dir/WING CONTROLLER.app/Contents/MacOS/wing-controller-desktop")" = "755" ] \
     && [ "$(wc -l < "$sandbox/opened.txt" | tr -d ' ')" = "1" ] \
     && [ "$(cat "$sandbox/opened.txt")" = "$sandbox/home/Applications/WING CONTROLLER.app" ]; then
    pass "unlock helper opens the installed copy, not the download"
  else
    fail "unlock helper (this build)" "exit $(cat "$case_dir/status"): $(tail -n 4 "$case_dir/out.txt" | tr '\n' ' ')"
  fi

  # Refusals after identity validation must not be reported as a successful launch.
  case_dir="$sandbox/case-xattr-failure"; mkdir -p "$case_dir"
  unlock_sandbox_bundle "$case_dir/WING CONTROLLER.app" "$expected_id" "$expected_version"
  unlock_helper_run "$case_dir" 1 0
  if [ "$(cat "$case_dir/status")" -ne 0 ] && [ ! -f "$sandbox/opened.txt" ] \
     && grep -q 'Quarantine removal failed' "$case_dir/out.txt"; then
    pass "unlock helper refuses to launch after quarantine failure"
  else
    fail "unlock helper quarantine failure" "failure was not reported accurately"
  fi
  case_dir="$sandbox/case-launch-failure"; mkdir -p "$case_dir"
  unlock_sandbox_bundle "$case_dir/WING CONTROLLER.app" "$expected_id" "$expected_version"
  unlock_helper_run "$case_dir" 0 1
  if [ "$(cat "$case_dir/status")" -ne 0 ] && grep -q 'macOS refused the launch request' "$case_dir/out.txt"; then
    pass "unlock helper reports a refused launch request"
  else
    fail "unlock helper launch failure" "failure was not reported accurately"
  fi
  rm -rf "$sandbox"
}

BUNDLE_DIR="dist/v${VERSION}"
DMG="${BUNDLE_DIR}/WING_CONTROLLER_v${VERSION}_AppleSilicon.dmg"
ZIP="${BUNDLE_DIR}/WING_CONTROLLER_v${VERSION}_AppleSilicon.zip"
APP_BUILT="target/release/bundle/macos/WING CONTROLLER.app"
APP_INSTALLED="/Applications/WING CONTROLLER.app"

# A volume left mounted by an earlier run (or by an earlier build) is not this run's fault, but it is this
# run's verdict: the check that says "no volume left mounted" is about the machine, so the machine starts
# clean. On 2026-10-02 three stale volumes (0.2.37, 0.2.40 and the previous verify's 0.2.63) made a good
# release look red. Whatever is detached is named, so a build that leaves volumes behind is still visible.
STALE_VOLUMES=0
for stale_device in $(mount | grep -i "wing controller" | sed 's/ on .*//'); do
  echo "detaching a volume left mounted by an earlier run: ${stale_device}"
  STALE_VOLUMES=$((STALE_VOLUMES + 1))
  hdiutil detach "$stale_device" >/dev/null 2>&1 || hdiutil detach -force "$stale_device" >/dev/null 2>&1 || true
done

echo "verifying ${VERSION} from ${BUNDLE_DIR}"
echo "--------------------------------------------------------------"
node scripts/verify-release-legal.mjs "${BUNDLE_DIR}/Legal" "$VERSION" && pass "release legal hashes and source links" || fail "release legal" "notice validation failed"

# 1. The artefacts exist and carry their own checksum file.
[ -f "$DMG" ] && [ -f "$ZIP" ] && pass "DMG and ZIP exist" || fail "artefacts" "missing $DMG or $ZIP"
if [ -f "${BUNDLE_DIR}/SHA256SUMS.txt" ]; then
  if (cd "$BUNDLE_DIR" && shasum -a 256 -c SHA256SUMS.txt >/dev/null 2>&1); then
    pass "SHA256SUMS.txt verifies"
  else
    fail "SHA256SUMS.txt" "a hash does not match the files it names"
  fi
else
  fail "SHA256SUMS.txt" "missing: the build script does not create it"
fi

# 2. The built bundle: version and signature.
if [ -d "$APP_BUILT" ]; then
  built_version="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$APP_BUILT/Contents/Info.plist" 2>/dev/null)"
  [ "$built_version" = "$VERSION" ] && pass "built bundle reports ${VERSION}" || fail "built version" "says '${built_version}'"
  codesign --verify "$APP_BUILT" >/dev/null 2>&1 && pass "built bundle signature verifies" || fail "built signature" "codesign --verify failed"
  check_stable_signature "built bundle" "$APP_BUILT"
  # The entitlement is what lets the hardened runtime record: the Info.plist carries the description the system
  # shows, the signature carries the right to ask, and only the second one was missing from every build until
  # 2026-10-04 — so it is measured here rather than assumed.
  ENTITLEMENTS_FILE="$ROOT_DIR/desktop/src-tauri/entitlements.plist"
  if [ -f "$ENTITLEMENTS_FILE" ] && grep -q "com.apple.security.device.audio-input" "$ENTITLEMENTS_FILE" 2>/dev/null; then
    # Same pipe, same hazard as the DMG check below: `grep -q` leaves on its first match and the producer can
    # take SIGPIPE, which `set -o pipefail` turns into a failure of a check that actually succeeded. It passes
    # today only because this output is small enough to be written in one go - a race, not a guarantee.
    entitlement_info="$(codesign -d --entitlements :- "$APP_BUILT" 2>/dev/null || true)"
    printf '%s\n' "$entitlement_info" | grep -q "audio-input" \
      && pass "built bundle carries the audio-input entitlement" \
      || fail "built entitlement" "signed without com.apple.security.device.audio-input: the audio input will list devices and fail to open"
  fi
else
  fail "built bundle" "not found at $APP_BUILT"
fi

# 3. The unlock helper this release ships, run rather than read (see check_unlock_helper above). The helper of
# the ZIP is checked here, that of the image inside section 4: they are generated from one source, and both
# artefacts are what an operator can end up double-clicking. What the helper must *expect* is read from the very
# executable it travels with: a helper whose EXPECTED_EXEC_CDHASH is not that of the application beside it refuses
# the application it ships with, which is a broken release rather than a safe one.
RELEASE_BUNDLE_ID=""
RELEASE_BUNDLE_VERSION=""
RELEASE_EXEC_CDHASH=""
UNLOCK_HELPER_CHECKED=0
RELEASE_IDENTITY_DIR=""
if [ -f "$ZIP" ] && [ -x /usr/bin/unzip ]; then
  RELEASE_IDENTITY_DIR="$(mktemp -d "${TMPDIR:-/tmp}/wing-release-identity.XXXXXX")"
  /usr/bin/unzip -p "$ZIP" "*WING CONTROLLER.app/Contents/Info.plist" > "$RELEASE_IDENTITY_DIR/Info.plist" 2>/dev/null || true
  RELEASE_BUNDLE_ID="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$RELEASE_IDENTITY_DIR/Info.plist" 2>/dev/null || true)"
  RELEASE_BUNDLE_VERSION="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$RELEASE_IDENTITY_DIR/Info.plist" 2>/dev/null || true)"
  /usr/bin/unzip -p "$ZIP" "*Unblock WING CONTROLLER.command" > "$RELEASE_IDENTITY_DIR/Unblock WING CONTROLLER.command" 2>/dev/null || true
  # The signature is embedded in the Mach-O and survives the extraction byte for byte, so the ZIP's own executable
  # is what the helper's expectation is compared against — no build and no mounted image needed for this part.
  /usr/bin/unzip -p "$ZIP" "*WING CONTROLLER.app/Contents/MacOS/wing-controller-desktop" \
    > "$RELEASE_IDENTITY_DIR/wing-controller-desktop" 2>/dev/null || true
  if [ -s "$RELEASE_IDENTITY_DIR/wing-controller-desktop" ]; then
    RELEASE_EXEC_CDHASH="$(codesign -dv --verbose=4 "$RELEASE_IDENTITY_DIR/wing-controller-desktop" 2>&1 | awk -F= '/^CDHash=/{print $2; exit}' || true)"
    # The signature (and with it the identity and the designated requirement) is embedded in the Mach-O and
    # survives the ZIP extraction byte for byte, so the archive's own copy is measured here, not assumed to
    # match the built one.
    check_stable_signature "the ZIP's executable" "$RELEASE_IDENTITY_DIR/wing-controller-desktop"
  fi
  if [ -z "$RELEASE_BUNDLE_ID" ] || [ -z "$RELEASE_BUNDLE_VERSION" ]; then
    fail "unlock helper" "the ZIP's application does not report the identifier and version to check the helper against"
  elif [ "$RELEASE_BUNDLE_VERSION" != "$VERSION" ]; then
    fail "unlock helper" "the ZIP's application reports ${RELEASE_BUNDLE_VERSION} while ${VERSION} is being verified"
  elif [ ! -s "$RELEASE_IDENTITY_DIR/Unblock WING CONTROLLER.command" ]; then
    fail "unlock helper" "the ZIP carries no 'Unblock WING CONTROLLER.command'"
  else
    if [ -z "$RELEASE_EXEC_CDHASH" ]; then
      fail "unlock helper" "the CDHash of the ZIP's main executable could not be read, so the expectation the helper carries cannot be checked"
    elif grep -qF "EXPECTED_EXEC_CDHASH=\"${RELEASE_EXEC_CDHASH}\"" "$RELEASE_IDENTITY_DIR/Unblock WING CONTROLLER.command"; then
      pass "the ZIP's helper expects that copy's executable CDHash"
    else
      fail "unlock helper" "it does not carry EXPECTED_EXEC_CDHASH=\"${RELEASE_EXEC_CDHASH}\": it would accept any bundle that copies the identifier and the version"
    fi
    check_unlock_helper "$RELEASE_IDENTITY_DIR/Unblock WING CONTROLLER.command" "$RELEASE_BUNDLE_ID" "$RELEASE_BUNDLE_VERSION"
    UNLOCK_HELPER_CHECKED=1
  fi
else
  fail "unlock helper" "no ZIP (or no /usr/bin/unzip) to read the shipped helper from"
fi

# Both the archive and app must retain the legal/source information.
for legal_file in LICENSE DISCLAIMER.md THIRD_PARTY.md THIRD-PARTY-NOTICES.txt DEPENDENCIES.json SOURCE.txt; do
  for legal_prefix in "WING_CONTROLLER_v${VERSION}_AppleSilicon/Legal" "WING_CONTROLLER_v${VERSION}_AppleSilicon/WING CONTROLLER.app/Contents/Resources/Legal"; do
    if /usr/bin/unzip -p "$ZIP" "$legal_prefix/$legal_file" 2>/dev/null | wc -c | awk '{exit !($1 > 0)}'; then
      pass "ZIP legal: $legal_file"
    else
      fail "ZIP legal" "$legal_prefix/$legal_file missing"
    fi
  done
done

# Extract only the legal folders for complete archive hash validation.
ZIP_LEGAL_DIR="$(mktemp -d "${TMPDIR:-/tmp}/wing-zip-legal.XXXXXX")"
if /usr/bin/unzip -qq "$ZIP" '*/Legal/*' -d "$ZIP_LEGAL_DIR"; then
  for zip_legal in "$ZIP_LEGAL_DIR/WING_CONTROLLER_v${VERSION}_AppleSilicon/Legal" "$ZIP_LEGAL_DIR/WING_CONTROLLER_v${VERSION}_AppleSilicon/WING CONTROLLER.app/Contents/Resources/Legal"; do
    node scripts/verify-release-legal.mjs "$zip_legal" "$VERSION" && pass "ZIP legal hashes and source links" || fail "ZIP legal" "notice validation failed"
  done
else
  fail "ZIP legal" "could not extract legal files"
fi
rm -rf "$ZIP_LEGAL_DIR"

# 4. What the DMG really carries, then leave no volume mounted.
if [ "$MOUNT_CHECK" -eq 1 ]; then
  MOUNT_DEVICE="$(hdiutil attach "$DMG" -nobrowse -readonly 2>/dev/null | tail -1 | awk '{print $1}')"
  if [ -n "${MOUNT_DEVICE:-}" ]; then
    VOLUME="$(mount | grep "$MOUNT_DEVICE" | sed 's/.* on //; s/ (.*//')"
    dmg_version="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$VOLUME/WING CONTROLLER.app/Contents/Info.plist" 2>/dev/null)"
    [ "$dmg_version" = "$VERSION" ] && pass "the app inside the DMG is ${VERSION}" || fail "DMG version" "says '${dmg_version}'"
    codesign --verify "$VOLUME/WING CONTROLLER.app" >/dev/null 2>&1 && pass "the app inside the DMG verifies" || fail "DMG signature" "codesign --verify failed"
    check_stable_signature "the app inside the DMG" "$VOLUME/WING CONTROLLER.app"
    # The image file itself carries the same identity: one identity per build, not one for the application
    # and an unlabelled or ad-hoc one for the download around it.
    # When this refuses, say where it looked and what codesign answered: a check that reports only "it is not
    # signed" cannot tell a missing file from an unsigned one, and this one cost an evening of exactly that.
    dmg_verify_error="$(codesign --verify --verbose=2 "$DMG" 2>&1)" || true
    if [ -f "$DMG" ] \
       && codesign --verify "$DMG" >/dev/null 2>&1 \
       && signature_info="$(codesign -dvv "$DMG" 2>&1 || true)"
 printf '%s\n' "$signature_info" | grep -qF "Authority=${WING_SIGNING_IDENTITY}"; then
      pass "the DMG itself is signed with ${WING_SIGNING_IDENTITY}"
    else
      echo "    [i] DMG check: pwd=${PWD} DMG=${DMG} exists=$([ -f "$DMG" ] && echo yes || echo NO)" >&2
      echo "    [i] codesign said: ${dmg_verify_error:-nothing}" >&2
      fail "DMG signature" "the image is not signed with '${WING_SIGNING_IDENTITY}'"
    fi
    for legal_file in LICENSE DISCLAIMER.md THIRD_PARTY.md THIRD-PARTY-NOTICES.txt DEPENDENCIES.json SOURCE.txt; do
      [ -s "$VOLUME/Legal/$legal_file" ] && pass "DMG legal: $legal_file" || fail "DMG legal" "$legal_file missing"
      [ -s "$VOLUME/WING CONTROLLER.app/Contents/Resources/Legal/$legal_file" ] || fail "app legal" "$legal_file missing"
    done
    node scripts/verify-release-legal.mjs "$VOLUME/Legal" "$VERSION" && pass "DMG legal hashes and source links" || fail "DMG legal" "notice validation failed"
    node scripts/verify-release-legal.mjs "$VOLUME/WING CONTROLLER.app/Contents/Resources/Legal" "$VERSION" && pass "DMG app legal hashes and source links" || fail "DMG app legal" "notice validation failed"
    [ -f "$VOLUME/README FIRST.txt" ] && pass "the DMG carries its install instructions" || fail "DMG contents" "README FIRST.txt is missing"
    # What an operator needs beside the app, and what the owner asked to always be there (2026-10-02): the
    # consolidated changelog and this version's release note, and an unlock helper whose name is English.
    [ -f "$VOLUME/CHANGELOG.md" ] && pass "the DMG carries the changelog" || fail "DMG contents" "CHANGELOG.md is missing from the image"
    [ -f "$VOLUME/RELEASE NOTES ${VERSION}.md" ] && pass "the DMG carries this version's release note" || fail "DMG contents" "RELEASE NOTES ${VERSION}.md is missing from the image"
    [ -f "$VOLUME/Unblock WING CONTROLLER.command" ] && pass "the DMG ships the unlock helper in English" || fail "DMG contents" "Unblock WING CONTROLLER.command is missing"
    # The expectation embedded in the image's helper, read from the image's own executable: the two copies of the
    # helper are generated from one source and must expect the same binary, or the one that does not match would
    # refuse the application it travels with (docs/reviews/QUEUE_DESIGN_2026-10-04.md, section 1).
    DMG_EXEC_CDHASH="$(codesign -dv --verbose=4 "$VOLUME/WING CONTROLLER.app/Contents/MacOS/wing-controller-desktop" 2>&1 | awk -F= '/^CDHash=/{print $2; exit}' || true)"
    if [ -z "$DMG_EXEC_CDHASH" ]; then
      fail "DMG helper CDHash" "the CDHash of the executable inside the image could not be read"
    elif grep -qF "EXPECTED_EXEC_CDHASH=\"${DMG_EXEC_CDHASH}\"" "$VOLUME/Unblock WING CONTROLLER.command"; then
      pass "the DMG's helper expects that copy's executable CDHash"
    else
      fail "DMG helper CDHash" "the helper inside the image does not carry the executable's CDHash, so it would refuse the application it travels with"
    fi
    if [ -n "$RELEASE_EXEC_CDHASH" ] && [ "$DMG_EXEC_CDHASH" = "$RELEASE_EXEC_CDHASH" ]; then
      pass "the ZIP and the DMG carry the same executable"
    elif [ -n "$DMG_EXEC_CDHASH" ]; then
      fail "DMG executable" "its CDHash (${DMG_EXEC_CDHASH}) is not the ZIP's (${RELEASE_EXEC_CDHASH:-unreadable})"
    fi
    # The copy inside the image is the one most operators double-click, so it is run too — not searched for.
    if [ "$UNLOCK_HELPER_CHECKED" -eq 1 ]; then
      check_unlock_helper "$VOLUME/Unblock WING CONTROLLER.command" "$RELEASE_BUNDLE_ID" "$RELEASE_BUNDLE_VERSION"
    fi
    # The icon must be in the copy the operator can run straight from the image: it used to have the flag and
    # no picture, so the app showed macOS 26's dark tile until it was installed and unblocked (owner's report).
    if python3 "$ROOT_DIR/scripts/write-custom-icon.py" --check "$VOLUME/WING CONTROLLER.app" >/dev/null 2>&1; then
      pass "the app inside the DMG carries its icon image"
    else
      fail "DMG icon" "the copy inside the image has no custom icon image (it would show the system tile)"
    fi
    if node "$ROOT_DIR/scripts/check-app-icon-render.mjs" "$VOLUME/WING CONTROLLER.app" >/dev/null 2>&1; then
      pass "macOS shows that copy's own artwork"
    else
      fail "DMG icon render" "the system does not return this copy's artwork (see scripts/check-app-icon-render.mjs)"
    fi
    # Detaching is not always instant (the volume can be busy for a moment while the system indexes it),
    # and a single attempt followed by a one-second wait reported a failure that was not real: on
    # 2026-10-01 the 0.2.63 check said "a WING CONTROLLER volume is still mounted" and the volume came off
    # by hand at once. A check that cries wolf is as bad as one that lies green, so it retries, then
    # insists, and only then fails.
    for attempt in 1 2 3; do
      hdiutil detach "$MOUNT_DEVICE" >/dev/null 2>&1 || true
      mount | grep -qi "wing controller" || break
    done
    if mount | grep -qi "wing controller"; then
      hdiutil detach -force "$MOUNT_DEVICE" >/dev/null 2>&1 || true
    fi
    if mount | grep -qi "wing controller"; then
      fail "no volume left mounted" "a WING CONTROLLER volume is still mounted"
    else
      pass "no volume left mounted"
    fi
  else
    fail "DMG mount" "hdiutil could not attach $DMG"
  fi
fi

# 5. The installed copy (and the state an operator sees).
if [ "$INSTALL" -eq 1 ]; then
  rm -rf "$APP_INSTALLED"
  ditto "$APP_BUILT" "$APP_INSTALLED" && xattr -cr "$APP_INSTALLED" && pass "installed into /Applications" || fail "install" "ditto/xattr failed"
  # `xattr -cr` (which the install needs: the bundle arrives quarantined) also deletes the custom icon —
  # it lives in `com.apple.FinderInfo` — and macOS 26 then draws the dark system tile behind the
  # artwork instead of the transparent marble W. `build-dist.sh` re-applies it after the same command;
  # this script did not, and the owner saw the black square again on the installed 0.2.62 (2026-10-01).
  if [ -x scripts/set-custom-icon.sh ]; then
    ./scripts/set-custom-icon.sh "$APP_INSTALLED" >/dev/null 2>&1 || true
  fi
fi
if [ -d "$APP_INSTALLED" ]; then
  if ./scripts/set-custom-icon.sh --check "$APP_INSTALLED" >/dev/null 2>&1; then
    pass "installed copy keeps its custom icon"
  else
    fail "installed icon" "macOS 26 will draw its dark tile instead of the transparent W"
  fi
  installed_version="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$APP_INSTALLED/Contents/Info.plist" 2>/dev/null)"
  [ "$installed_version" = "$VERSION" ] && pass "installed copy reports ${VERSION}" || fail "installed version" "says '${installed_version}'"
  codesign --verify "$APP_INSTALLED" >/dev/null 2>&1 && pass "installed copy signature verifies" || fail "installed signature" "codesign --verify failed"
  check_stable_signature "installed copy" "$APP_INSTALLED"
  if node scripts/wing-verify-single-instance.mjs >/dev/null 2>&1; then
    pass "installed copy runs as a single instance"
  else
    fail "single instance" "a second launch started a second process"
  fi
elif [ "$ALLOW_MISSING_INSTALL" -eq 1 ]; then
  echo "$(printf '%-58s%s' "installed copy" "SKIP (nothing installed, --allow-missing-install)")"
else
  fail "installed copy" "nothing is installed at ${APP_INSTALLED:-/Applications/WING CONTROLLER.app}, so the icon, version, signature and single-instance checks did not run (pass --allow-missing-install to accept that)"
fi

# One identity, one requirement — on every copy and in every artefact.
#
# This is the check that says the release kept the property the whole identity exists for: macOS compares a
# stored microphone grant against the code requirement of the running build, so a release whose image, ZIP
# and installed copy carried different requirements would hand the operator a grant that applies to only one
# of them. Measured, not assumed: each copy's requirement was read above.
if [ "${#STABLE_REQUIREMENTS[@]}" -gt 1 ]; then
  first_requirement="${STABLE_REQUIREMENTS[0]#*|}"
  one_requirement=1
  for entry in "${STABLE_REQUIREMENTS[@]:-}"; do
    [ "${entry#*|}" = "$first_requirement" ] || one_requirement=0
  done
  if [ "$one_requirement" -eq 1 ]; then
    pass "one designated requirement on all ${#STABLE_REQUIREMENTS[@]} copies"
  else
    fail "designated requirement" "not the same everywhere: $(printf '%s; ' "${STABLE_REQUIREMENTS[@]:-}")"
  fi
fi

echo "--------------------------------------------------------------"
# The sandboxes are this run's, and they leave with it.
if [ -n "$RELEASE_IDENTITY_DIR" ]; then
  rm -rf "$RELEASE_IDENTITY_DIR"
fi
# The "no volume left mounted" check means the machine is clean; say how many this run had to clean up, so
# a build that keeps leaving them behind is visible in the verdict instead of silent (S10).
if [ "$STALE_VOLUMES" -gt 0 ]; then
  echo "note: detached ${STALE_VOLUMES} volume(s) an earlier run left mounted"
fi
if [ "$FAILED" -eq 0 ]; then
  echo "ALL CHECKS PASSED for ${VERSION}"
  exit 0
fi
echo "SOME CHECKS FAILED for ${VERSION}"
exit 1
