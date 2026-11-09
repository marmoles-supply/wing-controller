#!/usr/bin/env node
// Build-time encryptor for the application's interface (binary shield, 2026-10-09).
//
// WHY THIS EXISTS
//
// `desktop/ui` is the application's brain: 1.7 MB of `index.html`, the cue engine in `cue-list.js`, the
// macro matrix, the meter bridge, the routing resolver. Tauri embeds that directory into the release
// binary, and until this script existed it embedded it **brotli-compressed, not encrypted**
// (tauri-codegen-2.6.3 `src/embedded_assets.rs:378` calls `brotli::BrotliCompress`; the decompressor is
// `tauri-utils-2.9.3 src/assets.rs:175`). The interface survived in the binary as plain text after one
// call to any brotli decoder — measured on `target/release/wing-controller-desktop` (15.6 MB, 2026-10-08):
// `strings` found no UI literal, but the asset map keys `/index.html`, `/cue-list.js` were there in the
// clear, and the payload behind each key was a brotli stream. Compression is not protection: whoever
// wanted the interface could have it in an afternoon, which is the "clonar la app" half of the problem.
//
// WHAT IT DOES
//
// Reads every file under `<ui-dir>` and writes two files into `<out-dir>` (the crate's `OUT_DIR`, so no
// key material is ever written into the repository or into a tracked path):
//
//   ui_vault.bin       the encrypted interface
//   ui_vault_keys.rs   the Rust constants the runtime module needs to reach the key
//
// The cipher is ChaCha20-Poly1305 (RFC 8439) with one nonce per file. The authenticated data of each
// entry is that entry's tag, so a body cannot be moved to a different entry. The file name is **not**
// stored in the vault: an entry is addressed by the first 8 bytes of `SHA-256(name)`, and the real name
// travels inside the ciphertext. That is why the vault has no readable file list — an attacker who
// `strings` the binary learns neither the interface's content nor even its shape.
//
// HONEST LIMITS, so nobody trusts this further than it goes
//
// The key has to be reachable by the program that decrypts, so it is reachable by whoever reads the
// program. `seed` is stored as `seed XOR mask` and the key is `SHA-256(seed || salt || domain)`, so the
// key is never a contiguous blob in the binary and a "scan for 32 high-entropy bytes and try it" attack
// does not work — but a person who reads the (stripped) Rust can still reconstruct it. This raises the
// cost of copying the interface from "run brotli" to "reverse-engineer the loader"; it does not make
// the interface unstealable. Nothing that runs offline can. The honest value is that the app is no
// longer *trivially* clonable and no longer a readable roadmap.
//
// Usage: node scripts/build-ui-vault.mjs <ui-dir> <out-dir>

import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

// The domain string is mixed into the key so that this key cannot be reused as a key for anything else,
// and it is written identically in `desktop/src-tauri/src/ui_vault.rs`. The two must match or every
// decryption fails; the Rust round-trip test is what makes a mismatch loud instead of a broken window.
const DOMAIN = Buffer.from("wing-controller/ui-vault/v1", "utf8");
const MAGIC = Buffer.from("WCVLT1\0\0", "latin1"); // 8 bytes
const FORMAT_VERSION = 1;
const SEED_LENGTH = 32;
const SALT_LENGTH = 32;
const NONCE_LENGTH = 12;
const TAG_LENGTH = 16;
const NAME_HASH_LENGTH = 8;

/** Every file under `dir`, dotfiles excluded, sorted so the vault is stable across runs. */
function walk(dir) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    if (entry.name.startsWith(".")) continue; // `.DS_Store` is not part of the interface
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...walk(path));
    else if (entry.isFile()) found.push(path);
  }
  return found;
}

function rustByteArray(name, bytes) {
  const lines = [];
  for (let offset = 0; offset < bytes.length; offset += 12) {
    lines.push(`    ${[...bytes.subarray(offset, offset + 12)].map((b) => `0x${b.toString(16).padStart(2, "0")}`).join(", ")},`);
  }
  return `pub const ${name}: [u8; ${bytes.length}] = [\n${lines.join("\n")}\n];\n`;
}

function writeAtomic(path, contents) {
  const temporary = `${path}.building`;
  writeFileSync(temporary, contents);
  renameSync(temporary, path);
}

function main() {
  const [uiDir, outDir] = process.argv.slice(2);
  if (!uiDir || !outDir) {
    console.error("Usage: node scripts/build-ui-vault.mjs <ui-dir> <out-dir>");
    process.exit(2);
  }
  if (!statSync(uiDir).isDirectory()) {
    console.error(`build-ui-vault: ${uiDir} is not a directory`);
    process.exit(2);
  }
  mkdirSync(outDir, { recursive: true });

  const files = walk(uiDir);
  if (files.length === 0) {
    console.error(`build-ui-vault: no interface files under ${uiDir}; refusing to build an empty vault`);
    process.exit(2);
  }

  // The key. `seed` and `mask` are random, `seed` is stored only XORed, and the key itself exists in no
  // file: it is derived here and again at runtime from the same three ingredients.
  const seed = randomBytes(SEED_LENGTH);
  const mask = randomBytes(SEED_LENGTH);
  const salt = randomBytes(SALT_LENGTH);
  const key = createHash("sha256").update(seed).update(salt).update(DOMAIN).digest();
  const maskedSeed = Buffer.alloc(SEED_LENGTH);
  for (let i = 0; i < SEED_LENGTH; i += 1) maskedSeed[i] = seed[i] ^ mask[i];

  const entries = [];
  let plaintextTotal = 0;
  for (const path of files) {
    const name = `/${relative(uiDir, path).split(sep).join("/")}`;
    const content = readFileSync(path);
    plaintextTotal += content.length;

    // The name travels inside the ciphertext; the entry is addressed by the hash of the name, which is
    // the only thing about the name that appears in the binary.
    const tag = createHash("sha256").update(name, "utf8").digest().subarray(0, NAME_HASH_LENGTH);
    const payload = Buffer.concat([
      (() => {
        const length = Buffer.alloc(2);
        length.writeUInt16LE(Buffer.byteLength(name, "utf8"), 0);
        return length;
      })(),
      Buffer.from(name, "utf8"),
      content,
    ]);

    const nonce = randomBytes(NONCE_LENGTH);
    const cipher = createCipheriv("chacha20-poly1305", key, nonce, { authTagLength: TAG_LENGTH });
    cipher.setAAD(tag);
    const body = Buffer.concat([cipher.update(payload), cipher.final(), cipher.getAuthTag()]);

    entries.push({ tag, nonce, body });
  }

  const header = Buffer.alloc(16);
  MAGIC.copy(header, 0);
  header.writeUInt32LE(FORMAT_VERSION, 8);
  header.writeUInt32LE(entries.length, 12);

  const parts = [header];
  for (const entry of entries) {
    const length = Buffer.alloc(4);
    length.writeUInt32LE(entry.body.length, 0);
    parts.push(entry.tag, entry.nonce, length, entry.body);
  }
  const vault = Buffer.concat(parts);
  writeAtomic(join(outDir, "ui_vault.bin"), vault);

  writeAtomic(
    join(outDir, "ui_vault_keys.rs"),
    [
      "// Generated by scripts/build-ui-vault.mjs. Do not edit, and do not commit: this is key material.",
      "//",
      "// `UI_VAULT_SEED_XOR` is the seed XORed with `UI_VAULT_SEED_MASK`, so the seed is not a contiguous",
      "// blob here; the runtime key is SHA-256(seed || salt || domain) and appears in no file at all.",
      rustByteArray("UI_VAULT_SEED_XOR", maskedSeed),
      rustByteArray("UI_VAULT_SEED_MASK", mask),
      rustByteArray("UI_VAULT_SALT", salt),
    ].join("\n"),
  );

  console.log(
    `build-ui-vault: ${entries.length} files, ${plaintextTotal} bytes of interface -> ${vault.length} bytes of ciphertext`,
  );
}

main();
