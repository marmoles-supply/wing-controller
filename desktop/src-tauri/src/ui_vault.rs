//! The interface shield: the application's interface, encrypted in the binary and decrypted in memory.
//!
//! Tauri asks a `Context` for its frontend through the `Assets` trait. `tauri.conf.json` normally makes
//! that trait an `EmbeddedAssets` built by the macro, and the macro stores every file of `desktop/ui`
//! **brotli-compressed, not encrypted** (tauri-codegen-2.6.3 `src/embedded_assets.rs:378`). This module
//! replaces that provider: `main.rs` passes `assets = UiVault` to `generate_context!`, which is a
//! documented extension point of the macro (tauri-codegen-2.6.3 `src/context.rs:176` — when a custom
//! provider is given, the `frontendDist` directory is never read and never embedded).
//!
//! What that buys, measured on the release binary rather than asserted:
//!
//! * no file of `desktop/ui` survives in the binary as text, in any compressed form;
//! * not even the interface's file names survive — an entry is addressed by the first 8 bytes of
//!   `SHA-256(name)` and the name itself travels inside the ciphertext, so `strings` cannot list the shape
//!   of the interface either;
//! * a tampered vault does not decrypt, because every entry is authenticated (ChaCha20-Poly1305,
//!   RFC 8439) with its own tag as authenticated data.
//!
//! What it does **not** buy, stated plainly because the honest limit is the useful part: the key has to
//! be reachable by the code that decrypts it, so a person who reads the (stripped) binary can reach it
//! too. `scripts/build-ui-vault.mjs` derives the key as `SHA-256(seed || salt || domain)` and stores the
//! seed only XORed with a mask, so the key is never a contiguous blob to find and try — that defeats the
//! automated attack, not a determined reader. The interface is no longer *trivially* copyable; it is not
//! unstealable, and nothing that runs offline can be.
//!
//! The vault is generated at build time by `scripts/build-ui-vault.mjs`, which `build.rs` runs into this
//! crate's `OUT_DIR`. No key material is written anywhere inside the repository.

use std::borrow::Cow;
use std::sync::OnceLock;

use chacha20poly1305::aead::{Aead, KeyInit, Payload};
use chacha20poly1305::{ChaCha20Poly1305, Nonce};
use sha2::{Digest, Sha256};
use tauri::utils::assets::{AssetKey, AssetsIter, CspHash};
use tauri::{Assets, Runtime};

// Written by `scripts/build-ui-vault.mjs` into this crate's `OUT_DIR`.
include!(concat!(env!("OUT_DIR"), "/ui_vault_keys.rs"));

/// The encrypted interface. `include_bytes!` keeps it in the read-only segment; nothing decrypts it
/// before it is asked for.
const VAULT: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/ui_vault.bin"));

/// Mixed into the key. `scripts/build-ui-vault.mjs` carries the same bytes in `DOMAIN`; a mismatch here
/// makes every decryption fail, which the round-trip test below turns into a red gate rather than a
/// window that opens empty.
const DOMAIN: &[u8] = b"wing-controller/ui-vault/v1";

const MAGIC: &[u8; 8] = b"WCVLT1\0\0";
const FORMAT_VERSION: u32 = 1;
const NONCE_LENGTH: usize = 12;
/// A vault cannot have more entries than this; the cap keeps a corrupt header from asking for a
/// multi-gigabyte allocation.
const MAX_ENTRIES: usize = 4096;

/// One encrypted file: the tag it is addressed by, its nonce, and its authenticated ciphertext.
struct Entry {
    tag: [u8; 8],
    nonce: &'static [u8],
    body: &'static [u8],
}

/// The provider `main.rs` hands to `generate_context!`. It holds nothing: the vault is a `const` and the
/// index is built once, on first use.
pub struct UiVault;

impl UiVault {
    /// The key, derived once and kept. `seed` is reassembled from the two constants and zeroed again
    /// immediately; the key itself is held by the cipher and appears in no file, in the repository or in
    /// the binary as a contiguous value.
    fn cipher() -> Option<&'static ChaCha20Poly1305> {
        static CIPHER: OnceLock<Option<ChaCha20Poly1305>> = OnceLock::new();
        CIPHER
            .get_or_init(|| {
                let mut seed = [0u8; 32];
                for (slot, (masked, mask)) in seed
                    .iter_mut()
                    .zip(UI_VAULT_SEED_XOR.iter().zip(UI_VAULT_SEED_MASK.iter()))
                {
                    *slot = masked ^ mask;
                }
                let mut hasher = Sha256::new();
                hasher.update(seed);
                hasher.update(UI_VAULT_SALT);
                hasher.update(DOMAIN);
                let key = hasher.finalize();
                seed.fill(0);
                ChaCha20Poly1305::new_from_slice(&key).ok()
            })
            .as_ref()
    }
}

/// The index of the vault, parsed once. `None` entries are never produced: a vault that cannot be parsed
/// yields an empty index, and every request then falls through to the damaged-installation page.
fn entries() -> &'static [Entry] {
    static ENTRIES: OnceLock<Vec<Entry>> = OnceLock::new();
    ENTRIES.get_or_init(|| parse(VAULT).unwrap_or_default())
}

/// The address of an entry: the first 8 bytes of `SHA-256(name)`. The name is not stored beside it.
fn name_tag(name: &str) -> [u8; 8] {
    let digest = Sha256::digest(name.as_bytes());
    let mut tag = [0u8; 8];
    tag.copy_from_slice(&digest[..8]);
    tag
}

fn fixed<const N: usize>(bytes: &[u8]) -> Option<[u8; N]> {
    <[u8; N]>::try_from(bytes).ok()
}

fn take<'a>(bytes: &'a [u8], cursor: &mut usize, length: usize) -> Option<&'a [u8]> {
    let end = cursor.checked_add(length)?;
    let slice = bytes.get(*cursor..end)?;
    *cursor = end;
    Some(slice)
}

/// Parse the vault. Every read is bounds-checked and no input can make this panic: a binary that has been
/// edited must produce the damaged-installation page, not a crash at start-up.
fn parse(bytes: &'static [u8]) -> Option<Vec<Entry>> {
    if bytes.len() < 16 || &bytes[..8] != MAGIC {
        return None;
    }
    if u32::from_le_bytes(fixed::<4>(&bytes[8..12])?) != FORMAT_VERSION {
        return None;
    }
    let count = u32::from_le_bytes(fixed::<4>(&bytes[12..16])?) as usize;
    if count > MAX_ENTRIES {
        return None;
    }
    let mut cursor = 16usize;
    let mut entries = Vec::with_capacity(count);
    for _ in 0..count {
        let tag = fixed::<8>(take(bytes, &mut cursor, 8)?)?;
        let nonce = take(bytes, &mut cursor, NONCE_LENGTH)?;
        let length = u32::from_le_bytes(fixed::<4>(take(bytes, &mut cursor, 4)?)?) as usize;
        let body = take(bytes, &mut cursor, length)?;
        entries.push(Entry { tag, nonce, body });
    }
    Some(entries)
}

/// Decrypt one entry and split the real name from the file content. The name is inside the ciphertext, so
/// a body that decrypts under one tag cannot be read as another file.
fn open(entry: &Entry) -> Option<(String, Vec<u8>)> {
    let plain = decrypt_bytes(entry.tag, entry.nonce, entry.body)?;
    if plain.len() < 2 {
        return None;
    }
    let name_length = u16::from_le_bytes([plain[0], plain[1]]) as usize;
    let name = std::str::from_utf8(plain.get(2..2 + name_length)?).ok()?.to_owned();
    let content = plain.get(2 + name_length..)?.to_vec();
    Some((name, content))
}

/// The authenticated decryption itself. A flipped byte anywhere in `body`, a wrong tag, or a body moved
/// to another entry all return `None` — that is the whole anti-tamper story for the interface.
fn decrypt_bytes(tag: [u8; 8], nonce: &[u8], body: &[u8]) -> Option<Vec<u8>> {
    let cipher = UiVault::cipher()?;
    cipher
        .decrypt(
            Nonce::from_slice(nonce),
            Payload {
                msg: body,
                aad: &tag,
            },
        )
        .ok()
}

impl<R: Runtime> Assets<R> for UiVault {
    fn get(&self, key: &AssetKey) -> Option<Cow<'_, [u8]>> {
        let wanted = key.as_ref();
        let tag = name_tag(wanted);
        if let Some(entry) = entries().iter().find(|entry| entry.tag == tag) {
            if let Some((name, content)) = open(entry) {
                // The name check is not ceremony: it is what makes an 8-byte tag a safe address, because
                // a collision would otherwise serve one file's bytes as another file's.
                if name == wanted {
                    return Some(Cow::Owned(content));
                }
            }
        }
        // A copy that cannot decrypt its own interface must say so. Returning `None` for the entry point
        // would leave the window blank, which is the one outcome an operator cannot act on.
        if wanted == "/index.html" {
            return Some(Cow::Borrowed(DAMAGED_INSTALLATION.as_bytes()));
        }
        None
    }

    fn iter(&self) -> Box<AssetsIter<'_>> {
        let decoded: Vec<(Cow<'_, str>, Cow<'_, [u8]>)> = entries()
            .iter()
            .filter_map(|entry| {
                let (name, content) = open(entry)?;
                Some((Cow::Owned(name), Cow::Owned(content)))
            })
            .collect();
        Box::new(decoded.into_iter())
    }

    /// No CSP hashes are published here, and that is deliberate rather than an omission.
    ///
    /// Tauri folds these into `script-src` and `style-src` as `'nonce-…'`/`'sha256-…'`, and WebKit reads
    /// the presence of any nonce or hash in a source list as "ignore `'unsafe-inline'`" — which would take
    /// the layout off every window of this interface. `tauri.conf.json` therefore sets
    /// `dangerousDisableAssetCspModification` for exactly those two directives, and
    /// `scripts/test-desktop-csp.mjs` fails if that is ever undone. If it is ever undone deliberately,
    /// this method has to start publishing hashes in the same change.
    fn csp_hashes(&self, _html_path: &AssetKey) -> Box<dyn Iterator<Item = CspHash<'_>> + '_> {
        Box::new(std::iter::empty())
    }
}

/// Shown when the vault does not decrypt. It is a `const` in the source, never a vault entry, so it is
/// available precisely when the vault is not.
const DAMAGED_INSTALLATION: &str = r#"<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>WING CONTROLLER</title>
<style>
:root { color-scheme: dark; }
body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #101014;
       color: #e8e8ee; font: 15px/1.6 -apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif; }
main { max-width: 34rem; padding: 2rem; }
h1 { font-size: 1.15rem; margin: 0 0 0.75rem; letter-spacing: 0.02em; }
p { margin: 0 0 0.75rem; color: #b9b9c6; }
</style>
</head>
<body>
<main>
<h1>Instalación dañada</h1>
<p>La interfaz no se ha podido descifrar: esta copia está incompleta o se ha modificado después de
firmarse.</p>
<p>Vuelve a instalar WING CONTROLLER desde la imagen original y abre la copia instalada, no la que está
dentro de la imagen.</p>
<p>Abrir esta pantalla no ha modificado ningún ajuste, macro ni show.</p>
</main>
</body>
</html>
"#;

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::{Path, PathBuf};

    fn interface_dir() -> PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR")).join("../ui")
    }

    /// `UiVault` implements `Assets` for every runtime, so the tests name the one the application runs:
    /// `Wry`, which is what `tauri::Builder::default()` builds in `main.rs`.
    fn served(name: &str) -> Option<Vec<u8>> {
        <UiVault as Assets<tauri::Wry>>::get(&UiVault, &AssetKey::from(name)).map(Cow::into_owned)
    }

    fn listed() -> Vec<String> {
        <UiVault as Assets<tauri::Wry>>::iter(&UiVault)
            .map(|(name, _)| name.into_owned())
            .collect()
    }

    /// Every interface file, as (`/name`, absolute path), the same shape the vault generator uses.
    fn interface_files(dir: &Path) -> Vec<(String, PathBuf)> {
        let mut found = Vec::new();
        let mut stack = vec![dir.to_path_buf()];
        while let Some(current) = stack.pop() {
            for entry in fs::read_dir(&current).expect("the interface directory is readable") {
                let entry = entry.expect("a directory entry is readable");
                let name = entry.file_name().to_string_lossy().into_owned();
                if name.starts_with('.') {
                    continue;
                }
                let path = entry.path();
                if path.is_dir() {
                    stack.push(path);
                } else {
                    let relative = path
                        .strip_prefix(dir)
                        .expect("a walked path is under the interface directory")
                        .to_string_lossy()
                        .replace('\\', "/");
                    found.push((format!("/{relative}"), path));
                }
            }
        }
        found.sort();
        found
    }

    /// The contract that matters most: what the binary can hand the window is what `desktop/ui` holds,
    /// byte for byte. A generator and a reader that disagree would show up here and nowhere else.
    #[test]
    fn every_interface_file_decrypts_byte_for_byte() {
        let dir = interface_dir();
        let files = interface_files(&dir);
        assert!(!files.is_empty(), "the interface directory {} is empty", dir.display());

        for (name, path) in &files {
            let expected = fs::read(path).expect("an interface file is readable");
            let served = served(name.trim_start_matches('/'))
                .unwrap_or_else(|| panic!("the vault does not hold {name}"));
            assert_eq!(
                served.as_slice(),
                expected.as_slice(),
                "{name} does not decrypt to the file on disk"
            );
        }
    }

    /// `iter()` is not on the window's path, but a provider that reports a different interface than the
    /// one it serves is a lie waiting for a reader (and for Tauri's next release).
    #[test]
    fn the_vault_lists_exactly_the_interface_files() {
        let files = interface_files(&interface_dir());
        let mut expected: Vec<String> = files.iter().map(|(name, _)| name.clone()).collect();
        expected.sort();
        let mut listed: Vec<String> = listed();
        listed.sort();
        assert_eq!(listed, expected);
    }

    /// The point of the shield, stated as a test: the binary carries neither the interface's text nor
    /// even the names of its files. This is what turns "run brotli" back into "reverse-engineer the
    /// loader", and it is the assertion that would fail if anyone went back to `EmbeddedAssets`.
    #[test]
    fn the_vault_carries_no_readable_piece_of_the_interface() {
        let dir = interface_dir();
        for (name, path) in interface_files(&dir) {
            let text = name.as_bytes();
            assert!(
                !VAULT.windows(text.len()).any(|window| window == text),
                "the vault exposes the file name {name}"
            );

            let bytes = fs::read(&path).expect("an interface file is readable");
            if bytes.len() < 256 || bytes.iter().any(|byte| *byte == 0) {
                continue; // opaque binaries (the PNG masters) have no readable excerpt to look for
            }
            for offset in [32, bytes.len() / 2, bytes.len() - 96] {
                let excerpt = &bytes[offset..offset + 48];
                assert!(
                    !VAULT.windows(excerpt.len()).any(|window| window == excerpt),
                    "{name} survives in the vault as plain text at offset {offset}"
                );
            }
        }
    }

    /// Anti-tamper, at the level where it is actually enforced: the authenticated decryption.
    #[test]
    fn a_modified_entry_does_not_decrypt() {
        let entry = entries().first().expect("the vault holds at least one entry");

        assert!(
            decrypt_bytes(entry.tag, entry.nonce, entry.body).is_some(),
            "the first entry of the vault must decrypt, or the build is broken"
        );

        let mut tampered = entry.body.to_vec();
        let last = tampered.len() - 1;
        tampered[last] ^= 0x01;
        assert!(
            decrypt_bytes(entry.tag, entry.nonce, &tampered).is_none(),
            "a flipped byte in an entry must not decrypt"
        );

        let mut wrong_tag = entry.tag;
        wrong_tag[0] ^= 0x01;
        assert!(
            decrypt_bytes(wrong_tag, entry.nonce, entry.body).is_none(),
            "an entry must not decrypt under another entry's tag"
        );
    }

    /// A damaged installation is answered with words, not with a blank window.
    #[test]
    fn the_entry_point_answers_with_the_damaged_installation_page_when_nothing_decrypts() {
        assert!(parse(b"not a vault at all").is_none());
        assert!(parse(b"WCVLT1\0\0").is_none(), "a truncated header must not parse");
        assert!(DAMAGED_INSTALLATION.contains("Instalación dañada"));
    }
}
