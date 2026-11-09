#!/usr/bin/env bash
# The one signing identity every build of this project signs with. Sourced, never executed:
#
#   . "$ROOT_DIR/scripts/signing-identity.sh"
#
# Why this exists (measured 2026-10-05; AGENTS.md, "Re-signing Ad-Hoc Loses The Microphone Grant"):
# macOS keeps a microphone grant in a TCC row keyed by the bundle identifier but carrying a `csreq`
# blob — the code requirement of the build that was granted. An ad-hoc signature's requirement is a
# per-build `cdhash`, so every build is a *new* code identity: the row still says "granted", the grant
# no longer applies to the new build, and macOS never asks again. The app is then told there are zero
# input devices (the owner measured exactly that on 2026-10-05, kTCCServiceMicrophone auth_value 2).
#
# A certificate-anchored requirement — `identifier "…" and certificate leaf = H"…"` — is byte-identical
# for every build signed with the same certificate, so the grant applies to the next build too.
# `scripts/create-signing-identity.sh` mints that certificate once per machine; `desktop/build-dist.sh`
# and `scripts/verify-install.sh` both resolve it through this file, so the name lives in one place.
#
# Overriding:  WING_SIGNING_IDENTITY=<name>  WING_SIGNING_KEYCHAIN=<path to keychain-db>

# The Common Name of the certificate, and what `codesign --sign` is given. A fresh certificate is minted
# per machine with this same name (no private key is ever copied between machines): a TCC grant is per
# host, and each host only ever validates its own signature.
WING_SIGNING_IDENTITY="${WING_SIGNING_IDENTITY:-WING CONTROLLER Local Signing}"
WING_SIGNING_KEYCHAIN="${WING_SIGNING_KEYCHAIN:-$HOME/Library/Keychains/login.keychain-db}"

# Prints the lower-case SHA-1 of the certificate behind $WING_SIGNING_IDENTITY, or nothing when there is
# no such identity in the keychain.
#
# `security find-identity -p codesigning` is used deliberately WITHOUT `-v`: without it the identity is
# listed whether or not macOS considers the certificate trusted, and a self-signed certificate is not
# trusted by default. Trust is a separate question (see create-signing-identity.sh); "is the identity
# there and usable" is this one.
#
# The digest is lower-cased because it is compared against the `certificate leaf = H"…"` of the
# requirement `codesign -d -r-` prints, and that is lower-case. The first version of this returned the
# upper-case digest `security` prints, so the comparison failed on case rather than on identity — found by
# running the script, not by reading it (2026-10-05).
wing_signing_certificate_sha1() {
  security find-identity -p codesigning "$WING_SIGNING_KEYCHAIN" 2>/dev/null | awk -v wanted="\"${WING_SIGNING_IDENTITY}\"" '
    index($0, wanted) > 0 && $2 ~ /^[0-9A-Fa-f]+$/ && length($2) == 40 { print tolower($2); exit }'
}

# The designated requirement `codesign` reports for a bundle or a Mach-O, as one line, or nothing.
# `codesign -d -r-` writes it to stderr, prefixed with "designated => ".
wing_signing_designated_requirement() {
  codesign -d -r- "$1" 2>&1 | awk '/designated =>/ { sub(/^.*designated => /, ""); print; exit }'
}

# True when a designated requirement names the certificate by digest — `certificate leaf = H"…"` — which is
# the property that makes it the same requirement for every build signed with that certificate. The digest
# comparison is lower-cased on both sides, because `security` prints it upper-case and `codesign`
# lower-case.
wing_signing_requirement_pins_certificate() { # $1 requirement text, $2 certificate SHA-1 (either case)
  local requirement="$1" sha1="$2"
  [ -n "$requirement" ] && [ -n "$sha1" ] || return 1
  case "$(printf '%s' "$requirement" | tr '[:upper:]' '[:lower:]')" in
    *"certificate leaf = h\"$(printf '%s' "$sha1" | tr '[:upper:]' '[:lower:]')\""*) return 0 ;;
    *) return 1 ;;
  esac
}

# True when a designated requirement is a per-build hash: the ad-hoc signature macOS gives a new code
# identity on every build, and the reason the microphone grant stops applying to the next build.
wing_signing_requirement_is_per_build_hash() {
  case "$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')" in
    *cdhash*) return 0 ;;
    *) return 1 ;;
  esac
}
