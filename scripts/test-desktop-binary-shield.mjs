// The binary shield contract (2026-10-09).
//
// Two halves, and neither is a grep for a word that ought to be there.
//
// **The pipeline.** The release profile must strip symbols and fold the program with LTO, `main.rs` must
// hand Tauri the vault provider by name, and `build.rs` must be the thing that builds the vault. Each of
// those is a single line that can be deleted, and deleting any of them puts the whole interface or a
// function-level map of the application back into the shipped binary with nothing else looking different:
//
//   * without `strip`, `nm` on the shipped copy reported **12,254** of this project's own symbols
//     (measured on `target/release/wing-controller-desktop`, 2026-10-08);
//   * without `assets = ui_vault::UiVault`, Tauri's macro goes back to `EmbeddedAssets`
//     (tauri-codegen-2.6.3 `src/context.rs:176-206`), which stores `desktop/ui` brotli-compressed — the
//     whole 3.2 MB interface one decompressor call away.
//
// **The vault itself.** The generator is run here, on the real `desktop/ui`, into a throwaway directory,
// and its output is measured: every file must decrypt byte for byte under the key its own key file
// describes, no file name and no readable excerpt of any file may appear in the ciphertext, and a flipped
// byte must stop decryption. This is the half that catches a generator and a reader drifting apart, and it
// needs no compiled binary, so the gate can always run it.
//
// `scripts/audit-binary-shield.mjs` is the other half — it measures a *built* binary, and
// `desktop/build-dist.sh` calls it so a leaking build cannot be packaged. It is not in this file because
// the gate has to stay runnable on a tree with no release build in it.
//
// Run: node scripts/test-desktop-binary-shield.mjs

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createDecipheriv, createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const ROOT_MANIFEST = `${ROOT}Cargo.toml`;
const GENERATOR = `${ROOT}scripts/build-ui-vault.mjs`;
const AUDIT = `${ROOT}scripts/audit-binary-shield.mjs`;
const MAIN_RS = `${ROOT}desktop/src-tauri/src/main.rs`;
const BUILD_RS = `${ROOT}desktop/src-tauri/build.rs`;
const UI_DIR = `${ROOT}desktop/ui`;

const DOMAIN = Buffer.from("wing-controller/ui-vault/v1", "utf8");

// ---------------------------------------------------------------------------
// 1. The release profile.
// ---------------------------------------------------------------------------
/** The `key = value` lines of one `[section]`, stopping at the next section header. */
function tomlSection(source, section) {
  const lines = source.split("\n");
  const start = lines.findIndex((line) => line.trim() === `[${section}]`);
  assert.notEqual(start, -1, `Cargo.toml must have a [${section}] section`);
  const entries = new Map();
  for (const line of lines.slice(start + 1)) {
    if (/^\s*\[/.test(line)) break;
    const match = /^\s*([A-Za-z0-9_.-]+)\s*=\s*(.+?)\s*$/.exec(line);
    if (match && !line.trim().startsWith("#")) entries.set(match[1], match[2].replace(/^"|"$/g, ""));
  }
  return entries;
}

const manifest = readFileSync(ROOT_MANIFEST, "utf8");
const release = tomlSection(manifest, "profile.release");

const strip = release.get("strip");
assert.ok(
  strip === "symbols" || strip === "true",
  `[profile.release] must strip symbols, found strip = ${strip ?? "(absent)"}. Without it the shipped ` +
    `binary names 12,254 of this project's own functions to whoever runs nm.`,
);
const lto = release.get("lto");
assert.ok(
  lto === "fat" || lto === "thin" || lto === "true",
  `[profile.release] must enable link-time optimisation, found lto = ${lto ?? "(absent)"}`,
);
assert.equal(
  release.get("codegen-units"),
  "1",
  "[profile.release] must use one codegen unit, or LLVM cannot fold the program across modules",
);
// `panic = "abort"` is the usual fourth line of a hardening block and it is deliberately absent: this
// binary spawns 19 threads and a panic in one of them currently ends that thread, not the show. Under
// abort, the same panic takes the console control down with it. This assertion is here so that adding the
// line is a decision somebody makes on purpose, with the reason in front of them, rather than a line
// copied from a hardening checklist.
assert.notEqual(
  release.get("panic"),
  "abort",
  'panic = "abort" would turn any panic in the 19 worker threads (meter, LTC, inter-application) into a ' +
    "whole-application abort at a show. If that trade is ever wanted, contain the thread panics first and " +
    "change this contract in the same commit, naming the measurement that makes it safe.",
);

// ---------------------------------------------------------------------------
// 2. The wiring: the provider must be named, and the build script must build the vault.
// ---------------------------------------------------------------------------
const mainSource = readFileSync(MAIN_RS, "utf8");
const contextCalls = [...mainSource.matchAll(/generate_context!\s*\(([^)]*)\)/g)].map((match) => match[1].trim());
assert.ok(contextCalls.length > 0, "main.rs must build a Tauri context");
for (const args of contextCalls) {
  assert.match(
    args,
    /^assets\s*=/,
    `every generate_context! in main.rs must name its asset provider (found \`(${args})\`). Bare, it goes ` +
      `back to EmbeddedAssets and the whole interface is embedded as brotli-compressed text.`,
  );
}
assert.ok(
  /generate_context!\(\s*assets\s*=\s*ui_vault::UiVault\s*\)/.test(mainSource),
  "main.rs must pass `assets = ui_vault::UiVault` to generate_context!",
);
assert.ok(/^mod ui_vault;$/m.test(mainSource), "main.rs must declare the ui_vault module");

const buildSource = readFileSync(BUILD_RS, "utf8");
assert.ok(
  /build-ui-vault\.mjs/.test(buildSource),
  "build.rs must build the interface vault, or cargo build/run/test would hand out a stale or missing one",
);
// The vault and the code that reads it are one format, so all three of its halves have to be watched. Any
// one of them missing is a stale vault meeting a rebuilt reader, which is the damaged-installation page in a
// shipped build — and the gate would find it only because the round-trip test reads the same stale vault.
const watchLines = buildSource.split("\n").filter((line) => line.includes("rerun-if-changed"));
assert.ok(
  watchLines.length >= 3,
  `build.rs must watch the interface, the generator and the reader (found ${watchLines.length} rerun-if-changed line(s))`,
);
const watched = watchLines.join("\n");
for (const [needle, why] of [
  ["ui_dir", "an edited window would ship inside the previous build's vault"],
  ["generator", "a changed vault format would leave a vault a recompiled reader cannot decrypt"],
  ["ui_vault.rs", "a changed reader would meet a vault generated in the old format"],
]) {
  assert.ok(watched.includes(needle), `build.rs must watch ${needle}: ${why}`);
}

// ---------------------------------------------------------------------------
// 3. The generator, run against the real interface.
// ---------------------------------------------------------------------------
assert.ok(existsSync(GENERATOR), "scripts/build-ui-vault.mjs must exist");
assert.ok(existsSync(AUDIT), "scripts/audit-binary-shield.mjs must exist");

// An output directory that is not given must be refused rather than defaulted: a default is how key
// material ends up written into a tracked path.
const withoutArguments = spawnSync(process.execPath, [GENERATOR], { encoding: "utf8" });
assert.equal(withoutArguments.status, 2, "the generator must refuse to run without an output directory");

const outDir = mkdtempSync(join(tmpdir(), "wing-vault-"));
try {
  const generated = spawnSync(process.execPath, [GENERATOR, UI_DIR, outDir], { encoding: "utf8" });
  assert.equal(generated.status, 0, `the generator failed: ${generated.stderr}`);
  assert.ok(existsSync(join(outDir, "ui_vault.bin")), "the generator must write the vault");
  assert.ok(existsSync(join(outDir, "ui_vault_keys.rs")), "the generator must write the key file");

  // Nothing may be written into the repository: the vault is a build artefact and the key is key material.
  for (const stray of ["desktop/src-tauri/gen/ui_vault.bin", "desktop/src-tauri/gen/ui_vault_keys.rs", "ui_vault.bin", "ui_vault_keys.rs"]) {
    assert.ok(!existsSync(`${ROOT}${stray}`), `the generator must not write ${stray} into the repository`);
  }

  const vault = readFileSync(join(outDir, "ui_vault.bin"));

  // The key, exactly as `desktop/src-tauri/src/ui_vault.rs` derives it: SHA-256(seed || salt || domain),
  // with the seed reassembled from the two stored constants.
  const keysSource = readFileSync(join(outDir, "ui_vault_keys.rs"), "utf8");
  function rustArray(name) {
    const match = new RegExp(`pub const ${name}: \\[u8; (\\d+)\\] = \\[([\\s\\S]*?)\\];`).exec(keysSource);
    assert.ok(match, `${name} must be in the generated key file`);
    const values = [...match[2].matchAll(/0x([0-9a-fA-F]{2})/g)].map((found) => parseInt(found[1], 16));
    assert.equal(values.length, Number(match[1]), `${name} must hold exactly ${match[1]} bytes`);
    return Buffer.from(values);
  }
  const maskedSeed = rustArray("UI_VAULT_SEED_XOR");
  const mask = rustArray("UI_VAULT_SEED_MASK");
  const salt = rustArray("UI_VAULT_SALT");
  const seed = Buffer.from(maskedSeed.map((byte, index) => byte ^ mask[index]));
  const key = createHash("sha256").update(seed).update(salt).update(DOMAIN).digest();
  assert.notDeepEqual(
    key,
    maskedSeed,
    "the key must not be a value that is stored in the binary; it is derived from the stored ingredients",
  );

  // The vault's own framing.
  assert.equal(vault.subarray(0, 8).toString("latin1"), "WCVLT1\0\0", "the vault must start with its magic");
  assert.equal(vault.readUInt32LE(8), 1, "the vault format version must be the one the reader knows");
  const count = vault.readUInt32LE(12);

  const entries = [];
  let cursor = 16;
  for (let index = 0; index < count; index += 1) {
    const tag = vault.subarray(cursor, cursor + 8);
    cursor += 8;
    const nonce = vault.subarray(cursor, cursor + 12);
    cursor += 12;
    const length = vault.readUInt32LE(cursor);
    cursor += 4;
    const body = vault.subarray(cursor, cursor + length);
    cursor += length;
    entries.push({ tag, nonce, body });
  }
  assert.equal(cursor, vault.length, "the vault must be exactly as long as its entries describe");

  function open(entry) {
    const decipher = createDecipheriv("chacha20-poly1305", key, entry.nonce, { authTagLength: 16 });
    decipher.setAAD(entry.tag);
    decipher.setAuthTag(entry.body.subarray(entry.body.length - 16));
    const plain = Buffer.concat([
      decipher.update(entry.body.subarray(0, entry.body.length - 16)),
      decipher.final(),
    ]);
    const nameLength = plain.readUInt16LE(0);
    return { name: plain.subarray(2, 2 + nameLength).toString("utf8"), content: plain.subarray(2 + nameLength) };
  }

  // Every interface file, byte for byte.
  function walk(dir) {
    const found = [];
    for (const dirent of readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      if (dirent.name.startsWith(".")) continue;
      const path = join(dir, dirent.name);
      if (dirent.isDirectory()) found.push(...walk(path));
      else if (dirent.isFile()) found.push(path);
    }
    return found;
  }

  const files = walk(UI_DIR);
  assert.ok(files.length > 0, "desktop/ui must hold the interface");
  assert.equal(entries.length, files.length, "the vault must hold one entry per interface file");

  const decoded = new Map();
  for (const entry of entries) {
    const { name, content } = open(entry);
    assert.ok(name.startsWith("/"), `every entry name must be an absolute-style key, found ${name}`);
    assert.ok(!decoded.has(name), `the vault must not hold ${name} twice`);
    decoded.set(name, content);
  }

  for (const path of files) {
    const name = `/${relative(UI_DIR, path).split(sep).join("/")}`;
    const expected = readFileSync(path);
    const served = decoded.get(name);
    assert.ok(served, `the vault must hold ${name}`);
    assert.ok(served.equals(expected), `${name} must decrypt to the file on disk, byte for byte`);
  }

  // What the shield is for. A readable name or a readable excerpt in the ciphertext means the interface
  // can be listed or partly read straight out of the shipped binary.
  for (const path of files) {
    const name = relative(UI_DIR, path).split(sep).join("/");
    assert.ok(
      !vault.includes(Buffer.from(name, "utf8")),
      `the vault must not carry the file name ${name} in the clear`,
    );

    const content = readFileSync(path);
    const steps = Math.max(1, Math.floor(content.length / 8));
    for (let offset = 0; offset + 64 <= content.length; offset += steps) {
      const excerpt = content.subarray(offset, offset + 64);
      if (!excerpt.every((byte) => byte >= 0x20 && byte <= 0x7e)) continue;
      assert.ok(
        !vault.includes(excerpt),
        `${name} survives in the vault as plain text at offset ${offset}: ${excerpt.toString("utf8")}`,
      );
    }
  }

  // Tamper detection, which is what the window's "Instalación dañada" page rests on.
  const first = entries[0];
  const tampered = {
    tag: first.tag,
    nonce: first.nonce,
    body: Buffer.from(first.body),
  };
  tampered.body[tampered.body.length - 1] ^= 0x01;
  assert.throws(() => open(tampered), "a flipped byte in an entry must not decrypt");

  const wrongTag = { tag: Buffer.from(first.tag), nonce: first.nonce, body: first.body };
  wrongTag.tag[0] ^= 0x01;
  assert.throws(() => open(wrongTag), "an entry must not decrypt under another entry's tag");

  console.log(
    `binary shield contract passed: ${entries.length} interface files, ${(vault.length / 1048576).toFixed(1)} MB ` +
      `of ciphertext, no names or excerpts in the clear, tampering refused`,
  );
} finally {
  rmSync(outDir, { recursive: true, force: true });
}

// The generator must be a build tool and nothing else: if it ever grows a default output path, the "must
// not write into the repository" assertion above stops meaning anything, so the argument is required here.
assert.ok(statSync(GENERATOR).isFile(), "scripts/build-ui-vault.mjs must be a file");
