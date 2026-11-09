#!/usr/bin/env bash
# Creates, once per machine, the self-signed code-signing identity every build of this project signs with.
#
# Why a stable identity is not optional here (measured 2026-10-05; AGENTS.md, "Re-signing Ad-Hoc Loses The
# Microphone Grant"): macOS keeps a microphone grant in a TCC row keyed by the bundle identifier but
# carrying a `csreq` blob — the code requirement of the build that was granted. An ad-hoc signature's
# requirement is a per-build `cdhash`, so every build is a new code identity: the row still says
# "granted", the grant no longer applies to the new build, and macOS never asks again. The app is then
# told there are zero input devices. A certificate-anchored requirement — `identifier "…" and certificate
# leaf = H"…"` — is the same for every build signed with the same certificate, so the grant survives.
#
# This script is idempotent: running it twice creates nothing the second time. It prints, at the end, the
# exact commands that remove the identity it made. The private key is generated inside a private temporary
# directory, is never printed, and is deleted when the script exits whether it succeeded or failed.
#
# Usage: ./scripts/create-signing-identity.sh [--no-trust]
#   --no-trust   do not add the certificate's codeSign trust setting (the identity still signs; it is then
#                not listed by `security find-identity -v`, which is a report, not a requirement)
#   WING_SIGNING_IDENTITY / WING_SIGNING_KEYCHAIN override the identity (see scripts/signing-identity.sh).

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=scripts/signing-identity.sh
. "$ROOT_DIR/scripts/signing-identity.sh"

WITH_TRUST=1
for arg in "$@"; do
  case "$arg" in
    --no-trust) WITH_TRUST=0 ;;
    *) echo "unknown argument: $arg" >&2; exit 2 ;;
  esac
done

print_removal_instructions() {
  cat <<REMOVAL
Removing the identity this script created
  1. security find-certificate -c "${WING_SIGNING_IDENTITY}" -p "${WING_SIGNING_KEYCHAIN}" > /tmp/wing-signing-identity.crt
  2. security remove-trusted-cert /tmp/wing-signing-identity.crt   # asks for your password
  3. security delete-identity -c "${WING_SIGNING_IDENTITY}" "${WING_SIGNING_KEYCHAIN}"
  4. rm -f /tmp/wing-signing-identity.crt
Step 2 only applies if the certificate was trusted for code signing; skip it if step 1 wrote an empty
file. If step 2 is skipped when it should not be, the trust entry is removed in Keychain Access: open the
certificate in ${WING_SIGNING_KEYCHAIN}, expand "Trust", and set "When using this certificate" to
"Never Trust". Nothing else in your keychain or your trust settings is touched by this script.
With the identity gone, desktop/build-dist.sh refuses to build — by design, so that no ad-hoc signature
can quietly take its place. Re-run this script to mint a new one.
REMOVAL
}

CERT_SHA1="$(wing_signing_certificate_sha1)"
if [ -n "$CERT_SHA1" ]; then
  echo "==> The signing identity '${WING_SIGNING_IDENTITY}' is already in ${WING_SIGNING_KEYCHAIN}; nothing to do."
  echo "    certificate SHA-1: ${CERT_SHA1}"
  if security find-identity -v -p codesigning "$WING_SIGNING_KEYCHAIN" 2>/dev/null \
    | grep -qF "\"${WING_SIGNING_IDENTITY}\""; then
    echo "    macOS lists it as a valid code-signing identity."
  else
    echo "    macOS lists it as untrusted (it is self-signed); it still signs, and the requirement it"
    echo "    produces is anchored to the certificate. To make it a *valid* identity, run:"
    echo "      security add-trusted-cert -r trustRoot -p codeSign -k \"${WING_SIGNING_KEYCHAIN}\" <certificate>"
  fi
  echo ""
  echo "    Build with: ./scripts/release.sh <version>   (or bash desktop/build-dist.sh)"
  echo ""
  print_removal_instructions
  exit 0
fi

# A certificate with this name but no usable identity means a half-created identity (typically the
# private key is gone). Creating a second certificate with the same Common Name would make `codesign
# --sign <name>` ambiguous, so this stops instead, and says how to clear it.
if security find-certificate -c "$WING_SIGNING_IDENTITY" "$WING_SIGNING_KEYCHAIN" > /dev/null 2>&1; then
  echo "Error: a certificate named '${WING_SIGNING_IDENTITY}' is in ${WING_SIGNING_KEYCHAIN} without a" >&2
  echo "       usable private key, so there is no signing identity behind it." >&2
  echo "       Remove it, then run this script again:" >&2
  print_removal_instructions >&2
  exit 1
fi

# `codesign` (and `security find-identity`) resolve an identity through the *search list*, not through
# --keychain alone. The login keychain is always in it; an overridden keychain may not be, so it is added
# for the duration of this script and the original list is restored on exit.
ORIGINAL_SEARCH_LIST=()
while IFS= read -r line; do
  line="${line#"${line%%[![:space:]]*}"}"
  line="${line#\"}"
  line="${line%\"}"
  [ -n "$line" ] && ORIGINAL_SEARCH_LIST+=("$line")
done < <(security list-keychains -d user 2>/dev/null)
ADDED_TO_SEARCH_LIST=0

WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/wing-signing-identity.XXXXXX")"
restore_state() {
  if [ "$ADDED_TO_SEARCH_LIST" -eq 1 ] && [ "${#ORIGINAL_SEARCH_LIST[@]}" -gt 0 ]; then
    security list-keychains -d user -s "${ORIGINAL_SEARCH_LIST[@]}" > /dev/null 2>&1 || true
  fi
  rm -rf "$WORK_DIR"
}
trap restore_state EXIT
# The private key lives only here, for as long as this script runs, reachable by nobody else.
umask 077

IN_SEARCH_LIST=0
for keychain in "${ORIGINAL_SEARCH_LIST[@]:-}"; do
  [ "$keychain" = "$WING_SIGNING_KEYCHAIN" ] && IN_SEARCH_LIST=1
done
if [ "$IN_SEARCH_LIST" -eq 0 ]; then
  # Guarded rather than expanded blind: an empty array expansion is an error under `set -u` on the bash 3.2
  # macOS ships, and this script has to run on a machine nobody has prepared.
  if [ "${#ORIGINAL_SEARCH_LIST[@]}" -gt 0 ]; then
    security list-keychains -d user -s "$WING_SIGNING_KEYCHAIN" "${ORIGINAL_SEARCH_LIST[@]}" > /dev/null
  else
    security list-keychains -d user -s "$WING_SIGNING_KEYCHAIN" > /dev/null
  fi
  ADDED_TO_SEARCH_LIST=1
fi

KEY_FILE="$WORK_DIR/identity.key"
CERT_FILE="$WORK_DIR/identity.crt"
P12_FILE="$WORK_DIR/identity.p12"
# A random passphrase, never printed and never reused: it protects the .p12 for the seconds it exists in
# a 0700 directory. A fixed one would leave the private key readable by anything that later reaches the
# file, and this project ships an application, not a shared signing convention.
P12_PASS="$(openssl rand -hex 24)"

cat > "$WORK_DIR/openssl.cnf" <<OPENSSL_CNF
[ req ]
distinguished_name = wing_dn
x509_extensions = wing_ext
prompt = no

[ wing_dn ]
CN = ${WING_SIGNING_IDENTITY}

[ wing_ext ]
basicConstraints = critical,CA:FALSE
keyUsage = critical,digitalSignature
extendedKeyUsage = critical,codeSigning
OPENSSL_CNF

echo "==> Creating the self-signed code-signing certificate '${WING_SIGNING_IDENTITY}' (10 years)"
echo "    key and certificate are generated in ${WORK_DIR} (mode 0700) and removed on exit"
openssl req -x509 -newkey rsa:2048 -nodes -days 3650 \
  -keyout "$KEY_FILE" -out "$CERT_FILE" -config "$WORK_DIR/openssl.cnf" > /dev/null 2>&1

# OpenSSL 3 writes PKCS#12 with AES-256-CBC and a SHA-256 MAC, which `security import` refuses with
# "MAC verification failed during PKCS12 import". The 3DES/SHA-1 combination below is the format macOS
# reads; it is used for the seconds the file exists, and -T /usr/bin/codesign + -A below are what make
# later signing non-interactive.
openssl pkcs12 -export -inkey "$KEY_FILE" -in "$CERT_FILE" -out "$P12_FILE" \
  -name "$WING_SIGNING_IDENTITY" -passout "pass:${P12_PASS}" \
  -certpbe PBE-SHA1-3DES -keypbe PBE-SHA1-3DES -macalg sha1 > /dev/null 2>&1

echo "==> Importing it into ${WING_SIGNING_KEYCHAIN}"
security import "$P12_FILE" -k "$WING_SIGNING_KEYCHAIN" -P "$P12_PASS" \
  -T /usr/bin/codesign -T /usr/bin/security -A > /dev/null

NEW_CERT_SHA1="$(wing_signing_certificate_sha1)"
if [ -z "$NEW_CERT_SHA1" ]; then
  echo "Error: the identity was imported but '${WING_SIGNING_IDENTITY}' is still not listed for code" >&2
  echo "       signing in ${WING_SIGNING_KEYCHAIN}." >&2
  exit 1
fi

# `-T /usr/bin/codesign` puts codesign on the key's trusted-application list, but macOS additionally
# checks the key's *partition list*. Without it, the first codesign call can abort with
# errSecInternalComponent or pop a keychain-password dialog once per nested binary, in the middle of a
# build. When the keychain password is available (WING_SIGNING_KEYCHAIN_PASSWORD, used by the test that
# exercises this script against a throwaway keychain) it is committed here without a prompt; otherwise
# `security` asks for it, once, only if the probe below shows that it is actually needed.
if [ -n "${WING_SIGNING_KEYCHAIN_PASSWORD:-}" ]; then
  security set-key-partition-list -S apple-tool:,apple:,codesign: -s \
    -k "$WING_SIGNING_KEYCHAIN_PASSWORD" "$WING_SIGNING_KEYCHAIN" > /dev/null 2>&1 || true
fi

PROBE_FILE="$WORK_DIR/probe"
cp /usr/bin/true "$PROBE_FILE"
sign_probe() {
  codesign --force --sign "$WING_SIGNING_IDENTITY" --keychain "$WING_SIGNING_KEYCHAIN" "$PROBE_FILE" 2>&1
}
if ! PROBE_ERROR="$(sign_probe)"; then
  echo "==> codesign could not use the new key yet; committing the key's partition list (this asks for your"
  echo "    login keychain password once, and only once)"
  security set-key-partition-list -S apple-tool:,apple:,codesign: -s "$WING_SIGNING_KEYCHAIN" > /dev/null 2>&1 || true
  if ! PROBE_ERROR="$(sign_probe)"; then
    echo "Error: the identity exists but codesign cannot sign with it." >&2
    echo "       codesign said: ${PROBE_ERROR}" >&2
    echo "       If it says 'ambiguous', another keychain on the search list already has a certificate" >&2
    echo "       with this Common Name; remove that one, or set WING_SIGNING_IDENTITY to a name of its own." >&2
    echo "       Otherwise, try again after unlocking the login keychain, then:" >&2
    echo "         security set-key-partition-list -S apple-tool:,apple:,codesign: -s \"${WING_SIGNING_KEYCHAIN}\"" >&2
    exit 1
  fi
fi
PROBE_REQUIREMENT="$(wing_signing_designated_requirement "$PROBE_FILE")"
if ! wing_signing_requirement_pins_certificate "$PROBE_REQUIREMENT" "$NEW_CERT_SHA1"; then
  echo "Error: the requirement codesign produces is not anchored to the new certificate:" >&2
  echo "       ${PROBE_REQUIREMENT:-nothing}" >&2
  exit 1
fi
echo "    [ok] codesign signs with it, and the requirement is anchored to the certificate, not a build hash"
echo "         requirement: ${PROBE_REQUIREMENT}"

if [ "$WITH_TRUST" -eq 1 ]; then
  # Self-signed certificates are not trusted by default, so `security find-identity -v` does not call this
  # identity valid. Trusting it for the codeSign policy only (never for TLS) makes that listing honest and
  # matches what Keychain Access' own "Code Signing" certificate does. It is the one step that may ask for
  # authorisation; if it fails the identity is still usable — signing and requirement evaluation do not
  # need it — so this reports and carries on rather than throwing away a working identity.
  if security add-trusted-cert -r trustRoot -p codeSign -k "$WING_SIGNING_KEYCHAIN" "$CERT_FILE" > /dev/null 2>&1; then
    echo "    [ok] trusted for code signing (listed by: security find-identity -v -p codesigning)"
  else
    echo "    [i] the certificate's codeSign trust setting could not be added (it may have asked for"
    echo "        authorisation). The identity signs and its requirement is certificate-anchored either"
    echo "        way. To add the setting later:"
    echo "          security add-trusted-cert -r trustRoot -p codeSign -k \"${WING_SIGNING_KEYCHAIN}\" <certificate>"
  fi
fi

echo ""
echo "==> Done. The build now signs with '${WING_SIGNING_IDENTITY}' (certificate SHA-1 ${NEW_CERT_SHA1})."
echo "    Build with: ./scripts/release.sh <version>   (or bash desktop/build-dist.sh)"
echo ""
print_removal_instructions
