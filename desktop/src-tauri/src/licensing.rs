//! Licensing: the token, and the rule that decides whether the application may drive a console.
//!
//! The design, its threat model and the decisions behind every choice below are in
//! `docs/LICENSING_PLAN_2026-10-09.md`. What matters for a reader here:
//!
//! * **A licence is unforgeable, not un-patchable.** It is an Ed25519-signed token, and the private key that
//!   mints one exists on the owner's machine and nowhere else — not in this repository, not in this binary.
//!   Forgery is closed. Patching the branch that reads the result is not, and cannot be offline on a single
//!   build (plan §1); what this module does about that is keep the decision in Rust, on the path to the
//!   console, rather than in the interface where one line of JavaScript would reverse it.
//! * **The signature is over the bytes in the file**, not over a re-serialisation of the parsed JSON. So the
//!   order of verification is: decode, verify, and only then parse. Canonical JSON is a swamp and this
//!   application does not enter it.
//! * **The times travel as Unix seconds.** The RFC 3339 strings in the payload are for the human who decodes
//!   the file; the integers are what is compared, so no date-parsing dependency and no format assumptions.

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine as _;
use ed25519_dalek::{Signature, Verifier as _, VerifyingKey};
use serde::Deserialize;

/// The owner's licence-signing public key, printed by `scripts/licence-keygen.mjs`.
///
/// **This is the one line that has to change before the first licence is sold**, and the placeholder is
/// deliberately an all-zero block: zero is not a valid Ed25519 point, so nothing verifies against it and the
/// application cannot be licensed at all until a real key is embedded. That fails *closed* and loudly, where
/// a plausible-looking placeholder would fail open.
///
/// A rotation adds a second constant here rather than replacing this one — a licence names the key that
/// signed it (`keyId`), so licences signed before a rotation keep verifying.
pub const LICENCE_PUBLIC_KEY: [u8; 32] = [0u8; 32];

/// The longest payload this will look at. A licence is a few hundred bytes; anything near this is not one,
/// and the bound is here so a hostile file cannot ask for an allocation.
const MAX_PAYLOAD_BYTES: usize = 4096;

/// What a licence says. Field names are camelCase in the file and snake_case here.
#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Licence {
    pub v: u32,
    pub id: String,
    pub kind: LicenceKind,
    pub holder: String,
    /// The `IOPlatformUUID` this licence was issued for.
    pub machine: String,
    #[allow(dead_code)] // carried for the record; the integer below is what decides
    pub issued_at: Option<String>,
    #[allow(dead_code)]
    pub expires_at: Option<String>,
    pub issued_at_unix: i64,
    /// `None` is a perpetual licence.
    pub expires_at_unix: Option<i64>,
    pub key_id: String,
}

#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum LicenceKind {
    Trial,
    Full,
}

/// Why a licence was refused. Every variant is a sentence the operator can act on, which is the standard
/// this project holds refusals to.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LicenceProblem {
    /// Not `payload.signature`, not base64url, or the payload is not JSON.
    Malformed,
    /// Well-formed and does not verify. This is the forgery case.
    SignatureInvalid,
    /// This build carries no signing key, so it cannot accept any licence.
    NoSigningKey,
    /// A version this build does not know. Refusing is right: a newer format may mean something this build
    /// would misread rather than reject.
    UnsupportedVersion(u32),
}

/// Decode, verify, and only then parse — in that order, and never another.
pub fn open_licence_with_key(text: &str, public_key: &[u8; 32]) -> Result<Licence, LicenceProblem> {
    if public_key == &[0u8; 32] {
        return Err(LicenceProblem::NoSigningKey);
    }
    let verifier = VerifyingKey::from_bytes(public_key).map_err(|_| LicenceProblem::NoSigningKey)?;

    let trimmed = text.trim();
    let Some((payload_b64, signature_b64)) = trimmed.split_once('.') else {
        return Err(LicenceProblem::Malformed);
    };
    let payload = URL_SAFE_NO_PAD
        .decode(payload_b64)
        .map_err(|_| LicenceProblem::Malformed)?;
    let signature_bytes = URL_SAFE_NO_PAD
        .decode(signature_b64)
        .map_err(|_| LicenceProblem::Malformed)?;

    if payload.is_empty() || payload.len() > MAX_PAYLOAD_BYTES {
        return Err(LicenceProblem::Malformed);
    }
    let signature_array: [u8; 64] = signature_bytes
        .as_slice()
        .try_into()
        .map_err(|_| LicenceProblem::Malformed)?;
    let signature = Signature::from_bytes(&signature_array);

    // The signature covers these exact bytes, and nothing re-encoded them first.
    verifier
        .verify(&payload, &signature)
        .map_err(|_| LicenceProblem::SignatureInvalid)?;

    let licence: Licence = serde_json::from_slice(&payload).map_err(|_| LicenceProblem::Malformed)?;
    if licence.v != 1 {
        return Err(LicenceProblem::UnsupportedVersion(licence.v));
    }
    Ok(licence)
}

/// Open a licence against the key this build was shipped with.
pub fn open_licence(text: &str) -> Result<Licence, LicenceProblem> {
    open_licence_with_key(text, &LICENCE_PUBLIC_KEY)
}

/// What the application is allowed to do, decided from a licence alone. A pure function, so the rules can be
/// tested without a keychain, a file or a clock.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Verdict {
    /// Good for this machine and not past its date.
    Granted {
        kind: LicenceKind,
        holder: String,
        expires_at_unix: Option<i64>,
        days_left: Option<i64>,
    },
    /// Issued for another Mac. A licence is anchored to one machine, so this is not a quibble: the token was
    /// minted for hardware this is not.
    WrongMachine,
    Expired {
        kind: LicenceKind,
        holder: String,
        expired_at_unix: i64,
    },
}

/// Decide. `now_unix` is passed in rather than read here so a test can stand at any date it likes.
pub fn evaluate(licence: &Licence, machine: &str, now_unix: i64) -> Verdict {
    if licence.machine != machine {
        return Verdict::WrongMachine;
    }
    match licence.expires_at_unix {
        // Perpetual.
        None => Verdict::Granted {
            kind: licence.kind,
            holder: licence.holder.clone(),
            expires_at_unix: None,
            days_left: None,
        },
        Some(expires) if now_unix > expires => Verdict::Expired {
            kind: licence.kind,
            holder: licence.holder.clone(),
            expired_at_unix: expires,
        },
        Some(expires) => Verdict::Granted {
            kind: licence.kind,
            holder: licence.holder.clone(),
            expires_at_unix: Some(expires),
            // Whole days remaining, rounded up, so the last partial day still reads as "1 day left" rather
            // than "0 days left" while the licence is still valid.
            days_left: Some((expires - now_unix).div_euclid(86_400) + i64::from((expires - now_unix) % 86_400 != 0)),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A vector minted by `scripts/issue-licence.mjs` with a throwaway key pair (2026-10-09). It is here for
    /// one reason: the signer is Node and the verifier is this crate, and the only way to know they agree is
    /// to verify a signature Node actually produced. A hand-written test signature would prove nothing about
    /// the tool the owner will use.
    const TEST_PUBLIC_KEY: [u8; 32] = [
        0xbf, 0xa4, 0xad, 0xc1, 0x6d, 0xbe, 0xec, 0x30, 0xef, 0xdf, 0xfd, 0x7f, 0x61, 0xd7, 0x03, 0x79,
        0x51, 0x68, 0xd7, 0x27, 0x20, 0x22, 0x51, 0xc8, 0x36, 0xb7, 0x4b, 0x9f, 0xcd, 0xa6, 0xbe, 0xad,
    ];
    const TEST_PAYLOAD: &str = "{\"v\":1,\"id\":\"ef95b27b-f949-4ea7-bccc-071018797c46\",\"kind\":\"trial\",\"holder\":\"Test Holder\",\"machine\":\"TEST-MACHINE\",\"issuedAt\":\"2026-10-09T11:29:01.530Z\",\"expiresAt\":\"2026-11-11T11:29:01.530Z\",\"issuedAtUnix\":1791545341,\"expiresAtUnix\":1794396541,\"keyId\":\"55c91442\"}";
    const TEST_SIGNATURE: &str = "uoRB-A-ZVnAoHeCSVYD6QW_mftge7fC52mV_8vHB5xMW10H5F46tUEfi-pIn4hOto2hSsEXWcENRG1l1rb4iAw";

    fn test_licence_text() -> String {
        format!(
            "{}.{}",
            URL_SAFE_NO_PAD.encode(TEST_PAYLOAD.as_bytes()),
            TEST_SIGNATURE
        )
    }

    /// The interop contract: what the owner's tool signs, this crate verifies.
    #[test]
    fn a_licence_signed_by_the_issuing_tool_verifies_here() {
        let licence = open_licence_with_key(&test_licence_text(), &TEST_PUBLIC_KEY)
            .expect("the vector minted by scripts/issue-licence.mjs must verify");
        assert_eq!(licence.v, 1);
        assert_eq!(licence.kind, LicenceKind::Trial);
        assert_eq!(licence.holder, "Test Holder");
        assert_eq!(licence.machine, "TEST-MACHINE");
        assert_eq!(licence.expires_at_unix, Some(1_794_396_541));
        assert_eq!(licence.key_id, "55c91442");
    }

    /// The forgery case, which is the whole point of signing: edit one byte of a valid licence and it stops
    /// being a licence.
    #[test]
    fn an_edited_licence_is_refused() {
        let edited = TEST_PAYLOAD.replace("\"kind\":\"trial\"", "\"kind\":\"full\"");
        let text = format!("{}.{}", URL_SAFE_NO_PAD.encode(edited.as_bytes()), TEST_SIGNATURE);
        assert_eq!(
            open_licence_with_key(&text, &TEST_PUBLIC_KEY),
            Err(LicenceProblem::SignatureInvalid)
        );
    }

    /// A licence signed by a *different* key is refused, which is what stops anyone who mints their own key
    /// pair from issuing licences.
    #[test]
    fn a_licence_signed_by_another_key_is_refused() {
        let other = [7u8; 32];
        // 7 repeated is not necessarily a valid point, but either refusal is a refusal; assert on the text we
        // care about being absent.
        assert!(open_licence_with_key(&test_licence_text(), &other).is_err());
    }

    #[test]
    fn rubbish_is_malformed_rather_than_accepted() {
        for text in ["", "not-a-licence", "one-part-only", "a.b.c", "!!!.###"] {
            assert_eq!(
                open_licence_with_key(text, &TEST_PUBLIC_KEY),
                Err(LicenceProblem::Malformed),
                "`{text}` must be Malformed"
            );
        }
    }

    /// A build with no signing key accepts nothing. This is the fail-closed placeholder.
    #[test]
    fn a_build_without_a_signing_key_refuses_everything() {
        assert_eq!(
            open_licence_with_key(&test_licence_text(), &[0u8; 32]),
            Err(LicenceProblem::NoSigningKey)
        );
        assert_eq!(
            open_licence(&test_licence_text()),
            Err(LicenceProblem::NoSigningKey),
            "and the shipped constant is that placeholder until the owner mints a key"
        );
    }

    #[test]
    fn the_machine_anchor_is_enforced() {
        let licence = open_licence_with_key(&test_licence_text(), &TEST_PUBLIC_KEY).unwrap();
        assert_eq!(
            evaluate(&licence, "ANOTHER-MACHINE", 1_794_000_000),
            Verdict::WrongMachine
        );
        assert!(matches!(
            evaluate(&licence, "TEST-MACHINE", 1_794_000_000),
            Verdict::Granted { days_left: Some(_), .. }
        ));
    }

    /// The day the trial ends, exactly: the last second is inside it and the next one is not.
    #[test]
    fn the_expiry_instant_is_the_boundary() {
        let licence = open_licence_with_key(&test_licence_text(), &TEST_PUBLIC_KEY).unwrap();
        let expires = licence.expires_at_unix.unwrap();
        assert!(matches!(
            evaluate(&licence, "TEST-MACHINE", expires),
            Verdict::Granted { .. }
        ));
        assert!(matches!(
            evaluate(&licence, "TEST-MACHINE", expires + 1),
            Verdict::Expired { .. }
        ));
    }

    /// Days remaining, including the rounding at the edges, because the operator reads this number.
    #[test]
    fn days_remaining_rounds_up_so_the_last_day_is_not_zero() {
        let licence = open_licence_with_key(&test_licence_text(), &TEST_PUBLIC_KEY).unwrap();
        let expires = licence.expires_at_unix.unwrap();
        let days = |now: i64| match evaluate(&licence, "TEST-MACHINE", now) {
            Verdict::Granted { days_left, .. } => days_left.unwrap(),
            other => panic!("expected Granted, got {other:?}"),
        };
        assert_eq!(days(expires - 86_400), 1, "one clear day left");
        assert_eq!(days(expires - 1), 1, "one second left still reads as a day, not as zero");
        assert_eq!(days(expires - 86_401), 2);
    }
}
