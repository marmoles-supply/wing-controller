#!/usr/bin/env bash
# Fails loudly when the stable signing identity is missing, and does it before a single line is compiled.
#
# `desktop/build-dist.sh` runs this as its first real step. The build must never fall back to an ad-hoc
# signature: an ad-hoc signature is a new code identity on every build, so the microphone grant macOS
# already recorded stops applying to the next build while its TCC row still says "granted" — the app is
# told there are zero input devices and macOS never asks again (measured 2026-10-05; see AGENTS.md,
# "Re-signing Ad-Hoc Loses The Microphone Grant"). A silent fallback would recreate exactly that bug
# while looking fine, so there is no fallback at all: this either prints the identity's certificate
# SHA-1 and exits 0, or says what to run and exits 1.
#
# Usage: ./scripts/check-signing-identity.sh
#   WING_SIGNING_IDENTITY / WING_SIGNING_KEYCHAIN override the identity (see scripts/signing-identity.sh).

set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=scripts/signing-identity.sh
. "$ROOT_DIR/scripts/signing-identity.sh"

refuse() {
  echo "Error: $1" >&2
  shift
  for line in "$@"; do
    echo "       $line" >&2
  done
  exit 1
}

CERT_SHA1="$(wing_signing_certificate_sha1)"
if [ -z "$CERT_SHA1" ]; then
  refuse "the signing identity '${WING_SIGNING_IDENTITY}' is not in ${WING_SIGNING_KEYCHAIN}." \
    "Every build signs with one stable identity so that the microphone grant survives an update," \
    "and this build deliberately does NOT fall back to an ad-hoc signature." \
    "Create the identity once on this machine, then build again:" \
    "  ./scripts/create-signing-identity.sh"
fi

# Present is not the same as usable. An identity whose private key was never imported, or whose access
# control list does not let codesign(1) use it, would otherwise fail the build minutes later — after the
# compile — or stop on a keychain dialog in the middle of packaging. This signs a throwaway Mach-O copy
# with it, which also proves the requirement codesign produces is anchored to this certificate rather
# than to a per-build cdhash.
PROBE_DIR="$(mktemp -d "${TMPDIR:-/tmp}/wing-signing-probe.XXXXXX")" || refuse "a temporary directory could not be created."
trap 'rm -rf "$PROBE_DIR"' EXIT
if ! cp /usr/bin/true "$PROBE_DIR/probe" 2>/dev/null; then
  refuse "a Mach-O to probe-sign could not be copied to ${PROBE_DIR}."
fi
if ! PROBE_ERROR="$(codesign --force --sign "$WING_SIGNING_IDENTITY" --keychain "$WING_SIGNING_KEYCHAIN" \
  "$PROBE_DIR/probe" 2>&1)"; then
  refuse "codesign could not sign with '${WING_SIGNING_IDENTITY}'." \
    "codesign said: ${PROBE_ERROR}" \
    "The identity is in ${WING_SIGNING_KEYCHAIN} but unusable: a missing private key, an access control" \
    "list that does not allow codesign, or a second certificate with the same Common Name in another" \
    "keychain on the search list (codesign then reports 'ambiguous' and refuses to choose)." \
    "Re-create it with:" \
    "  ./scripts/create-signing-identity.sh" \
    "(remove it first if the script says a certificate with that name already exists)."
fi
PROBE_REQUIREMENT="$(wing_signing_designated_requirement "$PROBE_DIR/probe")"
if ! wing_signing_requirement_pins_certificate "$PROBE_REQUIREMENT" "$CERT_SHA1"; then
  refuse "the requirement codesign produces for '${WING_SIGNING_IDENTITY}' is not anchored to its certificate." \
    "codesign reported: ${PROBE_REQUIREMENT:-nothing}" \
    "A requirement that is not anchored to the certificate changes with every build, which is the bug" \
    "this identity exists to prevent. Re-create the identity: ./scripts/create-signing-identity.sh"
fi

printf '%s\n' "$CERT_SHA1"
